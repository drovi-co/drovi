"""Create API keys table.

Revision ID: 009_create_api_keys_table
Revises: 008_create_live_session_tables
Create Date: 2026-02-02

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import ARRAY, UUID

# revision identifiers, used by Alembic.
revision: str = "009_create_api_keys_table"
down_revision: Union[str, None] = "008_create_live_session_tables"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "api_keys",
        sa.Column(
            "id",
            UUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column("organization_id", sa.String(100), nullable=False),
        sa.Column("key_hash", sa.Text, nullable=False),
        sa.Column("key_prefix", sa.String(16), nullable=False),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("scopes", ARRAY(sa.String), nullable=False, server_default="{}"),
        sa.Column("rate_limit_per_minute", sa.Integer, nullable=False, server_default="100"),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_by", sa.String(100), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_used_at", sa.DateTime(timezone=True), nullable=True),
    )

    op.create_index("idx_api_keys_org", "api_keys", ["organization_id"])
    op.create_index("idx_api_keys_hash", "api_keys", ["key_hash"], unique=True)
    op.create_index("idx_api_keys_prefix", "api_keys", ["key_prefix"])


def downgrade() -> None:
    op.drop_index("idx_api_keys_prefix", table_name="api_keys")
    op.drop_index("idx_api_keys_hash", table_name="api_keys")
    op.drop_index("idx_api_keys_org", table_name="api_keys")
    op.drop_table("api_keys")
