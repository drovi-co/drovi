"""Add uio_id to signal_candidate and unique constraint for unified_event.

Revision ID: 023_add_uio_id_and_unique_uem
Revises: 022_add_signal_candidate_status_index
Create Date: 2026-02-02

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = "023_add_uio_id_and_unique_uem"
down_revision: Union[str, None] = "022_add_signal_candidate_status_index"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("signal_candidate", sa.Column("uio_id", sa.Text, nullable=True))
    op.create_index("signal_candidate_uio_idx", "signal_candidate", ["uio_id"])

    op.create_unique_constraint(
        "unified_event_org_hash_unique",
        "unified_event",
        ["organization_id", "content_hash"],
    )


def downgrade() -> None:
    op.drop_constraint("unified_event_org_hash_unique", "unified_event")
    op.drop_index("signal_candidate_uio_idx", table_name="signal_candidate")
    op.drop_column("signal_candidate", "uio_id")
