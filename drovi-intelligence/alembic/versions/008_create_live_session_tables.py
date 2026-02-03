"""Create live session and evidence artifact tables.

Revision ID: 008_create_live_session_tables
Revises: 007_add_contact_brief_column
Create Date: 2026-01-31

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB, ARRAY

# revision identifiers, used by Alembic.
revision: str = "008_create_live_session_tables"
down_revision: Union[str, None] = "007_add_contact_brief_column"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Enums for live sessions
    op.execute("""
        CREATE TYPE live_session_status AS ENUM (
            'recording', 'processing', 'completed', 'failed', 'cancelled'
        )
    """)

    op.execute("""
        CREATE TYPE live_session_type AS ENUM (
            'meeting', 'call', 'recording'
        )
    """)

    # Live session table
    op.create_table(
        "live_session",
        sa.Column("id", sa.Text, primary_key=True),
        sa.Column("organization_id", sa.Text, nullable=False),
        sa.Column("session_type", sa.Text, nullable=False),
        sa.Column("status", sa.Text, nullable=False, server_default="recording"),
        sa.Column("title", sa.Text, nullable=True),
        sa.Column("source_type", sa.Text, nullable=True),
        sa.Column("source_id", sa.Text, nullable=True),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("ended_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("participants", ARRAY(sa.Text), server_default="{}"),
        sa.Column("metadata", JSONB, nullable=True),
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

    op.create_index("live_session_org_idx", "live_session", ["organization_id"])
    op.create_index("live_session_status_idx", "live_session", ["status"])
    op.create_index("live_session_type_idx", "live_session", ["session_type"])

    # Transcript segments
    op.create_table(
        "transcript_segment",
        sa.Column("id", sa.Text, primary_key=True),
        sa.Column(
            "session_id",
            sa.Text,
            sa.ForeignKey("live_session.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("speaker_label", sa.Text, nullable=True),
        sa.Column(
            "speaker_contact_id",
            sa.Text,
            sa.ForeignKey("contact.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("start_ms", sa.Integer, nullable=True),
        sa.Column("end_ms", sa.Integer, nullable=True),
        sa.Column("text", sa.Text, nullable=False),
        sa.Column("confidence", sa.Float, nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
    )

    op.create_index("transcript_session_idx", "transcript_segment", ["session_id"])
    op.create_index("transcript_start_idx", "transcript_segment", ["start_ms"])

    # Evidence artifacts (raw audio, recordings, etc.)
    op.create_table(
        "evidence_artifact",
        sa.Column("id", sa.Text, primary_key=True),
        sa.Column("organization_id", sa.Text, nullable=False),
        sa.Column(
            "session_id",
            sa.Text,
            sa.ForeignKey("live_session.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("source_type", sa.Text, nullable=True),
        sa.Column("source_id", sa.Text, nullable=True),
        sa.Column("artifact_type", sa.Text, nullable=False),
        sa.Column("mime_type", sa.Text, nullable=True),
        sa.Column("storage_backend", sa.Text, nullable=False),
        sa.Column("storage_path", sa.Text, nullable=False),
        sa.Column("byte_size", sa.BigInteger, nullable=True),
        sa.Column("sha256", sa.Text, nullable=True),
        sa.Column("metadata", JSONB, nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
    )

    op.create_index("evidence_artifact_org_idx", "evidence_artifact", ["organization_id"])
    op.create_index("evidence_artifact_session_idx", "evidence_artifact", ["session_id"])
    op.create_index("evidence_artifact_type_idx", "evidence_artifact", ["artifact_type"])


def downgrade() -> None:
    op.drop_index("evidence_artifact_type_idx", table_name="evidence_artifact")
    op.drop_index("evidence_artifact_session_idx", table_name="evidence_artifact")
    op.drop_index("evidence_artifact_org_idx", table_name="evidence_artifact")
    op.drop_table("evidence_artifact")

    op.drop_index("transcript_start_idx", table_name="transcript_segment")
    op.drop_index("transcript_session_idx", table_name="transcript_segment")
    op.drop_table("transcript_segment")

    op.drop_index("live_session_type_idx", table_name="live_session")
    op.drop_index("live_session_status_idx", table_name="live_session")
    op.drop_index("live_session_org_idx", table_name="live_session")
    op.drop_table("live_session")

    op.execute("DROP TYPE live_session_type")
    op.execute("DROP TYPE live_session_status")
