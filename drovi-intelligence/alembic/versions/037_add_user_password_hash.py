"""Add password_hash column to users table for email authentication.

Revision ID: 037_add_user_password_hash
Revises: 036_continuum_exchange_metadata
Create Date: 2025-02-05

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "037_add_user_password_hash"
down_revision: Union[str, None] = "036_continuum_exchange_metadata"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Add password_hash column to users table
    # This allows users to authenticate via email/password in addition to OAuth
    op.add_column(
        "users",
        sa.Column("password_hash", sa.String(255), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("users", "password_hash")
