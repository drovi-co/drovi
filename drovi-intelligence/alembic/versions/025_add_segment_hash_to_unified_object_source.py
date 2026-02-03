"""Add segment hash to unified object source.

Revision ID: 025_add_segment_hash_to_unified_object_source
Revises: 024_add_supersession_fields_to_uio_details
Create Date: 2026-02-03

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = "025_add_segment_hash_to_unified_object_source"
down_revision: Union[str, None] = "024_add_supersession_fields_to_uio_details"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "unified_object_source",
        sa.Column("segment_hash", sa.Text, nullable=True),
    )
    op.create_index(
        "uos_segment_hash_idx",
        "unified_object_source",
        ["segment_hash"],
    )


def downgrade() -> None:
    op.drop_index("uos_segment_hash_idx", table_name="unified_object_source")
    op.drop_column("unified_object_source", "segment_hash")
