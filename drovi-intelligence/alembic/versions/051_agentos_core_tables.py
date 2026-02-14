"""Create AgentOS core control-plane tables.

Revision ID: 051_agentos_core_tables
Revises: 050_vertical_extension_tables
Create Date: 2026-02-13
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "051_agentos_core_tables"
down_revision: Union[str, None] = "050_vertical_extension_tables"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _jsonb_default() -> sa.TextClause:
    return sa.text("'{}'::jsonb")


def _utc_now() -> sa.TextClause:
    return sa.text("NOW()")


def upgrade() -> None:
    op.create_table(
        "agent_role",
        sa.Column("id", sa.Text(), nullable=False),
        sa.Column("organization_id", sa.Text(), nullable=False),
        sa.Column("role_key", sa.Text(), nullable=False),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("domain", sa.Text(), nullable=True),
        sa.Column("status", sa.Text(), nullable=False, server_default=sa.text("'draft'")),
        sa.Column("metadata", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default=_jsonb_default()),
        sa.Column("created_by_user_id", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=_utc_now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=_utc_now()),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("organization_id", "role_key", name="agent_role_org_role_key_key"),
    )
    op.create_index("agent_role_org_status_idx", "agent_role", ["organization_id", "status"], unique=False)

    op.create_table(
        "agent_profile",
        sa.Column("id", sa.Text(), nullable=False),
        sa.Column("organization_id", sa.Text(), nullable=False),
        sa.Column("role_id", sa.Text(), nullable=False),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("autonomy_tier", sa.Text(), nullable=False, server_default=sa.text("'L1'")),
        sa.Column("model_policy", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default=_jsonb_default()),
        sa.Column("tool_policy", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default=_jsonb_default()),
        sa.Column("permission_scope", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default=_jsonb_default()),
        sa.Column("metadata", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default=_jsonb_default()),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=_utc_now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=_utc_now()),
        sa.ForeignKeyConstraint(["role_id"], ["agent_role.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("agent_profile_org_role_idx", "agent_profile", ["organization_id", "role_id"], unique=False)

    op.create_table(
        "agent_playbook",
        sa.Column("id", sa.Text(), nullable=False),
        sa.Column("organization_id", sa.Text(), nullable=False),
        sa.Column("role_id", sa.Text(), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("objective", sa.Text(), nullable=False),
        sa.Column("constraints", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default=_jsonb_default()),
        sa.Column("sop", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default=_jsonb_default()),
        sa.Column("success_criteria", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default=_jsonb_default()),
        sa.Column("escalation_policy", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default=_jsonb_default()),
        sa.Column("dsl", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default=_jsonb_default()),
        sa.Column("status", sa.Text(), nullable=False, server_default=sa.text("'draft'")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=_utc_now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=_utc_now()),
        sa.ForeignKeyConstraint(["role_id"], ["agent_role.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("role_id", "version", name="agent_playbook_role_version_key"),
    )
    op.create_index("agent_playbook_org_role_idx", "agent_playbook", ["organization_id", "role_id"], unique=False)

    op.create_table(
        "agent_memory_scope",
        sa.Column("id", sa.Text(), nullable=False),
        sa.Column("organization_id", sa.Text(), nullable=False),
        sa.Column("role_id", sa.Text(), nullable=False),
        sa.Column("readable_scopes", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default=_jsonb_default()),
        sa.Column("writable_scopes", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default=_jsonb_default()),
        sa.Column("retention_policy", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default=_jsonb_default()),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=_utc_now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=_utc_now()),
        sa.ForeignKeyConstraint(["role_id"], ["agent_role.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("organization_id", "role_id", name="agent_memory_scope_org_role_key"),
    )

    op.create_table(
        "agent_deployment",
        sa.Column("id", sa.Text(), nullable=False),
        sa.Column("organization_id", sa.Text(), nullable=False),
        sa.Column("role_id", sa.Text(), nullable=False),
        sa.Column("profile_id", sa.Text(), nullable=False),
        sa.Column("playbook_id", sa.Text(), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("status", sa.Text(), nullable=False, server_default=sa.text("'draft'")),
        sa.Column("rollout_strategy", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default=_jsonb_default()),
        sa.Column("snapshot_hash", sa.Text(), nullable=False),
        sa.Column("published_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_by_user_id", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=_utc_now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=_utc_now()),
        sa.CheckConstraint("snapshot_hash <> ''", name="agent_deployment_snapshot_hash_non_empty"),
        sa.ForeignKeyConstraint(["playbook_id"], ["agent_playbook.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["profile_id"], ["agent_profile.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["role_id"], ["agent_role.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("role_id", "version", name="agent_deployment_role_version_key"),
    )
    op.create_index("agent_deployment_org_status_idx", "agent_deployment", ["organization_id", "status"], unique=False)
    op.create_index("agent_deployment_org_role_idx", "agent_deployment", ["organization_id", "role_id"], unique=False)
    op.create_index("agent_deployment_org_snapshot_idx", "agent_deployment", ["organization_id", "snapshot_hash"], unique=False)

    op.create_table(
        "agent_trigger",
        sa.Column("id", sa.Text(), nullable=False),
        sa.Column("organization_id", sa.Text(), nullable=False),
        sa.Column("deployment_id", sa.Text(), nullable=False),
        sa.Column("trigger_type", sa.Text(), nullable=False),
        sa.Column("trigger_spec", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default=_jsonb_default()),
        sa.Column("is_enabled", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=_utc_now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=_utc_now()),
        sa.ForeignKeyConstraint(["deployment_id"], ["agent_deployment.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "agent_trigger_org_deployment_enabled_idx",
        "agent_trigger",
        ["organization_id", "deployment_id", "is_enabled"],
        unique=False,
    )

    op.create_table(
        "agent_run",
        sa.Column("id", sa.Text(), nullable=False),
        sa.Column("organization_id", sa.Text(), nullable=False),
        sa.Column("deployment_id", sa.Text(), nullable=False),
        sa.Column("trigger_id", sa.Text(), nullable=True),
        sa.Column("status", sa.Text(), nullable=False, server_default=sa.text("'accepted'")),
        sa.Column("initiated_by", sa.Text(), nullable=True),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("failure_reason", sa.Text(), nullable=True),
        sa.Column("metadata", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default=_jsonb_default()),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=_utc_now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=_utc_now()),
        sa.ForeignKeyConstraint(["deployment_id"], ["agent_deployment.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["trigger_id"], ["agent_trigger.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("agent_run_org_status_started_idx", "agent_run", ["organization_id", "status", "started_at"], unique=False)
    op.create_index(
        "agent_run_org_deployment_started_idx",
        "agent_run",
        ["organization_id", "deployment_id", "started_at"],
        unique=False,
    )

    op.create_table(
        "agent_run_step",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False, server_default=sa.text("gen_random_uuid()")),
        sa.Column("run_id", sa.Text(), nullable=False),
        sa.Column("organization_id", sa.Text(), nullable=False),
        sa.Column("step_index", sa.Integer(), nullable=False),
        sa.Column("step_type", sa.Text(), nullable=False),
        sa.Column("status", sa.Text(), nullable=False, server_default=sa.text("'pending'")),
        sa.Column("input_payload", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default=_jsonb_default()),
        sa.Column("output_payload", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default=_jsonb_default()),
        sa.Column("evidence_refs", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default=_jsonb_default()),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=_utc_now()),
        sa.ForeignKeyConstraint(["run_id"], ["agent_run.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("run_id", "step_index", name="agent_run_step_run_step_index_key"),
    )
    op.create_index("agent_run_step_run_idx", "agent_run_step", ["run_id", "step_index"], unique=False)

    op.create_table(
        "agent_work_product",
        sa.Column("id", sa.Text(), nullable=False),
        sa.Column("organization_id", sa.Text(), nullable=False),
        sa.Column("run_id", sa.Text(), nullable=False),
        sa.Column("product_type", sa.Text(), nullable=False),
        sa.Column("title", sa.Text(), nullable=True),
        sa.Column("status", sa.Text(), nullable=False, server_default=sa.text("'generated'")),
        sa.Column("artifact_ref", sa.Text(), nullable=True),
        sa.Column("payload", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default=_jsonb_default()),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=_utc_now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=_utc_now()),
        sa.ForeignKeyConstraint(["run_id"], ["agent_run.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("agent_work_product_org_run_idx", "agent_work_product", ["organization_id", "run_id"], unique=False)

    op.create_table(
        "agent_feedback",
        sa.Column("id", sa.Text(), nullable=False),
        sa.Column("organization_id", sa.Text(), nullable=False),
        sa.Column("run_id", sa.Text(), nullable=False),
        sa.Column("deployment_id", sa.Text(), nullable=True),
        sa.Column("user_id", sa.Text(), nullable=True),
        sa.Column("verdict", sa.Text(), nullable=False),
        sa.Column("reason", sa.Text(), nullable=True),
        sa.Column("metadata", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default=_jsonb_default()),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=_utc_now()),
        sa.ForeignKeyConstraint(["deployment_id"], ["agent_deployment.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["run_id"], ["agent_run.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("agent_feedback_org_created_idx", "agent_feedback", ["organization_id", "created_at"], unique=False)
    op.create_index("agent_feedback_org_run_idx", "agent_feedback", ["organization_id", "run_id"], unique=False)

    op.create_table(
        "agent_eval_result",
        sa.Column("id", sa.Text(), nullable=False),
        sa.Column("organization_id", sa.Text(), nullable=False),
        sa.Column("deployment_id", sa.Text(), nullable=True),
        sa.Column("run_id", sa.Text(), nullable=True),
        sa.Column("suite_name", sa.Text(), nullable=False),
        sa.Column("metric_name", sa.Text(), nullable=False),
        sa.Column("metric_value", sa.Float(), nullable=False),
        sa.Column("threshold", sa.Float(), nullable=True),
        sa.Column("passed", sa.Boolean(), nullable=False),
        sa.Column("metadata", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default=_jsonb_default()),
        sa.Column("evaluated_at", sa.DateTime(timezone=True), nullable=False, server_default=_utc_now()),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=_utc_now()),
        sa.ForeignKeyConstraint(["deployment_id"], ["agent_deployment.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["run_id"], ["agent_run.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "agent_eval_result_org_suite_evaluated_idx",
        "agent_eval_result",
        ["organization_id", "suite_name", "evaluated_at"],
        unique=False,
    )

    op.create_table(
        "agent_permission_grant",
        sa.Column("id", sa.Text(), nullable=False),
        sa.Column("organization_id", sa.Text(), nullable=False),
        sa.Column("profile_id", sa.Text(), nullable=False),
        sa.Column("resource_type", sa.Text(), nullable=False),
        sa.Column("resource_id", sa.Text(), nullable=False),
        sa.Column("permission", sa.Text(), nullable=False),
        sa.Column("granted_by_user_id", sa.Text(), nullable=True),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("metadata", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default=_jsonb_default()),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=_utc_now()),
        sa.ForeignKeyConstraint(["profile_id"], ["agent_profile.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "agent_permission_grant_org_profile_resource_idx",
        "agent_permission_grant",
        ["organization_id", "profile_id", "resource_type", "resource_id"],
        unique=False,
    )

    op.create_table(
        "agent_team",
        sa.Column("id", sa.Text(), nullable=False),
        sa.Column("organization_id", sa.Text(), nullable=False),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("metadata", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default=_jsonb_default()),
        sa.Column("created_by_user_id", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=_utc_now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=_utc_now()),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("organization_id", "name", name="agent_team_org_name_key"),
    )

    op.create_table(
        "agent_team_member",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False, server_default=sa.text("gen_random_uuid()")),
        sa.Column("organization_id", sa.Text(), nullable=False),
        sa.Column("team_id", sa.Text(), nullable=False),
        sa.Column("role_id", sa.Text(), nullable=False),
        sa.Column("priority", sa.Integer(), nullable=False, server_default=sa.text("0")),
        sa.Column("is_required", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=_utc_now()),
        sa.ForeignKeyConstraint(["role_id"], ["agent_role.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["team_id"], ["agent_team.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("team_id", "role_id", name="agent_team_member_team_role_key"),
    )
    op.create_index("agent_team_member_org_team_idx", "agent_team_member", ["organization_id", "team_id"], unique=False)

    op.create_table(
        "agent_handoff",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False, server_default=sa.text("gen_random_uuid()")),
        sa.Column("organization_id", sa.Text(), nullable=False),
        sa.Column("parent_run_id", sa.Text(), nullable=False),
        sa.Column("child_run_id", sa.Text(), nullable=False),
        sa.Column("from_role_id", sa.Text(), nullable=True),
        sa.Column("to_role_id", sa.Text(), nullable=True),
        sa.Column("reason", sa.Text(), nullable=True),
        sa.Column("metadata", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default=_jsonb_default()),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=_utc_now()),
        sa.ForeignKeyConstraint(["child_run_id"], ["agent_run.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["from_role_id"], ["agent_role.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["parent_run_id"], ["agent_run.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["to_role_id"], ["agent_role.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("agent_handoff_org_parent_idx", "agent_handoff", ["organization_id", "parent_run_id"], unique=False)
    op.create_index("agent_handoff_org_child_idx", "agent_handoff", ["organization_id", "child_run_id"], unique=False)


def downgrade() -> None:
    op.drop_index("agent_handoff_org_child_idx", table_name="agent_handoff")
    op.drop_index("agent_handoff_org_parent_idx", table_name="agent_handoff")
    op.drop_table("agent_handoff")

    op.drop_index("agent_team_member_org_team_idx", table_name="agent_team_member")
    op.drop_table("agent_team_member")

    op.drop_table("agent_team")

    op.drop_index("agent_permission_grant_org_profile_resource_idx", table_name="agent_permission_grant")
    op.drop_table("agent_permission_grant")

    op.drop_index("agent_eval_result_org_suite_evaluated_idx", table_name="agent_eval_result")
    op.drop_table("agent_eval_result")

    op.drop_index("agent_feedback_org_run_idx", table_name="agent_feedback")
    op.drop_index("agent_feedback_org_created_idx", table_name="agent_feedback")
    op.drop_table("agent_feedback")

    op.drop_index("agent_work_product_org_run_idx", table_name="agent_work_product")
    op.drop_table("agent_work_product")

    op.drop_index("agent_run_step_run_idx", table_name="agent_run_step")
    op.drop_table("agent_run_step")

    op.drop_index("agent_run_org_deployment_started_idx", table_name="agent_run")
    op.drop_index("agent_run_org_status_started_idx", table_name="agent_run")
    op.drop_table("agent_run")

    op.drop_index("agent_trigger_org_deployment_enabled_idx", table_name="agent_trigger")
    op.drop_table("agent_trigger")

    op.drop_index("agent_deployment_org_snapshot_idx", table_name="agent_deployment")
    op.drop_index("agent_deployment_org_role_idx", table_name="agent_deployment")
    op.drop_index("agent_deployment_org_status_idx", table_name="agent_deployment")
    op.drop_table("agent_deployment")

    op.drop_table("agent_memory_scope")

    op.drop_index("agent_playbook_org_role_idx", table_name="agent_playbook")
    op.drop_table("agent_playbook")

    op.drop_index("agent_profile_org_role_idx", table_name="agent_profile")
    op.drop_table("agent_profile")

    op.drop_index("agent_role_org_status_idx", table_name="agent_role")
    op.drop_table("agent_role")
