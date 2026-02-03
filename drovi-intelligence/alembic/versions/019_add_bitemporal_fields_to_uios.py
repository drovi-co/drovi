"""Add bi-temporal fields to unified_intelligence_object.

Revision ID: 019_add_bitemporal_fields_to_uios
Revises: 018_create_signal_candidate_table
Create Date: 2026-02-02

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = "019_add_bitemporal_fields_to_uios"
down_revision: Union[str, None] = "018_create_signal_candidate_table"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "unified_intelligence_object",
        sa.Column(
            "valid_from",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
    )
    op.add_column(
        "unified_intelligence_object",
        sa.Column(
            "valid_to",
            sa.DateTime(timezone=True),
            nullable=True,
        ),
    )
    op.add_column(
        "unified_intelligence_object",
        sa.Column(
            "system_from",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
    )
    op.add_column(
        "unified_intelligence_object",
        sa.Column(
            "system_to",
            sa.DateTime(timezone=True),
            nullable=True,
        ),
    )

    op.create_index(
        "uio_valid_from_idx",
        "unified_intelligence_object",
        ["valid_from"],
    )
    op.create_index(
        "uio_valid_to_idx",
        "unified_intelligence_object",
        ["valid_to"],
    )


def downgrade() -> None:
    op.drop_index("uio_valid_to_idx", table_name="unified_intelligence_object")
    op.drop_index("uio_valid_from_idx", table_name="unified_intelligence_object")
    op.drop_column("unified_intelligence_object", "system_to")
    op.drop_column("unified_intelligence_object", "system_from")
    op.drop_column("unified_intelligence_object", "valid_to")
    op.drop_column("unified_intelligence_object", "valid_from")
