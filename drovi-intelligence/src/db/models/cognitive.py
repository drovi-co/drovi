"""World Brain cognitive foundation models.

These models define the phase-1 cognitive persistence layer used by the
observation/belief/hypothesis/constraint and intervention pipelines.
"""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import Boolean, Column, DateTime, Float, ForeignKey, Integer, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB

from src.db.models.connections import Base


class Observation(Base):
    __tablename__ = "observation"

    id = Column(Text, primary_key=True)
    organization_id = Column(Text, ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False, index=True)
    source_event_id = Column(Text, ForeignKey("unified_event.id", ondelete="SET NULL"), nullable=True)
    source_type = Column(Text, nullable=True)
    source_ref = Column(Text, nullable=True)
    observation_type = Column(Text, nullable=False, index=True)
    title = Column(Text, nullable=True)
    content = Column(JSONB, nullable=False, default=dict)
    observation_hash = Column(Text, nullable=True, index=True)
    observed_at = Column(DateTime(timezone=True), nullable=False, index=True)
    valid_from = Column(DateTime(timezone=True), nullable=True)
    valid_to = Column(DateTime(timezone=True), nullable=True)
    believed_from = Column(DateTime(timezone=True), nullable=True)
    believed_to = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow)
    updated_at = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow)


class ObservationEvidenceLink(Base):
    __tablename__ = "observation_evidence_link"

    id = Column(Text, primary_key=True)
    organization_id = Column(Text, ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False, index=True)
    observation_id = Column(Text, ForeignKey("observation.id", ondelete="CASCADE"), nullable=False, index=True)
    evidence_artifact_id = Column(Text, ForeignKey("evidence_artifact.id", ondelete="SET NULL"), nullable=True, index=True)
    unified_event_id = Column(Text, ForeignKey("unified_event.id", ondelete="SET NULL"), nullable=True)
    link_type = Column(Text, nullable=False, default="supporting")
    quote = Column(Text, nullable=True)
    confidence = Column(Float, nullable=True)
    link_metadata = Column("metadata", JSONB, nullable=False, default=dict)
    created_at = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow)


class Belief(Base):
    __tablename__ = "belief"

    id = Column(Text, primary_key=True)
    organization_id = Column(Text, ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False, index=True)
    proposition = Column(Text, nullable=False)
    belief_state = Column(Text, nullable=False, default="asserted", index=True)
    probability = Column(Float, nullable=False, default=0.5, index=True)
    calibration_bucket = Column(Text, nullable=True)
    supporting_evidence_count = Column(Integer, nullable=False, default=0)
    contradiction_count = Column(Integer, nullable=False, default=0)
    belief_hash = Column(Text, nullable=True, index=True)
    derived_from_observation_id = Column(Text, ForeignKey("observation.id", ondelete="SET NULL"), nullable=True)
    valid_from = Column(DateTime(timezone=True), nullable=True)
    valid_to = Column(DateTime(timezone=True), nullable=True)
    believed_from = Column(DateTime(timezone=True), nullable=True)
    believed_to = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow)
    updated_at = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow)


class BeliefRevision(Base):
    __tablename__ = "belief_revision"

    id = Column(Text, primary_key=True)
    organization_id = Column(Text, ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False, index=True)
    belief_id = Column(Text, ForeignKey("belief.id", ondelete="CASCADE"), nullable=False, index=True)
    previous_state = Column(Text, nullable=True)
    next_state = Column(Text, nullable=False)
    previous_probability = Column(Float, nullable=True)
    next_probability = Column(Float, nullable=True)
    reason = Column(Text, nullable=True)
    evidence_link_ids = Column(JSONB, nullable=False, default=list)
    revised_at = Column(DateTime(timezone=True), nullable=False, index=True)
    created_at = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow)


class Hypothesis(Base):
    __tablename__ = "hypothesis"

    id = Column(Text, primary_key=True)
    organization_id = Column(Text, ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False, index=True)
    hypothesis_text = Column(Text, nullable=False)
    status = Column(Text, nullable=False, default="active", index=True)
    prior_probability = Column(Float, nullable=False, default=0.5)
    posterior_probability = Column(Float, nullable=False, default=0.5)
    hypothesis_hash = Column(Text, nullable=True, index=True)
    related_belief_id = Column(Text, ForeignKey("belief.id", ondelete="SET NULL"), nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow)
    updated_at = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow)


class HypothesisScore(Base):
    __tablename__ = "hypothesis_score"

    id = Column(Text, primary_key=True)
    organization_id = Column(Text, ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False, index=True)
    hypothesis_id = Column(Text, ForeignKey("hypothesis.id", ondelete="CASCADE"), nullable=False, index=True)
    score_type = Column(Text, nullable=False)
    score_value = Column(Float, nullable=False)
    model_version = Column(Text, nullable=True)
    score_metadata = Column("metadata", JSONB, nullable=False, default=dict)
    scored_at = Column(DateTime(timezone=True), nullable=False, index=True)


