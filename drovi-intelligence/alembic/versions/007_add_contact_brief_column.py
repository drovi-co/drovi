"""Add contact_brief column to contact table.

Revision ID: 007_add_contact_brief_column
Revises: 006_create_source_tables
Create Date: 2025-01-30

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

# revision identifiers, used by Alembic.
revision: str = "007_add_contact_brief_column"
down_revision: Union[str, None] = "006_create_source_tables"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Add contact_brief column to store the generated contact brief as JSON
    # This contains: brief_summary, relationship_status, key_insights,
    # suggested_actions, talking_points, etc.
    op.add_column(
        "contact",
        sa.Column("contact_brief", JSONB, nullable=True),
    )


def downgrade() -> None:
    op.drop_column("contact", "contact_brief")
