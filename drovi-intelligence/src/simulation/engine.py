"""Counterfactual simulation engine."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
import hashlib
import json
import random
from typing import Any
from uuid import uuid4

import structlog
from sqlalchemy import text

from src.causal import CausalEdge, CausalEngine
from src.continuum.manager import compute_next_run_at, fetch_continuum_definition
from src.db.client import get_db_session
from src.db.rls import set_rls_context
from src.events.publisher import get_event_publisher
from src.graph.client import get_graph_client
from src.kernel.time import utc_now_naive
from src.simulation.models import (
    ContinuumPreviewResponse,
    RiskInterval,
    RiskSnapshot,
    ScenarioAction,
    ScenarioStep,
    SensitivityResult,
    SimulationOverride,
    SimulationRequest,
    SimulationResponse,
    StressTestResult,
    UtilityBreakdown,
    UtilityObjectiveProfile,
    UtilityWeights,
)

logger = structlog.get_logger()


def _normalize_due_date(value: Any) -> datetime | None:
    if not isinstance(value, datetime):
        return None
    if value.tzinfo is not None:
        return value.replace(tzinfo=None)
    return value


def _compute_risk_score(open_count: int, overdue_count: int) -> float:
    if open_count <= 0:
        return 0.0
    ratio = overdue_count / max(open_count, 1)
    base = 0.2 + (0.6 * ratio)
    return min(1.0, max(0.0, base))


def _risk_outlook(score: float) -> str:
    if score >= 0.7:
        return "high"
    if score >= 0.4:
        return "medium"
    return "low"


def _is_open(status: str | None) -> bool:
    return status not in ("completed", "cancelled", "archived")


def _as_float(value: Any, default: float = 0.0) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def _clamp(value: float, low: float, high: float) -> float:
    return max(low, min(high, value))


def _stable_hash(payload: Any) -> str:
    return hashlib.sha256(
        json.dumps(payload, sort_keys=True, separators=(",", ":"), default=str).encode("utf-8")
    ).hexdigest()


def _percentile(values: list[float], percentile: int) -> float:
    if not values:
        return 0.0
    ordered = sorted(values)
    if len(ordered) == 1:
        return float(ordered[0])
    rank = (max(0, min(percentile, 100)) / 100.0) * (len(ordered) - 1)
    lower = int(rank)
    upper = min(lower + 1, len(ordered) - 1)
    weight = rank - lower
    return float((ordered[lower] * (1.0 - weight)) + (ordered[upper] * weight))


_UTILITY_PROFILES: dict[str, UtilityWeights] = {
    "balanced": UtilityWeights(),
    "compliance": UtilityWeights(
        overdue_penalty=0.65,
        at_risk_penalty=0.30,
        open_penalty=0.05,
        cancellation_penalty=0.20,
        complexity_penalty=0.10,
        resilience_reward=0.08,
    ),
    "growth": UtilityWeights(
        overdue_penalty=0.45,
        at_risk_penalty=0.20,
        open_penalty=0.18,
        cancellation_penalty=0.10,
        complexity_penalty=0.05,
        resilience_reward=0.20,
    ),
    "resilience": UtilityWeights(
        overdue_penalty=0.55,
        at_risk_penalty=0.30,
        open_penalty=0.10,
        cancellation_penalty=0.20,
        complexity_penalty=0.15,
        resilience_reward=0.15,
    ),
}


def _resolve_utility_weights(profile: UtilityObjectiveProfile) -> UtilityWeights:
    base = _UTILITY_PROFILES.get(profile.profile_name, _UTILITY_PROFILES["balanced"])
    if profile.weights is None:
        return base
    override_payload = profile.weights.model_dump(exclude_none=True)
    merged = base.model_dump()
    merged.update(override_payload)
    return UtilityWeights.model_validate(merged)


def _derive_seed(request: SimulationRequest) -> int:
    if request.seed is not None:
        return int(request.seed)
    digest = _stable_hash(
        {
            "organization_id": request.organization_id,
            "scenario_name": request.scenario_name,
            "scenario_type": request.scenario_type,
            "horizon_days": request.horizon_days,
            "overrides": request.overrides.model_dump(mode="json"),
            "steps": [step.model_dump(mode="json") for step in request.steps],
            "objective_profile": request.objective_profile.model_dump(mode="json"),
        }
    )
    return int(digest[:8], 16) or 1


def _legacy_override_steps(overrides: SimulationOverride) -> list[ScenarioStep]:
    delay_actions = [
        ScenarioAction(
            action_type="delay_commitment",
            commitment_id=commitment_id,
            delay_days=int(delay_days),
        )
        for commitment_id, delay_days in sorted(overrides.commitment_delays.items())
    ]
    cancel_actions = [
        ScenarioAction(
            action_type="cancel_commitment",
            commitment_id=commitment_id,
        )
        for commitment_id in sorted(overrides.commitment_cancellations)
    ]

    steps: list[ScenarioStep] = []
    if delay_actions:
        steps.append(
            ScenarioStep(
                step_id="legacy_delay_batch",
                name="Legacy delay overrides",
                day_offset=0,
                actions=delay_actions,
            )
        )
    if cancel_actions:
        steps.append(
            ScenarioStep(
                step_id="legacy_cancel_batch",
                name="Legacy cancellation overrides",
                day_offset=0,
                actions=cancel_actions,
            )
        )
    return steps


def _canonicalize_steps(request: SimulationRequest) -> list[ScenarioStep]:
    combined: list[ScenarioStep] = [step.model_copy(deep=True) for step in request.steps]
    combined.extend(_legacy_override_steps(request.overrides))
    combined.sort(key=lambda step: (step.day_offset, step.step_id))
    return combined


def _summarize_commitments(
    commitments: list[dict[str, Any]],
    *,
    now: datetime,
    horizon_days: int,
) -> RiskSnapshot:
    open_commitments = 0
    overdue_commitments = 0
    at_risk_commitments = 0
    horizon_date = now + timedelta(days=horizon_days)

    for item in commitments:
        if not _is_open(item.get("status")):
            continue
        open_commitments += 1
        due_date = _normalize_due_date(item.get("due_date"))
        if due_date and due_date < now:
            overdue_commitments += 1
        if due_date and due_date <= horizon_date:
            at_risk_commitments += 1

    risk_score = _compute_risk_score(open_commitments, overdue_commitments)
    return RiskSnapshot(
        open_commitments=open_commitments,
        overdue_commitments=overdue_commitments,
        at_risk_commitments=at_risk_commitments,
        risk_score=risk_score,
        risk_outlook=_risk_outlook(risk_score),
    )


def _apply_scenario_steps(
    commitments: list[dict[str, Any]],
    *,
    steps: list[ScenarioStep],
    now: datetime,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    updated = [dict(item) for item in commitments]
    by_id = {
        str(item.get("id")): item
        for item in updated
        if item.get("id")
    }
    trace: list[dict[str, Any]] = []

    for step in sorted(steps, key=lambda current: (current.day_offset, current.step_id)):
        for action in step.actions:
            if action.action_type == "bulk_overdue_shift":
                shift_days = int(action.metadata.get("days") or 7)
                limit = int(action.metadata.get("limit") or len(updated))
                shift_days = max(1, abs(shift_days))
                moved = 0
                for item in updated:
                    if moved >= limit:
                        break
                    if not _is_open(item.get("status")):
                        continue
                    before_due = _normalize_due_date(item.get("due_date"))
                    if before_due is None:
                        continue
                    after_due = before_due - timedelta(days=shift_days)
                    item["due_date"] = after_due
                    moved += 1
                    trace.append(
                        {
                            "step_id": step.step_id,
                            "action_type": action.action_type,
                            "commitment_id": str(item.get("id") or ""),
                            "before_due_date": before_due.isoformat(),
                            "after_due_date": after_due.isoformat(),
                        }
                    )
                continue

            commitment_id = str(action.commitment_id or "")
            if not commitment_id:
                continue
            target = by_id.get(commitment_id)
            if target is None:
                continue

            before_status = str(target.get("status") or "")
            before_due = _normalize_due_date(target.get("due_date"))
            after_status = before_status
            after_due = before_due

            if action.action_type == "delay_commitment":
                delay_days = int(action.delay_days if action.delay_days is not None else action.metadata.get("delay_days", 0))
                if before_due is None:
                    after_due = now + timedelta(days=max(1, delay_days))
                else:
                    after_due = before_due + timedelta(days=delay_days)
                target["due_date"] = after_due
            elif action.action_type == "cancel_commitment":
                after_status = "cancelled"
                target["status"] = after_status
            elif action.action_type == "reopen_commitment":
                after_status = "open"
                target["status"] = after_status
                if before_due is None:
                    target["due_date"] = now + timedelta(days=7)
                    after_due = _normalize_due_date(target.get("due_date"))
            elif action.action_type == "set_due_date":
                if action.due_date is not None:
                    after_due = _normalize_due_date(action.due_date)
                    target["due_date"] = after_due

            trace.append(
                {
                    "step_id": step.step_id,
                    "action_type": action.action_type,
                    "commitment_id": commitment_id,
                    "before_status": before_status,
                    "after_status": after_status,
                    "before_due_date": before_due.isoformat() if before_due else None,
                    "after_due_date": after_due.isoformat() if after_due else None,
                }
            )

    return updated, trace


def _compute_sensitivity(
    commitments: list[dict[str, Any]],
    *,
    steps: list[ScenarioStep],
    baseline: RiskSnapshot,
    now: datetime,
    horizon_days: int,
) -> list[SensitivityResult]:
    results: list[SensitivityResult] = []
    mapping = {
        "delay_commitment": "delay",
        "set_due_date": "delay",
        "cancel_commitment": "cancel",
        "reopen_commitment": "reopen",
        "bulk_overdue_shift": "bulk_overdue_shift",
    }

    for step in steps:
        for action in step.actions:
            probe_step = ScenarioStep(
                step_id=step.step_id,
                name=step.name,
                day_offset=step.day_offset,
                actions=[action],
            )
            simulated, _ = _apply_scenario_steps(
                commitments,
                steps=[probe_step],
                now=now,
            )
            summary = _summarize_commitments(
                simulated,
                now=now,
                horizon_days=horizon_days,
            )
            commitment_id = str(action.commitment_id or "__bulk__")
            results.append(
                SensitivityResult(
                    commitment_id=commitment_id,
                    change_type=mapping.get(action.action_type, "delay"),
                    delta_risk_score=round(summary.risk_score - baseline.risk_score, 3),
                    delta_overdue=summary.overdue_commitments - baseline.overdue_commitments,
                    step_id=step.step_id,
                )
            )
    return results[:50]


def _count_new_cancellations(
    baseline_commitments: list[dict[str, Any]],
    simulated_commitments: list[dict[str, Any]],
) -> int:
    baseline_status = {
        str(item.get("id")): str(item.get("status") or "")
        for item in baseline_commitments
        if item.get("id")
    }
    count = 0
    for item in simulated_commitments:
        commitment_id = str(item.get("id") or "")
        if not commitment_id:
            continue
        before_status = baseline_status.get(commitment_id)
        after_status = str(item.get("status") or "")
        if before_status != "cancelled" and after_status == "cancelled":
            count += 1
    return count


def _compute_utility_breakdown(
    *,
    baseline: RiskSnapshot,
    simulated: RiskSnapshot,
    objective_profile: UtilityObjectiveProfile,
    action_count: int,
    cancellation_count: int,
) -> UtilityBreakdown:
    weights = _resolve_utility_weights(objective_profile)
    complexity_ratio = _clamp(action_count / 12.0, 0.0, 1.0)

    def evaluate(snapshot: RiskSnapshot, *, cancellations: int) -> dict[str, float]:
        open_base = max(snapshot.open_commitments + cancellations, 1)
        overdue_ratio = _clamp(snapshot.overdue_commitments / open_base, 0.0, 1.0)
        at_risk_ratio = _clamp(snapshot.at_risk_commitments / open_base, 0.0, 1.0)
        open_ratio = _clamp(snapshot.open_commitments / 50.0, 0.0, 1.0)
        cancellation_ratio = _clamp(cancellations / open_base, 0.0, 1.0)
        penalty = (
            (overdue_ratio * weights.overdue_penalty)
            + (at_risk_ratio * weights.at_risk_penalty)
            + (open_ratio * weights.open_penalty)
            + (cancellation_ratio * weights.cancellation_penalty)
            + (complexity_ratio * weights.complexity_penalty)
        )
        resilience_reward = _clamp(1.0 - snapshot.risk_score, 0.0, 1.0) * weights.resilience_reward
        utility_score = _clamp(1.0 - penalty + resilience_reward, -1.0, 1.0)
        return {
            "overdue_ratio": overdue_ratio,
            "at_risk_ratio": at_risk_ratio,
            "open_ratio": open_ratio,
            "cancellation_ratio": cancellation_ratio,
            "complexity_ratio": complexity_ratio,
            "penalty": penalty,
            "resilience_reward": resilience_reward,
            "utility": utility_score,
        }

    baseline_eval = evaluate(baseline, cancellations=0)
    simulated_eval = evaluate(simulated, cancellations=cancellation_count)
    return UtilityBreakdown(
        profile_name=objective_profile.profile_name,
        baseline_utility=round(baseline_eval["utility"], 4),
        simulated_utility=round(simulated_eval["utility"], 4),
        utility_delta=round(simulated_eval["utility"] - baseline_eval["utility"], 4),
        components={
            "baseline_penalty": round(baseline_eval["penalty"], 4),
            "simulated_penalty": round(simulated_eval["penalty"], 4),
            "baseline_resilience_reward": round(baseline_eval["resilience_reward"], 4),
            "simulated_resilience_reward": round(simulated_eval["resilience_reward"], 4),
            "complexity_ratio": round(complexity_ratio, 4),
            "cancellation_ratio": round(simulated_eval["cancellation_ratio"], 4),
        },
    )


def _compute_uncertainty_intervals(
    *,
    commitments: list[dict[str, Any]],
    now: datetime,
    horizon_days: int,
    seed: int,
    samples: int = 64,
) -> tuple[list[RiskInterval], float]:
    rng = random.Random(seed)
    risk_scores: list[float] = []
    overdue_counts: list[float] = []
    at_risk_counts: list[float] = []

    for _ in range(max(16, samples)):
        perturbed: list[dict[str, Any]] = []
        for item in commitments:
            mutated = dict(item)
            due_date = _normalize_due_date(mutated.get("due_date"))
            if due_date is not None and _is_open(mutated.get("status")):
                jitter = rng.randint(-2, 3)
                mutated["due_date"] = due_date + timedelta(days=jitter)
            if str(mutated.get("status") or "") == "cancelled" and rng.random() <= 0.04:
                mutated["status"] = "open"
            perturbed.append(mutated)

        summary = _summarize_commitments(
            perturbed,
            now=now,
            horizon_days=horizon_days,
        )
        risk_scores.append(float(summary.risk_score))
        overdue_counts.append(float(summary.overdue_commitments))
        at_risk_counts.append(float(summary.at_risk_commitments))

    intervals = [
        RiskInterval(
            metric="risk_score",
            p10=round(_percentile(risk_scores, 10), 4),
            p50=round(_percentile(risk_scores, 50), 4),
            p90=round(_percentile(risk_scores, 90), 4),
        ),
        RiskInterval(
            metric="overdue_commitments",
            p10=round(_percentile(overdue_counts, 10), 3),
            p50=round(_percentile(overdue_counts, 50), 3),
            p90=round(_percentile(overdue_counts, 90), 3),
        ),
        RiskInterval(
            metric="at_risk_commitments",
            p10=round(_percentile(at_risk_counts, 10), 3),
            p50=round(_percentile(at_risk_counts, 50), 3),
            p90=round(_percentile(at_risk_counts, 90), 3),
        ),
    ]

    downside = max(0.0, intervals[0].p90 - intervals[0].p50)
    return intervals, round(downside, 4)


def _build_stress_test_steps(open_commitment_ids: list[str]) -> list[tuple[str, str, str, list[ScenarioStep]]]:
    if not open_commitment_ids:
        return []
    head = open_commitment_ids[0]
    return [
        (
            "stress_adversarial_cancel_chain",
            "Adversarial cancellation chain reaction",
            "adversarial",
            [
                ScenarioStep(
                    step_id="adversarial_cancel",
                    day_offset=0,
                    actions=[ScenarioAction(action_type="cancel_commitment", commitment_id=head)],
                ),
                ScenarioStep(
                    step_id="adversarial_pull_forward",
                    day_offset=1,
                    actions=[
                        ScenarioAction(
                            action_type="bulk_overdue_shift",
                            metadata={"days": 10, "limit": min(5, len(open_commitment_ids))},
                        )
                    ],
                ),
            ],
        ),
        (
            "stress_rare_black_swan_deadline_pullforward",
            "Rare-event deadline pull-forward",
            "rare_event",
            [
                ScenarioStep(
                    step_id="rare_pull_forward",
                    day_offset=0,
                    actions=[
                        ScenarioAction(
                            action_type="bulk_overdue_shift",
                            metadata={"days": 21, "limit": min(12, len(open_commitment_ids))},
                        )
                    ],
                )
            ],
        ),
    ]


def _run_stress_tests(
    *,
    commitments: list[dict[str, Any]],
    reference_snapshot: RiskSnapshot,
    now: datetime,
    horizon_days: int,
) -> list[StressTestResult]:
    open_commitment_ids = [
        str(item.get("id"))
        for item in commitments
        if item.get("id") and _is_open(item.get("status"))
    ]
    scenarios = _build_stress_test_steps(open_commitment_ids)

    results: list[StressTestResult] = []
    for scenario_id, scenario_name, category, steps in scenarios:
        stressed, _ = _apply_scenario_steps(
            commitments,
            steps=steps,
            now=now,
        )
        summary = _summarize_commitments(
            stressed,
            now=now,
            horizon_days=horizon_days,
        )
        delta = round(summary.risk_score - reference_snapshot.risk_score, 4)
        passed = summary.risk_score <= min(1.0, reference_snapshot.risk_score + 0.2)
        results.append(
            StressTestResult(
                scenario_id=scenario_id,
                scenario_name=scenario_name,
                category=category,  # type: ignore[arg-type]
                simulated=summary,
                delta_risk_score=delta,
                passed=passed,
                notes=(
                    "Stress tolerance within threshold"
                    if passed
                    else "Stress scenario exceeded tolerance; policy gate escalation recommended"
                ),
            )
        )
    return results


async def _fetch_commitments(organization_id: str) -> list[dict[str, Any]]:
    set_rls_context(organization_id, is_internal=True)
    try:
        async with get_db_session() as session:
            result = await session.execute(
                text(
                    """
                    SELECT id, status, due_date
                    FROM unified_intelligence_object
                    WHERE organization_id = :org_id
                      AND type = 'commitment'
                    """
                ),
                {"org_id": organization_id},
            )
            return [dict(row._mapping) for row in result.fetchall()]
    finally:
        set_rls_context(None, is_internal=False)


async def _fetch_causal_edges(
    *,
    organization_id: str,
    source_refs: list[str],
    limit_per_source: int = 500,
) -> list[CausalEdge]:
    if not source_refs:
        return []

    graph = await get_graph_client()
    rows: list[dict[str, Any]] = []
    seen_pairs: set[tuple[str, str]] = set()

    for source_ref in source_refs[:6]:
        try:
            fetched = await graph.get_causal_edges(
                organization_id=organization_id,
                source_ref=source_ref,
                min_confidence=0.05,
                limit=limit_per_source,
            )
        except Exception as exc:  # pragma: no cover - defensive, external dependency
            logger.warning(
                "Failed to fetch causal edges for simulation",
                organization_id=organization_id,
                source_ref=source_ref,
                error=str(exc),
            )
            continue

        for row in fetched:
            pair = (str(row.get("source_ref") or ""), str(row.get("target_ref") or ""))
            if not pair[0] or not pair[1] or pair in seen_pairs:
                continue
            seen_pairs.add(pair)
            rows.append(row)

    edges: list[CausalEdge] = []
    for index, row in enumerate(rows):
        lag_hours = max(0.0, _as_float(row.get("lag_hours"), 24.0))
        edges.append(
            CausalEdge(
                edge_id=str(row.get("edge_id") or f"graph_edge_{index}"),
                source_ref=str(row.get("source_ref")),
                target_ref=str(row.get("target_ref")),
                sign=-1 if int(_as_float(row.get("sign"), 1.0)) < 0 else 1,
                strength=max(0.01, min(1.0, _as_float(row.get("strength"), 0.5))),
                lag_hours=lag_hours,
                lag_distribution={
                    "p10": max(0.0, lag_hours * 0.5),
                    "p50": lag_hours,
                    "p90": max(lag_hours, lag_hours * 1.5),
                    "sample_size": 1.0,
                },
                confidence=max(0.01, min(1.0, _as_float(row.get("confidence"), 0.5))),
                evidence_refs=[str(item) for item in list(row.get("evidence_refs") or []) if item],
            )
        )
    return edges


async def _compute_causal_projection(
    *,
    organization_id: str,
    commitments: list[dict[str, Any]],
    source_refs: list[str],
    risk_delta: dict[str, Any],
) -> tuple[list[dict[str, Any]], str | None]:
    effective_sources = [ref for ref in source_refs if ref]
    if not effective_sources:
        effective_sources = [
            str(item.get("id"))
            for item in commitments
            if item.get("id") and _is_open(item.get("status"))
        ][:3]

    edges = await _fetch_causal_edges(
        organization_id=organization_id,
        source_refs=effective_sources,
    )
    if not edges:
        return [], None

    engine = CausalEngine()
    shock_magnitude = max(
        0.1,
        abs(_as_float(risk_delta.get("risk_score"), 0.0))
        + (0.05 * abs(_as_float(risk_delta.get("overdue_commitments"), 0.0))),
    )

    seen: set[tuple[str, str, int, str]] = set()
    combined_impacts = []
    for source_ref in effective_sources[:3]:
        impacts = engine.propagate_second_order_impacts(
            edges=edges,
            origin_ref=source_ref,
            magnitude=shock_magnitude,
            max_hops=3,
            horizon_hours=24.0 * 30.0,
            min_abs_delta=0.005,
        )
        for impact in impacts:
            key = (
                impact.source_ref,
                impact.target_ref,
                impact.hop,
                "->".join(impact.path),
            )
            if key in seen:
                continue
            seen.add(key)
            combined_impacts.append(impact)

    combined_impacts.sort(
        key=lambda item: (
            -abs(item.expected_delta),
            item.hop,
            item.target_ref,
            "->".join(item.path),
        )
    )
    trimmed = combined_impacts[:20]
    replay_hash = engine.replay_stability_hash(trimmed) if trimmed else None
    return [item.to_dict() for item in trimmed], replay_hash


def _extract_source_refs(steps: list[ScenarioStep]) -> list[str]:
    refs: list[str] = []
    for step in steps:
        for action in step.actions:
            if action.commitment_id:
                refs.append(str(action.commitment_id))
    deduped: list[str] = []
    seen: set[str] = set()
    for ref in refs:
        if ref in seen:
            continue
        seen.add(ref)
        deduped.append(ref)
    return deduped


async def _publish_simulation_events(
    *,
    organization_id: str,
    simulation_id: str,
    scenario_name: str,
    scenario_type: str,
    source_refs: list[str],
    requested_by: str | None,
    downside_risk_estimate: float,
    expected_utility_delta: float,
    summary_payload: dict[str, Any],
) -> None:
    publisher = await get_event_publisher()
    now = datetime.now(UTC)

    await publisher.publish_world_brain_contract_event(
        {
            "schema_version": "1.0",
            "organization_id": organization_id,
            "event_id": str(uuid4()),
            "occurred_at": now,
            "producer": "drovi-intelligence",
            "event_type": "simulation.requested.v1",
            "payload": {
                "simulation_id": simulation_id,
                "scenario_name": scenario_name,
                "scenario_type": scenario_type,
                "requested_by": requested_by,
                "requested_at": now,
                "input_ref": None,
                "target_refs": source_refs[:25],
            },
        }
    )

    await publisher.publish_world_brain_contract_event(
        {
            "schema_version": "1.0",
            "organization_id": organization_id,
            "event_id": str(uuid4()),
            "occurred_at": now,
            "producer": "drovi-intelligence",
            "event_type": "simulation.completed.v1",
            "payload": {
                "simulation_id": simulation_id,
                "scenario_name": scenario_name,
                "status": "completed",
                "completed_at": now,
                "result_summary": summary_payload,
                "downside_risk_estimate": downside_risk_estimate,
                "expected_utility_delta": expected_utility_delta,
            },
        }
    )


async def run_simulation(
    request: SimulationRequest,
    *,
    persist: bool = True,
    publish_events: bool = False,
    requested_by: str | None = None,
) -> SimulationResponse:
    commitments = await _fetch_commitments(request.organization_id)
    now = utc_now_naive()
    replay_seed = _derive_seed(request)

    baseline = _summarize_commitments(
        commitments,
        now=now,
        horizon_days=request.horizon_days,
    )

    steps = _canonicalize_steps(request)
    simulated_commitments, step_trace = _apply_scenario_steps(
        commitments,
        steps=steps,
        now=now,
    )
    simulated = _summarize_commitments(
        simulated_commitments,
        now=now,
        horizon_days=request.horizon_days,
    )

    delta = {
        "open_commitments": simulated.open_commitments - baseline.open_commitments,
        "overdue_commitments": simulated.overdue_commitments - baseline.overdue_commitments,
        "at_risk_commitments": simulated.at_risk_commitments - baseline.at_risk_commitments,
        "risk_score": round(simulated.risk_score - baseline.risk_score, 3),
    }

    sensitivity = _compute_sensitivity(
        commitments,
        steps=steps,
        baseline=baseline,
        now=now,
        horizon_days=request.horizon_days,
    )
    source_refs = _extract_source_refs(steps)

    causal_projection, causal_replay_hash = await _compute_causal_projection(
        organization_id=request.organization_id,
        commitments=commitments,
        source_refs=source_refs,
        risk_delta=delta,
    )

    cancellation_count = _count_new_cancellations(commitments, simulated_commitments)
    utility = _compute_utility_breakdown(
        baseline=baseline,
        simulated=simulated,
        objective_profile=request.objective_profile,
        action_count=len(step_trace),
        cancellation_count=cancellation_count,
    )

    risk_intervals, downside_risk_estimate = _compute_uncertainty_intervals(
        commitments=simulated_commitments,
        now=now,
        horizon_days=request.horizon_days,
        seed=replay_seed,
    )
    stress_tests = _run_stress_tests(
        commitments=simulated_commitments,
        reference_snapshot=simulated,
        now=now,
        horizon_days=request.horizon_days,
    )

    scenario_replay_hash = _stable_hash(
        {
            "seed": replay_seed,
            "steps": [step.model_dump(mode="json") for step in steps],
            "trace": step_trace,
            "delta": delta,
            "utility": utility.model_dump(mode="json"),
            "risk_intervals": [interval.model_dump(mode="json") for interval in risk_intervals],
        }
    )

    failed_stress = sum(1 for item in stress_tests if not item.passed)
    narrative = (
        f"Simulated horizon {request.horizon_days} days with {len(step_trace)} actions. "
        f"Open commitments: {baseline.open_commitments} → {simulated.open_commitments}. "
        f"Overdue: {baseline.overdue_commitments} → {simulated.overdue_commitments}. "
        f"Risk score: {baseline.risk_score:.2f} → {simulated.risk_score:.2f}. "
        f"Utility ({utility.profile_name}): {utility.baseline_utility:.2f} → {utility.simulated_utility:.2f}. "
        f"Downside tail risk +{downside_risk_estimate:.3f}."
    )
    if failed_stress:
        narrative += f" {failed_stress} stress scenario(s) exceeded tolerance."
    if causal_projection:
        top_impact = causal_projection[0]
        narrative += (
            f" Causal projection highlights {top_impact.get('target_ref')} "
            f"(delta {top_impact.get('expected_delta'):.3f}, hop {top_impact.get('hop')})."
        )

    simulation_id = str(uuid4())
    output_payload = {
        "baseline": baseline.model_dump(mode="json"),
        "simulated": simulated.model_dump(mode="json"),
        "delta": delta,
        "utility": utility.model_dump(mode="json"),
        "risk_intervals": [interval.model_dump(mode="json") for interval in risk_intervals],
        "downside_risk_estimate": downside_risk_estimate,
        "sensitivity": [item.model_dump(mode="json") for item in sensitivity],
        "stress_tests": [item.model_dump(mode="json") for item in stress_tests],
        "causal_projection": causal_projection,
        "causal_replay_hash": causal_replay_hash,
        "scenario_replay_hash": scenario_replay_hash,
        "replay_seed": replay_seed,
        "narrative": narrative,
    }

    if persist:
        set_rls_context(request.organization_id, is_internal=True)
        try:
            async with get_db_session() as session:
                await session.execute(
                    text(
                        """
                        INSERT INTO simulation_run (
                            id,
                            organization_id,
                            scenario_name,
                            scenario_type,
                            status,
                            input_payload,
                            output_payload,
                            started_at,
                            completed_at,
                            run_metadata,
                            created_at
                        ) VALUES (
                            :id,
                            :org_id,
                            :scenario_name,
                            :scenario_type,
                            :status,
                            :input_payload,
                            :output_payload,
                            :started_at,
                            :completed_at,
                            :run_metadata,
                            :created_at
                        )
                        """
                    ),
                    {
                        "id": simulation_id,
                        "org_id": request.organization_id,
                        "scenario_name": request.scenario_name,
                        "scenario_type": request.scenario_type,
                        "status": "completed",
                        "input_payload": request.model_dump(mode="json"),
                        "output_payload": output_payload,
                        "started_at": now,
                        "completed_at": now,
                        "run_metadata": {
                            "replay_seed": replay_seed,
                            "scenario_replay_hash": scenario_replay_hash,
                            "action_count": len(step_trace),
                        },
                        "created_at": now,
                    },
                )
        finally:
            set_rls_context(None, is_internal=False)

    if publish_events:
        try:
            await _publish_simulation_events(
                organization_id=request.organization_id,
                simulation_id=simulation_id,
                scenario_name=request.scenario_name,
                scenario_type=request.scenario_type,
                source_refs=source_refs,
                requested_by=requested_by,
                downside_risk_estimate=downside_risk_estimate,
                expected_utility_delta=utility.utility_delta,
                summary_payload={
                    "delta": delta,
                    "risk_outlook": simulated.risk_outlook,
                    "failed_stress_tests": failed_stress,
                    "scenario_replay_hash": scenario_replay_hash,
                },
            )
        except Exception as exc:  # pragma: no cover - non-blocking event publication
            logger.warning(
                "Failed to publish simulation contract events",
                organization_id=request.organization_id,
                simulation_id=simulation_id,
                error=str(exc),
            )

    return SimulationResponse(
        simulation_id=simulation_id,
        scenario_name=request.scenario_name,
        baseline=baseline,
        simulated=simulated,
        delta=delta,
        utility=utility,
        risk_intervals=risk_intervals,
        downside_risk_estimate=downside_risk_estimate,
        sensitivity=sensitivity,
        stress_tests=stress_tests,
        causal_projection=causal_projection,
        causal_replay_hash=causal_replay_hash,
        scenario_replay_hash=scenario_replay_hash,
        replay_seed=replay_seed,
        narrative=narrative,
    )


async def preview_continuum(
    *,
    organization_id: str,
    continuum_id: str,
    horizon_days: int = 30,
) -> ContinuumPreviewResponse:
    definition = await fetch_continuum_definition(
        continuum_id=continuum_id,
        organization_id=organization_id,
    )

    commitments = await _fetch_commitments(organization_id)
    now = utc_now_naive()
    snapshot = _summarize_commitments(commitments, now=now, horizon_days=horizon_days)

    next_run = compute_next_run_at(definition, now)
    schedule_payload = {
        "type": definition.schedule.type,
        "interval_minutes": definition.schedule.interval_minutes,
        "cron": definition.schedule.cron,
        "next_run_at": next_run.isoformat() if next_run else None,
    }

    return ContinuumPreviewResponse(
        continuum_id=continuum_id,
        name=definition.name,
        goal=definition.goal,
        schedule=schedule_payload,
        expected_actions=[step.action for step in definition.steps],
        proof_requirements=[proof.model_dump() for proof in definition.proofs],
        risk_snapshot=snapshot,
    )
