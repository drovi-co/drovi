"""Add locale preferences for users and organizations.

Revision ID: 046_add_locales
Revises: 045_support_tickets
Create Date: 2026-02-08

Adds:
- organizations.default_locale (default "en")
- users.locale (nullable, overrides org default)
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "046_add_locales"
down_revision: Union[str, None] = "045_support_tickets"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "organizations",
        sa.Column("default_locale", sa.Text(), nullable=False, server_default="en"),
    )
    op.add_column(
        "users",
        sa.Column("locale", sa.Text(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("users", "locale")
    op.drop_column("organizations", "default_locale")

