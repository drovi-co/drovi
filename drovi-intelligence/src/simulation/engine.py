"""Counterfactual simulation engine."""

from __future__ import annotations

from datetime import datetime, timedelta
from typing import Any
from uuid import uuid4

from sqlalchemy import text

from src.continuum.manager import compute_next_run_at, fetch_continuum_definition
from src.db.client import get_db_session
from src.db.rls import set_rls_context
from src.kernel.time import utc_now_naive
from src.simulation.models import (
    ContinuumPreviewResponse,
    RiskSnapshot,
    SensitivityResult,
    SimulationOverride,
    SimulationRequest,
    SimulationResponse,
)


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


def _apply_overrides(
    commitments: list[dict[str, Any]],
    overrides: SimulationOverride,
) -> list[dict[str, Any]]:
    updated_commitments: list[dict[str, Any]] = []
    for item in commitments:
        updated = dict(item)
        due_date = _normalize_due_date(updated.get("due_date"))
        if item["id"] in overrides.commitment_delays and due_date:
            delay_days = overrides.commitment_delays[item["id"]]
            updated["due_date"] = due_date + timedelta(days=delay_days)
        if item["id"] in overrides.commitment_cancellations:
            updated["status"] = "cancelled"
        updated_commitments.append(updated)
    return updated_commitments


def _compute_sensitivity(
    commitments: list[dict[str, Any]],
    overrides: SimulationOverride,
    *,
    baseline: RiskSnapshot,
    now: datetime,
    horizon_days: int,
) -> list[SensitivityResult]:
    results: list[SensitivityResult] = []

    for commitment_id, delay_days in overrides.commitment_delays.items():
        scenario = SimulationOverride(commitment_delays={commitment_id: delay_days})
        simulated = _apply_overrides(commitments, scenario)
        summary = _summarize_commitments(simulated, now=now, horizon_days=horizon_days)
        results.append(
            SensitivityResult(
                commitment_id=commitment_id,
                change_type="delay",
                delta_risk_score=round(summary.risk_score - baseline.risk_score, 3),
                delta_overdue=summary.overdue_commitments - baseline.overdue_commitments,
            )
        )

    for commitment_id in overrides.commitment_cancellations:
        scenario = SimulationOverride(commitment_cancellations=[commitment_id])
        simulated = _apply_overrides(commitments, scenario)
        summary = _summarize_commitments(simulated, now=now, horizon_days=horizon_days)
        results.append(
            SensitivityResult(
                commitment_id=commitment_id,
                change_type="cancel",
                delta_risk_score=round(summary.risk_score - baseline.risk_score, 3),
                delta_overdue=summary.overdue_commitments - baseline.overdue_commitments,
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


async def run_simulation(request: SimulationRequest) -> SimulationResponse:
    commitments = await _fetch_commitments(request.organization_id)
    now = utc_now_naive()

    baseline = _summarize_commitments(
        commitments,
        now=now,
        horizon_days=request.horizon_days,
    )

    simulated_commitments = _apply_overrides(commitments, request.overrides)
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
        request.overrides,
        baseline=baseline,
        now=now,
        horizon_days=request.horizon_days,
    )

    narrative = (
        f"Simulated horizon {request.horizon_days} days. "
        f"Open commitments: {baseline.open_commitments} → {simulated.open_commitments}. "
        f"Overdue: {baseline.overdue_commitments} → {simulated.overdue_commitments}. "
        f"Risk score: {baseline.risk_score:.2f} → {simulated.risk_score:.2f}."
    )

    simulation_id = str(uuid4())
    output_payload = {
        "baseline": baseline.model_dump(),
        "simulated": simulated.model_dump(),
        "delta": delta,
        "sensitivity": [item.model_dump() for item in sensitivity],
        "narrative": narrative,
    }

    set_rls_context(request.organization_id, is_internal=True)
    try:
        async with get_db_session() as session:
            await session.execute(
                text(
                    """
                    INSERT INTO simulation_run (
                        id, organization_id, scenario_name,
                        input_payload, output_payload, created_at
                    ) VALUES (
                        :id, :org_id, :scenario_name,
                        :input_payload, :output_payload, :created_at
                    )
                    """
                ),
                {
                    "id": simulation_id,
                    "org_id": request.organization_id,
                    "scenario_name": request.scenario_name,
                    "input_payload": request.model_dump(),
                    "output_payload": output_payload,
                    "created_at": now,
                },
            )
    finally:
        set_rls_context(None, is_internal=False)

    return SimulationResponse(
        simulation_id=simulation_id,
        scenario_name=request.scenario_name,
        baseline=baseline,
        simulated=simulated,
        delta=delta,
        sensitivity=sensitivity,
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
