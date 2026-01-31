"""Create core infrastructure tables.

Revision ID: 002_create_core_tables
Revises: 001_create_enums
Create Date: 2025-01-29

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID, JSONB, ARRAY

# revision identifiers, used by Alembic.
revision: str = "002_create_core_tables"
down_revision: Union[str, None] = "001_create_enums"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # ==========================================================================
    # Organizations table (pilot account management)
    # ==========================================================================
    op.create_table(
        "organizations",
        sa.Column("id", sa.String(100), primary_key=True),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column(
            "pilot_status", sa.String(20), nullable=False, server_default="active"
        ),
        sa.Column("region", sa.String(50), nullable=False, server_default="us-west"),
        sa.Column("allowed_domains", ARRAY(sa.String), nullable=False, server_default="{}"),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("idx_orgs_status", "organizations", ["pilot_status"])
    op.create_index("idx_orgs_expires", "organizations", ["expires_at"])

    # ==========================================================================
    # Users table
    # ==========================================================================
    op.create_table(
        "users",
        sa.Column("id", sa.String(100), primary_key=True),
        sa.Column("email", sa.String(255), unique=True, nullable=False),
        sa.Column("name", sa.String(255), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.Column("last_login_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("idx_users_email", "users", ["email"])

    # ==========================================================================
    # Memberships table
    # ==========================================================================
    op.create_table(
        "memberships",
        sa.Column(
            "user_id",
            sa.String(100),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column(
            "org_id",
            sa.String(100),
            sa.ForeignKey("organizations.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column("role", sa.String(50), nullable=False, server_default="pilot_member"),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
    )

    # ==========================================================================
    # Invites table
    # ==========================================================================
    op.create_table(
        "invites",
        sa.Column("token", sa.String(100), primary_key=True),
        sa.Column(
            "org_id",
            sa.String(100),
            sa.ForeignKey("organizations.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("role", sa.String(50), nullable=False, server_default="pilot_member"),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("used_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("used_by_user_id", sa.String(100), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
    )
    op.create_index("idx_invites_org", "invites", ["org_id"])

    # ==========================================================================
    # Connections table
    # ==========================================================================
    op.create_table(
        "connections",
        sa.Column(
            "id",
            UUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column("organization_id", sa.String(100), nullable=False),
        sa.Column("connector_type", sa.String(50), nullable=False),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("description", sa.Text, nullable=True),
        sa.Column("config", JSONB, nullable=False, server_default="{}"),
        sa.Column("streams_config", JSONB, nullable=False, server_default="[]"),
        sa.Column("sync_frequency_minutes", sa.Integer, server_default="5"),
        sa.Column("sync_enabled", sa.Boolean, server_default="true"),
        sa.Column("backfill_enabled", sa.Boolean, server_default="true"),
        sa.Column("backfill_start_date", sa.DateTime(timezone=True), nullable=True),
        sa.Column("status", sa.String(20), nullable=False, server_default="pending_auth"),
        sa.Column("last_sync_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_sync_status", sa.String(20), nullable=True),
        sa.Column("last_sync_error", sa.Text, nullable=True),
        sa.Column("last_sync_records", sa.Integer, server_default="0"),
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
    op.create_index("idx_connections_org", "connections", ["organization_id"])
    op.create_index("idx_connections_type", "connections", ["connector_type"])
    op.create_index("idx_connections_status", "connections", ["status"])

    # ==========================================================================
    # OAuth Tokens table
    # ==========================================================================
    op.create_table(
        "oauth_tokens",
        sa.Column(
            "id",
            UUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column(
            "connection_id",
            UUID(as_uuid=True),
            sa.ForeignKey("connections.id", ondelete="CASCADE"),
            nullable=False,
            unique=True,
        ),
        sa.Column("organization_id", sa.String(100), nullable=False),
        sa.Column("provider", sa.String(50), nullable=False),
        sa.Column("access_token_encrypted", sa.LargeBinary, nullable=False),
        sa.Column("refresh_token_encrypted", sa.LargeBinary, nullable=True),
        sa.Column("token_type", sa.String(20), server_default="Bearer"),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("scopes", ARRAY(sa.String), server_default="{}"),
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
    op.create_index("idx_oauth_tokens_org", "oauth_tokens", ["organization_id"])
    op.create_index("idx_oauth_tokens_expires", "oauth_tokens", ["expires_at"])

    # ==========================================================================
    # Sync States table
    # ==========================================================================
    op.create_table(
        "sync_states",
        sa.Column(
            "id",
            UUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column(
            "connection_id",
            UUID(as_uuid=True),
            sa.ForeignKey("connections.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("stream_name", sa.String(100), nullable=False),
        sa.Column("cursor_state", JSONB, nullable=False, server_default="{}"),
        sa.Column("records_synced", sa.Integer, server_default="0"),
        sa.Column("bytes_synced", sa.Integer, server_default="0"),
        sa.Column("status", sa.String(20), server_default="idle"),
        sa.Column("error_message", sa.Text, nullable=True),
        sa.Column("last_sync_started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_sync_completed_at", sa.DateTime(timezone=True), nullable=True),
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
        sa.UniqueConstraint(
            "connection_id", "stream_name", name="uix_sync_state_connection_stream"
        ),
    )

    # ==========================================================================
    # Sync Job History table
    # ==========================================================================
    op.create_table(
        "sync_job_history",
        sa.Column(
            "id",
            UUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column(
            "connection_id",
            UUID(as_uuid=True),
            sa.ForeignKey("connections.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("organization_id", sa.String(100), nullable=False),
        sa.Column("job_type", sa.String(20), nullable=False),
        sa.Column("streams", ARRAY(sa.String), server_default="{}"),
        sa.Column("full_refresh", sa.Boolean, server_default="false"),
        sa.Column("status", sa.String(20), nullable=False),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("duration_seconds", sa.Integer, nullable=True),
        sa.Column("records_synced", sa.Integer, server_default="0"),
        sa.Column("bytes_synced", sa.Integer, server_default="0"),
        sa.Column("streams_completed", ARRAY(sa.String), server_default="{}"),
        sa.Column("streams_failed", ARRAY(sa.String), server_default="{}"),
        sa.Column("error_message", sa.Text, nullable=True),
        sa.Column("extra_data", JSONB, server_default="{}"),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
    )
    op.create_index("idx_sync_jobs_connection", "sync_job_history", ["connection_id"])
    op.create_index("idx_sync_jobs_org", "sync_job_history", ["organization_id"])
    op.create_index("idx_sync_jobs_status", "sync_job_history", ["status"])

    # ==========================================================================
    # Event Records table
    # ==========================================================================
    op.create_table(
        "event_records",
        sa.Column("id", sa.String(50), primary_key=True),
        sa.Column("organization_id", sa.String(255), nullable=False),
        sa.Column("event_type", sa.String(100), nullable=False),
        sa.Column("payload", JSONB, nullable=False, server_default="{}"),
        sa.Column("correlation_id", sa.String(50), nullable=True),
        sa.Column("source", sa.String(50), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
    )
    op.create_index("idx_events_org", "event_records", ["organization_id"])
    op.create_index("idx_events_type", "event_records", ["event_type"])
    op.create_index("idx_events_time", "event_records", ["created_at"])
    op.create_index("idx_events_corr", "event_records", ["correlation_id"])
    op.create_index(
        "idx_events_org_type_time",
        "event_records",
        ["organization_id", "event_type", "created_at"],
    )
    op.create_index(
        "idx_events_org_time", "event_records", ["organization_id", "created_at"]
    )

    # ==========================================================================
    # Webhook Subscriptions table
    # ==========================================================================
    op.create_table(
        "webhook_subscriptions",
        sa.Column("id", sa.String(50), primary_key=True),
        sa.Column("organization_id", sa.String(255), nullable=False),
        sa.Column("url", sa.Text, nullable=False),
        sa.Column("events", ARRAY(sa.String), nullable=False, server_default="{}"),
        sa.Column("secret", sa.String(64), nullable=False),
        sa.Column("active", sa.Boolean, nullable=False, server_default="true"),
        sa.Column("name", sa.String(255), nullable=True),
        sa.Column("description", sa.Text, nullable=True),
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
    op.create_index("idx_webhook_subs_org", "webhook_subscriptions", ["organization_id"])

    # ==========================================================================
    # Webhook Deliveries table
    # ==========================================================================
    op.create_table(
        "webhook_deliveries",
        sa.Column("id", sa.String(50), primary_key=True),
        sa.Column(
            "subscription_id",
            sa.String(50),
            sa.ForeignKey("webhook_subscriptions.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("event_type", sa.String(50), nullable=False),
        sa.Column("payload", JSONB, nullable=False, server_default="{}"),
        sa.Column("status", sa.String(20), nullable=False, server_default="pending"),
        sa.Column("attempts", sa.Integer, nullable=False, server_default="0"),
        sa.Column("max_attempts", sa.Integer, nullable=False, server_default="5"),
        sa.Column("next_retry_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_attempt_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("response_code", sa.Integer, nullable=True),
        sa.Column("error_message", sa.Text, nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.Column("delivered_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("idx_webhook_del_sub", "webhook_deliveries", ["subscription_id"])
    op.create_index("idx_webhook_del_event", "webhook_deliveries", ["event_type"])
    op.create_index("idx_webhook_del_status", "webhook_deliveries", ["status"])


def downgrade() -> None:
    op.drop_table("webhook_deliveries")
    op.drop_table("webhook_subscriptions")
    op.drop_table("event_records")
    op.drop_table("sync_job_history")
    op.drop_table("sync_states")
    op.drop_table("oauth_tokens")
    op.drop_table("connections")
    op.drop_table("invites")
    op.drop_table("memberships")
    op.drop_table("users")
    op.drop_table("organizations")
