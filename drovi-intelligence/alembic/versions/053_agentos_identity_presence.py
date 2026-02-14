"""Add AgentOS identity/presence tables for email/slack/teams channels.

Revision ID: 053_agentos_identity_presence
Revises: 052_agentos_tool_policy_plane
Create Date: 2026-02-13
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "053_agentos_identity_presence"
down_revision: Union[str, None] = "052_agentos_tool_policy_plane"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _jsonb_default() -> sa.TextClause:
    return sa.text("'{}'::jsonb")


def _utc_now() -> sa.TextClause:
    return sa.text("NOW()")


def upgrade() -> None:
    op.create_table(
        "agent_identity",
        sa.Column("id", sa.Text(), nullable=False),
        sa.Column("organization_id", sa.Text(), nullable=False),
        sa.Column("deployment_id", sa.Text(), nullable=True),
        sa.Column("role_id", sa.Text(), nullable=True),
        sa.Column("profile_id", sa.Text(), nullable=True),
        sa.Column("display_name", sa.Text(), nullable=False),
        sa.Column("identity_mode", sa.Text(), nullable=False, server_default=sa.text("'virtual_persona'")),
        sa.Column("email_address", sa.Text(), nullable=True),
        sa.Column("status", sa.Text(), nullable=False, server_default=sa.text("'active'")),
        sa.Column("metadata", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default=_jsonb_default()),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=_utc_now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=_utc_now()),
        sa.ForeignKeyConstraint(["deployment_id"], ["agent_deployment.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["role_id"], ["agent_role.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["profile_id"], ["agent_profile.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "agent_identity_org_status_idx",
        "agent_identity",
        ["organization_id", "status", "created_at"],
        unique=False,
    )
    op.create_index(
        "agent_identity_org_email_idx",
        "agent_identity",
        ["organization_id", "email_address"],
        unique=False,
    )

    op.create_table(
        "agent_channel_binding",
        sa.Column("id", sa.Text(), nullable=False),
        sa.Column("organization_id", sa.Text(), nullable=False),
        sa.Column("identity_id", sa.Text(), nullable=False),
        sa.Column("channel_type", sa.Text(), nullable=False),
        sa.Column("channel_target", sa.Text(), nullable=False),
        sa.Column("channel_account_id", sa.Text(), nullable=True),
        sa.Column("routing_mode", sa.Text(), nullable=False, server_default=sa.text("'auto'")),
        sa.Column("is_enabled", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("config", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default=_jsonb_default()),
        sa.Column("metadata", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default=_jsonb_default()),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=_utc_now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=_utc_now()),
        sa.ForeignKeyConstraint(["identity_id"], ["agent_identity.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "organization_id",
            "identity_id",
            "channel_type",
            "channel_target",
            name="agent_channel_binding_org_identity_target_key",
        ),
    )
    op.create_index(
        "agent_channel_binding_org_type_enabled_idx",
        "agent_channel_binding",
        ["organization_id", "channel_type", "is_enabled"],
        unique=False,
    )

    op.create_table(
        "agent_inbox_thread",
        sa.Column("id", sa.Text(), nullable=False),
        sa.Column("organization_id", sa.Text(), nullable=False),
        sa.Column("identity_id", sa.Text(), nullable=False),
        sa.Column("channel_type", sa.Text(), nullable=False),
        sa.Column("external_thread_id", sa.Text(), nullable=False),
        sa.Column("continuity_key", sa.Text(), nullable=True),
        sa.Column("subject", sa.Text(), nullable=True),
        sa.Column("status", sa.Text(), nullable=False, server_default=sa.text("'open'")),
        sa.Column("assigned_run_id", sa.Text(), nullable=True),
        sa.Column("last_message_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("metadata", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default=_jsonb_default()),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=_utc_now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=_utc_now()),
        sa.ForeignKeyConstraint(["identity_id"], ["agent_identity.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["assigned_run_id"], ["agent_run.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "organization_id",
            "identity_id",
            "channel_type",
            "external_thread_id",
            name="agent_inbox_thread_org_identity_channel_external_key",
        ),
    )
    op.create_index(
        "agent_inbox_thread_org_status_last_msg_idx",
        "agent_inbox_thread",
        ["organization_id", "status", "last_message_at"],
        unique=False,
    )

    op.create_table(
        "agent_message_event",
        sa.Column("id", sa.Text(), nullable=False),
        sa.Column("organization_id", sa.Text(), nullable=False),
        sa.Column("thread_id", sa.Text(), nullable=False),
        sa.Column("identity_id", sa.Text(), nullable=False),
        sa.Column("channel_binding_id", sa.Text(), nullable=True),
        sa.Column("direction", sa.Text(), nullable=False),
        sa.Column("event_type", sa.Text(), nullable=False),
        sa.Column("sender", sa.Text(), nullable=True),
        sa.Column("recipients", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default=_jsonb_default()),
        sa.Column("subject", sa.Text(), nullable=True),
        sa.Column("body_text", sa.Text(), nullable=True),
        sa.Column("body_html", sa.Text(), nullable=True),
        sa.Column("raw_payload", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default=_jsonb_default()),
        sa.Column("parsed_task", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default=_jsonb_default()),
        sa.Column("policy_status", sa.Text(), nullable=True),
        sa.Column("approval_request_id", sa.Text(), nullable=True),
        sa.Column("run_id", sa.Text(), nullable=True),
        sa.Column("message_status", sa.Text(), nullable=False, server_default=sa.text("'received'")),
        sa.Column("occurred_at", sa.DateTime(timezone=True), nullable=False, server_default=_utc_now()),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=_utc_now()),
        sa.ForeignKeyConstraint(["thread_id"], ["agent_inbox_thread.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["identity_id"], ["agent_identity.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["channel_binding_id"], ["agent_channel_binding.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["approval_request_id"], ["agent_action_approval.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["run_id"], ["agent_run.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "agent_message_event_org_thread_occurred_idx",
        "agent_message_event",
        ["organization_id", "thread_id", "occurred_at"],
        unique=False,
    )
    op.create_index(
        "agent_message_event_org_status_idx",
        "agent_message_event",
        ["organization_id", "message_status", "occurred_at"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index("agent_message_event_org_status_idx", table_name="agent_message_event")
    op.drop_index("agent_message_event_org_thread_occurred_idx", table_name="agent_message_event")
    op.drop_table("agent_message_event")

    op.drop_index("agent_inbox_thread_org_status_last_msg_idx", table_name="agent_inbox_thread")
    op.drop_table("agent_inbox_thread")

    op.drop_index("agent_channel_binding_org_type_enabled_idx", table_name="agent_channel_binding")
    op.drop_table("agent_channel_binding")

    op.drop_index("agent_identity_org_email_idx", table_name="agent_identity")
    op.drop_index("agent_identity_org_status_idx", table_name="agent_identity")
    op.drop_table("agent_identity")
