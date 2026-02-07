"""Add updated_at to organizations.

Revision ID: 041_add_org_updated_at
Revises: 040_background_jobs
Create Date: 2026-02-06

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = "041_add_org_updated_at"
down_revision: Union[str, None] = "040_background_jobs"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # The org settings/onboarding flow updates organizations.updated_at.
    # This column was missing from the initial pilot accounts schema.
    op.add_column(
        "organizations",
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=True,
            server_default=sa.func.now(),
        ),
    )

    # Backfill existing rows.
    op.execute("UPDATE organizations SET updated_at = created_at WHERE updated_at IS NULL")

    op.alter_column(
        "organizations",
        "updated_at",
        nullable=False,
        server_default=sa.func.now(),
    )

    op.create_index("idx_orgs_updated_at", "organizations", ["updated_at"])


def downgrade() -> None:
    op.drop_index("idx_orgs_updated_at", table_name="organizations")
    op.drop_column("organizations", "updated_at")

