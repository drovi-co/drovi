"""Create UIO core tables.

Revision ID: 004_create_uio_tables
Revises: 003_create_contact_table
Create Date: 2025-01-29

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB, ARRAY

# revision identifiers, used by Alembic.
revision: str = "004_create_uio_tables"
down_revision: Union[str, None] = "003_create_contact_table"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

EMBEDDING_DIMENSIONS = 1536


def upgrade() -> None:
    # ==========================================================================
    # Core UIO Table (unified_intelligence_object)
    # ==========================================================================
    op.create_table(
        "unified_intelligence_object",
        sa.Column("id", sa.Text, primary_key=True),
        sa.Column("organization_id", sa.Text, nullable=False),
        # Type and identity (using Text for enum compatibility)
        sa.Column("type", sa.Text, nullable=False),
        sa.Column("status", sa.Text, nullable=False, server_default="active"),
        # Canonical representation
        sa.Column("canonical_title", sa.Text, nullable=False),
        sa.Column("canonical_description", sa.Text, nullable=True),
        # Due date tracking
        sa.Column("due_date", sa.DateTime(timezone=True), nullable=True),
        sa.Column("due_date_confidence", sa.Float, nullable=True),
        sa.Column("due_date_last_updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("due_date_last_updated_source_id", sa.Text, nullable=True),
        # Parties
        sa.Column(
            "owner_contact_id",
            sa.Text,
            sa.ForeignKey("contact.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("participant_contact_ids", ARRAY(sa.Text), server_default="{}"),
        # Confidence
        sa.Column("overall_confidence", sa.Float, nullable=False, server_default="0.5"),
        # Timeline
        sa.Column("first_seen_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("last_updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("last_activity_source_type", sa.Text, nullable=True),
        # Merge tracking
        sa.Column("merged_into_id", sa.Text, nullable=True),
        # User corrections
        sa.Column("is_user_verified", sa.Boolean, server_default="false"),
        sa.Column("is_user_dismissed", sa.Boolean, server_default="false"),
        sa.Column("user_corrected_title", sa.Text, nullable=True),
        # Signal detection
        sa.Column("signal_classification", sa.Text, nullable=True),
        sa.Column("deviation_score", sa.Float, nullable=True),
        sa.Column("actionability_score", sa.Float, nullable=True),
        sa.Column("control_chart_zone", sa.Text, nullable=True),
        # Graph-based signal indicators
        sa.Column("contradicts_existing", sa.Boolean, server_default="false"),
        sa.Column("new_cluster_detected", sa.Boolean, server_default="false"),
        sa.Column("high_centrality_involved", sa.Boolean, server_default="false"),
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

    # UIO Indexes
    op.create_index("uio_org_idx", "unified_intelligence_object", ["organization_id"])
    op.create_index("uio_type_idx", "unified_intelligence_object", ["type"])
    op.create_index("uio_status_idx", "unified_intelligence_object", ["status"])
    op.create_index("uio_owner_idx", "unified_intelligence_object", ["owner_contact_id"])
    op.create_index("uio_due_date_idx", "unified_intelligence_object", ["due_date"])
    op.create_index(
        "uio_last_updated_idx", "unified_intelligence_object", ["last_updated_at"]
    )
    op.create_index(
        "uio_merged_into_idx", "unified_intelligence_object", ["merged_into_id"]
    )
    op.create_index(
        "uio_org_type_status_idx",
        "unified_intelligence_object",
        ["organization_id", "type", "status"],
    )
    op.create_index(
        "uio_signal_classification_idx",
        "unified_intelligence_object",
        ["signal_classification"],
    )
    op.create_index(
        "uio_actionability_idx", "unified_intelligence_object", ["actionability_score"]
    )
    op.create_index(
        "uio_contradicts_idx", "unified_intelligence_object", ["contradicts_existing"]
    )

    # ==========================================================================
    # Unified Object Source Table
    # ==========================================================================
    op.create_table(
        "unified_object_source",
        sa.Column("id", sa.Text, primary_key=True),
        sa.Column(
            "unified_object_id",
            sa.Text,
            sa.ForeignKey("unified_intelligence_object.id", ondelete="CASCADE"),
            nullable=False,
        ),
        # Source identification
        sa.Column("source_type", sa.Text, nullable=False),
        sa.Column("source_account_id", sa.Text, nullable=True),
        # Role
        sa.Column("role", sa.Text, nullable=False, server_default="context"),
        # Links to source data
        sa.Column("conversation_id", sa.Text, nullable=True),
        sa.Column("message_id", sa.Text, nullable=True),
        # Original extracted objects
        sa.Column("original_commitment_id", sa.Text, nullable=True),
        sa.Column("original_decision_id", sa.Text, nullable=True),
        sa.Column("original_claim_id", sa.Text, nullable=True),
        # Evidence
        sa.Column("quoted_text", sa.Text, nullable=True),
        sa.Column("quoted_text_start", sa.Text, nullable=True),
        sa.Column("quoted_text_end", sa.Text, nullable=True),
        # Extracted data
        sa.Column("extracted_title", sa.Text, nullable=True),
        sa.Column("extracted_due_date", sa.DateTime(timezone=True), nullable=True),
        sa.Column("extracted_status", sa.Text, nullable=True),
        # Confidence
        sa.Column("confidence", sa.Float, nullable=False, server_default="0.5"),
        # Timestamps
        sa.Column(
            "added_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.Column("source_timestamp", sa.DateTime(timezone=True), nullable=True),
        # Processing metadata
        sa.Column("detection_method", sa.Text, nullable=True),
        sa.Column("match_score", sa.Float, nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
    )

    op.create_index("uos_unified_object_idx", "unified_object_source", ["unified_object_id"])
    op.create_index("uos_source_type_idx", "unified_object_source", ["source_type"])
    op.create_index("uos_conversation_idx", "unified_object_source", ["conversation_id"])
    op.create_index("uos_source_timestamp_idx", "unified_object_source", ["source_timestamp"])
    op.create_index(
        "uos_original_commitment_idx", "unified_object_source", ["original_commitment_id"]
    )
    op.create_index(
        "uos_original_decision_idx", "unified_object_source", ["original_decision_id"]
    )
    op.create_unique_constraint(
        "uos_unique_source",
        "unified_object_source",
        ["unified_object_id", "conversation_id", "message_id"],
    )

    # ==========================================================================
    # Unified Object Timeline Table
    # ==========================================================================
    op.create_table(
        "unified_object_timeline",
        sa.Column("id", sa.Text, primary_key=True),
        sa.Column(
            "unified_object_id",
            sa.Text,
            sa.ForeignKey("unified_intelligence_object.id", ondelete="CASCADE"),
            nullable=False,
        ),
        # Event details
        sa.Column("event_type", sa.Text, nullable=False),
        sa.Column("event_description", sa.Text, nullable=False),
        # Changes
        sa.Column("previous_value", JSONB, nullable=True),
        sa.Column("new_value", JSONB, nullable=True),
        # Source of change
        sa.Column("source_type", sa.Text, nullable=True),
        sa.Column("source_id", sa.Text, nullable=True),
        sa.Column("source_name", sa.Text, nullable=True),
        # Evidence
        sa.Column("message_id", sa.Text, nullable=True),
        sa.Column("quoted_text", sa.Text, nullable=True),
        # Trigger
        sa.Column("triggered_by", sa.Text, nullable=True),
        # Confidence
        sa.Column("confidence", sa.Float, nullable=True),
        sa.Column("event_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
    )

    op.create_index("uot_unified_object_idx", "unified_object_timeline", ["unified_object_id"])
    op.create_index("uot_event_type_idx", "unified_object_timeline", ["event_type"])
    op.create_index("uot_event_at_idx", "unified_object_timeline", ["event_at"])
    op.create_index("uot_source_type_idx", "unified_object_timeline", ["source_type"])
    op.create_index(
        "uot_object_event_at_idx",
        "unified_object_timeline",
        ["unified_object_id", "event_at"],
    )

    # ==========================================================================
    # Unified Object Embedding Table (with pgvector)
    # ==========================================================================
    op.create_table(
        "unified_object_embedding",
        sa.Column("id", sa.Text, primary_key=True),
        sa.Column(
            "unified_object_id",
            sa.Text,
            sa.ForeignKey("unified_intelligence_object.id", ondelete="CASCADE"),
            nullable=False,
            unique=True,
        ),
        # Model metadata
        sa.Column("model", sa.Text, nullable=False),
        sa.Column("model_version", sa.Text, nullable=True),
        # Input hash
        sa.Column("input_hash", sa.Text, nullable=True),
        # Processing status
        sa.Column("status", sa.Text, server_default="completed"),
        sa.Column("error_message", sa.Text, nullable=True),
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

    # Add vector column using raw SQL (pgvector)
    op.execute(
        f"ALTER TABLE unified_object_embedding ADD COLUMN embedding vector({EMBEDDING_DIMENSIONS})"
    )

    op.create_index("uoe_unified_object_idx", "unified_object_embedding", ["unified_object_id"])
    op.create_index("uoe_model_idx", "unified_object_embedding", ["model"])
    op.create_index("uoe_status_idx", "unified_object_embedding", ["status"])

    # Create HNSW index for vector similarity search
    op.execute("""
        CREATE INDEX uoe_embedding_hnsw_idx ON unified_object_embedding
        USING hnsw (embedding vector_cosine_ops)
        WITH (m = 16, ef_construction = 64)
    """)

    # ==========================================================================
    # Deduplication Candidate Table
    # ==========================================================================
    op.create_table(
        "deduplication_candidate",
        sa.Column("id", sa.Text, primary_key=True),
        sa.Column("organization_id", sa.Text, nullable=False),
        # Candidates
        sa.Column(
            "source_object_id",
            sa.Text,
            sa.ForeignKey("unified_intelligence_object.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "target_object_id",
            sa.Text,
            sa.ForeignKey("unified_intelligence_object.id", ondelete="CASCADE"),
            nullable=False,
        ),
        # Scores
        sa.Column("semantic_similarity", sa.Float, nullable=False),
        sa.Column("party_match_score", sa.Float, nullable=True),
        sa.Column("temporal_score", sa.Float, nullable=True),
        sa.Column("overall_score", sa.Float, nullable=False),
        # Match reasoning
        sa.Column("match_reasons", ARRAY(sa.Text), server_default="{}"),
        sa.Column("match_explanation", sa.Text, nullable=True),
        # Status
        sa.Column("status", sa.Text, nullable=False, server_default="pending_review"),
        # Resolution
        sa.Column("resolved_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("resolved_by", sa.Text, nullable=True),
        sa.Column("resolution_note", sa.Text, nullable=True),
        # Expiry
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
    )

    op.create_index("dc_org_idx", "deduplication_candidate", ["organization_id"])
    op.create_index("dc_source_idx", "deduplication_candidate", ["source_object_id"])
    op.create_index("dc_target_idx", "deduplication_candidate", ["target_object_id"])
    op.create_index("dc_status_idx", "deduplication_candidate", ["status"])
    op.create_index("dc_score_idx", "deduplication_candidate", ["overall_score"])
    op.create_unique_constraint(
        "dc_pair_unique",
        "deduplication_candidate",
        ["source_object_id", "target_object_id"],
    )


def downgrade() -> None:
    op.drop_table("deduplication_candidate")
    op.drop_table("unified_object_embedding")
    op.drop_table("unified_object_timeline")
    op.drop_table("unified_object_source")
    op.drop_table("unified_intelligence_object")
