"""Create contact_identity table for deterministic identity resolution.

Revision ID: 017_create_contact_identity_table
Revises: 016_create_unified_event_model
Create Date: 2026-02-02

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = "017_create_contact_identity_table"
down_revision: Union[str, None] = "016_create_unified_event_model"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _enable_rls(table: str, column: str) -> None:
    policy_name = f"{table}_org_isolation"
    op.execute(
        f"""
        DO $$
        BEGIN
            EXECUTE 'ALTER TABLE {table} ENABLE ROW LEVEL SECURITY';
            EXECUTE 'ALTER TABLE {table} FORCE ROW LEVEL SECURITY';
            IF NOT EXISTS (
                SELECT 1
                FROM pg_policies
                WHERE schemaname = current_schema()
                  AND tablename = '{table}'
                  AND policyname = '{policy_name}'
            ) THEN
                EXECUTE 'CREATE POLICY {policy_name} ON {table}
                         USING ({column} = current_setting(''app.organization_id'', true))';
            END IF;
        EXCEPTION
            WHEN undefined_table THEN
                RAISE NOTICE 'Table {table} does not exist, skipping RLS';
        END
        $$;
        """
    )


def upgrade() -> None:
    op.create_table(
        "contact_identity",
        sa.Column("id", sa.Text, primary_key=True),
        sa.Column("organization_id", sa.Text, nullable=False),
        sa.Column("contact_id", sa.Text, nullable=False),
        sa.Column("identity_type", sa.Text, nullable=False),
        sa.Column("identity_value", sa.Text, nullable=False),
        sa.Column("confidence", sa.Float, nullable=False, server_default="1.0"),
        sa.Column("is_verified", sa.Boolean, nullable=False, server_default="false"),
        sa.Column("source", sa.Text, nullable=True),
        sa.Column("source_account_id", sa.Text, nullable=True),
        sa.Column("last_seen_at", sa.DateTime(timezone=True), nullable=True),
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
        "contact_identity_org_idx",
        "contact_identity",
        ["organization_id"],
    )
    op.create_index(
        "contact_identity_contact_idx",
        "contact_identity",
        ["contact_id"],
    )
    op.create_unique_constraint(
        "contact_identity_unique",
        "contact_identity",
        ["organization_id", "identity_type", "identity_value"],
    )

    _enable_rls("contact_identity", "organization_id")


def downgrade() -> None:
    op.execute(
        """
        DO $$
        BEGIN
            EXECUTE 'DROP POLICY IF EXISTS contact_identity_org_isolation ON contact_identity';
            EXECUTE 'ALTER TABLE contact_identity NO FORCE ROW LEVEL SECURITY';
            EXECUTE 'ALTER TABLE contact_identity DISABLE ROW LEVEL SECURITY';
        EXCEPTION
            WHEN undefined_table THEN
                RAISE NOTICE 'Table contact_identity does not exist, skipping RLS disable';
        END
        $$;
        """
    )

    op.drop_constraint("contact_identity_unique", "contact_identity")
    op.drop_index("contact_identity_contact_idx", table_name="contact_identity")
    op.drop_index("contact_identity_org_idx", table_name="contact_identity")
    op.drop_table("contact_identity")
