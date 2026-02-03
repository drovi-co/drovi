"""Add processing fields to signal_candidate.

Revision ID: 020_add_signal_candidate_processing_fields
Revises: 019_add_bitemporal_fields_to_uios
Create Date: 2026-02-02

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = "020_add_signal_candidate_processing_fields"
down_revision: Union[str, None] = "019_add_bitemporal_fields_to_uios"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "signal_candidate",
        sa.Column("processing_started_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "signal_candidate",
        sa.Column("processing_error", sa.Text, nullable=True),
    )
    op.add_column(
        "signal_candidate",
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
    )


def downgrade() -> None:
    op.drop_column("signal_candidate", "updated_at")
    op.drop_column("signal_candidate", "processing_error")
    op.drop_column("signal_candidate", "processing_started_at")
