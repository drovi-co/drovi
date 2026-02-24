"""World Brain phase 1 cognitive schema foundations.

Revision ID: 067_world_brain_phase1_foundation
Revises: 066_derivation_rule
Create Date: 2026-02-22
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB


# revision identifiers, used by Alembic.
revision: str = "067_world_brain_phase1_foundation"
down_revision: Union[str, None] = "066_derivation_rule"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _enable_rls(table: str, column: str = "organization_id") -> None:
    policy_name = f"{table}_org_isolation"
    op.execute(
        f"""
        ALTER TABLE {table} ENABLE ROW LEVEL SECURITY;
        ALTER TABLE {table} FORCE ROW LEVEL SECURITY;
        DROP POLICY IF EXISTS {policy_name} ON {table};
        CREATE POLICY {policy_name} ON {table}
            USING (
                current_setting('app.is_internal', true) = 'true'
                OR {column}::text = current_setting('app.organization_id', true)
            )
            WITH CHECK (
                current_setting('app.is_internal', true) = 'true'
                OR {column}::text = current_setting('app.organization_id', true)
            );
        """
    )


def upgrade() -> None:
    op.create_table(
        "observation",
        sa.Column("id", sa.Text(), primary_key=True, nullable=False),
        sa.Column(
            "organization_id",
            sa.Text(),
            sa.ForeignKey("organizations.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "source_event_id",
            sa.Text(),
            sa.ForeignKey("unified_event.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("source_type", sa.Text(), nullable=True),
        sa.Column("source_ref", sa.Text(), nullable=True),
        sa.Column("observation_type", sa.Text(), nullable=False),
        sa.Column("title", sa.Text(), nullable=True),
        sa.Column("content", JSONB(astext_type=sa.Text()), nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column("observation_hash", sa.Text(), nullable=True),
        sa.Column("observed_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("valid_from", sa.DateTime(timezone=True), nullable=True),
        sa.Column("valid_to", sa.DateTime(timezone=True), nullable=True),
        sa.Column("believed_from", sa.DateTime(timezone=True), nullable=True),
        sa.Column("believed_to", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
    )
    op.create_index("observation_org_idx", "observation", ["organization_id"])
    op.create_index("observation_type_idx", "observation", ["observation_type"])
    op.create_index("observation_observed_at_idx", "observation", ["observed_at"])
    op.create_index("observation_hash_idx", "observation", ["observation_hash"])

    op.create_table(
        "observation_evidence_link",
        sa.Column("id", sa.Text(), primary_key=True, nullable=False),
        sa.Column(
            "organization_id",
            sa.Text(),
            sa.ForeignKey("organizations.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "observation_id",
            sa.Text(),
            sa.ForeignKey("observation.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "evidence_artifact_id",
            sa.Text(),
            sa.ForeignKey("evidence_artifact.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "unified_event_id",
            sa.Text(),
            sa.ForeignKey("unified_event.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("link_type", sa.Text(), nullable=False, server_default="supporting"),
        sa.Column("quote", sa.Text(), nullable=True),
        sa.Column("confidence", sa.Float(), nullable=True),
        sa.Column("metadata", JSONB(astext_type=sa.Text()), nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
    )
    op.create_index(
        "observation_evidence_link_org_idx",
        "observation_evidence_link",
        ["organization_id"],
    )
    op.create_index(
        "observation_evidence_link_observation_idx",
        "observation_evidence_link",
        ["observation_id"],
    )
    op.create_index(
        "observation_evidence_link_artifact_idx",
        "observation_evidence_link",
        ["evidence_artifact_id"],
    )

    op.create_table(
        "belief",
        sa.Column("id", sa.Text(), primary_key=True, nullable=False),
        sa.Column(
            "organization_id",
            sa.Text(),
            sa.ForeignKey("organizations.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("proposition", sa.Text(), nullable=False),
        sa.Column("belief_state", sa.Text(), nullable=False, server_default="asserted"),
        sa.Column("probability", sa.Float(), nullable=False, server_default="0.5"),
        sa.Column("calibration_bucket", sa.Text(), nullable=True),
        sa.Column("supporting_evidence_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("contradiction_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("belief_hash", sa.Text(), nullable=True),
        sa.Column(
            "derived_from_observation_id",
            sa.Text(),
            sa.ForeignKey("observation.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("valid_from", sa.DateTime(timezone=True), nullable=True),
        sa.Column("valid_to", sa.DateTime(timezone=True), nullable=True),
        sa.Column("believed_from", sa.DateTime(timezone=True), nullable=True),
        sa.Column("believed_to", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
    )
    op.create_index("belief_org_idx", "belief", ["organization_id"])
    op.create_index("belief_state_idx", "belief", ["belief_state"])
    op.create_index("belief_probability_idx", "belief", ["probability"])
    op.create_index("belief_hash_idx", "belief", ["belief_hash"])

    op.create_table(
        "belief_revision",
        sa.Column("id", sa.Text(), primary_key=True, nullable=False),
        sa.Column(
            "organization_id",
            sa.Text(),
            sa.ForeignKey("organizations.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "belief_id",
            sa.Text(),
            sa.ForeignKey("belief.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("previous_state", sa.Text(), nullable=True),
        sa.Column("next_state", sa.Text(), nullable=False),
        sa.Column("previous_probability", sa.Float(), nullable=True),
        sa.Column("next_probability", sa.Float(), nullable=True),
        sa.Column("reason", sa.Text(), nullable=True),
        sa.Column("evidence_link_ids", JSONB(astext_type=sa.Text()), nullable=False, server_default=sa.text("'[]'::jsonb")),
        sa.Column("revised_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
    )
    op.create_index("belief_revision_org_idx", "belief_revision", ["organization_id"])
    op.create_index("belief_revision_belief_idx", "belief_revision", ["belief_id"])
    op.create_index("belief_revision_revised_at_idx", "belief_revision", ["revised_at"])

    op.create_table(
        "hypothesis",
        sa.Column("id", sa.Text(), primary_key=True, nullable=False),
        sa.Column(
            "organization_id",
            sa.Text(),
            sa.ForeignKey("organizations.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("hypothesis_text", sa.Text(), nullable=False),
        sa.Column("status", sa.Text(), nullable=False, server_default="active"),
        sa.Column("prior_probability", sa.Float(), nullable=False, server_default="0.5"),
        sa.Column("posterior_probability", sa.Float(), nullable=False, server_default="0.5"),
        sa.Column("hypothesis_hash", sa.Text(), nullable=True),
        sa.Column(
            "related_belief_id",
            sa.Text(),
            sa.ForeignKey("belief.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
    )
    op.create_index("hypothesis_org_idx", "hypothesis", ["organization_id"])
    op.create_index("hypothesis_status_idx", "hypothesis", ["status"])
    op.create_index("hypothesis_hash_idx", "hypothesis", ["hypothesis_hash"])

    op.create_table(
        "hypothesis_score",
        sa.Column("id", sa.Text(), primary_key=True, nullable=False),
        sa.Column(
            "organization_id",
            sa.Text(),
            sa.ForeignKey("organizations.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "hypothesis_id",
            sa.Text(),
            sa.ForeignKey("hypothesis.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("score_type", sa.Text(), nullable=False),
        sa.Column("score_value", sa.Float(), nullable=False),
        sa.Column("model_version", sa.Text(), nullable=True),
        sa.Column("metadata", JSONB(astext_type=sa.Text()), nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column("scored_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("hypothesis_score_org_idx", "hypothesis_score", ["organization_id"])
    op.create_index("hypothesis_score_hypothesis_idx", "hypothesis_score", ["hypothesis_id"])
    op.create_index("hypothesis_score_scored_at_idx", "hypothesis_score", ["scored_at"])

    op.create_table(
        "cognitive_constraint",
        sa.Column("id", sa.Text(), primary_key=True, nullable=False),
        sa.Column(
            "organization_id",
            sa.Text(),
            sa.ForeignKey("organizations.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("origin_type", sa.Text(), nullable=False),
        sa.Column("title", sa.Text(), nullable=False),
        sa.Column("machine_rule", sa.Text(), nullable=False),
        sa.Column("jurisdiction", sa.Text(), nullable=True),
        sa.Column("severity_on_breach", sa.Text(), nullable=False, server_default="medium"),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("constraint_hash", sa.Text(), nullable=True),
        sa.Column("valid_from", sa.DateTime(timezone=True), nullable=True),
        sa.Column("valid_to", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
    )
    op.create_index("cognitive_constraint_org_idx", "cognitive_constraint", ["organization_id"])
    op.create_index("cognitive_constraint_origin_idx", "cognitive_constraint", ["origin_type"])
    op.create_index("cognitive_constraint_active_idx", "cognitive_constraint", ["is_active"])

    op.create_table(
        "constraint_violation_candidate",
        sa.Column("id", sa.Text(), primary_key=True, nullable=False),
        sa.Column(
            "organization_id",
            sa.Text(),
            sa.ForeignKey("organizations.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "constraint_id",
            sa.Text(),
            sa.ForeignKey("cognitive_constraint.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("subject_entity_id", sa.Text(), nullable=True),
        sa.Column("status", sa.Text(), nullable=False, server_default="open"),
        sa.Column("severity", sa.Text(), nullable=False, server_default="medium"),
        sa.Column("confidence", sa.Float(), nullable=False, server_default="0.5"),
        sa.Column("details", JSONB(astext_type=sa.Text()), nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column("detected_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("resolved_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
    )
    op.create_index(
        "constraint_violation_candidate_org_idx",
        "constraint_violation_candidate",
        ["organization_id"],
    )
    op.create_index(
        "constraint_violation_candidate_constraint_idx",
        "constraint_violation_candidate",
        ["constraint_id"],
    )
    op.create_index(
        "constraint_violation_candidate_status_idx",
        "constraint_violation_candidate",
        ["status"],
    )

    op.create_table(
        "impact_edge",
        sa.Column("id", sa.Text(), primary_key=True, nullable=False),
        sa.Column(
            "organization_id",
            sa.Text(),
            sa.ForeignKey("organizations.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("external_object_ref", sa.Text(), nullable=False),
        sa.Column("internal_object_ref", sa.Text(), nullable=False),
        sa.Column("impact_type", sa.Text(), nullable=False),
        sa.Column("severity", sa.Text(), nullable=False, server_default="medium"),
        sa.Column("confidence", sa.Float(), nullable=False, server_default="0.5"),
        sa.Column("impact_hash", sa.Text(), nullable=True),
        sa.Column("evidence_link_ids", JSONB(astext_type=sa.Text()), nullable=False, server_default=sa.text("'[]'::jsonb")),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
    )
    op.create_index("impact_edge_org_idx", "impact_edge", ["organization_id"])
    op.create_index("impact_edge_type_idx", "impact_edge", ["impact_type"])
    op.create_index("impact_edge_created_idx", "impact_edge", ["created_at"])

    op.add_column(
        "simulation_run",
        sa.Column("scenario_type", sa.Text(), nullable=True),
    )
    op.add_column(
        "simulation_run",
        sa.Column("status", sa.Text(), nullable=False, server_default="completed"),
    )
    op.add_column(
        "simulation_run",
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "simulation_run",
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "simulation_run",
        sa.Column("run_metadata", JSONB(astext_type=sa.Text()), nullable=False, server_default=sa.text("'{}'::jsonb")),
    )
    op.create_index("simulation_run_status_idx", "simulation_run", ["status"])
    op.create_index("simulation_run_type_idx", "simulation_run", ["scenario_type"])

    op.create_table(
        "intervention_plan",
        sa.Column("id", sa.Text(), primary_key=True, nullable=False),
        sa.Column(
            "organization_id",
            sa.Text(),
            sa.ForeignKey("organizations.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("target_ref", sa.Text(), nullable=False),
        sa.Column("policy_class", sa.Text(), nullable=False, server_default="p1"),
        sa.Column("status", sa.Text(), nullable=False, server_default="proposed"),
        sa.Column("action_graph", JSONB(astext_type=sa.Text()), nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column("rollback_plan", JSONB(astext_type=sa.Text()), nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column("expected_utility_delta", sa.Float(), nullable=True),
        sa.Column("downside_risk_estimate", sa.Float(), nullable=True),
        sa.Column("intervention_hash", sa.Text(), nullable=True),
        sa.Column("proposed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("approved_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("executed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("rolled_back_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
    )
    op.create_index("intervention_plan_org_idx", "intervention_plan", ["organization_id"])
    op.create_index("intervention_plan_status_idx", "intervention_plan", ["status"])
    op.create_index("intervention_plan_policy_idx", "intervention_plan", ["policy_class"])

    op.create_table(
        "realized_outcome",
        sa.Column("id", sa.Text(), primary_key=True, nullable=False),
        sa.Column(
            "organization_id",
            sa.Text(),
            sa.ForeignKey("organizations.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "intervention_plan_id",
            sa.Text(),
            sa.ForeignKey("intervention_plan.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("outcome_type", sa.Text(), nullable=False),
        sa.Column("outcome_payload", JSONB(astext_type=sa.Text()), nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column("outcome_hash", sa.Text(), nullable=True),
        sa.Column("measured_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
    )
    op.create_index("realized_outcome_org_idx", "realized_outcome", ["organization_id"])
    op.create_index("realized_outcome_type_idx", "realized_outcome", ["outcome_type"])
    op.create_index("realized_outcome_measured_idx", "realized_outcome", ["measured_at"])

    op.create_table(
        "uncertainty_state",
        sa.Column("id", sa.Text(), primary_key=True, nullable=False),
        sa.Column(
            "organization_id",
            sa.Text(),
            sa.ForeignKey("organizations.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("object_ref", sa.Text(), nullable=False),
        sa.Column("object_type", sa.Text(), nullable=False),
        sa.Column("uncertainty_score", sa.Float(), nullable=False),
        sa.Column("uncertainty_band", JSONB(astext_type=sa.Text()), nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column("measured_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
    )
    op.create_index("uncertainty_state_org_idx", "uncertainty_state", ["organization_id"])
    op.create_index("uncertainty_state_type_idx", "uncertainty_state", ["object_type"])
    op.create_index("uncertainty_state_measured_idx", "uncertainty_state", ["measured_at"])

    op.create_table(
        "source_reliability_profile",
        sa.Column("id", sa.Text(), primary_key=True, nullable=False),
        sa.Column(
            "organization_id",
            sa.Text(),
            sa.ForeignKey("organizations.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("source_key", sa.Text(), nullable=False),
        sa.Column("reliability_score", sa.Float(), nullable=False, server_default="0.5"),
        sa.Column("corroboration_rate", sa.Float(), nullable=False, server_default="0.0"),
        sa.Column("false_positive_rate", sa.Float(), nullable=False, server_default="0.0"),
        sa.Column("stats", JSONB(astext_type=sa.Text()), nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column("last_evaluated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.UniqueConstraint("organization_id", "source_key", name="source_reliability_profile_org_source_unique"),
    )
    op.create_index("source_reliability_profile_org_idx", "source_reliability_profile", ["organization_id"])
    op.create_index("source_reliability_profile_source_idx", "source_reliability_profile", ["source_key"])

    rls_tables = [
        "observation",
        "observation_evidence_link",
        "belief",
        "belief_revision",
        "hypothesis",
        "hypothesis_score",
        "cognitive_constraint",
        "constraint_violation_candidate",
        "impact_edge",
        "intervention_plan",
        "realized_outcome",
        "uncertainty_state",
        "source_reliability_profile",
    ]
    for table in rls_tables:
        _enable_rls(table)


def downgrade() -> None:
    rls_tables = [
        "source_reliability_profile",
        "uncertainty_state",
        "realized_outcome",
        "intervention_plan",
        "impact_edge",
        "constraint_violation_candidate",
        "cognitive_constraint",
        "hypothesis_score",
        "hypothesis",
        "belief_revision",
        "belief",
        "observation_evidence_link",
        "observation",
    ]
    for table in rls_tables:
        policy_name = f"{table}_org_isolation"
        op.execute(f"DROP POLICY IF EXISTS {policy_name} ON {table};")
        op.execute(f"ALTER TABLE {table} NO FORCE ROW LEVEL SECURITY;")
        op.execute(f"ALTER TABLE {table} DISABLE ROW LEVEL SECURITY;")

    op.drop_index("source_reliability_profile_source_idx", table_name="source_reliability_profile")
    op.drop_index("source_reliability_profile_org_idx", table_name="source_reliability_profile")
    op.drop_table("source_reliability_profile")

    op.drop_index("uncertainty_state_measured_idx", table_name="uncertainty_state")
    op.drop_index("uncertainty_state_type_idx", table_name="uncertainty_state")
    op.drop_index("uncertainty_state_org_idx", table_name="uncertainty_state")
    op.drop_table("uncertainty_state")

    op.drop_index("realized_outcome_measured_idx", table_name="realized_outcome")
    op.drop_index("realized_outcome_type_idx", table_name="realized_outcome")
    op.drop_index("realized_outcome_org_idx", table_name="realized_outcome")
    op.drop_table("realized_outcome")

    op.drop_index("intervention_plan_policy_idx", table_name="intervention_plan")
    op.drop_index("intervention_plan_status_idx", table_name="intervention_plan")
    op.drop_index("intervention_plan_org_idx", table_name="intervention_plan")
    op.drop_table("intervention_plan")

    op.drop_index("simulation_run_type_idx", table_name="simulation_run")
    op.drop_index("simulation_run_status_idx", table_name="simulation_run")
    op.drop_column("simulation_run", "run_metadata")
    op.drop_column("simulation_run", "completed_at")
    op.drop_column("simulation_run", "started_at")
    op.drop_column("simulation_run", "status")
    op.drop_column("simulation_run", "scenario_type")

    op.drop_index("impact_edge_created_idx", table_name="impact_edge")
    op.drop_index("impact_edge_type_idx", table_name="impact_edge")
    op.drop_index("impact_edge_org_idx", table_name="impact_edge")
    op.drop_table("impact_edge")

    op.drop_index("constraint_violation_candidate_status_idx", table_name="constraint_violation_candidate")
    op.drop_index("constraint_violation_candidate_constraint_idx", table_name="constraint_violation_candidate")
    op.drop_index("constraint_violation_candidate_org_idx", table_name="constraint_violation_candidate")
    op.drop_table("constraint_violation_candidate")

    op.drop_index("cognitive_constraint_active_idx", table_name="cognitive_constraint")
    op.drop_index("cognitive_constraint_origin_idx", table_name="cognitive_constraint")
    op.drop_index("cognitive_constraint_org_idx", table_name="cognitive_constraint")
    op.drop_table("cognitive_constraint")

    op.drop_index("hypothesis_score_scored_at_idx", table_name="hypothesis_score")
    op.drop_index("hypothesis_score_hypothesis_idx", table_name="hypothesis_score")
    op.drop_index("hypothesis_score_org_idx", table_name="hypothesis_score")
    op.drop_table("hypothesis_score")

    op.drop_index("hypothesis_hash_idx", table_name="hypothesis")
    op.drop_index("hypothesis_status_idx", table_name="hypothesis")
    op.drop_index("hypothesis_org_idx", table_name="hypothesis")
    op.drop_table("hypothesis")

    op.drop_index("belief_revision_revised_at_idx", table_name="belief_revision")
    op.drop_index("belief_revision_belief_idx", table_name="belief_revision")
    op.drop_index("belief_revision_org_idx", table_name="belief_revision")
    op.drop_table("belief_revision")

    op.drop_index("belief_hash_idx", table_name="belief")
    op.drop_index("belief_probability_idx", table_name="belief")
    op.drop_index("belief_state_idx", table_name="belief")
    op.drop_index("belief_org_idx", table_name="belief")
    op.drop_table("belief")

    op.drop_index("observation_evidence_link_artifact_idx", table_name="observation_evidence_link")
    op.drop_index("observation_evidence_link_observation_idx", table_name="observation_evidence_link")
    op.drop_index("observation_evidence_link_org_idx", table_name="observation_evidence_link")
    op.drop_table("observation_evidence_link")

    op.drop_index("observation_hash_idx", table_name="observation")
    op.drop_index("observation_observed_at_idx", table_name="observation")
    op.drop_index("observation_type_idx", table_name="observation")
    op.drop_index("observation_org_idx", table_name="observation")
    op.drop_table("observation")