class CognitiveConstraint(Base):
    __tablename__ = "cognitive_constraint"

    id = Column(Text, primary_key=True)
    organization_id = Column(Text, ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False, index=True)
    origin_type = Column(Text, nullable=False, index=True)
    title = Column(Text, nullable=False)
    machine_rule = Column(Text, nullable=False)
    jurisdiction = Column(Text, nullable=True)
    severity_on_breach = Column(Text, nullable=False, default="medium")
    is_active = Column(Boolean, nullable=False, default=True, index=True)
    constraint_hash = Column(Text, nullable=True)
    valid_from = Column(DateTime(timezone=True), nullable=True)
    valid_to = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow)
    updated_at = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow)


class ConstraintViolationCandidate(Base):
    __tablename__ = "constraint_violation_candidate"

    id = Column(Text, primary_key=True)
    organization_id = Column(Text, ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False, index=True)
    constraint_id = Column(Text, ForeignKey("cognitive_constraint.id", ondelete="CASCADE"), nullable=False, index=True)
    subject_entity_id = Column(Text, nullable=True)
    status = Column(Text, nullable=False, default="open", index=True)
    severity = Column(Text, nullable=False, default="medium")
    confidence = Column(Float, nullable=False, default=0.5)
    details = Column(JSONB, nullable=False, default=dict)
    detected_at = Column(DateTime(timezone=True), nullable=False)
    resolved_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow)


class ImpactEdge(Base):
    __tablename__ = "impact_edge"

    id = Column(Text, primary_key=True)
    organization_id = Column(Text, ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False, index=True)
    external_object_ref = Column(Text, nullable=False)
    internal_object_ref = Column(Text, nullable=False)
    impact_type = Column(Text, nullable=False, index=True)
    severity = Column(Text, nullable=False, default="medium")
    confidence = Column(Float, nullable=False, default=0.5)
    impact_hash = Column(Text, nullable=True)
    evidence_link_ids = Column(JSONB, nullable=False, default=list)
    created_at = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow, index=True)


class InterventionPlan(Base):
    __tablename__ = "intervention_plan"

    id = Column(Text, primary_key=True)
    organization_id = Column(Text, ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False, index=True)
    target_ref = Column(Text, nullable=False)
    policy_class = Column(Text, nullable=False, default="p1", index=True)
    status = Column(Text, nullable=False, default="proposed", index=True)
    action_graph = Column(JSONB, nullable=False, default=dict)
    rollback_plan = Column(JSONB, nullable=False, default=dict)
    expected_utility_delta = Column(Float, nullable=True)
    downside_risk_estimate = Column(Float, nullable=True)
    intervention_hash = Column(Text, nullable=True)
    proposed_at = Column(DateTime(timezone=True), nullable=True)
    approved_at = Column(DateTime(timezone=True), nullable=True)
    executed_at = Column(DateTime(timezone=True), nullable=True)
    rolled_back_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow)
    updated_at = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow)


class RealizedOutcome(Base):
    __tablename__ = "realized_outcome"

    id = Column(Text, primary_key=True)
    organization_id = Column(Text, ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False, index=True)
    intervention_plan_id = Column(Text, ForeignKey("intervention_plan.id", ondelete="SET NULL"), nullable=True)
    outcome_type = Column(Text, nullable=False, index=True)
    outcome_payload = Column(JSONB, nullable=False, default=dict)
    outcome_hash = Column(Text, nullable=True)
    measured_at = Column(DateTime(timezone=True), nullable=False, index=True)
    created_at = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow)


class UncertaintyState(Base):
    __tablename__ = "uncertainty_state"

    id = Column(Text, primary_key=True)
    organization_id = Column(Text, ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False, index=True)
    object_ref = Column(Text, nullable=False)
    object_type = Column(Text, nullable=False, index=True)
    uncertainty_score = Column(Float, nullable=False)
    uncertainty_band = Column(JSONB, nullable=False, default=dict)
    measured_at = Column(DateTime(timezone=True), nullable=False, index=True)
    created_at = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow)


class SourceReliabilityProfile(Base):
    __tablename__ = "source_reliability_profile"

    id = Column(Text, primary_key=True)
    organization_id = Column(Text, ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False, index=True)
    source_key = Column(Text, nullable=False, index=True)
    reliability_score = Column(Float, nullable=False, default=0.5)
    corroboration_rate = Column(Float, nullable=False, default=0.0)
    false_positive_rate = Column(Float, nullable=False, default=0.0)
    stats = Column(JSONB, nullable=False, default=dict)
    last_evaluated_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow)
    updated_at = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow)

    __table_args__ = (
        UniqueConstraint("organization_id", "source_key", name="source_reliability_profile_org_source_unique"),
    )
