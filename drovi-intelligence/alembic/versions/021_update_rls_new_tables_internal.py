"""Update RLS policies for new tables to allow internal bypass.

Revision ID: 021_update_rls_new_tables_internal
Revises: 020_add_signal_candidate_processing_fields
Create Date: 2026-02-02

"""
from typing import Sequence, Union

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "021_update_rls_new_tables_internal"
down_revision: Union[str, None] = "020_add_signal_candidate_processing_fields"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _reset_policy(table: str, column: str) -> None:
    policy_name = f"{table}_org_isolation"
    op.execute(
        f"""
        DO $$
        BEGIN
            EXECUTE 'DROP POLICY IF EXISTS {policy_name} ON {table}';
            EXECUTE 'CREATE POLICY {policy_name} ON {table}
                     USING (
                        current_setting(''app.is_internal'', true) = ''true''
                        OR {column} = current_setting(''app.organization_id'', true)
                     )';
        EXCEPTION
            WHEN undefined_table THEN
                RAISE NOTICE 'Table {table} does not exist, skipping RLS update';
        END
        $$;
        """
    )


def upgrade() -> None:
    _reset_policy("unified_event", "organization_id")
    _reset_policy("contact_identity", "organization_id")
    _reset_policy("signal_candidate", "organization_id")


def downgrade() -> None:
    tables = [
        ("unified_event", "organization_id"),
        ("contact_identity", "organization_id"),
        ("signal_candidate", "organization_id"),
    ]
    for table, column in tables:
        policy_name = f"{table}_org_isolation"
        op.execute(
            f"""
            DO $$
            BEGIN
                EXECUTE 'DROP POLICY IF EXISTS {policy_name} ON {table}';
                EXECUTE 'CREATE POLICY {policy_name} ON {table}
                         USING ({column} = current_setting(''app.organization_id'', true))';
            EXCEPTION
                WHEN undefined_table THEN
                    RAISE NOTICE 'Table {table} does not exist, skipping RLS downgrade';
            END
            $$;
            """
        )
