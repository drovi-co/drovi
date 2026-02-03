"""Add brief delta fields and task extraction context.

Revision ID: 026_add_brief_fields_and_task_extraction_context
Revises: 025_add_segment_hash_to_unified_object_source
Create Date: 2026-02-03
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

# revision identifiers, used by Alembic.
revision = "026_add_brief_fields_and_task_extraction_context"
down_revision = "025_add_segment_hash_to_unified_object_source"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("uio_task_details", sa.Column("extraction_context", JSONB, nullable=True))
    op.add_column("uio_brief_details", sa.Column("why_this_matters", sa.Text, nullable=True))
    op.add_column("uio_brief_details", sa.Column("what_changed", sa.Text, nullable=True))


def downgrade() -> None:
    op.drop_column("uio_brief_details", "what_changed")
    op.drop_column("uio_brief_details", "why_this_matters")
    op.drop_column("uio_task_details", "extraction_context")
