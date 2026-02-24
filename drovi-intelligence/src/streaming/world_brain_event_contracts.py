"""World Brain Kafka event contracts."""

from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, Field


class _WorldBrainEventBase(BaseModel):
    schema_version: Literal["1.0"] = "1.0"
    organization_id: str
    event_id: str
    occurred_at: datetime
    producer: str = "drovi-intelligence"


class ObservationRawPayload(BaseModel):
    observation_id: str
    source_type: str
    source_ref: str | None = None
    observation_type: str
    content: dict[str, Any] = Field(default_factory=dict)
    observed_at: datetime
    reliability_score: float | None = Field(default=None, ge=0.0, le=1.0)
    artifact_id: str | None = None
    artifact_sha256: str | None = None
    artifact_storage_path: str | None = None
    ingest_run_id: str | None = None
    source_metadata: dict[str, Any] = Field(default_factory=dict)
    trace_id: str | None = None
    tags: list[str] = Field(default_factory=list)


class ObservationNormalizedPayload(BaseModel):
    observation_id: str
    normalized_text: str
    entities: list[str] = Field(default_factory=list)
    embedding_ref: str | None = None
    confidence: float = Field(ge=0.0, le=1.0)
    valid_from: datetime | None = None
    valid_to: datetime | None = None


class BeliefUpdatePayload(BaseModel):
    belief_id: str
    proposition: str
    next_state: str
    probability: float = Field(ge=0.0, le=1.0)
    supporting_observation_ids: list[str] = Field(default_factory=list)
    revised_at: datetime


class BeliefDegradedPayload(BaseModel):
    belief_id: str
    previous_state: str | None = None
    degraded_state: str
    degradation_reason: str
    contradiction_ids: list[str] = Field(default_factory=list)
    degraded_at: datetime


class HypothesisGeneratedPayload(BaseModel):
    hypothesis_id: str
    belief_id: str | None = None
    hypothesis_text: str
    prior_probability: float = Field(ge=0.0, le=1.0)
    posterior_probability: float = Field(ge=0.0, le=1.0)
    generated_at: datetime
    model_version: str | None = None


class HypothesisRejectedPayload(BaseModel):
    hypothesis_id: str
    rejection_reason: str
    rejected_at: datetime
    disproving_observation_ids: list[str] = Field(default_factory=list)
    confidence: float = Field(ge=0.0, le=1.0)


class CausalEdgeUpdatePayload(BaseModel):
    edge_id: str
    from_ref: str
    to_ref: str
    relation_type: str
    strength: float = Field(ge=0.0, le=1.0)
    direction: str
    updated_at: datetime
    mechanism_summary: str | None = None


class ImpactEdgeComputedPayload(BaseModel):
    impact_edge_id: str
    external_object_ref: str
    internal_object_ref: str
    impact_type: str
    severity: str
    confidence: float = Field(ge=0.0, le=1.0)
    computed_at: datetime
    evidence_link_ids: list[str] = Field(default_factory=list)


class ConstraintViolationCandidatePayload(BaseModel):
    violation_id: str
    constraint_id: str
    subject_entity_id: str | None = None
    status: str
    severity: str
    confidence: float = Field(ge=0.0, le=1.0)
    detected_at: datetime
    details: dict[str, Any] = Field(default_factory=dict)


class SimulationRequestedPayload(BaseModel):
    simulation_id: str
    scenario_name: str
    scenario_type: str | None = None
    requested_by: str | None = None
    requested_at: datetime
    input_ref: str | None = None
    target_refs: list[str] = Field(default_factory=list)


class SimulationCompletedPayload(BaseModel):
    simulation_id: str
    scenario_name: str
    status: str
    completed_at: datetime
    result_summary: dict[str, Any] = Field(default_factory=dict)
    downside_risk_estimate: float | None = None
    expected_utility_delta: float | None = None


class InterventionProposedPayload(BaseModel):
    intervention_plan_id: str
    target_ref: str
    policy_class: str
    status: str
    proposed_at: datetime
    expected_utility_delta: float | None = None
    downside_risk_estimate: float | None = None
    action_graph: dict[str, Any] = Field(default_factory=dict)
    rollback_plan: dict[str, Any] = Field(default_factory=dict)


class OutcomeRealizedPayload(BaseModel):
    realized_outcome_id: str
    intervention_plan_id: str | None = None
    outcome_type: str
    measured_at: datetime
    outcome_payload: dict[str, Any] = Field(default_factory=dict)
    outcome_hash: str | None = None


class ObservationRawEvent(_WorldBrainEventBase):
    event_type: Literal["observation.raw.v1"] = "observation.raw.v1"
    payload: ObservationRawPayload


