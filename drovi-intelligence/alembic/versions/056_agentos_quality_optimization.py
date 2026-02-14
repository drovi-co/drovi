"""Add AgentOS quality optimization tables.

Revision ID: 056_agentos_quality_optimization
Revises: 055_agentos_governance_security
Create Date: 2026-02-14
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "056_agentos_quality_optimization"
down_revision: Union[str, None] = "055_agentos_governance_security"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _jsonb_default() -> sa.TextClause:
    return sa.text("'{}'::jsonb")


def _utc_now() -> sa.TextClause:
    return sa.text("NOW()")


def upgrade() -> None:
    op.create_table(
        "agent_run_quality_score",
        sa.Column("id", sa.Text(), nullable=False),
        sa.Column("organization_id", sa.Text(), nullable=False),
        sa.Column("run_id", sa.Text(), nullable=False),
        sa.Column("deployment_id", sa.Text(), nullable=True),
        sa.Column("role_id", sa.Text(), nullable=True),
        sa.Column("quality_score", sa.Float(), nullable=False),
        sa.Column("confidence_score", sa.Float(), nullable=False, server_default=sa.text("0.5")),
        sa.Column("outcome_score", sa.Float(), nullable=True),
        sa.Column("status", sa.Text(), nullable=False, server_default=sa.text("'pending_feedback'")),
        sa.Column("score_breakdown", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default=_jsonb_default()),
        sa.Column("evaluated_at", sa.DateTime(timezone=True), nullable=False, server_default=_utc_now()),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=_utc_now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=_utc_now()),
        sa.CheckConstraint("quality_score >= 0.0 AND quality_score <= 1.0", name="agent_run_quality_score_range"),
        sa.CheckConstraint(
            "confidence_score >= 0.0 AND confidence_score <= 1.0",
            name="agent_run_quality_confidence_range",
        ),
        sa.CheckConstraint(
            "(outcome_score IS NULL) OR (outcome_score >= 0.0 AND outcome_score <= 1.0)",
            name="agent_run_quality_outcome_range",
        ),
        sa.ForeignKeyConstraint(["deployment_id"], ["agent_deployment.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["role_id"], ["agent_role.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["run_id"], ["agent_run.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("run_id", name="agent_run_quality_score_run_key"),
    )
    op.create_index(
        "agent_run_quality_score_org_eval_idx",
        "agent_run_quality_score",
        ["organization_id", "evaluated_at"],
        unique=False,
    )
    op.create_index(
        "agent_run_quality_score_org_role_eval_idx",
        "agent_run_quality_score",
        ["organization_id", "role_id", "evaluated_at"],
        unique=False,
    )

    op.create_table(
        "agent_confidence_calibration",
        sa.Column("id", sa.Text(), nullable=False),
        sa.Column("organization_id", sa.Text(), nullable=False),
        sa.Column("role_id", sa.Text(), nullable=True),
        sa.Column("sample_count", sa.Integer(), nullable=False, server_default=sa.text("0")),
        sa.Column("mean_absolute_error", sa.Float(), nullable=False, server_default=sa.text("0.0")),
        sa.Column("brier_score", sa.Float(), nullable=False, server_default=sa.text("0.0")),
        sa.Column("calibration_error", sa.Float(), nullable=False, server_default=sa.text("0.0")),
        sa.Column("adjustment_factor", sa.Float(), nullable=False, server_default=sa.text("1.0")),
        sa.Column("bucket_stats", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default=_jsonb_default()),
        sa.Column("metadata", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default=_jsonb_default()),
        sa.Column("computed_at", sa.DateTime(timezone=True), nullable=False, server_default=_utc_now()),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=_utc_now()),
        sa.ForeignKeyConstraint(["role_id"], ["agent_role.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "agent_confidence_calibration_org_role_idx",
        "agent_confidence_calibration",
        ["organization_id", "role_id", "computed_at"],
        unique=False,
    )

    op.create_table(
        "agent_quality_recommendation",
        sa.Column("id", sa.Text(), nullable=False),
        sa.Column("organization_id", sa.Text(), nullable=False),
        sa.Column("role_id", sa.Text(), nullable=True),
        sa.Column("deployment_id", sa.Text(), nullable=True),
        sa.Column("recommendation_type", sa.Text(), nullable=False),
        sa.Column("priority", sa.Text(), nullable=False, server_default=sa.text("'medium'")),
        sa.Column("status", sa.Text(), nullable=False, server_default=sa.text("'open'")),
        sa.Column("summary", sa.Text(), nullable=False),
        sa.Column("details", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default=_jsonb_default()),
        sa.Column("source_signals", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default=_jsonb_default()),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=_utc_now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=_utc_now()),
        sa.Column("resolved_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["deployment_id"], ["agent_deployment.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["role_id"], ["agent_role.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "agent_quality_recommendation_org_status_idx",
        "agent_quality_recommendation",
        ["organization_id", "status", "created_at"],
        unique=False,
    )

    op.create_table(
        "agent_quality_regression_gate",
        sa.Column("id", sa.Text(), nullable=False),
        sa.Column("organization_id", sa.Text(), nullable=False),
        sa.Column("role_id", sa.Text(), nullable=True),
        sa.Column("deployment_id", sa.Text(), nullable=True),
        sa.Column("metric_name", sa.Text(), nullable=False),
        sa.Column("comparator", sa.Text(), nullable=False, server_default=sa.text("'max_drop'")),
        sa.Column("threshold", sa.Float(), nullable=False),
        sa.Column("lookback_days", sa.Integer(), nullable=False, server_default=sa.text("14")),
        sa.Column("min_samples", sa.Integer(), nullable=False, server_default=sa.text("10")),
        sa.Column("severity", sa.Text(), nullable=False, server_default=sa.text("'blocker'")),
        sa.Column("is_enabled", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("metadata", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default=_jsonb_default()),
        sa.Column("created_by_user_id", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=_utc_now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=_utc_now()),
        sa.CheckConstraint("lookback_days >= 1 AND lookback_days <= 365", name="agent_quality_gate_lookback_days_range"),
        sa.CheckConstraint("min_samples >= 1 AND min_samples <= 100000", name="agent_quality_gate_min_samples_range"),
        sa.ForeignKeyConstraint(["deployment_id"], ["agent_deployment.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["role_id"], ["agent_role.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "agent_quality_regression_gate_org_enabled_idx",
        "agent_quality_regression_gate",
        ["organization_id", "is_enabled", "metric_name"],
        unique=False,
    )

    op.create_table(
        "agent_quality_regression_event",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False, server_default=sa.text("gen_random_uuid()")),
        sa.Column("organization_id", sa.Text(), nullable=False),
        sa.Column("gate_id", sa.Text(), nullable=False),
        sa.Column("metric_name", sa.Text(), nullable=False),
        sa.Column("baseline_value", sa.Float(), nullable=True),
        sa.Column("current_value", sa.Float(), nullable=True),
        sa.Column("delta_value", sa.Float(), nullable=True),
        sa.Column("sample_count", sa.Integer(), nullable=False, server_default=sa.text("0")),
        sa.Column("verdict", sa.Text(), nullable=False),
        sa.Column("blocked", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("metadata", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default=_jsonb_default()),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=_utc_now()),
        sa.ForeignKeyConstraint(["gate_id"], ["agent_quality_regression_gate.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "agent_quality_regression_event_org_created_idx",
        "agent_quality_regression_event",
        ["organization_id", "created_at"],
        unique=False,
    )
    op.create_index(
        "agent_quality_regression_event_gate_created_idx",
        "agent_quality_regression_event",
        ["gate_id", "created_at"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index("agent_quality_regression_event_gate_created_idx", table_name="agent_quality_regression_event")
    op.drop_index("agent_quality_regression_event_org_created_idx", table_name="agent_quality_regression_event")
    op.drop_table("agent_quality_regression_event")

    op.drop_index("agent_quality_regression_gate_org_enabled_idx", table_name="agent_quality_regression_gate")
    op.drop_table("agent_quality_regression_gate")

    op.drop_index("agent_quality_recommendation_org_status_idx", table_name="agent_quality_recommendation")
    op.drop_table("agent_quality_recommendation")

    op.drop_index("agent_confidence_calibration_org_role_idx", table_name="agent_confidence_calibration")
    op.drop_table("agent_confidence_calibration")

    op.drop_index("agent_run_quality_score_org_role_eval_idx", table_name="agent_run_quality_score")
    op.drop_index("agent_run_quality_score_org_eval_idx", table_name="agent_run_quality_score")
    op.drop_table("agent_run_quality_score")
