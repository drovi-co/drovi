"""Create contact table.

Revision ID: 003_create_contact_table
Revises: 002_create_core_tables
Create Date: 2025-01-29

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB, ARRAY

# revision identifiers, used by Alembic.
revision: str = "003_create_contact_table"
down_revision: Union[str, None] = "002_create_core_tables"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # ==========================================================================
    # Contact table (unified contact intelligence)
    # ==========================================================================
    op.create_table(
        "contact",
        sa.Column("id", sa.Text, primary_key=True),
        sa.Column("organization_id", sa.Text, nullable=True),
        # Identity
        sa.Column("primary_email", sa.Text, nullable=False),
        sa.Column("emails", ARRAY(sa.Text), server_default="{}"),
        sa.Column("display_name", sa.Text, nullable=True),
        sa.Column("first_name", sa.Text, nullable=True),
        sa.Column("last_name", sa.Text, nullable=True),
        # Professional info
        sa.Column("company", sa.Text, nullable=True),
        sa.Column("title", sa.Text, nullable=True),
        sa.Column("department", sa.Text, nullable=True),
        sa.Column("phone", sa.Text, nullable=True),
        sa.Column("linkedin_url", sa.Text, nullable=True),
        sa.Column("avatar_url", sa.Text, nullable=True),
        # Interaction history
        sa.Column("first_interaction_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_interaction_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("total_threads", sa.Integer, nullable=False, server_default="0"),
        sa.Column("total_messages", sa.Integer, nullable=False, server_default="0"),
        sa.Column("messages_sent", sa.Integer, nullable=False, server_default="0"),
        sa.Column("messages_received", sa.Integer, nullable=False, server_default="0"),
        # Response patterns
        sa.Column("avg_response_time_minutes", sa.Integer, nullable=True),
        sa.Column("response_rate", sa.Float, nullable=True),
        sa.Column("avg_words_per_message", sa.Integer, nullable=True),
        # AI-computed scores
        sa.Column("sentiment_score", sa.Float, nullable=True),
        sa.Column("importance_score", sa.Float, nullable=True),
        sa.Column("health_score", sa.Float, nullable=True),
        sa.Column("engagement_score", sa.Float, nullable=True),
        # Status flags
        sa.Column("is_vip", sa.Boolean, server_default="false"),
        sa.Column("is_at_risk", sa.Boolean, server_default="false"),
        sa.Column("is_internal", sa.Boolean, server_default="false"),
        # Risk detection
        sa.Column("risk_reason", sa.Text, nullable=True),
        sa.Column("days_since_last_contact", sa.Integer, nullable=True),
        # User customization
        sa.Column("tags", ARRAY(sa.Text), server_default="{}"),
        sa.Column("notes", sa.Text, nullable=True),
        sa.Column("user_override_vip", sa.Boolean, nullable=True),
        # Enrichment tracking
        sa.Column("last_enriched_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("enrichment_source", sa.Text, nullable=True),
        # Contact Intelligence - use string for enum compatibility
        sa.Column("lifecycle_stage", sa.Text, server_default="unknown"),
        sa.Column("lifecycle_stage_confidence", sa.Float, nullable=True),
        sa.Column("role_type", sa.Text, server_default="unknown"),
        sa.Column("role_type_confidence", sa.Float, nullable=True),
        sa.Column("seniority_level", sa.Text, server_default="unknown"),
        sa.Column("seniority_confidence", sa.Float, nullable=True),
        # Graph analytics scores
        sa.Column("influence_score", sa.Float, nullable=True),
        sa.Column("bridging_score", sa.Float, nullable=True),
        sa.Column("community_ids", ARRAY(sa.Text), server_default="{}"),
        # Deep communication profile
        sa.Column("communication_profile", JSONB, nullable=True),
        # Intelligence processing tracking
        sa.Column("last_intelligence_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("intelligence_version", sa.Text, nullable=True),
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

    # Create indexes
    op.create_index("contact_org_idx", "contact", ["organization_id"])
    op.create_index("contact_primary_email_idx", "contact", ["primary_email"])
    op.create_index("contact_importance_idx", "contact", ["importance_score"])
    op.create_index("contact_health_idx", "contact", ["health_score"])
    op.create_index("contact_vip_idx", "contact", ["is_vip"])
    op.create_index("contact_at_risk_idx", "contact", ["is_at_risk"])
    op.create_index("contact_last_interaction_idx", "contact", ["last_interaction_at"])
    op.create_index("contact_lifecycle_stage_idx", "contact", ["lifecycle_stage"])
    op.create_index("contact_role_type_idx", "contact", ["role_type"])
    op.create_index("contact_influence_score_idx", "contact", ["influence_score"])
    op.create_index("contact_bridging_score_idx", "contact", ["bridging_score"])
    op.create_index("contact_last_intelligence_idx", "contact", ["last_intelligence_at"])
    op.create_unique_constraint(
        "contact_org_email_unique", "contact", ["organization_id", "primary_email"]
    )


def downgrade() -> None:
    op.drop_table("contact")
