"""Create UIO extension tables.

Revision ID: 005_create_uio_extension_tables
Revises: 004_create_uio_tables
Create Date: 2025-01-29

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB, ARRAY

# revision identifiers, used by Alembic.
revision: str = "005_create_uio_extension_tables"
down_revision: Union[str, None] = "004_create_uio_tables"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # ==========================================================================
    # UIO Commitment Details
    # ==========================================================================
    op.create_table(
        "uio_commitment_details",
        sa.Column("id", sa.Text, primary_key=True),
        sa.Column(
            "uio_id",
            sa.Text,
            sa.ForeignKey("unified_intelligence_object.id", ondelete="CASCADE"),
            nullable=False,
            unique=True,
        ),
        # Direction
        sa.Column("direction", sa.Text, nullable=False),
        # Parties
        sa.Column(
            "debtor_contact_id",
            sa.Text,
            sa.ForeignKey("contact.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "creditor_contact_id",
            sa.Text,
            sa.ForeignKey("contact.id", ondelete="SET NULL"),
            nullable=True,
        ),
        # Due date sourcing
        sa.Column("due_date_source", sa.Text, nullable=True),
        sa.Column("due_date_original_text", sa.Text, nullable=True),
        # Priority and status
        sa.Column("priority", sa.Text, nullable=False, server_default="medium"),
        sa.Column("status", sa.Text, nullable=False, server_default="pending"),
        # Conditional
        sa.Column("is_conditional", sa.Boolean, server_default="false"),
        sa.Column("condition", sa.Text, nullable=True),
        # Completion
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("completed_via", sa.Text, nullable=True),
        # Snooze
        sa.Column("snoozed_until", sa.DateTime(timezone=True), nullable=True),
        # LLM context
        sa.Column("extraction_context", JSONB, nullable=True),
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

    op.create_index("uio_commitment_details_uio_idx", "uio_commitment_details", ["uio_id"])
    op.create_index(
        "uio_commitment_details_debtor_idx", "uio_commitment_details", ["debtor_contact_id"]
    )
    op.create_index(
        "uio_commitment_details_creditor_idx",
        "uio_commitment_details",
        ["creditor_contact_id"],
    )
    op.create_index(
        "uio_commitment_details_direction_idx", "uio_commitment_details", ["direction"]
    )
    op.create_index("uio_commitment_details_status_idx", "uio_commitment_details", ["status"])
    op.create_index(
        "uio_commitment_details_priority_idx", "uio_commitment_details", ["priority"]
    )

    # ==========================================================================
    # UIO Decision Details
    # ==========================================================================
    op.create_table(
        "uio_decision_details",
        sa.Column("id", sa.Text, primary_key=True),
        sa.Column(
            "uio_id",
            sa.Text,
            sa.ForeignKey("unified_intelligence_object.id", ondelete="CASCADE"),
            nullable=False,
            unique=True,
        ),
        # Content
        sa.Column("statement", sa.Text, nullable=False),
        sa.Column("rationale", sa.Text, nullable=True),
        # Alternatives
        sa.Column("alternatives", JSONB, nullable=True),
        # Decision maker
        sa.Column(
            "decision_maker_contact_id",
            sa.Text,
            sa.ForeignKey("contact.id", ondelete="SET NULL"),
            nullable=True,
        ),
        # Stakeholders
        sa.Column("stakeholder_contact_ids", ARRAY(sa.Text), server_default="{}"),
        sa.Column("impact_areas", ARRAY(sa.Text), server_default="{}"),
        # Status
        sa.Column("status", sa.Text, nullable=False, server_default="made"),
        # When
        sa.Column("decided_at", sa.DateTime(timezone=True), nullable=True),
        # Supersession
        sa.Column("supersedes_uio_id", sa.Text, nullable=True),
        sa.Column("superseded_by_uio_id", sa.Text, nullable=True),
        # LLM context
        sa.Column("extraction_context", JSONB, nullable=True),
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

    op.create_index("uio_decision_details_uio_idx", "uio_decision_details", ["uio_id"])
    op.create_index(
        "uio_decision_details_maker_idx",
        "uio_decision_details",
        ["decision_maker_contact_id"],
    )
    op.create_index("uio_decision_details_status_idx", "uio_decision_details", ["status"])
    op.create_index(
        "uio_decision_details_supersedes_idx", "uio_decision_details", ["supersedes_uio_id"]
    )

    # ==========================================================================
    # UIO Claim Details
    # ==========================================================================
    op.create_table(
        "uio_claim_details",
        sa.Column("id", sa.Text, primary_key=True),
        sa.Column(
            "uio_id",
            sa.Text,
            sa.ForeignKey("unified_intelligence_object.id", ondelete="CASCADE"),
            nullable=False,
            unique=True,
        ),
        # Type
        sa.Column("claim_type", sa.Text, nullable=False),
        # Evidence
        sa.Column("quoted_text", sa.Text, nullable=True),
        sa.Column("quoted_text_start", sa.Text, nullable=True),
        sa.Column("quoted_text_end", sa.Text, nullable=True),
        sa.Column("normalized_text", sa.Text, nullable=True),
        # Importance
        sa.Column("importance", sa.Text, server_default="medium"),
        # Source
        sa.Column("source_message_index", sa.Text, nullable=True),
        # LLM context
        sa.Column("extraction_context", JSONB, nullable=True),
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

    op.create_index("uio_claim_details_uio_idx", "uio_claim_details", ["uio_id"])
    op.create_index("uio_claim_details_type_idx", "uio_claim_details", ["claim_type"])
    op.create_index("uio_claim_details_importance_idx", "uio_claim_details", ["importance"])

    # ==========================================================================
    # UIO Task Details
    # ==========================================================================
    op.create_table(
        "uio_task_details",
        sa.Column("id", sa.Text, primary_key=True),
        sa.Column(
            "uio_id",
            sa.Text,
            sa.ForeignKey("unified_intelligence_object.id", ondelete="CASCADE"),
            nullable=False,
            unique=True,
        ),
        # Status and priority
        sa.Column("status", sa.Text, nullable=False, server_default="todo"),
        sa.Column("priority", sa.Text, nullable=False, server_default="medium"),
        # Ownership
        sa.Column(
            "assignee_contact_id",
            sa.Text,
            sa.ForeignKey("contact.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "created_by_contact_id",
            sa.Text,
            sa.ForeignKey("contact.id", ondelete="SET NULL"),
            nullable=True,
        ),
        # Timeline
        sa.Column("estimated_effort", sa.Text, nullable=True),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        # Dependencies
        sa.Column("depends_on_uio_ids", ARRAY(sa.Text), server_default="{}"),
        sa.Column("blocks_uio_ids", ARRAY(sa.Text), server_default="{}"),
        # Hierarchy
        sa.Column("parent_task_uio_id", sa.Text, nullable=True),
        sa.Column("commitment_uio_id", sa.Text, nullable=True),
        # Organization
        sa.Column("project", sa.Text, nullable=True),
        sa.Column("tags", ARRAY(sa.Text), server_default="{}"),
        # User overrides
        sa.Column("user_overrides", JSONB, nullable=True),
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

    op.create_index("uio_task_details_uio_idx", "uio_task_details", ["uio_id"])
    op.create_index("uio_task_details_status_idx", "uio_task_details", ["status"])
    op.create_index("uio_task_details_priority_idx", "uio_task_details", ["priority"])
    op.create_index(
        "uio_task_details_assignee_idx", "uio_task_details", ["assignee_contact_id"]
    )
    op.create_index(
        "uio_task_details_parent_idx", "uio_task_details", ["parent_task_uio_id"]
    )
    op.create_index(
        "uio_task_details_commitment_idx", "uio_task_details", ["commitment_uio_id"]
    )
    op.create_index("uio_task_details_project_idx", "uio_task_details", ["project"])

    # ==========================================================================
    # UIO Risk Details
    # ==========================================================================
    op.create_table(
        "uio_risk_details",
        sa.Column("id", sa.Text, primary_key=True),
        sa.Column(
            "uio_id",
            sa.Text,
            sa.ForeignKey("unified_intelligence_object.id", ondelete="CASCADE"),
            nullable=False,
            unique=True,
        ),
        # Classification
        sa.Column("risk_type", sa.Text, nullable=False),
        sa.Column("severity", sa.Text, nullable=False),
        # Related UIOs
        sa.Column("related_commitment_uio_ids", ARRAY(sa.Text), server_default="{}"),
        sa.Column("related_decision_uio_ids", ARRAY(sa.Text), server_default="{}"),
        # Action
        sa.Column("suggested_action", sa.Text, nullable=True),
        # Findings
        sa.Column("findings", JSONB, nullable=True),
        # LLM context
        sa.Column("extraction_context", JSONB, nullable=True),
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

    op.create_index("uio_risk_details_uio_idx", "uio_risk_details", ["uio_id"])
    op.create_index("uio_risk_details_type_idx", "uio_risk_details", ["risk_type"])
    op.create_index("uio_risk_details_severity_idx", "uio_risk_details", ["severity"])

    # ==========================================================================
    # UIO Brief Details
    # ==========================================================================
    op.create_table(
        "uio_brief_details",
        sa.Column("id", sa.Text, primary_key=True),
        sa.Column(
            "uio_id",
            sa.Text,
            sa.ForeignKey("unified_intelligence_object.id", ondelete="CASCADE"),
            nullable=False,
            unique=True,
        ),
        # Summary
        sa.Column("summary", sa.Text, nullable=False),
        # Action
        sa.Column("suggested_action", sa.Text, nullable=False),
        sa.Column("action_reasoning", sa.Text, nullable=True),
        # Open loops
        sa.Column("open_loops", JSONB, nullable=True),
        # Priority
        sa.Column("priority_tier", sa.Text, nullable=False),
        # Scores
        sa.Column("urgency_score", sa.Float, server_default="0"),
        sa.Column("importance_score", sa.Float, server_default="0"),
        sa.Column("sentiment_score", sa.Float, server_default="0"),
        # Intent
        sa.Column("intent_classification", sa.Text, nullable=True),
        # Conversation
        sa.Column("conversation_id", sa.Text, nullable=True),
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

    op.create_index("uio_brief_details_uio_idx", "uio_brief_details", ["uio_id"])
    op.create_index(
        "uio_brief_details_action_idx", "uio_brief_details", ["suggested_action"]
    )
    op.create_index(
        "uio_brief_details_priority_idx", "uio_brief_details", ["priority_tier"]
    )
    op.create_index(
        "uio_brief_details_conversation_idx", "uio_brief_details", ["conversation_id"]
    )
    op.create_index(
        "uio_brief_details_urgency_idx", "uio_brief_details", ["urgency_score"]
    )
    op.create_index(
        "uio_brief_details_importance_idx", "uio_brief_details", ["importance_score"]
    )


def downgrade() -> None:
    op.drop_table("uio_brief_details")
    op.drop_table("uio_risk_details")
    op.drop_table("uio_task_details")
    op.drop_table("uio_claim_details")
    op.drop_table("uio_decision_details")
    op.drop_table("uio_commitment_details")
