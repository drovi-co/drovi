"""Create unified event model tables.

Revision ID: 016_create_unified_event_model
Revises: 015_connector_webhook_inbox_outbox
Create Date: 2026-02-02

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

# revision identifiers, used by Alembic.
revision: str = "016_create_unified_event_model"
down_revision: Union[str, None] = "015_connector_webhook_inbox_outbox"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "unified_event",
        sa.Column(
            "id",
            sa.Text,
            primary_key=True,
        ),
        sa.Column("organization_id", sa.String(100), nullable=False),
        sa.Column("source_type", sa.String(50), nullable=False),
        sa.Column("source_id", sa.Text, nullable=True),
        sa.Column("source_account_id", sa.Text, nullable=True),
        sa.Column("conversation_id", sa.Text, nullable=True),
        sa.Column("message_id", sa.Text, nullable=True),
        sa.Column("event_type", sa.String(50), nullable=False),
        sa.Column("content_text", sa.Text, nullable=True),
        sa.Column("content_json", JSONB, nullable=True),
        sa.Column("participants", JSONB, nullable=False, server_default="[]"),
        sa.Column("metadata", JSONB, nullable=False, server_default="{}"),
        sa.Column("content_hash", sa.Text, nullable=True),
        sa.Column("captured_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "received_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.Column("evidence_artifact_id", sa.Text, nullable=True),
    )

    op.create_index(
        "unified_event_org_idx",
        "unified_event",
        ["organization_id"],
    )
    op.create_index(
        "unified_event_conversation_idx",
        "unified_event",
        ["conversation_id"],
    )
    op.create_index(
        "unified_event_event_type_idx",
        "unified_event",
        ["event_type"],
    )
    op.create_index(
        "unified_event_captured_at_idx",
        "unified_event",
        ["captured_at"],
    )
    op.create_index(
        "unified_event_content_hash_idx",
        "unified_event",
        ["content_hash"],
    )


def downgrade() -> None:
    op.drop_index("unified_event_content_hash_idx", table_name="unified_event")
    op.drop_index("unified_event_captured_at_idx", table_name="unified_event")
    op.drop_index("unified_event_event_type_idx", table_name="unified_event")
    op.drop_index("unified_event_conversation_idx", table_name="unified_event")
    op.drop_index("unified_event_org_idx", table_name="unified_event")
    op.drop_table("unified_event")
