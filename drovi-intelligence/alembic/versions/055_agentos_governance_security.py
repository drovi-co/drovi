"""Add AgentOS governance and enterprise security primitives.

Revision ID: 055_agentos_governance_security
Revises: 054_agentos_browser_automation
Create Date: 2026-02-14
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "055_agentos_governance_security"
down_revision: Union[str, None] = "054_agentos_browser_automation"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None



def _jsonb_object_default() -> sa.TextClause:
    return sa.text("'{}'::jsonb")



def _jsonb_array_default() -> sa.TextClause:
    return sa.text("'[]'::jsonb")



def _utc_now() -> sa.TextClause:
    return sa.text("NOW()")



def upgrade() -> None:
    op.create_table(
        "agent_service_principal",
        sa.Column("id", sa.Text(), nullable=False),
        sa.Column("organization_id", sa.Text(), nullable=False),
        sa.Column("deployment_id", sa.Text(), nullable=False),
        sa.Column("principal_name", sa.Text(), nullable=False),
        sa.Column("status", sa.Text(), nullable=False, server_default=sa.text("'active'")),
        sa.Column("allowed_scopes", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default=_jsonb_object_default()),
        sa.Column("metadata", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default=_jsonb_object_default()),
        sa.Column("created_by_user_id", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=_utc_now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=_utc_now()),
        sa.CheckConstraint("principal_name <> ''", name="agent_service_principal_name_non_empty"),
        sa.ForeignKeyConstraint(["deployment_id"], ["agent_deployment.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("deployment_id", name="agent_service_principal_deployment_key"),
        sa.UniqueConstraint("organization_id", "principal_name", name="agent_service_principal_org_name_key"),
    )
    op.create_index(
        "agent_service_principal_org_status_idx",
        "agent_service_principal",
        ["organization_id", "status", "updated_at"],
        unique=False,
    )

    op.create_table(
        "agent_delegated_authority",
        sa.Column("id", sa.Text(), nullable=False),
        sa.Column("organization_id", sa.Text(), nullable=False),
        sa.Column("principal_id", sa.Text(), nullable=False),
        sa.Column("authorized_by_user_id", sa.Text(), nullable=True),
        sa.Column("authority_scope", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default=_jsonb_object_default()),
        sa.Column("authority_reason", sa.Text(), nullable=True),
        sa.Column("valid_from", sa.DateTime(timezone=True), nullable=False, server_default=_utc_now()),
        sa.Column("valid_to", sa.DateTime(timezone=True), nullable=True),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("revoked_by_user_id", sa.Text(), nullable=True),
        sa.Column("metadata", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default=_jsonb_object_default()),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=_utc_now()),
        sa.ForeignKeyConstraint(["principal_id"], ["agent_service_principal.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "agent_delegated_authority_org_principal_valid_idx",
        "agent_delegated_authority",
        ["organization_id", "principal_id", "valid_from", "valid_to"],
        unique=False,
    )
    op.create_index(
        "agent_delegated_authority_org_active_idx",
        "agent_delegated_authority",
        ["organization_id", "revoked_at", "created_at"],
        unique=False,
    )

    op.create_table(
        "agent_org_governance_policy",
        sa.Column("organization_id", sa.Text(), nullable=False),
        sa.Column("residency_region", sa.Text(), nullable=False, server_default=sa.text("'global'")),
        sa.Column("allowed_regions", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default=_jsonb_array_default()),
        sa.Column("data_retention_days", sa.Integer(), nullable=False, server_default=sa.text("365")),
        sa.Column("evidence_retention_days", sa.Integer(), nullable=False, server_default=sa.text("3650")),
        sa.Column("require_residency_enforcement", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("enforce_delegated_authority", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("kill_switch_enabled", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("metadata", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default=_jsonb_object_default()),
        sa.Column("updated_by_user_id", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=_utc_now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=_utc_now()),
        sa.CheckConstraint("data_retention_days > 0", name="agent_org_governance_data_retention_positive"),
        sa.CheckConstraint("evidence_retention_days > 0", name="agent_org_governance_evidence_retention_positive"),
        sa.PrimaryKeyConstraint("organization_id"),
    )

    op.add_column(
        "agent_action_approval",
        sa.Column("chain_mode", sa.Text(), nullable=False, server_default=sa.text("'single'")),
    )
    op.add_column(
        "agent_action_approval",
        sa.Column("required_approvals", sa.Integer(), nullable=False, server_default=sa.text("1")),
    )
    op.add_column(
        "agent_action_approval",
        sa.Column(
            "approval_chain",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default=_jsonb_array_default(),
        ),
    )
    op.add_column(
        "agent_action_approval",
        sa.Column("approvals_received", sa.Integer(), nullable=False, server_default=sa.text("0")),
    )
    op.add_column(
        "agent_action_approval",
        sa.Column(
            "decision_summary",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default=_jsonb_object_default(),
        ),
    )
    op.create_check_constraint(
        "agent_action_approval_required_approvals_positive",
        "agent_action_approval",
        "required_approvals > 0",
    )

    op.create_table(
        "agent_action_approval_decision",
        sa.Column("id", sa.Text(), nullable=False),
        sa.Column("organization_id", sa.Text(), nullable=False),
        sa.Column("approval_id", sa.Text(), nullable=False),
        sa.Column("step_index", sa.Integer(), nullable=False, server_default=sa.text("1")),
        sa.Column("approver_id", sa.Text(), nullable=True),
        sa.Column("decision", sa.Text(), nullable=False),
        sa.Column("reason", sa.Text(), nullable=True),
        sa.Column("decided_at", sa.DateTime(timezone=True), nullable=False, server_default=_utc_now()),
        sa.Column("metadata", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default=_jsonb_object_default()),
        sa.CheckConstraint("step_index > 0", name="agent_action_approval_decision_step_positive"),
        sa.ForeignKeyConstraint(["approval_id"], ["agent_action_approval.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "agent_action_approval_decision_org_approval_decided_idx",
        "agent_action_approval_decision",
        ["organization_id", "approval_id", "decided_at"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index("agent_action_approval_decision_org_approval_decided_idx", table_name="agent_action_approval_decision")
    op.drop_table("agent_action_approval_decision")

    op.drop_constraint(
        "agent_action_approval_required_approvals_positive",
        "agent_action_approval",
        type_="check",
    )
    op.drop_column("agent_action_approval", "decision_summary")
    op.drop_column("agent_action_approval", "approvals_received")
    op.drop_column("agent_action_approval", "approval_chain")
    op.drop_column("agent_action_approval", "required_approvals")
    op.drop_column("agent_action_approval", "chain_mode")

    op.drop_table("agent_org_governance_policy")

    op.drop_index("agent_delegated_authority_org_active_idx", table_name="agent_delegated_authority")
    op.drop_index("agent_delegated_authority_org_principal_valid_idx", table_name="agent_delegated_authority")
    op.drop_table("agent_delegated_authority")

    op.drop_index("agent_service_principal_org_status_idx", table_name="agent_service_principal")
    op.drop_table("agent_service_principal")
