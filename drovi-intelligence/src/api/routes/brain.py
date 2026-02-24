"""World Brain belief and hypothesis intelligence API routes."""

from __future__ import annotations

from datetime import UTC, datetime
import hashlib
import json
from typing import Any
from uuid import uuid4

import structlog
from fastapi import APIRouter, Depends, Header, HTTPException, Query
from pydantic import BaseModel, Field

from src.audit.log import record_audit_event
from src.auth.middleware import APIKeyContext, require_scope_with_rate_limit
from src.auth.scopes import Scope
from src.epistemics import (
    get_belief_intelligence_service,
    get_observation_intelligence_service,
)
from src.hypothesis import get_hypothesis_service, run_hypothesis_red_team_benchmark
from src.intervention import get_intervention_service
from src.jobs.queue import EnqueueJobRequest, enqueue_job
from src.normative import get_normative_intelligence_service, run_normative_benchmark
from src.config import get_settings
from src.security.cognitive_access import redact_payload, require_cognitive_access
from src.simulation.engine import run_simulation
from src.simulation.models import SimulationRequest
from src.tape import get_tape_service
from src.world_model import (
    get_impact_intelligence_service,
    get_world_twin_service,
    run_impact_benchmark,
    run_twin_diff_benchmark,
    run_twin_refresh_benchmark,
)

router = APIRouter(prefix="/brain", tags=["Brain"])
logger = structlog.get_logger()


def _validate_org_id(ctx: APIKeyContext, organization_id: str) -> None:
    if ctx.organization_id != "internal" and ctx.organization_id != organization_id:
        raise HTTPException(
            status_code=403,
            detail="Organization ID mismatch with authenticated key",
        )


def _as_float(value: Any, default: float = 0.0) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def _clamp(value: float, low: float, high: float) -> float:
    return max(low, min(high, value))


def _build_explainability_payload(
    *,
    output_type: str,
    confidence: float | None,
    uncertainty: float | None = None,
    model_refs: list[str] | None = None,
    evidence_refs: list[str] | None = None,
    policy_gates: list[str] | None = None,
    reasoning: dict[str, Any] | None = None,
    assumptions: list[str] | None = None,
) -> dict[str, Any]:
    """Return a standard explainability envelope for high-impact outputs."""
    confidence_value = None if confidence is None else round(_clamp(_as_float(confidence), 0.0, 1.0), 4)
    uncertainty_value = None if uncertainty is None else round(_clamp(_as_float(uncertainty), 0.0, 1.0), 4)
    return {
        "schema_version": "1.0",
        "output_type": output_type,
        "generated_at": datetime.now(UTC).isoformat(),
        "confidence": confidence_value,
        "uncertainty": uncertainty_value,
        "model_refs": [str(item) for item in list(model_refs or []) if str(item).strip()],
        "evidence_refs": [str(item) for item in list(evidence_refs or []) if str(item).strip()],
        "policy_gates": [str(item) for item in list(policy_gates or []) if str(item).strip()],
        "reasoning": dict(reasoning or {}),
        "assumptions": [str(item) for item in list(assumptions or []) if str(item).strip()],
    }


def _apply_redaction_if_needed(payload: Any, *, masked: bool) -> Any:
    if not masked:
        return payload
    return redact_payload(payload)


class BeliefSignalInput(BaseModel):
    direction: str = Field(description="support|contradict|neutral")
    strength: float = Field(ge=0.0, le=1.0)
    source_key: str | None = None
    source_ref: str | None = None
    reliability: float | None = Field(default=None, ge=0.0, le=1.0)
    freshness_hours: float = Field(default=24.0, ge=0.0)
    evidence_link_id: str | None = None


class BeliefRevisionRequest(BaseModel):
    organization_id: str
    reason: str
    model_version: str | None = None
    contradiction_ids: list[str] = Field(default_factory=list)
    signals: list[BeliefSignalInput] = Field(default_factory=list)


class HypothesisSignalInput(BaseModel):
    direction: str = Field(description="support|contradict")
    strength: float = Field(ge=0.0, le=1.0)
    source_ref: str | None = None
    evidence_link_id: str | None = None


class HypothesisGenerateRequest(BaseModel):
    organization_id: str
    belief_id: str | None = None
    anomaly_ref: str | None = None
    anomaly_summary: str | None = None
    impact_score: float = Field(default=0.6, ge=0.0, le=1.0)
    observations: list[str] = Field(default_factory=list)
    top_k: int = Field(default=3, ge=1, le=10)
    min_score: float = Field(default=0.5, ge=0.0, le=1.0)
    trigger: str | None = None
    model_version: str | None = None
    force_credible: bool = False
    contradiction_id: str | None = None
    contradiction_type: str | None = None
    contradiction_severity: str = Field(default="medium")
    uio_a_id: str | None = None
    uio_b_id: str | None = None
    evidence_quote: str | None = None


class HypothesisRescoreRequest(BaseModel):
    organization_id: str
    belief_id: str | None = None
    hypothesis_ids: list[str] = Field(default_factory=list)
    evidence_signals: list[HypothesisSignalInput] = Field(default_factory=list)
    model_version: str | None = None
    rejection_threshold: float = Field(default=0.45, ge=0.0, le=1.0)


class ConstraintUpsertRequest(BaseModel):
    organization_id: str
    payload: dict[str, Any]


class NormativeSentinelRunRequest(BaseModel):
    organization_id: str
    facts: dict[str, Any] = Field(default_factory=dict)
    include_warnings: bool = True
    publish_events: bool = True
    max_constraints: int = Field(default=1000, ge=1, le=10000)
    enqueue: bool = False


class ImpactComputeRequest(BaseModel):
    organization_id: str
    external_events: list[dict[str, Any]] = Field(default_factory=list)
    internal_objects: list[dict[str, Any]] = Field(default_factory=list)
    risk_overlay: dict[str, Any] = Field(default_factory=dict)
    causal_strength_by_ref: dict[str, float] = Field(default_factory=dict)
    min_score: float = Field(default=0.35, ge=0.0, le=1.0)
    max_per_internal: int = Field(default=3, ge=1, le=50)
    max_total: int = Field(default=30, ge=1, le=500)
    dedupe_window_minutes: int = Field(default=240, ge=1, le=1440)
    publish_events: bool = True
    persist: bool = True
    enqueue: bool = False


class TwinBuildRequest(BaseModel):
    organization_id: str
    lookback_hours: int = Field(default=24 * 7, ge=1, le=24 * 90)
    role: str = Field(default="exec")
    persist: bool = True
    enqueue: bool = False


class TwinStreamUpdateRequest(BaseModel):
    organization_id: str
    event: dict[str, Any] = Field(default_factory=dict)
    persist: bool = True
    enqueue: bool = False


class BrainSimulationRequest(SimulationRequest):
    persist: bool = True
    publish_events: bool = True
    enqueue: bool = False
    requested_by: str | None = None


class InterventionPlanRequest(BaseModel):
    organization_id: str
    target_ref: str
    pressure_score: float = Field(ge=0.0, le=1.0)
    causal_confidence: float = Field(ge=0.0, le=1.0)
    max_constraint_severity: str | None = Field(default=None)
    recommended_actions: list[str] = Field(default_factory=list)
    simulation_id: str | None = Field(default=None)
    persist: bool = True
    publish_events: bool = True
    enqueue: bool = False


class InterventionOutcomeRequest(BaseModel):
    organization_id: str
    intervention_plan_id: str | None = None
    outcome_type: str
    outcome_payload: dict[str, Any] = Field(default_factory=dict)
    measured_at: datetime | None = None
    persist: bool = True
    publish_events: bool = True
    enqueue: bool = False


class BrainAskV2Request(BaseModel):
    organization_id: str
    question: str
    role: str = "exec"
    limit: int = Field(default=5, ge=1, le=25)


class CounterfactualLabCompareRequest(BaseModel):
    organization_id: str
    scenario_a: BrainSimulationRequest
    scenario_b: BrainSimulationRequest
    target_ref: str = Field(default="portfolio_risk")
    max_constraint_severity: str | None = Field(default=None)
    recommended_actions: list[str] = Field(default_factory=list)
    generate_interventions: bool = True


class ObligationSentinelTriageRequest(BaseModel):
    organization_id: str
    violation_id: str
    action: str = Field(description="acknowledge|escalate|resolve|simulate_impact")
    notes: str | None = None
    include_counterfactual_preview: bool = False


class CapacityHistoryPoint(BaseModel):
    timestamp: datetime
    event_rate_eps: float = Field(ge=0.0)
    storage_bytes: float = Field(ge=0.0)
    graph_nodes: float = Field(ge=0.0)


class CapacityForecastRequest(BaseModel):
    organization_id: str
    history: list[CapacityHistoryPoint] = Field(default_factory=list, min_length=2, max_length=5000)
    horizon_days: int = Field(default=30, ge=1, le=365)
    max_event_rate_eps: float | None = Field(default=None, gt=0.0)
    max_storage_bytes: float | None = Field(default=None, gt=0.0)
    max_graph_nodes: float | None = Field(default=None, gt=0.0)


class InferencePlanInput(BaseModel):
    model_family: str
    risk_class: str = Field(default="medium")
    sla_minutes: int = Field(default=30, ge=1, le=24 * 60)
    backlog_depth: int = Field(default=0, ge=0, le=1_000_000)


class InferenceAutoscaleInput(BaseModel):
    pool_id: str
    backlog_depth: int = Field(default=0, ge=0, le=1_000_000)
    p95_latency_ms: float = Field(default=0.0, ge=0.0)
    utilization: float = Field(default=0.0, ge=0.0, le=1.0)
    current_replicas: int = Field(default=1, ge=1, le=2048)


class InferenceScalePlanRequest(BaseModel):
    organization_id: str
    requests: list[InferencePlanInput] = Field(default_factory=list, max_length=2000)
    autoscale_inputs: list[InferenceAutoscaleInput] = Field(default_factory=list, max_length=100)


class DrillTargetInput(BaseModel):
    layer: str
    primary_region: str
    secondary_region: str
    rto_target_minutes: int = Field(default=30, ge=1, le=24 * 60)
    rpo_target_minutes: int = Field(default=15, ge=0, le=24 * 60)


class DisasterRecoveryDrillRequest(BaseModel):
    organization_id: str
    targets: list[DrillTargetInput] = Field(default_factory=list, min_length=1, max_length=10)
    observed_results: list[dict[str, Any]] = Field(default_factory=list, max_length=20)
    initiated_by: str = Field(default="system")


