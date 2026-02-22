"""Add blindspot feedback persistence table.

Revision ID: 064_blindspot_feedback
Revises: 063_password_reset_token
Create Date: 2026-02-21
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


# revision identifiers, used by Alembic.
revision: str = "064_blindspot_feedback"
down_revision: Union[str, None] = "063_password_reset_token"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _enable_rls(table: str, column: str = "organization_id") -> None:
    policy_name = f"{table}_org_isolation"
    op.execute(
        f"""
        ALTER TABLE {table} ENABLE ROW LEVEL SECURITY;
        ALTER TABLE {table} FORCE ROW LEVEL SECURITY;
        DROP POLICY IF EXISTS {policy_name} ON {table};
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
        "blindspot_feedback",
        sa.Column("id", sa.Text(), primary_key=True, nullable=False),
        sa.Column(
            "organization_id",
            sa.Text(),
            sa.ForeignKey("organizations.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("blindspot_id", sa.Text(), nullable=False),
        sa.Column("blindspot_type", sa.Text(), nullable=False),
        sa.Column("fingerprint", sa.Text(), nullable=False),
        sa.Column("feedback_action", sa.Text(), nullable=False, server_default="dismissed"),
        sa.Column("reason", sa.Text(), nullable=False),
        sa.Column("dismissed_by_subject", sa.Text(), nullable=True),
        sa.Column(
            "metadata",
            sa.dialects.postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default=sa.text("'{}'::jsonb"),
        ),
        sa.Column("dismissal_count", sa.Integer(), nullable=False, server_default="1"),
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
        sa.Column(
            "last_dismissed_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
    )
    op.create_index(
        "blindspot_feedback_org_action_updated_idx",
        "blindspot_feedback",
        ["organization_id", "feedback_action", "updated_at"],
    )
    op.create_index(
        "blindspot_feedback_org_type_action_idx",
        "blindspot_feedback",
        ["organization_id", "blindspot_type", "feedback_action"],
    )
    op.create_index(
        "blindspot_feedback_org_action_fingerprint_uniq",
        "blindspot_feedback",
        ["organization_id", "feedback_action", "fingerprint"],
        unique=True,
    )
    _enable_rls("blindspot_feedback")


def downgrade() -> None:
    op.drop_index(
        "blindspot_feedback_org_action_fingerprint_uniq",
        table_name="blindspot_feedback",
    )
    op.drop_index(
        "blindspot_feedback_org_type_action_idx",
        table_name="blindspot_feedback",
    )
    op.drop_index(
        "blindspot_feedback_org_action_updated_idx",
        table_name="blindspot_feedback",
    )
    op.drop_table("blindspot_feedback")
