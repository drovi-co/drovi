"""Add console saved searches table.

Revision ID: 062_console_saved_searches
Revises: 061_uio_discussion_comments
Create Date: 2026-02-21
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


# revision identifiers, used by Alembic.
revision: str = "062_console_saved_searches"
down_revision: Union[str, None] = "061_uio_discussion_comments"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _enable_rls(table: str, column: str = "organization_id") -> None:
    policy_name = f"{table}_org_isolation"
    op.execute(f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY;")
    op.execute(f"ALTER TABLE {table} FORCE ROW LEVEL SECURITY;")
    op.execute(f"DROP POLICY IF EXISTS {policy_name} ON {table};")
    op.execute(
        f"""
        CREATE POLICY {policy_name} ON {table}
            USING (
                current_setting('app.is_internal', true) = 'true'
                OR {column}::text = current_setting('app.organization_id', true)
            )
            WITH CHECK (
                current_setting('app.is_internal', true) = 'true'
                OR {column}::text = current_setting('app.organization_id', true)
            );
        """
    )


def upgrade() -> None:
    op.create_table(
        "console_saved_search",
        sa.Column("id", sa.Text(), primary_key=True, nullable=False),
        sa.Column(
            "organization_id",
            sa.Text(),
            sa.ForeignKey("organizations.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("owner_subject_id", sa.Text(), nullable=False),
        sa.Column("owner_user_id", sa.Text(), nullable=True),
        sa.Column("owner_email", sa.Text(), nullable=True),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("query_text", sa.Text(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
    )

    op.create_index(
        "console_saved_search_org_owner_updated_idx",
        "console_saved_search",
        ["organization_id", "owner_subject_id", "updated_at"],
    )
    op.create_index(
        "console_saved_search_org_owner_name_uniq",
        "console_saved_search",
        ["organization_id", "owner_subject_id", "name"],
        unique=True,
    )
    _enable_rls("console_saved_search")


def downgrade() -> None:
    op.drop_index(
        "console_saved_search_org_owner_name_uniq",
        table_name="console_saved_search",
    )
    op.drop_index(
        "console_saved_search_org_owner_updated_idx",
        table_name="console_saved_search",
    )
    op.drop_table("console_saved_search")
