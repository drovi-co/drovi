"""Add AgentOS browser automation persistence.

Revision ID: 054_agentos_browser_automation
Revises: 053_agentos_identity_presence
Create Date: 2026-02-13
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "054_agentos_browser_automation"
down_revision: Union[str, None] = "053_agentos_identity_presence"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _jsonb_default() -> sa.TextClause:
    return sa.text("'{}'::jsonb")


def _utc_now() -> sa.TextClause:
    return sa.text("NOW()")


def upgrade() -> None:
    op.create_table(
        "agent_browser_session",
        sa.Column("id", sa.Text(), nullable=False),
        sa.Column("organization_id", sa.Text(), nullable=False),
        sa.Column("provider", sa.Text(), nullable=False),
        sa.Column("deployment_id", sa.Text(), nullable=True),
        sa.Column("run_id", sa.Text(), nullable=True),
        sa.Column("status", sa.Text(), nullable=False, server_default=sa.text("'active'")),
        sa.Column("current_url", sa.Text(), nullable=True),
        sa.Column("state", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default=_jsonb_default()),
        sa.Column("artifacts", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default=_jsonb_default()),
        sa.Column("metadata", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default=_jsonb_default()),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=_utc_now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=_utc_now()),
        sa.Column("last_active_at", sa.DateTime(timezone=True), nullable=False, server_default=_utc_now()),
        sa.ForeignKeyConstraint(["deployment_id"], ["agent_deployment.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["run_id"], ["agent_run.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "agent_browser_session_org_status_last_active_idx",
        "agent_browser_session",
        ["organization_id", "status", "last_active_at"],
        unique=False,
    )
    op.create_index(
        "agent_browser_session_org_run_created_idx",
        "agent_browser_session",
        ["organization_id", "run_id", "created_at"],
        unique=False,
    )
    op.create_index(
        "agent_browser_session_org_provider_status_idx",
        "agent_browser_session",
        ["organization_id", "provider", "status"],
        unique=False,
    )

    op.create_table(
        "agent_browser_action_log",
        sa.Column("id", sa.Text(), nullable=False),
        sa.Column("session_id", sa.Text(), nullable=False),
        sa.Column("organization_id", sa.Text(), nullable=False),
        sa.Column("action_type", sa.Text(), nullable=False),
        sa.Column("status", sa.Text(), nullable=False),
        sa.Column(
            "request_payload",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default=_jsonb_default(),
        ),
        sa.Column(
            "response_payload",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default=_jsonb_default(),
        ),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=_utc_now()),
        sa.ForeignKeyConstraint(["session_id"], ["agent_browser_session.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "agent_browser_action_log_org_session_created_idx",
        "agent_browser_action_log",
        ["organization_id", "session_id", "created_at"],
        unique=False,
    )
    op.create_index(
        "agent_browser_action_log_org_status_created_idx",
        "agent_browser_action_log",
        ["organization_id", "status", "created_at"],
        unique=False,
    )

    op.create_table(
        "agent_browser_artifact",
        sa.Column("id", sa.Text(), nullable=False),
        sa.Column("organization_id", sa.Text(), nullable=False),
        sa.Column("session_id", sa.Text(), nullable=False),
        sa.Column("action_log_id", sa.Text(), nullable=True),
        sa.Column("artifact_type", sa.Text(), nullable=False),
        sa.Column("storage_backend", sa.Text(), nullable=False, server_default=sa.text("'inline'")),
        sa.Column("storage_uri", sa.Text(), nullable=True),
        sa.Column("metadata", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default=_jsonb_default()),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=_utc_now()),
        sa.ForeignKeyConstraint(["session_id"], ["agent_browser_session.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["action_log_id"], ["agent_browser_action_log.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "agent_browser_artifact_org_session_type_created_idx",
        "agent_browser_artifact",
        ["organization_id", "session_id", "artifact_type", "created_at"],
        unique=False,
    )
    op.create_index(
        "agent_browser_artifact_org_action_log_idx",
        "agent_browser_artifact",
        ["organization_id", "action_log_id"],
        unique=False,
    )

    op.create_table(
        "agent_browser_provider_secret",
        sa.Column("organization_id", sa.Text(), nullable=False),
        sa.Column("provider", sa.Text(), nullable=False),
        sa.Column("secret_name", sa.Text(), nullable=False),
        sa.Column("secret_ciphertext", sa.Text(), nullable=False),
        sa.Column("secret_preview", sa.Text(), nullable=True),
        sa.Column("metadata", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default=_jsonb_default()),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=_utc_now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=_utc_now()),
        sa.PrimaryKeyConstraint("organization_id", "provider", "secret_name"),
    )
    op.create_index(
        "agent_browser_provider_secret_org_provider_idx",
        "agent_browser_provider_secret",
        ["organization_id", "provider"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index("agent_browser_provider_secret_org_provider_idx", table_name="agent_browser_provider_secret")
    op.drop_table("agent_browser_provider_secret")

    op.drop_index("agent_browser_artifact_org_action_log_idx", table_name="agent_browser_artifact")
    op.drop_index("agent_browser_artifact_org_session_type_created_idx", table_name="agent_browser_artifact")
    op.drop_table("agent_browser_artifact")

    op.drop_index("agent_browser_action_log_org_status_created_idx", table_name="agent_browser_action_log")
    op.drop_index("agent_browser_action_log_org_session_created_idx", table_name="agent_browser_action_log")
    op.drop_table("agent_browser_action_log")

    op.drop_index("agent_browser_session_org_provider_status_idx", table_name="agent_browser_session")
    op.drop_index("agent_browser_session_org_run_created_idx", table_name="agent_browser_session")
    op.drop_index("agent_browser_session_org_status_last_active_idx", table_name="agent_browser_session")
    op.drop_table("agent_browser_session")
