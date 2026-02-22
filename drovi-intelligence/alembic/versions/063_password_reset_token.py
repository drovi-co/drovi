"""Add password reset token table.

Revision ID: 063_password_reset_token
Revises: 062_console_saved_searches
Create Date: 2026-02-21
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


# revision identifiers, used by Alembic.
revision: str = "063_password_reset_token"
down_revision: Union[str, None] = "062_console_saved_searches"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "password_reset_token",
        sa.Column("id", sa.Text(), primary_key=True, nullable=False),
        sa.Column(
            "user_id",
            sa.Text(),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("token_hash", sa.Text(), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("used_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
    )
    op.create_index(
        "password_reset_token_hash_uniq",
        "password_reset_token",
        ["token_hash"],
        unique=True,
    )
    op.create_index(
        "password_reset_token_user_created_idx",
        "password_reset_token",
        ["user_id", "created_at"],
    )


def downgrade() -> None:
    op.drop_index(
        "password_reset_token_user_created_idx",
        table_name="password_reset_token",
    )
    op.drop_index(
        "password_reset_token_hash_uniq",
        table_name="password_reset_token",
    )
    op.drop_table("password_reset_token")
