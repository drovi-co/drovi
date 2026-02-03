"""Add supersession fields to commitment/task/risk details.

Revision ID: 024_add_supersession_fields_to_uio_details
Revises: 023_add_uio_id_and_unique_uem
Create Date: 2026-02-02

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = "024_add_supersession_fields_to_uio_details"
down_revision: Union[str, None] = "023_add_uio_id_and_unique_uem"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("uio_commitment_details", sa.Column("supersedes_uio_id", sa.Text, nullable=True))
    op.add_column("uio_commitment_details", sa.Column("superseded_by_uio_id", sa.Text, nullable=True))

    op.add_column("uio_task_details", sa.Column("supersedes_uio_id", sa.Text, nullable=True))
    op.add_column("uio_task_details", sa.Column("superseded_by_uio_id", sa.Text, nullable=True))

    op.add_column("uio_risk_details", sa.Column("supersedes_uio_id", sa.Text, nullable=True))
    op.add_column("uio_risk_details", sa.Column("superseded_by_uio_id", sa.Text, nullable=True))

    op.create_index("uio_commitment_supersedes_idx", "uio_commitment_details", ["supersedes_uio_id"])
    op.create_index("uio_commitment_superseded_by_idx", "uio_commitment_details", ["superseded_by_uio_id"])
    op.create_index("uio_task_supersedes_idx", "uio_task_details", ["supersedes_uio_id"])
    op.create_index("uio_task_superseded_by_idx", "uio_task_details", ["superseded_by_uio_id"])
    op.create_index("uio_risk_supersedes_idx", "uio_risk_details", ["supersedes_uio_id"])
    op.create_index("uio_risk_superseded_by_idx", "uio_risk_details", ["superseded_by_uio_id"])


def downgrade() -> None:
    op.drop_index("uio_risk_superseded_by_idx", table_name="uio_risk_details")
    op.drop_index("uio_risk_supersedes_idx", table_name="uio_risk_details")
    op.drop_index("uio_task_superseded_by_idx", table_name="uio_task_details")
    op.drop_index("uio_task_supersedes_idx", table_name="uio_task_details")
    op.drop_index("uio_commitment_superseded_by_idx", table_name="uio_commitment_details")
    op.drop_index("uio_commitment_supersedes_idx", table_name="uio_commitment_details")

    op.drop_column("uio_risk_details", "superseded_by_uio_id")
    op.drop_column("uio_risk_details", "supersedes_uio_id")
    op.drop_column("uio_task_details", "superseded_by_uio_id")
    op.drop_column("uio_task_details", "supersedes_uio_id")
    op.drop_column("uio_commitment_details", "superseded_by_uio_id")
    op.drop_column("uio_commitment_details", "supersedes_uio_id")
