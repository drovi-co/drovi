"""Add AgentOS tool/policy/approval/receipt persistence.

Revision ID: 052_agentos_tool_policy_plane
Revises: 051_agentos_core_tables
Create Date: 2026-02-13
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "052_agentos_tool_policy_plane"
down_revision: Union[str, None] = "051_agentos_core_tables"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _jsonb_default() -> sa.TextClause:
    return sa.text("'{}'::jsonb")


def _utc_now() -> sa.TextClause:
    return sa.text("NOW()")


def upgrade() -> None:
    op.create_table(
        "agent_tool_manifest",
        sa.Column("id", sa.Text(), nullable=False),
        sa.Column("organization_id", sa.Text(), nullable=False),
        sa.Column("tool_id", sa.Text(), nullable=False),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("side_effect_tier", sa.Text(), nullable=False),
        sa.Column("default_policy_action", sa.Text(), nullable=False, server_default=sa.text("'allow'")),
        sa.Column("requires_evidence", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("high_stakes", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("input_schema", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default=_jsonb_default()),
        sa.Column("output_schema", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default=_jsonb_default()),
        sa.Column("metadata", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default=_jsonb_default()),
        sa.Column("is_enabled", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=_utc_now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=_utc_now()),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("organization_id", "tool_id", name="agent_tool_manifest_org_tool_key"),
    )
    op.create_index(
        "agent_tool_manifest_org_enabled_idx",
        "agent_tool_manifest",
        ["organization_id", "is_enabled", "tool_id"],
        unique=False,
    )

    op.create_table(
        "agent_org_policy_overlay",
        sa.Column("organization_id", sa.Text(), nullable=False),
        sa.Column("allow_tools", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default=_jsonb_default()),
        sa.Column("deny_tools", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default=_jsonb_default()),
        sa.Column(
            "require_approval_tools",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default=_jsonb_default(),
        ),
        sa.Column(
            "emergency_denylist",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default=_jsonb_default(),
        ),
        sa.Column("default_policy_action", sa.Text(), nullable=False, server_default=sa.text("'allow'")),
        sa.Column("metadata", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default=_jsonb_default()),
        sa.Column("updated_by_user_id", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=_utc_now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=_utc_now()),
        sa.PrimaryKeyConstraint("organization_id"),
    )

    op.create_table(
        "agent_action_approval",
        sa.Column("id", sa.Text(), nullable=False),
        sa.Column("organization_id", sa.Text(), nullable=False),
        sa.Column("run_id", sa.Text(), nullable=True),
        sa.Column("deployment_id", sa.Text(), nullable=True),
        sa.Column("tool_id", sa.Text(), nullable=False),
        sa.Column("action_tier", sa.Text(), nullable=False),
        sa.Column("reason", sa.Text(), nullable=True),
        sa.Column("status", sa.Text(), nullable=False, server_default=sa.text("'pending'")),
        sa.Column("requested_by", sa.Text(), nullable=True),
        sa.Column("requested_at", sa.DateTime(timezone=True), nullable=False, server_default=_utc_now()),
        sa.Column("sla_due_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("escalation_path", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default=_jsonb_default()),
        sa.Column("approver_id", sa.Text(), nullable=True),
        sa.Column("approval_reason", sa.Text(), nullable=True),
        sa.Column("decided_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("metadata", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default=_jsonb_default()),
        sa.ForeignKeyConstraint(["run_id"], ["agent_run.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["deployment_id"], ["agent_deployment.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "agent_action_approval_org_status_requested_idx",
        "agent_action_approval",
        ["organization_id", "status", "requested_at"],
        unique=False,
    )
    op.create_index("agent_action_approval_org_run_idx", "agent_action_approval", ["organization_id", "run_id"], unique=False)

    op.create_table(
        "agent_action_receipt",
        sa.Column("id", sa.Text(), nullable=False),
        sa.Column("organization_id", sa.Text(), nullable=False),
        sa.Column("run_id", sa.Text(), nullable=True),
        sa.Column("deployment_id", sa.Text(), nullable=True),
        sa.Column("tool_id", sa.Text(), nullable=False),
        sa.Column("request_payload", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default=_jsonb_default()),
        sa.Column("evidence_refs", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default=_jsonb_default()),
        sa.Column("policy_result", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default=_jsonb_default()),
        sa.Column("approval_request_id", sa.Text(), nullable=True),
        sa.Column("final_status", sa.Text(), nullable=False),
        sa.Column("result_payload", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default=_jsonb_default()),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=_utc_now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=_utc_now()),
        sa.ForeignKeyConstraint(["run_id"], ["agent_run.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["deployment_id"], ["agent_deployment.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["approval_request_id"], ["agent_action_approval.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "agent_action_receipt_org_run_created_idx",
        "agent_action_receipt",
        ["organization_id", "run_id", "created_at"],
        unique=False,
    )
    op.create_index(
        "agent_action_receipt_org_status_created_idx",
        "agent_action_receipt",
        ["organization_id", "final_status", "created_at"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index("agent_action_receipt_org_status_created_idx", table_name="agent_action_receipt")
    op.drop_index("agent_action_receipt_org_run_created_idx", table_name="agent_action_receipt")
    op.drop_table("agent_action_receipt")

    op.drop_index("agent_action_approval_org_run_idx", table_name="agent_action_approval")
    op.drop_index("agent_action_approval_org_status_requested_idx", table_name="agent_action_approval")
    op.drop_table("agent_action_approval")

    op.drop_table("agent_org_policy_overlay")

    op.drop_index("agent_tool_manifest_org_enabled_idx", table_name="agent_tool_manifest")
    op.drop_table("agent_tool_manifest")
