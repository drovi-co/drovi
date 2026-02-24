"""Add persisted UIO discussion comments table.

Revision ID: 061_uio_discussion_comments
Revises: 060_admin_onboarding_runbook
Create Date: 2026-02-21
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


# revision identifiers, used by Alembic.
revision: str = "061_uio_discussion_comments"
down_revision: Union[str, None] = "060_admin_onboarding_runbook"
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
        "uio_discussion_comment",
        sa.Column("id", sa.Text(), primary_key=True, nullable=False),
        sa.Column(
            "organization_id",
            sa.Text(),
            sa.ForeignKey("organizations.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "uio_id",
            sa.Text(),
            sa.ForeignKey("unified_intelligence_object.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column("author_user_id", sa.Text(), nullable=True),
        sa.Column("author_email", sa.Text(), nullable=True),
        sa.Column("author_label", sa.Text(), nullable=True),
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
        "uio_discussion_comment_uio_created_idx",
        "uio_discussion_comment",
        ["uio_id", "created_at"],
    )
    op.create_index(
        "uio_discussion_comment_org_created_idx",
        "uio_discussion_comment",
        ["organization_id", "created_at"],
    )
    _enable_rls("uio_discussion_comment")


def downgrade() -> None:
    op.drop_index(
        "uio_discussion_comment_org_created_idx",
        table_name="uio_discussion_comment",
    )
    op.drop_index(
        "uio_discussion_comment_uio_created_idx",
        table_name="uio_discussion_comment",
    )
    op.drop_table("uio_discussion_comment")
