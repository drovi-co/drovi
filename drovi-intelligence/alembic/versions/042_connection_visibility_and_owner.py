"""Add connection visibility + owner.

Revision ID: 042_connection_visibility_and_owner
Revises: 041_add_org_updated_at
Create Date: 2026-02-06

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = "042_connection_visibility_and_owner"
down_revision: Union[str, None] = "041_add_org_updated_at"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "connections",
        sa.Column("created_by_user_id", sa.String(length=100), nullable=True),
    )
    op.add_column(
        "connections",
        sa.Column(
            "visibility",
            sa.String(length=20),
            nullable=True,
            server_default="org_shared",
        ),
    )

    # Backfill existing rows and then enforce NOT NULL.
    op.execute("UPDATE connections SET visibility = 'org_shared' WHERE visibility IS NULL")
    op.alter_column(
        "connections",
        "visibility",
        nullable=False,
        server_default="org_shared",
    )

    op.create_index(
        "idx_connections_org_visibility",
        "connections",
        ["organization_id", "visibility"],
    )
    op.create_index(
        "idx_connections_org_created_by",
        "connections",
        ["organization_id", "created_by_user_id"],
    )


def downgrade() -> None:
    op.drop_index("idx_connections_org_created_by", table_name="connections")
    op.drop_index("idx_connections_org_visibility", table_name="connections")
    op.drop_column("connections", "visibility")
    op.drop_column("connections", "created_by_user_id")

