"""Create source and conversation tables.

Revision ID: 006_create_source_tables
Revises: 005_create_uio_extension_tables
Create Date: 2025-01-29

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB, ARRAY

# revision identifiers, used by Alembic.
revision: str = "006_create_source_tables"
down_revision: Union[str, None] = "005_create_uio_extension_tables"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # ==========================================================================
    # Source-related Enums
    # ==========================================================================
    op.execute("""
        CREATE TYPE source_status AS ENUM (
            'connected', 'disconnected', 'syncing', 'error', 'expired', 'revoked', 'pending'
        )
    """)

    op.execute("""
        CREATE TYPE conversation_type AS ENUM (
            'thread', 'channel', 'dm', 'group_dm', 'slack_thread',
            'event', 'recurring_event', 'page', 'database_item', 'comment_thread',
            'document', 'doc_comment_thread', 'meeting', 'recording',
            'chat', 'group_chat', 'other'
        )
    """)

    op.execute("""
        CREATE TYPE priority_tier AS ENUM ('urgent', 'high', 'medium', 'low')
    """)

    op.execute("""
        CREATE TYPE source_visibility AS ENUM ('private', 'team', 'organization', 'delegated')
    """)

    op.execute("""
        CREATE TYPE conversation_relation_type AS ENUM (
            'calendar_email', 'slack_email', 'calendar_slack',
            'meeting_calendar', 'follow_up', 'reference', 'duplicate'
        )
    """)

    # ==========================================================================
    # Source Account Table
    # ==========================================================================
    op.create_table(
        "source_account",
        sa.Column("id", sa.Text, primary_key=True),
        sa.Column(
            "organization_id",
            sa.Text,
            sa.ForeignKey("organizations.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "added_by_user_id",
            sa.Text,
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=False,
        ),
        # Source identification
        sa.Column("type", sa.Text, nullable=False),  # Uses source_type enum from 001
        sa.Column("provider", sa.Text, nullable=False),
        sa.Column("external_id", sa.Text, nullable=False),
        sa.Column("display_name", sa.Text, nullable=True),
        # OAuth tokens
        sa.Column("access_token", sa.Text, nullable=True),
        sa.Column("refresh_token", sa.Text, nullable=True),
        sa.Column("token_expires_at", sa.DateTime(timezone=True), nullable=True),
        # API keys
        sa.Column("api_key", sa.Text, nullable=True),
        # Webhook config
        sa.Column("webhook_id", sa.Text, nullable=True),
        sa.Column("webhook_secret", sa.Text, nullable=True),
        sa.Column("webhook_url", sa.Text, nullable=True),
        # Connection status
        sa.Column("status", sa.Text, nullable=False, server_default="disconnected"),
        # Sync state
        sa.Column("sync_cursor", sa.Text, nullable=True),
        sa.Column("last_sync_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_sync_status", sa.Text, nullable=True),
        sa.Column("last_sync_error", sa.Text, nullable=True),
        sa.Column("next_sync_at", sa.DateTime(timezone=True), nullable=True),
        # Backfill progress
        sa.Column("backfill_progress", JSONB, nullable=True),
        # Settings
        sa.Column("settings", JSONB, nullable=True),
        # Primary flag
        sa.Column("is_primary", sa.Boolean, server_default="false"),
        # Visibility
        sa.Column("visibility", sa.Text, server_default="private"),
        sa.Column("visible_to_team_ids", ARRAY(sa.Text), server_default="{}"),
        sa.Column(
            "delegated_by_user_id",
            sa.Text,
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "managed_by_user_id",
            sa.Text,
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("is_shared_inbox", sa.Boolean, server_default="false"),
        # Timestamps
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

    op.create_index("source_account_org_idx", "source_account", ["organization_id"])
    op.create_index("source_account_type_idx", "source_account", ["type"])
    op.create_index("source_account_status_idx", "source_account", ["status"])
    op.create_index("source_account_added_by_idx", "source_account", ["added_by_user_id"])
    op.create_index("source_account_visibility_idx", "source_account", ["visibility"])
    op.create_index("source_account_shared_inbox_idx", "source_account", ["is_shared_inbox"])
    op.create_unique_constraint(
        "source_account_org_type_external_unique",
        "source_account",
        ["organization_id", "type", "external_id"],
    )

    # ==========================================================================
    # Conversation Table
    # ==========================================================================
    op.create_table(
        "conversation",
        sa.Column("id", sa.Text, primary_key=True),
        sa.Column(
            "source_account_id",
            sa.Text,
            sa.ForeignKey("source_account.id", ondelete="CASCADE"),
            nullable=False,
        ),
        # External identification
        sa.Column("external_id", sa.Text, nullable=False),
        sa.Column("conversation_type", sa.Text, nullable=True),
        # Display
        sa.Column("title", sa.Text, nullable=True),
        sa.Column("snippet", sa.Text, nullable=True),
        # Participants
        sa.Column("participant_ids", ARRAY(sa.Text), server_default="{}"),
        # Message stats
        sa.Column("message_count", sa.Integer, nullable=False, server_default="0"),
        sa.Column("first_message_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_message_at", sa.DateTime(timezone=True), nullable=True),
        # Status flags
        sa.Column("is_read", sa.Boolean, server_default="false"),
        sa.Column("is_starred", sa.Boolean, server_default="false"),
        sa.Column("is_archived", sa.Boolean, server_default="false"),
        sa.Column("is_muted", sa.Boolean, server_default="false"),
        sa.Column("is_trashed", sa.Boolean, server_default="false"),
        sa.Column("is_pinned", sa.Boolean, server_default="false"),
        sa.Column("is_done", sa.Boolean, server_default="false"),
        sa.Column("snoozed_until", sa.DateTime(timezone=True), nullable=True),
        # Intelligence metadata
        sa.Column("brief_summary", sa.Text, nullable=True),
        sa.Column("intent_classification", sa.Text, nullable=True),
        sa.Column("urgency_score", sa.Float, nullable=True),
        sa.Column("importance_score", sa.Float, nullable=True),
        sa.Column("sentiment_score", sa.Float, nullable=True),
        sa.Column("has_open_loops", sa.Boolean, server_default="false"),
        sa.Column("open_loop_count", sa.Integer, server_default="0"),
        sa.Column("suggested_action", sa.Text, nullable=True),
        sa.Column("suggested_action_reason", sa.Text, nullable=True),
        sa.Column("priority_tier", sa.Text, nullable=True),
        sa.Column("commitment_count", sa.Integer, server_default="0"),
        sa.Column("decision_count", sa.Integer, server_default="0"),
        sa.Column("claim_count", sa.Integer, server_default="0"),
        sa.Column("has_risk_warning", sa.Boolean, server_default="false"),
        sa.Column("risk_level", sa.Text, nullable=True),
        sa.Column("last_analyzed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("analysis_version", sa.Text, nullable=True),
        # Metadata
        sa.Column("metadata", JSONB, nullable=True),
        # Timestamps
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

    op.create_index("conversation_source_idx", "conversation", ["source_account_id"])
    op.create_index("conversation_last_message_idx", "conversation", ["last_message_at"])
    op.create_index("conversation_urgency_idx", "conversation", ["urgency_score"])
    op.create_index("conversation_priority_idx", "conversation", ["priority_tier"])
    op.create_index("conversation_open_loops_idx", "conversation", ["has_open_loops"])
    op.create_index("conversation_is_read_idx", "conversation", ["is_read"])
    op.create_index("conversation_is_archived_idx", "conversation", ["is_archived"])
    op.create_index("conversation_is_done_idx", "conversation", ["is_done"])
    op.create_index("conversation_type_idx", "conversation", ["conversation_type"])
    op.create_unique_constraint(
        "conversation_source_external_unique",
        "conversation",
        ["source_account_id", "external_id"],
    )

    # ==========================================================================
    # Message Table
    # ==========================================================================
    op.create_table(
        "message",
        sa.Column("id", sa.Text, primary_key=True),
        sa.Column(
            "conversation_id",
            sa.Text,
            sa.ForeignKey("conversation.id", ondelete="CASCADE"),
            nullable=False,
        ),
        # External identification
        sa.Column("external_id", sa.Text, nullable=False),
        # Sender info
        sa.Column("sender_external_id", sa.Text, nullable=False),
        sa.Column("sender_name", sa.Text, nullable=True),
        sa.Column("sender_email", sa.Text, nullable=True),
        sa.Column("sender_avatar_url", sa.Text, nullable=True),
        # Recipients
        sa.Column("recipients", JSONB, server_default="[]"),
        # Content
        sa.Column("subject", sa.Text, nullable=True),
        sa.Column("body_text", sa.Text, nullable=True),
        sa.Column("body_html", sa.Text, nullable=True),
        sa.Column("snippet", sa.Text, nullable=True),
        # Timestamps
        sa.Column("sent_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("received_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("edited_at", sa.DateTime(timezone=True), nullable=True),
        # Ordering
        sa.Column("message_index", sa.Integer, nullable=False, server_default="0"),
        # Direction
        sa.Column("is_from_user", sa.Boolean, server_default="false"),
        # Attachments
        sa.Column("has_attachments", sa.Boolean, server_default="false"),
        # Metadata
        sa.Column("metadata", JSONB, nullable=True),
        # Timestamps
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

    op.create_index("message_conversation_idx", "message", ["conversation_id"])
    op.create_index("message_sender_idx", "message", ["sender_external_id"])
    op.create_index("message_sent_idx", "message", ["sent_at"])
    op.create_index("message_received_idx", "message", ["received_at"])
    op.create_unique_constraint(
        "message_conv_external_unique",
        "message",
        ["conversation_id", "external_id"],
    )

    # ==========================================================================
    # Participant Table
    # ==========================================================================
    op.create_table(
        "participant",
        sa.Column("id", sa.Text, primary_key=True),
        sa.Column(
            "source_account_id",
            sa.Text,
            sa.ForeignKey("source_account.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "contact_id",
            sa.Text,
            sa.ForeignKey("contact.id", ondelete="SET NULL"),
            nullable=True,
        ),
        # External identification
        sa.Column("external_id", sa.Text, nullable=False),
        # Display info
        sa.Column("display_name", sa.Text, nullable=True),
        sa.Column("email", sa.Text, nullable=True),
        sa.Column("phone", sa.Text, nullable=True),
        sa.Column("avatar_url", sa.Text, nullable=True),
        # Metadata
        sa.Column("metadata", JSONB, nullable=True),
        # Resolution
        sa.Column("is_resolved", sa.Boolean, server_default="false"),
        sa.Column("resolved_at", sa.DateTime(timezone=True), nullable=True),
        # Timestamps
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

    op.create_index("participant_source_idx", "participant", ["source_account_id"])
    op.create_index("participant_contact_idx", "participant", ["contact_id"])
    op.create_index("participant_email_idx", "participant", ["email"])
    op.create_index("participant_resolved_idx", "participant", ["is_resolved"])
    op.create_unique_constraint(
        "participant_source_external_unique",
        "participant",
        ["source_account_id", "external_id"],
    )

    # ==========================================================================
    # Attachment Table
    # ==========================================================================
    op.create_table(
        "attachment",
        sa.Column("id", sa.Text, primary_key=True),
        sa.Column(
            "message_id",
            sa.Text,
            sa.ForeignKey("message.id", ondelete="CASCADE"),
            nullable=False,
        ),
        # External identification
        sa.Column("external_id", sa.Text, nullable=True),
        # File metadata
        sa.Column("filename", sa.Text, nullable=False),
        sa.Column("mime_type", sa.Text, nullable=True),
        sa.Column("size_bytes", sa.Integer, nullable=True),
        # Inline support
        sa.Column("content_id", sa.Text, nullable=True),
        sa.Column("is_inline", sa.Boolean, server_default="false"),
        # Storage
        sa.Column("storage_key", sa.Text, nullable=True),
        sa.Column("download_url", sa.Text, nullable=True),
        sa.Column("downloaded_at", sa.DateTime(timezone=True), nullable=True),
        # Timestamps
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
    )

    op.create_index("attachment_message_idx", "attachment", ["message_id"])
    op.create_index("attachment_mime_idx", "attachment", ["mime_type"])

    # ==========================================================================
    # Related Conversation Table
    # ==========================================================================
    op.create_table(
        "related_conversation",
        sa.Column("id", sa.Text, primary_key=True),
        sa.Column(
            "conversation_id",
            sa.Text,
            sa.ForeignKey("conversation.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "related_conversation_id",
            sa.Text,
            sa.ForeignKey("conversation.id", ondelete="CASCADE"),
            nullable=False,
        ),
        # Relationship
        sa.Column("relation_type", sa.Text, nullable=False),
        sa.Column("confidence", sa.Float, nullable=False, server_default="0.5"),
        sa.Column("match_reason", sa.Text, nullable=True),
        # Detection
        sa.Column("is_auto_detected", sa.Boolean, server_default="true"),
        sa.Column("is_dismissed", sa.Boolean, server_default="false"),
        sa.Column("dismissed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("dismissed_by_user_id", sa.Text, nullable=True),
        # Timestamps
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

    op.create_index("related_conv_conv_idx", "related_conversation", ["conversation_id"])
    op.create_index(
        "related_conv_related_idx", "related_conversation", ["related_conversation_id"]
    )
    op.create_index("related_conv_type_idx", "related_conversation", ["relation_type"])
    op.create_index("related_conv_confidence_idx", "related_conversation", ["confidence"])
    op.create_unique_constraint(
        "related_conv_pair_unique",
        "related_conversation",
        ["conversation_id", "related_conversation_id", "relation_type"],
    )


def downgrade() -> None:
    op.drop_table("related_conversation")
    op.drop_table("attachment")
    op.drop_table("participant")
    op.drop_table("message")
    op.drop_table("conversation")
    op.drop_table("source_account")

    # Drop enums
    op.execute("DROP TYPE IF EXISTS conversation_relation_type")
    op.execute("DROP TYPE IF EXISTS source_visibility")
    op.execute("DROP TYPE IF EXISTS priority_tier")
    op.execute("DROP TYPE IF EXISTS conversation_type")
    op.execute("DROP TYPE IF EXISTS source_status")