@router.get("/observations")
async def list_observations(
    organization_id: str,
    observation_type: str | None = Query(default=None),
    source_type: str | None = Query(default=None),
    hours: int = Query(default=24 * 7, ge=1, le=24 * 180),
    limit: int = Query(default=100, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    break_glass_token: str | None = Header(default=None, alias="X-Break-Glass-Token"),
    ctx: APIKeyContext = Depends(require_scope_with_rate_limit(Scope.READ)),
):
    """List normalized world observations with evidence coverage metadata."""
    _validate_org_id(ctx, organization_id)
    access_decision = await require_cognitive_access(
        ctx=ctx,
        organization_id=organization_id,
        action="brain.observations.list",
        break_glass_token=break_glass_token,
        sensitivity="sensitive",
    )

    service = await get_observation_intelligence_service(organization_id)
    items = await service.list_observations(
        observation_type=observation_type,
        source_type=source_type,
        hours=hours,
        limit=limit,
        offset=offset,
    )
    redacted_items = _apply_redaction_if_needed(items, masked=access_decision.masked)
    return {
        "success": True,
        "count": len(redacted_items),
        "items": redacted_items,
        "redaction_applied": bool(access_decision.masked),
    }


@router.get("/observations/{observation_id}")
async def get_observation(
    observation_id: str,
    organization_id: str,
    break_glass_token: str | None = Header(default=None, alias="X-Break-Glass-Token"),
    ctx: APIKeyContext = Depends(require_scope_with_rate_limit(Scope.READ)),
):
    """Return one observation with temporal fields and structured payload."""
    _validate_org_id(ctx, organization_id)
    access_decision = await require_cognitive_access(
        ctx=ctx,
        organization_id=organization_id,
        action="brain.observations.read",
        break_glass_token=break_glass_token,
        sensitivity="sensitive",
    )

    service = await get_observation_intelligence_service(organization_id)
    item = await service.get_observation(observation_id=observation_id)
    if item is None:
        raise HTTPException(status_code=404, detail="Observation not found")
    redacted_item = _apply_redaction_if_needed(item, masked=access_decision.masked)
    return {
        "success": True,
        "observation": redacted_item,
        "redaction_applied": bool(access_decision.masked),
    }


@router.get("/observations/{observation_id}/evidence")
async def get_observation_evidence(
    observation_id: str,
    organization_id: str,
    limit: int = Query(default=100, ge=1, le=1000),
    break_glass_token: str | None = Header(default=None, alias="X-Break-Glass-Token"),
    ctx: APIKeyContext = Depends(require_scope_with_rate_limit(Scope.READ)),
):
    """List evidence links for one observation."""
    _validate_org_id(ctx, organization_id)
    access_decision = await require_cognitive_access(
        ctx=ctx,
        organization_id=organization_id,
        action="brain.observations.evidence.read",
        break_glass_token=break_glass_token,
        sensitivity="sensitive",
    )

    service = await get_observation_intelligence_service(organization_id)
    items = await service.get_observation_evidence(observation_id=observation_id, limit=limit)
    redacted_items = _apply_redaction_if_needed(items, masked=access_decision.masked)
    return {
        "success": True,
        "observation_id": observation_id,
        "count": len(redacted_items),
        "items": redacted_items,
        "redaction_applied": bool(access_decision.masked),
    }


@router.get("/tape")
async def list_tape_events(
    organization_id: str,
    hours: int = Query(default=24 * 7, ge=1, le=24 * 180),
    limit: int = Query(default=200, ge=1, le=500),
    lane: str | None = Query(default=None),
    delta_domain: str | None = Query(default=None),
    min_confidence: float = Query(default=0.0, ge=0.0, le=1.0),
    ctx: APIKeyContext = Depends(require_scope_with_rate_limit(Scope.READ)),
):
    """List high-signal tape deltas across belief/hypothesis/constraint/causal/bridge domains."""
    _validate_org_id(ctx, organization_id)

    service = await get_tape_service(organization_id)
    items = await service.list_events(
        hours=hours,
        limit=limit,
        lane=lane,
        delta_domain=delta_domain,
        min_confidence=min_confidence,
    )
    return {
        "success": True,
        "count": len(items),
        "items": items,
    }


@router.get("/tape/live-contract")
async def get_tape_live_contract(
    organization_id: str,
    role: str = Query(default="exec"),
    limit: int = Query(default=20, ge=1, le=200),
    ctx: APIKeyContext = Depends(require_scope_with_rate_limit(Scope.READ_ANALYTICS)),
):
    """Return lane and bridge visualization contract for live world pressure + tape rendering."""
    _validate_org_id(ctx, organization_id)

    service = await get_tape_service(organization_id)
    contract = await service.build_live_contract(role=role, limit=limit)
    return {
        "success": True,
        "contract": contract,
    }


@router.get("/tape/{event_id}")
async def get_tape_event(
    event_id: str,
    organization_id: str,
    break_glass_token: str | None = Header(default=None, alias="X-Break-Glass-Token"),
    ctx: APIKeyContext = Depends(require_scope_with_rate_limit(Scope.READ)),
):
    """Expand one tape tile into a proof bundle payload."""
    _validate_org_id(ctx, organization_id)
    access_decision = await require_cognitive_access(
        ctx=ctx,
        organization_id=organization_id,
        action="brain.tape.event.read",
        break_glass_token=break_glass_token,
        sensitivity="sensitive",
    )

    service = await get_tape_service(organization_id)
    item = await service.get_event(event_id=event_id)
    if item is None:
        raise HTTPException(status_code=404, detail="Tape event not found")
    redacted_event = _apply_redaction_if_needed(item, masked=access_decision.masked)
    proof_bundle = _apply_redaction_if_needed(
        (item.get("proof_bundle") or {}),
        masked=access_decision.masked,
    )
    return {
        "success": True,
        "event": redacted_event,
        "proof_bundle": proof_bundle,
        "redaction_applied": bool(access_decision.masked),
    }


@router.get("/beliefs")
async def list_beliefs(
    organization_id: str,
    belief_state: str | None = Query(default=None),
    min_probability: float = Query(default=0.0, ge=0.0, le=1.0),
    max_probability: float = Query(default=1.0, ge=0.0, le=1.0),
    limit: int = Query(default=100, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    ctx: APIKeyContext = Depends(require_scope_with_rate_limit(Scope.READ)),
):
    """List beliefs with epistemic and uncertainty metadata."""
    _validate_org_id(ctx, organization_id)

    service = await get_belief_intelligence_service(organization_id)
    items = await service.list_beliefs(
        belief_state=belief_state,
        min_probability=min_probability,
        max_probability=max_probability,
        limit=limit,
        offset=offset,
    )
    enriched_items: list[dict[str, Any]] = []
    for item in items:
        candidate = dict(item)
        probability = _clamp(_as_float(candidate.get("probability"), default=0.5), 0.0, 1.0)
        uncertainty_score = candidate.get("uncertainty_score")
        if uncertainty_score is None:
            uncertainty_score = round(1.0 - probability, 4)
            candidate["uncertainty_score"] = uncertainty_score
        if candidate.get("uncertainty_band") is None:
            uncertainty_value = _clamp(_as_float(uncertainty_score), 0.0, 1.0)
            candidate["uncertainty_band"] = {
                "p10": round(max(0.0, probability - uncertainty_value), 4),
                "p90": round(min(1.0, probability + uncertainty_value), 4),
            }
        if not candidate.get("calibration_bucket"):
            floor = int(probability * 10) / 10
            ceil = min(1.0, floor + 0.1)
            candidate["calibration_bucket"] = f"{floor:.1f}-{ceil:.1f}"
        enriched_items.append(candidate)
    return {
        "success": True,
        "count": len(enriched_items),
        "items": enriched_items,
    }


@router.get("/beliefs/{belief_id}/hypotheses")
async def list_belief_hypotheses(
    belief_id: str,
    organization_id: str,
    status: str | None = Query(default=None),
    limit: int = Query(default=100, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    ctx: APIKeyContext = Depends(require_scope_with_rate_limit(Scope.READ)),
):
    """List alternatives attached to one belief."""
    _validate_org_id(ctx, organization_id)

    service = await get_hypothesis_service(organization_id)
    items = await service.list_hypotheses(
        status=status,
        belief_id=belief_id,
        limit=limit,
        offset=offset,
    )
    return {
        "success": True,
        "belief_id": belief_id,
        "count": len(items),
        "items": items,
    }


@router.get("/beliefs/{belief_id}/trail")
async def get_belief_trail(
    belief_id: str,
    organization_id: str,
    break_glass_token: str | None = Header(default=None, alias="X-Break-Glass-Token"),
    ctx: APIKeyContext = Depends(require_scope_with_rate_limit(Scope.READ)),
):
    """Return belief timeline and temporal revisions."""
    _validate_org_id(ctx, organization_id)
    access_decision = await require_cognitive_access(
        ctx=ctx,
        organization_id=organization_id,
        action="brain.beliefs.trail.read",
        break_glass_token=break_glass_token,
        sensitivity="sensitive",
    )

    service = await get_belief_intelligence_service(organization_id)
    trail = await service.get_belief_trail(belief_id)
    if not trail:
        raise HTTPException(status_code=404, detail="Belief not found")
    redacted_trail = _apply_redaction_if_needed(trail, masked=access_decision.masked)
    return {
        "success": True,
        "trail": redacted_trail,
        "redaction_applied": bool(access_decision.masked),
    }


@router.get("/beliefs/{belief_id}/evidence")
async def get_belief_evidence(
    belief_id: str,
    organization_id: str,
    limit: int = Query(default=100, ge=1, le=1000),
    break_glass_token: str | None = Header(default=None, alias="X-Break-Glass-Token"),
    ctx: APIKeyContext = Depends(require_scope_with_rate_limit(Scope.READ)),
):
    """Expand evidence linked to belief support/contestation revisions."""
    _validate_org_id(ctx, organization_id)
    access_decision = await require_cognitive_access(
        ctx=ctx,
        organization_id=organization_id,
        action="brain.beliefs.evidence.read",
        break_glass_token=break_glass_token,
        sensitivity="sensitive",
    )

    service = await get_belief_intelligence_service(organization_id)
    items = await service.get_belief_evidence(belief_id=belief_id, limit=limit)
    redacted_items = _apply_redaction_if_needed(items, masked=access_decision.masked)
    return {
        "success": True,
        "belief_id": belief_id,
        "count": len(redacted_items),
        "items": redacted_items,
        "redaction_applied": bool(access_decision.masked),
    }


@router.get("/beliefs/{belief_id}/replay")
async def replay_belief(
    belief_id: str,
    organization_id: str,
    ctx: APIKeyContext = Depends(require_scope_with_rate_limit(Scope.READ)),
):
    """Replay belief revision history and return deterministic state hash."""
    _validate_org_id(ctx, organization_id)

    service = await get_belief_intelligence_service(organization_id)
    replay = await service.replay_belief(belief_id=belief_id)
    if not replay:
        raise HTTPException(status_code=404, detail="Belief not found")
    return {
        "success": True,
        "replay": replay,
    }


@router.post("/beliefs/{belief_id}/revise")
async def revise_belief(
    belief_id: str,
    request: BeliefRevisionRequest,
    ctx: APIKeyContext = Depends(require_scope_with_rate_limit(Scope.WRITE)),
):
    """Apply an evidence-backed belief revision."""
    _validate_org_id(ctx, request.organization_id)

    service = await get_belief_intelligence_service(request.organization_id)
    try:
        revision = await service.revise_belief(
            belief_id=belief_id,
            signals=[item.model_dump() for item in request.signals],
            reason=request.reason,
            model_version=request.model_version,
            contradiction_ids=request.contradiction_ids,
        )
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc

    revision_payload = revision.to_dict()
    rescore_job_id: str | None = None
    if request.signals:
        try:
            rescore_job_id = await enqueue_job(
                EnqueueJobRequest(
                    organization_id=request.organization_id,
                    job_type="hypothesis.rescore",
                    payload={
                        "organization_id": request.organization_id,
                        "belief_id": belief_id,
                        "evidence_signals": [item.model_dump() for item in request.signals],
                        "model_version": request.model_version or "hypothesis-v1-rescore",
                    },
                    priority=2,
                    max_attempts=3,
                    idempotency_key=(
                        f"hypothesis.rescore:{request.organization_id}:{belief_id}:"
                        f"{revision_payload.get('revision_id') or revision_payload.get('revised_at') or 'latest'}"
                    ),
                    resource_key=f"hypothesis:belief:{belief_id}",
                )
            )
        except Exception as exc:  # pragma: no cover - defensive, non-blocking
            logger.warning(
                "Failed to enqueue hypothesis rescore after belief revision",
                organization_id=request.organization_id,
                belief_id=belief_id,
                error=str(exc),
            )

    try:
        await record_audit_event(
            organization_id=request.organization_id,
            action="brain.belief.revised",
            actor_type="api_key" if ctx.key_id else "system",
            actor_id=ctx.key_id or ctx.auth_subject_id,
            resource_type="belief",
            resource_id=belief_id,
            metadata={
                "revision_id": revision_payload.get("revision_id"),
                "previous_state": revision_payload.get("previous_state"),
                "next_state": revision_payload.get("next_state"),
                "previous_probability": revision_payload.get("previous_probability"),
                "next_probability": revision_payload.get("next_probability"),
                "uncertainty": revision_payload.get("uncertainty"),
                "calibration_bucket": revision_payload.get("calibration_bucket"),
                "signal_count": len(request.signals),
                "contradiction_count": len(request.contradiction_ids),
                "reason_digest": hashlib.sha256(request.reason.encode("utf-8")).hexdigest(),
            },
        )
    except Exception as exc:  # pragma: no cover - non-blocking audit
        logger.warning(
            "Failed to record belief revision audit event",
            organization_id=request.organization_id,
            belief_id=belief_id,
            error=str(exc),
        )

    explainability = _build_explainability_payload(
        output_type="belief_revision",
        confidence=_as_float(revision_payload.get("next_probability"), default=0.0),
        uncertainty=_as_float(revision_payload.get("uncertainty"), default=0.0),
        model_refs=[request.model_version or "epistemic-v1"],
        evidence_refs=[
            str(item.evidence_link_id)
            for item in request.signals
            if item.evidence_link_id
        ],
        reasoning={
            "previous_state": revision_payload.get("previous_state"),
            "next_state": revision_payload.get("next_state"),
            "state_decision": (revision_payload.get("reason") or {}).get("state_decision"),
            "support_increment": revision_payload.get("support_count_increment"),
            "contradiction_increment": revision_payload.get("contradiction_count_increment"),
        },
        assumptions=["Belief transition reflects current evidence and reliability priors."],
    )

    return {
        "success": True,
        "revision": revision_payload,
        "epistemic": {
            "uncertainty": revision_payload.get("uncertainty"),
            "calibration_bucket": revision_payload.get("calibration_bucket"),
            "previous_probability": revision_payload.get("previous_probability"),
            "next_probability": revision_payload.get("next_probability"),
        },
        "explainability": explainability,
        "hypothesis_rescore_job_id": rescore_job_id,
    }


@router.get("/calibration/beliefs")
async def get_belief_calibration(
    organization_id: str,
    days: int = Query(default=30, ge=1, le=365),
    source_key: str | None = Query(default=None),
    model_version: str | None = Query(default=None),
    ctx: APIKeyContext = Depends(require_scope_with_rate_limit(Scope.READ_ANALYTICS)),
):
    """Return calibration metrics by source and model version."""
    _validate_org_id(ctx, organization_id)

    service = await get_belief_intelligence_service(organization_id)
    metrics: dict[str, Any] = await service.get_calibration_metrics(
        days=days,
        source_key=source_key,
        model_version=model_version,
    )
    return {
        "success": True,
        "metrics": metrics,
        "generated_at": datetime.now(UTC).isoformat(),
    }


@router.get("/hypotheses")
async def list_hypotheses(
    organization_id: str,
    status: str | None = Query(default=None),
    belief_id: str | None = Query(default=None),
    limit: int = Query(default=100, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    ctx: APIKeyContext = Depends(require_scope_with_rate_limit(Scope.READ)),
):
    """List ranked hypotheses and their latest score metadata."""
    _validate_org_id(ctx, organization_id)

    service = await get_hypothesis_service(organization_id)
    items = await service.list_hypotheses(
        status=status,
        belief_id=belief_id,
        limit=limit,
        offset=offset,
    )
    enriched_items: list[dict[str, Any]] = []
    for item in items:
        candidate = dict(item)
        confidence = _clamp(
            _as_float(candidate.get("overall_score"), default=_as_float(candidate.get("posterior_probability"), 0.5)),
            0.0,
            1.0,
        )
        uncertainty = round(_clamp(1.0 - confidence, 0.0, 1.0), 4)
        lower = round(max(0.0, confidence - uncertainty), 4)
        upper = round(min(1.0, confidence + uncertainty), 4)
        calibration_floor = int(confidence * 10) / 10
        calibration_ceiling = min(1.0, calibration_floor + 0.1)
        candidate["confidence"] = round(confidence, 4)
        candidate["uncertainty_score"] = uncertainty
        candidate["uncertainty_band"] = {"p10": lower, "p90": upper}
        candidate["calibration_bucket"] = f"{calibration_floor:.1f}-{calibration_ceiling:.1f}"
        enriched_items.append(candidate)
    return {
        "success": True,
        "count": len(enriched_items),
        "items": enriched_items,
    }


@router.post("/hypotheses/generate")
async def generate_hypotheses(
    request: HypothesisGenerateRequest,
    ctx: APIKeyContext = Depends(require_scope_with_rate_limit(Scope.WRITE)),
):
    """Generate top-K alternatives for beliefs, anomalies, or major contradictions."""
    _validate_org_id(ctx, request.organization_id)

    service = await get_hypothesis_service(request.organization_id)
    top_k = max(1, int(request.top_k))
    min_score = float(request.min_score)
    model_version = request.model_version or "hypothesis-v1"

    contradiction_context = None
    if request.contradiction_id or request.contradiction_type:
        contradiction_context = {
            "id": request.contradiction_id,
            "type": request.contradiction_type,
            "severity": request.contradiction_severity,
            "uio_a_id": request.uio_a_id,
            "uio_b_id": request.uio_b_id,
        }

    if request.belief_id:
        result = await service.generate_for_belief(
            belief_id=request.belief_id,
            top_k=top_k,
            min_score=min_score,
            trigger=request.trigger or "belief_update",
            model_version=model_version,
            force_credible=request.force_credible,
            contradiction_context=contradiction_context,
        )
    elif request.contradiction_id:
        result = await service.generate_for_contradiction(
            contradiction_id=request.contradiction_id,
            contradiction_type=request.contradiction_type or "conflict",
            severity=request.contradiction_severity,
            uio_a_id=request.uio_a_id,
            uio_b_id=request.uio_b_id,
            evidence_quote=request.evidence_quote,
            top_k=top_k,
            min_score=min_score,
            model_version=model_version,
        )
    elif request.anomaly_ref and request.anomaly_summary:
        result = await service.generate_for_anomaly(
            anomaly_ref=request.anomaly_ref,
            anomaly_summary=request.anomaly_summary,
            impact_score=request.impact_score,
            observations=request.observations,
            top_k=top_k,
            min_score=min_score,
            trigger=request.trigger or "anomaly",
            model_version=model_version,
            contradiction_context=contradiction_context,
        )
    else:
        raise HTTPException(
            status_code=400,
            detail=(
                "Provide either belief_id, contradiction_id, or anomaly_ref + anomaly_summary "
                "to generate hypotheses"
            ),
        )

    return {
        "success": True,
        "result": result,
    }


@router.post("/hypotheses/rescore")
async def rescore_hypotheses(
    request: HypothesisRescoreRequest,
    ctx: APIKeyContext = Depends(require_scope_with_rate_limit(Scope.WRITE)),
):
    """Rescore existing hypotheses when new evidence arrives."""
    _validate_org_id(ctx, request.organization_id)

    service = await get_hypothesis_service(request.organization_id)
    result = await service.rescore_hypotheses(
        belief_id=request.belief_id,
        hypothesis_ids=request.hypothesis_ids,
        evidence_signals=[item.model_dump() for item in request.evidence_signals],
        model_version=request.model_version or "hypothesis-v1-rescore",
        rejection_threshold=request.rejection_threshold,
    )
    return {
        "success": True,
        "result": result,
    }


@router.get("/hypotheses/benchmark")
async def run_hypothesis_benchmark(
    organization_id: str,
    top_k: int = Query(default=3, ge=1, le=10),
    pass_threshold: float = Query(default=0.78, ge=0.0, le=1.0),
    ctx: APIKeyContext = Depends(require_scope_with_rate_limit(Scope.READ_ANALYTICS)),
):
    """Run the deterministic red-team benchmark for hypothesis selection quality."""
    _validate_org_id(ctx, organization_id)

    benchmark = run_hypothesis_red_team_benchmark(
        top_k=top_k,
        pass_threshold=pass_threshold,
    )
    return {
        "success": True,
        "benchmark": benchmark,
        "generated_at": datetime.now(UTC).isoformat(),
    }


@router.get("/hypotheses/{hypothesis_id}")
async def get_hypothesis(
    hypothesis_id: str,
    organization_id: str,
    ctx: APIKeyContext = Depends(require_scope_with_rate_limit(Scope.READ)),
):
    """Return one hypothesis with full score history."""
    _validate_org_id(ctx, organization_id)

    service = await get_hypothesis_service(organization_id)
    hypothesis = await service.get_hypothesis(hypothesis_id)
    if not hypothesis:
        raise HTTPException(status_code=404, detail="Hypothesis not found")
    return {
        "success": True,
        "hypothesis": hypothesis,
    }


@router.post("/constraints/upsert")
async def upsert_constraint(
    request: ConstraintUpsertRequest,
    ctx: APIKeyContext = Depends(require_scope_with_rate_limit(Scope.WRITE)),
):
    """Create or update one machine-checkable obligation constraint."""
    _validate_org_id(ctx, request.organization_id)

    service = await get_normative_intelligence_service(request.organization_id)
    result = await service.upsert_constraint_from_source(request.payload)
    return {
        "success": True,
        "constraint": result,
    }


@router.get("/constraints")
async def list_constraints(
    organization_id: str,
    is_active: bool | None = Query(default=None),
    origin_type: str | None = Query(default=None),
    limit: int = Query(default=100, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    ctx: APIKeyContext = Depends(require_scope_with_rate_limit(Scope.READ)),
):
    """List obligations with DSL and scoped metadata."""
    _validate_org_id(ctx, organization_id)

    service = await get_normative_intelligence_service(organization_id)
    items = await service.list_constraints(
        is_active=is_active,
        origin_type=origin_type,
        limit=limit,
        offset=offset,
    )
    return {
        "success": True,
        "count": len(items),
        "items": items,
    }


@router.get("/violations")
async def list_violations(
    organization_id: str,
    status: str | None = Query(default=None),
    severity: str | None = Query(default=None),
    constraint_id: str | None = Query(default=None),
    limit: int = Query(default=100, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    break_glass_token: str | None = Header(default=None, alias="X-Break-Glass-Token"),
    ctx: APIKeyContext = Depends(require_scope_with_rate_limit(Scope.READ)),
):
    """List breach and pre-breach candidate signals with evidence traces."""
    _validate_org_id(ctx, organization_id)
    access_decision = await require_cognitive_access(
        ctx=ctx,
        organization_id=organization_id,
        action="brain.violations.read",
        break_glass_token=break_glass_token,
        sensitivity="sensitive",
    )

    service = await get_normative_intelligence_service(organization_id)
    items = await service.list_violations(
        status=status,
        severity=severity,
        constraint_id=constraint_id,
        limit=limit,
        offset=offset,
    )
    redacted_items = _apply_redaction_if_needed(items, masked=access_decision.masked)
    enriched_items: list[dict[str, Any]] = []
    for item in redacted_items:
        candidate = dict(item) if isinstance(item, dict) else {"value": item}
        confidence = _clamp(_as_float(candidate.get("confidence"), default=0.5), 0.0, 1.0)
        candidate["uncertainty_score"] = round(1.0 - confidence, 4)
        details = candidate.get("details") if isinstance(candidate.get("details"), dict) else {}
        source_reliability = details.get("source_reliability")
        if isinstance(source_reliability, dict):
            candidate["source_reliability"] = source_reliability
        elif isinstance(candidate.get("source_reliability"), dict):
            candidate["source_reliability"] = candidate.get("source_reliability")
        else:
            candidate["source_reliability"] = {
                "score": None,
                "band": "unknown",
            }
        enriched_items.append(candidate)
    return {
        "success": True,
        "count": len(enriched_items),
        "items": enriched_items,
        "redaction_applied": bool(access_decision.masked),
    }


@router.get("/constraints/{constraint_id}/timeline")
async def get_constraint_timeline(
    constraint_id: str,
    organization_id: str,
    limit: int = Query(default=200, ge=1, le=1000),
    break_glass_token: str | None = Header(default=None, alias="X-Break-Glass-Token"),
    ctx: APIKeyContext = Depends(require_scope_with_rate_limit(Scope.READ)),
):
    """Return obligation timeline with violations/warnings and evidence references."""
    _validate_org_id(ctx, organization_id)
    access_decision = await require_cognitive_access(
        ctx=ctx,
        organization_id=organization_id,
        action="brain.constraints.timeline.read",
        break_glass_token=break_glass_token,
        sensitivity="sensitive",
    )

    service = await get_normative_intelligence_service(organization_id)
    timeline = await service.get_obligation_timeline(constraint_id=constraint_id, limit=limit)
    if not timeline:
        raise HTTPException(status_code=404, detail="Constraint not found")
    redacted_timeline = _apply_redaction_if_needed(timeline, masked=access_decision.masked)
    return {
        "success": True,
        "timeline": redacted_timeline,
        "redaction_applied": bool(access_decision.masked),
    }


@router.post("/normative/sentinel/run")
async def run_normative_sentinel(
    request: NormativeSentinelRunRequest,
    ctx: APIKeyContext = Depends(require_scope_with_rate_limit(Scope.WRITE)),
):
    """Run (or enqueue) the normative sentinel that detects breaches and pre-breach warnings."""
    _validate_org_id(ctx, request.organization_id)

    if request.enqueue:
        facts_fingerprint = hashlib.sha256(
            json.dumps(request.facts or {}, sort_keys=True, separators=(",", ":")).encode("utf-8")
        ).hexdigest()[:16]
        job_id = await enqueue_job(
            EnqueueJobRequest(
                organization_id=request.organization_id,
                job_type="normative.sentinel",
                payload={
                    "organization_id": request.organization_id,
                    "facts": request.facts,
                    "include_warnings": request.include_warnings,
                    "publish_events": request.publish_events,
                    "max_constraints": request.max_constraints,
                },
                priority=3,
                max_attempts=3,
                idempotency_key=(
                    f"normative.sentinel:{request.organization_id}:"
                    f"{facts_fingerprint}"
                ),
                resource_key=f"normative:sentinel:{request.organization_id}",
            )
        )
        return {
            "success": True,
            "enqueued": True,
            "job_id": job_id,
        }

    service = await get_normative_intelligence_service(request.organization_id)
    result = await service.run_violation_sentinel(
        facts=request.facts,
        include_warnings=request.include_warnings,
        publish_events=request.publish_events,
        max_constraints=request.max_constraints,
    )
    return {
        "success": True,
        "enqueued": False,
        "result": result,
    }


@router.get("/normative/benchmark")
async def run_normative_sentinel_benchmark(
    organization_id: str,
    target_recall: float = Query(default=0.9, ge=0.0, le=1.0),
    max_false_positive_rate: float = Query(default=0.2, ge=0.0, le=1.0),
    ctx: APIKeyContext = Depends(require_scope_with_rate_limit(Scope.READ_ANALYTICS)),
):
    """Run synthetic benchmark for breach recall and pre-breach precision."""
    _validate_org_id(ctx, organization_id)

    benchmark = run_normative_benchmark(
        target_recall=target_recall,
        max_false_positive_rate=max_false_positive_rate,
    )
    return {
        "success": True,
        "benchmark": benchmark,
        "generated_at": datetime.now(UTC).isoformat(),
    }


@router.post("/simulate")
async def run_brain_simulation(
    request: BrainSimulationRequest,
    ctx: APIKeyContext = Depends(require_scope_with_rate_limit(Scope.WRITE)),
):
    """Run (or enqueue) a world-brain counterfactual simulation."""
    _validate_org_id(ctx, request.organization_id)

    payload = request.model_dump(mode="json", exclude={"enqueue"})
    if request.enqueue:
        fingerprint = hashlib.sha256(
            json.dumps(payload, sort_keys=True, separators=(",", ":")).encode("utf-8")
        ).hexdigest()[:16]
        job_id = await enqueue_job(
            EnqueueJobRequest(
                organization_id=request.organization_id,
                job_type="simulation.run",
                payload=payload,
                priority=2,
                max_attempts=3,
                idempotency_key=f"simulation.run:{request.organization_id}:{fingerprint}",
                resource_key=f"simulation:run:{request.organization_id}:{request.scenario_name}",
            )
        )
        return {
            "success": True,
            "enqueued": True,
            "job_id": job_id,
        }

    response = await run_simulation(
        request,
        persist=request.persist,
        publish_events=request.publish_events,
        requested_by=request.requested_by,
    )
    result_payload = response.model_dump(mode="json")
    confidence = 1.0 - _clamp(_as_float(result_payload.get("downside_risk_estimate"), default=0.5), 0.0, 1.0)
    explainability = _build_explainability_payload(
        output_type="simulation",
        confidence=confidence,
        uncertainty=_clamp(1.0 - confidence, 0.0, 1.0),
        model_refs=["simulation-engine-v2"],
        evidence_refs=[
            str(item)
            for item in list(result_payload.get("causal_projection") or [])
            if isinstance(item, dict) and str(item.get("source_ref") or "").strip()
        ],
        reasoning={
            "scenario_name": request.scenario_name,
            "horizon_days": request.horizon_days,
            "risk_delta": _as_float((result_payload.get("delta") or {}).get("risk_score"), default=0.0),
            "downside_risk_estimate": result_payload.get("downside_risk_estimate"),
        },
        assumptions=["Counterfactual outputs assume stable baseline operating regime."],
    )
    try:
        await record_audit_event(
            organization_id=request.organization_id,
            action="brain.simulation.executed",
            actor_type="api_key" if ctx.key_id else "system",
            actor_id=ctx.key_id or ctx.auth_subject_id,
            resource_type="simulation_run",
            resource_id=str(result_payload.get("simulation_id") or ""),
            metadata={
                "scenario_name": request.scenario_name,
                "horizon_days": request.horizon_days,
                "persist": request.persist,
                "publish_events": request.publish_events,
                "confidence": explainability.get("confidence"),
            },
        )
    except Exception as exc:  # pragma: no cover - non-blocking audit
        logger.warning(
            "Failed to record simulation audit event",
            organization_id=request.organization_id,
            scenario_name=request.scenario_name,
            error=str(exc),
        )
    return {
        "success": True,
        "enqueued": False,
        "result": result_payload,
        "explainability": explainability,
    }


@router.post("/interventions")
async def propose_intervention(
    request: InterventionPlanRequest,
    ctx: APIKeyContext = Depends(require_scope_with_rate_limit(Scope.WRITE)),
):
    """Generate (or enqueue) a governed intervention plan with rollback and policy gates."""
    _validate_org_id(ctx, request.organization_id)

    payload = request.model_dump(mode="json", exclude={"enqueue"})
    if request.enqueue:
        fingerprint = hashlib.sha256(
            json.dumps(payload, sort_keys=True, separators=(",", ":")).encode("utf-8")
        ).hexdigest()[:16]
        job_id = await enqueue_job(
            EnqueueJobRequest(
                organization_id=request.organization_id,
                job_type="intervention.propose",
                payload=payload,
                priority=3,
                max_attempts=3,
                idempotency_key=f"intervention.propose:{request.organization_id}:{fingerprint}",
                resource_key=f"intervention:propose:{request.organization_id}:{request.target_ref}",
            )
        )
        return {
            "success": True,
            "enqueued": True,
            "job_id": job_id,
        }

    service = await get_intervention_service(request.organization_id)
    result = await service.propose_and_persist(
        target_ref=request.target_ref,
        pressure_score=request.pressure_score,
        causal_confidence=request.causal_confidence,
        max_constraint_severity=request.max_constraint_severity,
        recommended_actions=request.recommended_actions,
        simulation_id=request.simulation_id,
        persist=request.persist,
        publish_events=request.publish_events,
    )
    try:
        await record_audit_event(
            organization_id=request.organization_id,
            action="brain.intervention.proposed",
            actor_type="api_key" if ctx.key_id else "system",
            actor_id=ctx.key_id or ctx.auth_subject_id,
            resource_type="intervention_plan",
            resource_id=str(result.get("intervention_id") or ""),
            metadata={
                "target_ref": request.target_ref,
                "policy_class": result.get("policy_class"),
                "pressure_score": request.pressure_score,
                "causal_confidence": request.causal_confidence,
                "max_constraint_severity": request.max_constraint_severity,
                "simulation_id": request.simulation_id,
            },
        )
    except Exception as exc:  # pragma: no cover - non-blocking audit
        logger.warning(
            "Failed to record intervention proposal audit event",
            organization_id=request.organization_id,
            error=str(exc),
        )

    explainability = _build_explainability_payload(
        output_type="intervention_proposal",
        confidence=request.causal_confidence,
        uncertainty=1.0 - _clamp(request.causal_confidence, 0.0, 1.0),
        model_refs=["intervention-engine-v1"],
        evidence_refs=[
            str(item)
            for item in list((result.get("action_graph") or {}).get("evidence_link_ids") or [])
            if str(item).strip()
        ],
        policy_gates=[str(result.get("policy_class") or "p1_human_approval")],
        reasoning={
            "target_ref": request.target_ref,
            "pressure_score": request.pressure_score,
            "expected_utility_delta": result.get("expected_utility_delta"),
            "downside_risk_estimate": result.get("downside_risk_estimate"),
        },
        assumptions=["Intervention proposal must pass policy gates before execution."],
    )
    return {
        "success": True,
        "enqueued": False,
        "result": result,
        "explainability": explainability,
    }


@router.get("/interventions")
async def list_interventions(
    organization_id: str,
    status: str | None = Query(default=None),
    policy_class: str | None = Query(default=None),
    limit: int = Query(default=100, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    ctx: APIKeyContext = Depends(require_scope_with_rate_limit(Scope.READ)),
):
    """List persisted intervention plans."""
    _validate_org_id(ctx, organization_id)

    service = await get_intervention_service(organization_id)
    items = await service.list_plans(
        status=status,
        policy_class=policy_class,
        limit=limit,
        offset=offset,
    )
    return {
        "success": True,
        "count": len(items),
        "items": items,
    }


@router.post("/interventions/outcomes")
async def capture_intervention_outcome(
    request: InterventionOutcomeRequest,
    ctx: APIKeyContext = Depends(require_scope_with_rate_limit(Scope.WRITE)),
):
    """Capture realized intervention outcomes for feedback and online learning hooks."""
    _validate_org_id(ctx, request.organization_id)

    payload = request.model_dump(mode="json", exclude={"enqueue"})
    if request.enqueue:
        fingerprint = hashlib.sha256(
            json.dumps(payload, sort_keys=True, separators=(",", ":")).encode("utf-8")
        ).hexdigest()[:16]
        job_id = await enqueue_job(
            EnqueueJobRequest(
                organization_id=request.organization_id,
                job_type="intervention.outcome.capture",
                payload=payload,
                priority=2,
                max_attempts=3,
                idempotency_key=f"intervention.outcome.capture:{request.organization_id}:{fingerprint}",
                resource_key=f"intervention:outcome:{request.organization_id}:{request.intervention_plan_id or 'none'}",
            )
        )
        return {
            "success": True,
            "enqueued": True,
            "job_id": job_id,
        }

    service = await get_intervention_service(request.organization_id)
    result = await service.capture_outcome(
        outcome_type=request.outcome_type,
        outcome_payload=request.outcome_payload,
        intervention_plan_id=request.intervention_plan_id,
        measured_at=request.measured_at,
        persist=request.persist,
        publish_events=request.publish_events,
    )
    try:
        await record_audit_event(
            organization_id=request.organization_id,
            action="brain.intervention.outcome.captured",
            actor_type="api_key" if ctx.key_id else "system",
            actor_id=ctx.key_id or ctx.auth_subject_id,
            resource_type="realized_outcome",
            resource_id=str(result.get("realized_outcome_id") or ""),
            metadata={
                "intervention_plan_id": request.intervention_plan_id,
                "outcome_type": request.outcome_type,
                "measured_at": result.get("measured_at"),
            },
        )
    except Exception as exc:  # pragma: no cover - non-blocking audit
        logger.warning(
            "Failed to record intervention outcome audit event",
            organization_id=request.organization_id,
            error=str(exc),
        )

    explainability = _build_explainability_payload(
        output_type="intervention_outcome",
        confidence=0.8 if "success" in str(request.outcome_type).lower() else 0.55,
        uncertainty=0.2 if "success" in str(request.outcome_type).lower() else 0.45,
        model_refs=["outcome-evaluator-v1"],
        evidence_refs=[
            str(item)
            for item in list((request.outcome_payload or {}).get("evidence_link_ids") or [])
            if str(item).strip()
        ],
        policy_gates=[],
        reasoning={
            "outcome_type": request.outcome_type,
            "intervention_plan_id": request.intervention_plan_id,
            "outcome_hash": result.get("outcome_hash"),
        },
    )
    return {
        "success": True,
        "enqueued": False,
        "result": result,
        "explainability": explainability,
    }


@router.post("/ask/v2")
async def ask_brain_v2(
    request: BrainAskV2Request,
    ctx: APIKeyContext = Depends(require_scope_with_rate_limit(Scope.READ)),
):
    """Truth-first ask endpoint with explicit truth -> uncertainty -> narrative ordering."""
    _validate_org_id(ctx, request.organization_id)

    observations_service = await get_observation_intelligence_service(request.organization_id)
    belief_service = await get_belief_intelligence_service(request.organization_id)
    hypothesis_service = await get_hypothesis_service(request.organization_id)
    normative_service = await get_normative_intelligence_service(request.organization_id)
    impact_service = await get_impact_intelligence_service(request.organization_id)

    observations = await observations_service.list_observations(
        hours=24 * 30,
        limit=request.limit,
        offset=0,
    )
    beliefs = await belief_service.list_beliefs(
        belief_state=None,
        min_probability=0.0,
        max_probability=1.0,
        limit=request.limit,
        offset=0,
    )
    hypotheses = await hypothesis_service.list_hypotheses(
        status=None,
        belief_id=None,
        limit=request.limit,
        offset=0,
    )
    violations = await normative_service.list_violations(
        status="open",
        severity=None,
        constraint_id=None,
        limit=request.limit,
        offset=0,
    )
    impacts = await impact_service.list_impacts(
        severity=None,
        impact_type=None,
        internal_object_ref=None,
        limit=request.limit,
        offset=0,
    )

    truth = {
        "observations": observations,
        "beliefs": beliefs,
        "hypotheses": hypotheses,
        "violations": violations,
        "impacts": impacts,
        "counts": {
            "observations": len(observations),
            "beliefs": len(beliefs),
            "hypotheses": len(hypotheses),
            "violations": len(violations),
            "impacts": len(impacts),
        },
    }

    uncertainty_values = [
        float(item["uncertainty_score"])
        for item in beliefs
        if item.get("uncertainty_score") is not None
    ]
    high_uncertainty_beliefs = [
        item["id"]
        for item in beliefs
        if float(item.get("uncertainty_score") or 0.0) >= 0.6
    ]
    low_confidence_impacts = [
        item["id"]
        for item in impacts
        if float(item.get("confidence") or 0.0) < 0.5
    ]

    source_counts: dict[str, int] = {}
    source_reliability_totals: dict[str, float] = {}
    source_reliability_counts: dict[str, int] = {}
    for item in observations:
        source_key = str(item.get("source_type") or "unknown")
        source_counts[source_key] = source_counts.get(source_key, 0) + 1
        reliability = item.get("source_reliability_score")
        if reliability is None:
            continue
        source_reliability_totals[source_key] = (
            source_reliability_totals.get(source_key, 0.0) + _clamp(_as_float(reliability), 0.0, 1.0)
        )
        source_reliability_counts[source_key] = source_reliability_counts.get(source_key, 0) + 1

    source_mix = [
        {
            "source_type": source_type,
            "count": count,
            "avg_reliability_score": (
                round(
                    source_reliability_totals[source_type] / source_reliability_counts[source_type],
                    4,
                )
                if source_reliability_counts.get(source_type)
                else None
            ),
        }
        for source_type, count in sorted(source_counts.items(), key=lambda pair: (-pair[1], pair[0]))
    ]
    for item in source_mix:
        score = item.get("avg_reliability_score")
        if score is None:
            item["reliability_band"] = "unknown"
        elif score >= 0.8:
            item["reliability_band"] = "high"
        elif score >= 0.6:
            item["reliability_band"] = "medium"
        else:
            item["reliability_band"] = "low"

    calibration_distribution: dict[str, int] = {}
    for item in beliefs:
        bucket = str(item.get("calibration_bucket") or "unknown")
        calibration_distribution[bucket] = calibration_distribution.get(bucket, 0) + 1

    uncertainty = {
        "average_belief_uncertainty": (
            round(sum(uncertainty_values) / len(uncertainty_values), 4)
            if uncertainty_values
            else None
        ),
        "max_belief_uncertainty": round(max(uncertainty_values), 4) if uncertainty_values else None,
        "high_uncertainty_belief_ids": high_uncertainty_beliefs,
        "low_confidence_impact_ids": low_confidence_impacts,
        "calibration_distribution": calibration_distribution,
        "source_mix": source_mix,
    }

    top_observation = observations[0]["title"] if observations else None
    top_belief = beliefs[0]["proposition"] if beliefs else None
    top_violation = violations[0]["constraint_title"] if violations else None
    narrative_parts = [
        f"Question: {request.question.strip()}",
        (
            f"Truth snapshot has {len(observations)} observations, {len(beliefs)} beliefs, "
            f"{len(hypotheses)} hypotheses, {len(violations)} open violations, and {len(impacts)} impact edges."
        ),
    ]
    if top_observation:
        narrative_parts.append(f"Most recent observation: {top_observation}.")
    if top_belief:
        narrative_parts.append(f"Most recent belief: {top_belief}.")
    if top_violation:
        narrative_parts.append(f"Highest-priority open obligation signal: {top_violation}.")
    if high_uncertainty_beliefs:
        narrative_parts.append(
            f"{len(high_uncertainty_beliefs)} beliefs are currently high-uncertainty and need corroboration."
        )
    if low_confidence_impacts:
        narrative_parts.append(
            f"{len(low_confidence_impacts)} impact edges are low-confidence and should be treated as provisional."
        )

    return {
        "success": True,
        "ask_v2": {
            "question": request.question,
            "role": request.role,
            "ordering": ["truth", "uncertainty", "narrative"],
            "truth": truth,
            "uncertainty": uncertainty,
            "narrative": " ".join(part for part in narrative_parts if part),
            "explainability": _build_explainability_payload(
                output_type="ask_v2",
                confidence=1.0 - _clamp(_as_float(uncertainty.get("average_belief_uncertainty"), 0.4), 0.0, 1.0),
                uncertainty=_as_float(uncertainty.get("average_belief_uncertainty"), 0.4),
                model_refs=["ask-v2-truth-first"],
                reasoning={
                    "ordering": ["truth", "uncertainty", "narrative"],
                    "belief_count": len(beliefs),
                    "impact_count": len(impacts),
                },
            ),
            "generated_at": datetime.now(UTC).isoformat(),
        },
    }


@router.post("/counterfactual-lab/compare")
async def compare_counterfactual_lab(
    request: CounterfactualLabCompareRequest,
    ctx: APIKeyContext = Depends(require_scope_with_rate_limit(Scope.WRITE)),
):
    """Run A/B counterfactual comparison with optional intervention previews."""
    _validate_org_id(ctx, request.organization_id)
    if request.scenario_a.organization_id != request.organization_id:
        raise HTTPException(status_code=400, detail="scenario_a.organization_id mismatch")
    if request.scenario_b.organization_id != request.organization_id:
        raise HTTPException(status_code=400, detail="scenario_b.organization_id mismatch")

    scenario_a = await run_simulation(
        request.scenario_a,
        persist=False,
        publish_events=False,
        requested_by="counterfactual_lab",
    )
    scenario_b = await run_simulation(
        request.scenario_b,
        persist=False,
        publish_events=False,
        requested_by="counterfactual_lab",
    )

    score_a = float(scenario_a.utility.simulated_utility) - float(scenario_a.downside_risk_estimate)
    score_b = float(scenario_b.utility.simulated_utility) - float(scenario_b.downside_risk_estimate)
    preferred = "a" if score_a > score_b else "b"
    if abs(score_a - score_b) < 1e-6:
        preferred = "tie"

    intervention_previews: dict[str, Any] = {}
    if request.generate_interventions:
        intervention_service = await get_intervention_service(request.organization_id)
        intervention_previews["a"] = await intervention_service.propose_and_persist(
            target_ref=request.target_ref,
            pressure_score=min(1.0, float(scenario_a.simulated.risk_score) + float(scenario_a.downside_risk_estimate)),
            causal_confidence=0.7,
            max_constraint_severity=request.max_constraint_severity,
            recommended_actions=request.recommended_actions,
            simulation_id=scenario_a.simulation_id,
            persist=False,
            publish_events=False,
        )
        intervention_previews["b"] = await intervention_service.propose_and_persist(
            target_ref=request.target_ref,
            pressure_score=min(1.0, float(scenario_b.simulated.risk_score) + float(scenario_b.downside_risk_estimate)),
            causal_confidence=0.7,
            max_constraint_severity=request.max_constraint_severity,
            recommended_actions=request.recommended_actions,
            simulation_id=scenario_b.simulation_id,
            persist=False,
            publish_events=False,
        )

    explainability = _build_explainability_payload(
        output_type="counterfactual_compare",
        confidence=_clamp(abs(score_a - score_b), 0.0, 1.0),
        uncertainty=1.0 - _clamp(abs(score_a - score_b), 0.0, 1.0),
        model_refs=["simulation-engine-v2", "intervention-engine-v1"],
        reasoning={
            "preferred": preferred,
            "score_a": round(score_a, 4),
            "score_b": round(score_b, 4),
            "delta": round(score_a - score_b, 4),
        },
        assumptions=["Scenario comparisons assume equivalent baseline priors."],
    )
    try:
        await record_audit_event(
            organization_id=request.organization_id,
            action="brain.counterfactual.compare",
            actor_type="api_key" if ctx.key_id else "system",
            actor_id=ctx.key_id or ctx.auth_subject_id,
            resource_type="counterfactual_comparison",
            resource_id=str(uuid4()),
            metadata={
                "preferred": preferred,
                "score_a": round(score_a, 4),
                "score_b": round(score_b, 4),
                "delta": round(score_a - score_b, 4),
                "generate_interventions": bool(request.generate_interventions),
            },
        )
    except Exception as exc:  # pragma: no cover - non-blocking audit
        logger.warning(
            "Failed to record counterfactual comparison audit event",
            organization_id=request.organization_id,
            error=str(exc),
        )

    return {
        "success": True,
        "comparison": {
            "preferred": preferred,
            "score_a": round(score_a, 4),
            "score_b": round(score_b, 4),
            "delta": round(score_a - score_b, 4),
            "scenario_a": scenario_a.model_dump(mode="json"),
            "scenario_b": scenario_b.model_dump(mode="json"),
            "intervention_previews": intervention_previews,
            "generated_at": datetime.now(UTC).isoformat(),
        },
        "explainability": explainability,
    }


@router.get("/obligation-sentinel/dashboard")
async def get_obligation_sentinel_dashboard(
    organization_id: str,
    limit: int = Query(default=100, ge=1, le=500),
    ctx: APIKeyContext = Depends(require_scope_with_rate_limit(Scope.READ)),
):
    """Return pre-breach/post-breach triage payload for Obligation Sentinel UI."""
    _validate_org_id(ctx, organization_id)

    service = await get_normative_intelligence_service(organization_id)
    constraints = await service.list_constraints(
        is_active=True,
        origin_type=None,
        limit=limit,
        offset=0,
    )
    violations = await service.list_violations(
        status=None,
        severity=None,
        constraint_id=None,
        limit=limit,
        offset=0,
    )

    pre_breach = [item for item in violations if str(item.get("status") or "").lower() == "warning"]
    post_breach = [item for item in violations if str(item.get("status") or "").lower() == "open"]

    severity_counts: dict[str, int] = {}
    for item in violations:
        severity = str(item.get("severity") or "medium").lower()
        severity_counts[severity] = severity_counts.get(severity, 0) + 1

    return {
        "success": True,
        "dashboard": {
            "summary": {
                "active_constraints": len(constraints),
                "total_signals": len(violations),
                "pre_breach_warnings": len(pre_breach),
                "post_breach_open": len(post_breach),
                "severity_counts": severity_counts,
            },
            "pre_breach": pre_breach,
            "post_breach": post_breach,
            "workflows": {
                "pre_breach": [
                    "inspect proof bundle",
                    "assign owner",
                    "trigger mitigation",
                ],
                "post_breach": [
                    "open breach timeline",
                    "escalate legal/compliance",
                    "run counterfactual replay",
                ],
            },
            "generated_at": datetime.now(UTC).isoformat(),
        },
    }


@router.post("/obligation-sentinel/triage")
async def triage_obligation_sentinel(
    request: ObligationSentinelTriageRequest,
    ctx: APIKeyContext = Depends(require_scope_with_rate_limit(Scope.WRITE)),
):
    """Return deterministic triage guidance for one violation, with optional counterfactual preview."""
    _validate_org_id(ctx, request.organization_id)

    action = str(request.action or "").strip().lower()
    if action not in {"acknowledge", "escalate", "resolve", "simulate_impact"}:
        raise HTTPException(status_code=400, detail="Invalid triage action")

    service = await get_normative_intelligence_service(request.organization_id)
    violations = await service.list_violations(
        status=None,
        severity=None,
        constraint_id=None,
        limit=500,
        offset=0,
    )
    target = next((item for item in violations if str(item.get("id")) == request.violation_id), None)
    if target is None:
        raise HTTPException(status_code=404, detail="Violation not found")

    steps = {
        "acknowledge": [
            "record acknowledgment note",
            "assign owner",
            "schedule next review",
        ],
        "escalate": [
            "notify compliance and legal",
            "attach proof bundle",
            "start incident timeline",
        ],
        "resolve": [
            "confirm remediation evidence",
            "run sentinel check",
            "close with audit note",
        ],
        "simulate_impact": [
            "run counterfactual with current obligations",
            "compare intervention options",
            "publish recommended path",
        ],
    }

    preview: dict[str, Any] | None = None
    if request.include_counterfactual_preview or action == "simulate_impact":
        simulation_request = SimulationRequest(
            organization_id=request.organization_id,
            scenario_name=f"obligation_triage_{request.violation_id}",
            horizon_days=30,
        )
        simulation = await run_simulation(
            simulation_request,
            persist=False,
            publish_events=False,
            requested_by="obligation_sentinel_triage",
        )
        preview = {
            "simulation_id": simulation.simulation_id,
            "risk_score": simulation.simulated.risk_score,
            "downside_risk_estimate": simulation.downside_risk_estimate,
            "utility_delta": simulation.utility.utility_delta,
        }

    return {
        "success": True,
        "triage": {
            "violation_id": request.violation_id,
            "action": action,
            "status": str(target.get("status") or "open"),
            "severity": str(target.get("severity") or "medium"),
            "recommended_steps": steps[action],
            "notes": request.notes,
            "counterfactual_preview": preview,
            "generated_at": datetime.now(UTC).isoformat(),
        },
    }


@router.post("/impact/compute")
async def compute_impacts(
    request: ImpactComputeRequest,
    ctx: APIKeyContext = Depends(require_scope_with_rate_limit(Scope.WRITE)),
):
    """Compute external->internal impact bridges with dedupe and anti-noise controls."""
    _validate_org_id(ctx, request.organization_id)

    if request.enqueue:
        fingerprint = hashlib.sha256(
            json.dumps(
                {
                    "external_events": request.external_events,
                    "risk_overlay": request.risk_overlay,
                    "min_score": request.min_score,
                    "max_per_internal": request.max_per_internal,
                    "max_total": request.max_total,
                    "persist": request.persist,
                },
                sort_keys=True,
                separators=(",", ":"),
            ).encode("utf-8")
        ).hexdigest()[:16]
        job_id = await enqueue_job(
            EnqueueJobRequest(
                organization_id=request.organization_id,
                job_type="impact.compute",
                payload={
                    "organization_id": request.organization_id,
                    "external_events": request.external_events,
                    "internal_objects": request.internal_objects,
                    "risk_overlay": request.risk_overlay,
                    "causal_strength_by_ref": request.causal_strength_by_ref,
                    "min_score": request.min_score,
                    "max_per_internal": request.max_per_internal,
                    "max_total": request.max_total,
                    "dedupe_window_minutes": request.dedupe_window_minutes,
                    "publish_events": request.publish_events,
                    "persist": request.persist,
                },
                priority=2,
                max_attempts=3,
                idempotency_key=f"impact.compute:{request.organization_id}:{fingerprint}",
                resource_key=f"impact:compute:{request.organization_id}",
            )
        )
        return {
            "success": True,
            "enqueued": True,
            "job_id": job_id,
        }

    service = await get_impact_intelligence_service(request.organization_id)
    if request.persist:
        result = await service.compute_and_persist_impacts(
            internal_objects=request.internal_objects,
            external_events=request.external_events,
            risk_overlay=request.risk_overlay,
            causal_strength_by_ref=request.causal_strength_by_ref,
            min_score=request.min_score,
            max_per_internal=request.max_per_internal,
            max_total=request.max_total,
            dedupe_window_minutes=request.dedupe_window_minutes,
            publish_events=request.publish_events,
        )
    else:
        result = await service.preview_impacts(
            internal_objects=request.internal_objects,
            external_events=request.external_events,
            risk_overlay=request.risk_overlay,
            causal_strength_by_ref=request.causal_strength_by_ref,
            min_score=request.min_score,
            max_per_internal=request.max_per_internal,
            max_total=request.max_total,
        )
    persisted = _as_float(result.get("persisted_count"), default=0.0)
    evaluated = max(1.0, _as_float(result.get("candidates_evaluated"), default=result.get("candidate_count") or 1.0))
    confidence = _clamp(persisted / evaluated, 0.0, 1.0)
    explainability = _build_explainability_payload(
        output_type="impact_compute",
        confidence=confidence,
        uncertainty=1.0 - confidence,
        model_refs=["impact-engine-v2"],
        evidence_refs=[
            str(edge.get("id"))
            for edge in list(result.get("items") or [])
            if isinstance(edge, dict) and str(edge.get("id") or "").strip()
        ],
        reasoning={
            "candidates_evaluated": result.get("candidates_evaluated", result.get("candidate_count")),
            "persisted_count": result.get("persisted_count", 0),
            "skipped_duplicates": result.get("skipped_duplicates", 0),
            "min_score": request.min_score,
            "max_total": request.max_total,
        },
        assumptions=["Impact edges below confidence thresholds are filtered by anti-noise controls."],
    )
    try:
        await record_audit_event(
            organization_id=request.organization_id,
            action="brain.impact.compute",
            actor_type="api_key" if ctx.key_id else "system",
            actor_id=ctx.key_id or ctx.auth_subject_id,
            resource_type="impact_edge_batch",
            resource_id=str(uuid4()),
            metadata={
                "persist": request.persist,
                "publish_events": request.publish_events,
                "candidates_evaluated": result.get("candidates_evaluated", result.get("candidate_count")),
                "persisted_count": result.get("persisted_count", 0),
                "confidence": explainability.get("confidence"),
            },
        )
    except Exception as exc:  # pragma: no cover - non-blocking audit
        logger.warning(
            "Failed to record impact compute audit event",
            organization_id=request.organization_id,
            error=str(exc),
        )
    return {
        "success": True,
        "enqueued": False,
        "result": result,
        "explainability": explainability,
    }


@router.get("/impact/edges")
async def list_impact_edges(
    organization_id: str,
    severity: str | None = Query(default=None),
    impact_type: str | None = Query(default=None),
    internal_object_ref: str | None = Query(default=None),
    limit: int = Query(default=100, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    ctx: APIKeyContext = Depends(require_scope_with_rate_limit(Scope.READ)),
):
    """List persisted impact bridges."""
    _validate_org_id(ctx, organization_id)

    service = await get_impact_intelligence_service(organization_id)
    items = await service.list_impacts(
        severity=severity,
        impact_type=impact_type,
        internal_object_ref=internal_object_ref,
        limit=limit,
        offset=offset,
    )
    enriched_items: list[dict[str, Any]] = []
    for item in items:
        candidate = dict(item)
        confidence = _clamp(_as_float(candidate.get("confidence"), default=0.5), 0.0, 1.0)
        candidate["uncertainty_score"] = round(1.0 - confidence, 4)
        confidence_floor = int(confidence * 10) / 10
        confidence_ceiling = min(1.0, confidence_floor + 0.1)
        candidate["calibration_bucket"] = f"{confidence_floor:.1f}-{confidence_ceiling:.1f}"
        enriched_items.append(candidate)
    return {
        "success": True,
        "count": len(enriched_items),
        "items": enriched_items,
    }


@router.get("/impact/summary")
async def get_impact_summary(
    organization_id: str,
    hours: int = Query(default=24, ge=1, le=24 * 30),
    ctx: APIKeyContext = Depends(require_scope_with_rate_limit(Scope.READ_ANALYTICS)),
):
    """Return impact severity and hot-object summary for a recent horizon."""
    _validate_org_id(ctx, organization_id)

    service = await get_impact_intelligence_service(organization_id)
    summary = await service.get_impact_summary(hours=hours)
    return {
        "success": True,
        "summary": summary,
    }


@router.get("/impact/benchmark")
async def run_impact_engine_benchmark(
    organization_id: str,
    min_precision_gain: float = Query(default=0.2, ge=0.0, le=1.0),
    max_alerts_per_event: float = Query(default=2.0, ge=0.1, le=20.0),
    ctx: APIKeyContext = Depends(require_scope_with_rate_limit(Scope.READ_ANALYTICS)),
):
    """Run synthetic benchmark for impact precision and anti-noise alert density."""
    _validate_org_id(ctx, organization_id)

    benchmark = run_impact_benchmark(
        min_precision_gain=min_precision_gain,
        max_alerts_per_event=max_alerts_per_event,
    )
    return {
        "success": True,
        "benchmark": benchmark,
        "generated_at": datetime.now(UTC).isoformat(),
    }


@router.post("/twin/build")
async def build_world_twin(
    request: TwinBuildRequest,
    ctx: APIKeyContext = Depends(require_scope_with_rate_limit(Scope.WRITE)),
):
    """Build and optionally persist a world twin snapshot."""
    _validate_org_id(ctx, request.organization_id)

    if request.enqueue:
        fingerprint = hashlib.sha256(
            json.dumps(
                {
                    "lookback_hours": request.lookback_hours,
                    "role": request.role,
                    "persist": request.persist,
                },
                sort_keys=True,
                separators=(",", ":"),
            ).encode("utf-8")
        ).hexdigest()[:16]
        job_id = await enqueue_job(
            EnqueueJobRequest(
                organization_id=request.organization_id,
                job_type="world_twin.snapshot",
                payload={
                    "organization_id": request.organization_id,
                    "lookback_hours": request.lookback_hours,
                    "role": request.role,
                    "persist": request.persist,
                },
                priority=2,
                max_attempts=3,
                idempotency_key=f"world_twin.snapshot:{request.organization_id}:{fingerprint}",
                resource_key=f"world_twin:snapshot:{request.organization_id}",
            )
        )
        return {
            "success": True,
            "enqueued": True,
            "job_id": job_id,
        }

    service = await get_world_twin_service(request.organization_id)
    result = await service.build_snapshot(
        lookback_hours=request.lookback_hours,
        role=request.role,
        persist=request.persist,
    )
    drift_index = _as_float((result.get("drift_metrics") or {}).get("drift_index"), default=0.0)
    confidence = _clamp(1.0 - drift_index, 0.0, 1.0)
    explainability = _build_explainability_payload(
        output_type="world_twin_snapshot",
        confidence=confidence,
        uncertainty=1.0 - confidence,
        model_refs=["world-twin-materializer-v1"],
        evidence_refs=[
            str(item.get("event_id"))
            for item in list(result.get("deltas") or [])
            if isinstance(item, dict) and str(item.get("event_id") or "").strip()
        ],
        reasoning={
            "snapshot_id": result.get("snapshot_id"),
            "lookback_hours": request.lookback_hours,
            "drift_index": drift_index,
            "materialization_latency_ms": result.get("materialization_latency_ms"),
        },
    )
    try:
        await record_audit_event(
            organization_id=request.organization_id,
            action="brain.world_twin.snapshot",
            actor_type="api_key" if ctx.key_id else "system",
            actor_id=ctx.key_id or ctx.auth_subject_id,
            resource_type="world_twin_snapshot",
            resource_id=str(result.get("snapshot_id") or ""),
            metadata={
                "lookback_hours": request.lookback_hours,
                "role": request.role,
                "persist": request.persist,
                "confidence": explainability.get("confidence"),
            },
        )
    except Exception as exc:  # pragma: no cover - non-blocking audit
        logger.warning(
            "Failed to record world twin snapshot audit event",
            organization_id=request.organization_id,
            error=str(exc),
        )
    return {
        "success": True,
        "enqueued": False,
        "result": result,
        "explainability": explainability,
    }


@router.post("/twin/stream-update")
async def stream_update_world_twin(
    request: TwinStreamUpdateRequest,
    ctx: APIKeyContext = Depends(require_scope_with_rate_limit(Scope.WRITE)),
):
    """Apply one external event update to the latest twin snapshot."""
    _validate_org_id(ctx, request.organization_id)

    if request.enqueue:
        fingerprint = hashlib.sha256(
            json.dumps(request.event or {}, sort_keys=True, separators=(",", ":")).encode("utf-8")
        ).hexdigest()[:16]
        job_id = await enqueue_job(
            EnqueueJobRequest(
                organization_id=request.organization_id,
                job_type="world_twin.stream_update",
                payload={
                    "organization_id": request.organization_id,
                    "event": request.event,
                    "persist": request.persist,
                },
                priority=2,
                max_attempts=3,
                idempotency_key=f"world_twin.stream_update:{request.organization_id}:{fingerprint}",
                resource_key=f"world_twin:stream:{request.organization_id}",
            )
        )
        return {
            "success": True,
            "enqueued": True,
            "job_id": job_id,
        }

    service = await get_world_twin_service(request.organization_id)
    result = await service.apply_stream_event(
        event=request.event,
        persist=request.persist,
    )
    drift_index = _as_float((result.get("drift_metrics") or {}).get("drift_index"), default=0.0)
    confidence = _clamp(1.0 - drift_index, 0.0, 1.0)
    explainability = _build_explainability_payload(
        output_type="world_twin_stream_update",
        confidence=confidence,
        uncertainty=1.0 - confidence,
        model_refs=["world-twin-materializer-v1"],
        reasoning={
            "snapshot_id": result.get("snapshot_id"),
            "drift_index": drift_index,
            "event_keys": sorted(list((request.event or {}).keys()))[:25],
        },
    )
    try:
        await record_audit_event(
            organization_id=request.organization_id,
            action="brain.world_twin.stream_update",
            actor_type="api_key" if ctx.key_id else "system",
            actor_id=ctx.key_id or ctx.auth_subject_id,
            resource_type="world_twin_snapshot",
            resource_id=str(result.get("snapshot_id") or ""),
            metadata={
                "persist": request.persist,
                "drift_index": drift_index,
                "confidence": explainability.get("confidence"),
            },
        )
    except Exception as exc:  # pragma: no cover - non-blocking audit
        logger.warning(
            "Failed to record world twin stream update audit event",
            organization_id=request.organization_id,
            error=str(exc),
        )
    return {
        "success": True,
        "enqueued": False,
        "result": result,
        "explainability": explainability,
    }


@router.get("/twin")
async def get_world_twin(
    organization_id: str,
    role: str = Query(default="exec"),
    refresh: bool = Query(default=False),
    lookback_hours: int = Query(default=24 * 7, ge=1, le=24 * 90),
    ctx: APIKeyContext = Depends(require_scope_with_rate_limit(Scope.READ)),
):
    """Return latest world twin snapshot (or rebuild on-demand)."""
    _validate_org_id(ctx, organization_id)

    service = await get_world_twin_service(organization_id)
    if refresh:
        payload = await service.build_snapshot(
            lookback_hours=lookback_hours,
            role=role,
            persist=True,
        )
        return {"success": True, "snapshot": payload}

    latest = await service.get_latest_snapshot(role=role)
    if latest is None:
        raise HTTPException(status_code=404, detail="No twin snapshot available")
    return {"success": True, "snapshot": latest}


@router.get("/twin/history")
async def get_world_twin_history(
    organization_id: str,
    limit: int = Query(default=20, ge=1, le=200),
    ctx: APIKeyContext = Depends(require_scope_with_rate_limit(Scope.READ)),
):
    """List recent world twin snapshots."""
    _validate_org_id(ctx, organization_id)

    service = await get_world_twin_service(organization_id)
    items = await service.get_snapshot_history(limit=limit)
    return {
        "success": True,
        "count": len(items),
        "items": items,
    }


@router.get("/twin/diff")
async def get_world_twin_diff(
    organization_id: str,
    from_snapshot_id: str | None = Query(default=None),
    to_snapshot_id: str | None = Query(default=None),
    from_time: datetime | None = Query(default=None),
    to_time: datetime | None = Query(default=None),
    ctx: APIKeyContext = Depends(require_scope_with_rate_limit(Scope.READ_ANALYTICS)),
):
    """Compute diff and drift metrics between two twin snapshots."""
    _validate_org_id(ctx, organization_id)

    service = await get_world_twin_service(organization_id)
    diff = await service.diff(
        from_snapshot_id=from_snapshot_id,
        to_snapshot_id=to_snapshot_id,
        from_time=from_time,
        to_time=to_time,
    )
    return {
        "success": True,
        "diff": diff,
    }


@router.get("/twin/pressure-map")
async def get_world_pressure_map(
    organization_id: str,
    role: str = Query(default="exec"),
    limit: int = Query(default=20, ge=1, le=100),
    ctx: APIKeyContext = Depends(require_scope_with_rate_limit(Scope.READ_ANALYTICS)),
):
    """Return tenant pressure map from latest twin snapshot."""
    _validate_org_id(ctx, organization_id)

    service = await get_world_twin_service(organization_id)
    pressure = await service.get_pressure_map(role=role, limit=limit)
    if pressure is None:
        raise HTTPException(status_code=404, detail="No twin snapshot available")
    return {
        "success": True,
        "pressure_map": pressure,
    }


@router.get("/twin/belief-drift-radar")
async def get_belief_drift_radar(
    organization_id: str,
    lookback_hours: int = Query(default=24 * 7, ge=1, le=24 * 90),
    ctx: APIKeyContext = Depends(require_scope_with_rate_limit(Scope.READ_ANALYTICS)),
):
    """Return belief drift radar over a time horizon."""
    _validate_org_id(ctx, organization_id)

    service = await get_world_twin_service(organization_id)
    radar = await service.get_belief_drift_radar(lookback_hours=lookback_hours)
    return {
        "success": True,
        "belief_drift_radar": radar,
    }


@router.get("/twin/explainability")
async def get_world_twin_explainability(
    organization_id: str,
    role: str = Query(default="exec"),
    entity_id: str | None = Query(default=None),
    domain: str | None = Query(default=None),
    ctx: APIKeyContext = Depends(require_scope_with_rate_limit(Scope.READ)),
):
    """Explain pressure/exposure for one entity or domain in the latest twin."""
    _validate_org_id(ctx, organization_id)

    if not entity_id and not domain:
        raise HTTPException(status_code=400, detail="Provide entity_id or domain")

    service = await get_world_twin_service(organization_id)
    explanation = await service.explain(
        entity_id=entity_id,
        domain=domain,
        role=role,
    )
    if explanation is None:
        raise HTTPException(status_code=404, detail="No twin snapshot available")
    confidence = _clamp(1.0 - _as_float((explanation.get("state") or {}).get("drift_score"), 0.0), 0.0, 1.0)
    return {
        "success": True,
        "explanation": explanation,
        "explainability": _build_explainability_payload(
            output_type="world_twin_explanation",
            confidence=confidence,
            uncertainty=1.0 - confidence,
            model_refs=["world-twin-materializer-v1"],
            reasoning={
                "entity_id": entity_id,
                "domain": domain,
                "role": role,
            },
        ),
    }


@router.get("/twin/benchmark")
async def run_world_twin_benchmark(
    organization_id: str,
    ctx: APIKeyContext = Depends(require_scope_with_rate_limit(Scope.READ_ANALYTICS)),
):
    """Run deterministic diff benchmark for world twin drift accuracy."""
    _validate_org_id(ctx, organization_id)

    diff_benchmark = run_twin_diff_benchmark()
    refresh_benchmark = run_twin_refresh_benchmark(target_latency_ms=1000)
    return {
        "success": True,
        "benchmark": {
            "diff": diff_benchmark,
            "refresh": refresh_benchmark,
            "passed": bool(diff_benchmark.get("passed")) and bool(refresh_benchmark.get("passed")),
        },
        "generated_at": datetime.now(UTC).isoformat(),
    }


@router.post("/ops/capacity/forecast")
async def get_capacity_forecast(
    request: CapacityForecastRequest,
    ctx: APIKeyContext = Depends(require_scope_with_rate_limit(Scope.READ_ANALYTICS)),
):
    """Forecast capacity envelopes for event rate, storage growth, and graph cardinality."""
    from src.ops.capacity_forecast import CapacityBudget, CapacityForecastEngine

    _validate_org_id(ctx, request.organization_id)
    settings = get_settings()

    engine = CapacityForecastEngine()
    forecast = engine.build_dashboard(
        history=[item.model_dump(mode="json") for item in request.history],
        horizon_days=request.horizon_days,
        budget=CapacityBudget(
            max_event_rate_eps=float(
                request.max_event_rate_eps
                if request.max_event_rate_eps is not None
                else settings.world_capacity_event_rate_budget_eps
            ),
            max_storage_bytes=float(
                request.max_storage_bytes
                if request.max_storage_bytes is not None
                else settings.world_capacity_storage_budget_bytes
            ),
            max_graph_nodes=float(
                request.max_graph_nodes
                if request.max_graph_nodes is not None
                else settings.world_capacity_graph_node_budget
            ),
        ),
    )
    return {
        "success": True,
        "forecast": forecast,
    }


@router.post("/ops/inference/plan")
async def get_inference_scale_plan(
    request: InferenceScalePlanRequest,
    ctx: APIKeyContext = Depends(require_scope_with_rate_limit(Scope.READ_ANALYTICS)),
):
    """Return pool routing, queue priority classes, and autoscaling recommendations."""
    from src.mlops.inference_scale import InferenceScalePlanner

    _validate_org_id(ctx, request.organization_id)

    planner = InferenceScalePlanner()
    dispatch = [
        planner.route_request(
            model_family=str(item.model_family),  # validated downstream by planner pool mapping
            risk_class=str(item.risk_class),
            sla_minutes=item.sla_minutes,
            backlog_depth=item.backlog_depth,
        ).to_dict()
        for item in request.requests
    ]
    autoscale: list[dict[str, Any]] = []
    for item in request.autoscale_inputs:
        try:
            autoscale.append(
                planner.autoscale_pool(
                    pool_id=item.pool_id,
                    backlog_depth=item.backlog_depth,
                    p95_latency_ms=item.p95_latency_ms,
                    utilization=item.utilization,
                    current_replicas=item.current_replicas,
                ).to_dict()
            )
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc))
    return {
        "success": True,
        "pool_inventory": planner.pool_inventory(),
        "dispatch": dispatch,
        "autoscale": autoscale,
    }


@router.post("/ops/drill/disaster-recovery")
async def run_disaster_recovery_drill(
    request: DisasterRecoveryDrillRequest,
    ctx: APIKeyContext = Depends(require_scope_with_rate_limit(Scope.WRITE)),
):
    """Plan/evaluate multi-region evidence and lakehouse backup/restore drills."""
    from src.ops.disaster_recovery import DrillTarget, MultiRegionDrillPlanner

    _validate_org_id(ctx, request.organization_id)

    planner = MultiRegionDrillPlanner()
    targets = [
        DrillTarget(
            layer=item.layer,
            primary_region=item.primary_region,
            secondary_region=item.secondary_region,
            rto_target_minutes=item.rto_target_minutes,
            rpo_target_minutes=item.rpo_target_minutes,
        )
        for item in request.targets
    ]
    plan = planner.build_plan(
        organization_id=request.organization_id,
        targets=targets,
        initiated_by=request.initiated_by,
    )
    evaluation = planner.evaluate_results(targets=targets, results=request.observed_results)
    return {
        "success": True,
        "plan": plan,
        "evaluation": evaluation,
    }
