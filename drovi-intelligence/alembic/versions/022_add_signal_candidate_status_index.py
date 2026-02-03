"""Add index for signal_candidate status.

Revision ID: 022_add_signal_candidate_status_index
Revises: 021_update_rls_new_tables_internal
Create Date: 2026-02-02

"""
from typing import Sequence, Union

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "022_add_signal_candidate_status_index"
down_revision: Union[str, None] = "021_update_rls_new_tables_internal"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_index(
        "signal_candidate_status_idx",
        "signal_candidate",
        ["status"],
    )


def downgrade() -> None:
    op.drop_index("signal_candidate_status_idx", table_name="signal_candidate")
