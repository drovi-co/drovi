"""Add admin onboarding runbook table.

Revision ID: 060_admin_onboarding_runbook
Revises: 059_security_posture_controls
Create Date: 2026-02-17
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


# revision identifiers, used by Alembic.
revision: str = "060_admin_onboarding_runbook"
down_revision: Union[str, None] = "059_security_posture_controls"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _enable_rls(table: str, column: str = "organization_id") -> None:
    policy_name = f"{table}_org_isolation"
    op.execute(
        f"""
        DO $$
        BEGIN
            IF EXISTS (
                SELECT 1
                FROM information_schema.tables
                WHERE table_schema = 'public'
                  AND table_name = '{table}'
            ) THEN
                EXECUTE 'ALTER TABLE {table} ENABLE ROW LEVEL SECURITY';
                EXECUTE 'ALTER TABLE {table} FORCE ROW LEVEL SECURITY';
                EXECUTE 'DROP POLICY IF EXISTS {policy_name} ON {table}';
                EXECUTE 'CREATE POLICY {policy_name} ON {table}
                    USING (
                        current_setting(''app.is_internal'', true) = ''true''
                        OR {column}::text = current_setting(''app.organization_id'', true)
                    )
                    WITH CHECK (
                        current_setting(''app.is_internal'', true) = ''true''
                        OR {column}::text = current_setting(''app.organization_id'', true)
                    )';
            END IF;
        END $$;
        """
    )


def upgrade() -> None:
    op.create_table(
        "admin_onboarding_runbook",
        sa.Column(
            "organization_id",
            sa.Text(),
            sa.ForeignKey("organizations.id", ondelete="CASCADE"),
            primary_key=True,
            nullable=False,
        ),
        sa.Column(
            "security_review_complete",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
        ),
        sa.Column(
            "data_custody_mapped",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
        ),
        sa.Column(
            "pilot_mandate_set",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
        ),
        sa.Column(
            "go_live_ready",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
        ),
        sa.Column("owner_email", sa.Text(), nullable=True),
        sa.Column("target_go_live_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("updated_by", sa.Text(), nullable=True),
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
        "admin_onboarding_runbook_updated_idx",
        "admin_onboarding_runbook",
        ["updated_at"],
    )
    op.create_index(
        "admin_onboarding_runbook_ready_idx",
        "admin_onboarding_runbook",
        ["go_live_ready"],
    )
    _enable_rls("admin_onboarding_runbook")


def downgrade() -> None:
    op.drop_index(
        "admin_onboarding_runbook_ready_idx",
        table_name="admin_onboarding_runbook",
    )
    op.drop_index(
        "admin_onboarding_runbook_updated_idx",
        table_name="admin_onboarding_runbook",
    )
    op.drop_table("admin_onboarding_runbook")