class ObservationNormalizedEvent(_WorldBrainEventBase):
    event_type: Literal["observation.normalized.v1"] = "observation.normalized.v1"
    payload: ObservationNormalizedPayload


class BeliefUpdateEvent(_WorldBrainEventBase):
    event_type: Literal["belief.update.v1"] = "belief.update.v1"
    payload: BeliefUpdatePayload


class BeliefDegradedEvent(_WorldBrainEventBase):
    event_type: Literal["belief.degraded.v1"] = "belief.degraded.v1"
    payload: BeliefDegradedPayload


class HypothesisGeneratedEvent(_WorldBrainEventBase):
    event_type: Literal["hypothesis.generated.v1"] = "hypothesis.generated.v1"
    payload: HypothesisGeneratedPayload


class HypothesisRejectedEvent(_WorldBrainEventBase):
    event_type: Literal["hypothesis.rejected.v1"] = "hypothesis.rejected.v1"
    payload: HypothesisRejectedPayload


class CausalEdgeUpdateEvent(_WorldBrainEventBase):
    event_type: Literal["causal.edge.update.v1"] = "causal.edge.update.v1"
    payload: CausalEdgeUpdatePayload


class ImpactEdgeComputedEvent(_WorldBrainEventBase):
    event_type: Literal["impact.edge.computed.v1"] = "impact.edge.computed.v1"
    payload: ImpactEdgeComputedPayload


class ConstraintViolationCandidateEvent(_WorldBrainEventBase):
    event_type: Literal["constraint.violation.candidate.v1"] = "constraint.violation.candidate.v1"
    payload: ConstraintViolationCandidatePayload


class SimulationRequestedEvent(_WorldBrainEventBase):
    event_type: Literal["simulation.requested.v1"] = "simulation.requested.v1"
    payload: SimulationRequestedPayload


class SimulationCompletedEvent(_WorldBrainEventBase):
    event_type: Literal["simulation.completed.v1"] = "simulation.completed.v1"
    payload: SimulationCompletedPayload


class InterventionProposedEvent(_WorldBrainEventBase):
    event_type: Literal["intervention.proposed.v1"] = "intervention.proposed.v1"
    payload: InterventionProposedPayload


class OutcomeRealizedEvent(_WorldBrainEventBase):
    event_type: Literal["outcome.realized.v1"] = "outcome.realized.v1"
    payload: OutcomeRealizedPayload


WORLD_BRAIN_EVENT_MODELS: dict[str, type[BaseModel]] = {
    "observation.raw.v1": ObservationRawEvent,
    "observation.normalized.v1": ObservationNormalizedEvent,
    "belief.update.v1": BeliefUpdateEvent,
    "belief.degraded.v1": BeliefDegradedEvent,
    "hypothesis.generated.v1": HypothesisGeneratedEvent,
    "hypothesis.rejected.v1": HypothesisRejectedEvent,
    "causal.edge.update.v1": CausalEdgeUpdateEvent,
    "impact.edge.computed.v1": ImpactEdgeComputedEvent,
    "constraint.violation.candidate.v1": ConstraintViolationCandidateEvent,
    "simulation.requested.v1": SimulationRequestedEvent,
    "simulation.completed.v1": SimulationCompletedEvent,
    "intervention.proposed.v1": InterventionProposedEvent,
    "outcome.realized.v1": OutcomeRealizedEvent,
}


def validate_world_brain_event(event_type: str, payload: dict[str, Any]) -> BaseModel:
    """Validate one World Brain event payload against its contract."""
    model = WORLD_BRAIN_EVENT_MODELS.get(event_type)
    if model is None:
        supported = ", ".join(sorted(WORLD_BRAIN_EVENT_MODELS))
        raise ValueError(f"Unsupported event_type '{event_type}'. Expected one of: {supported}")
    return model.model_validate(payload)


def world_brain_event_schema(event_type: str) -> dict[str, Any]:
    """Return the JSON Schema for one event type."""
    model = WORLD_BRAIN_EVENT_MODELS.get(event_type)
    if model is None:
        supported = ", ".join(sorted(WORLD_BRAIN_EVENT_MODELS))
        raise ValueError(f"Unsupported event_type '{event_type}'. Expected one of: {supported}")
    return model.model_json_schema()


def all_world_brain_event_schemas() -> dict[str, dict[str, Any]]:
    """Return all World Brain event schemas keyed by event type."""
    return {
        event_type: model.model_json_schema()
        for event_type, model in sorted(WORLD_BRAIN_EVENT_MODELS.items())
    }
