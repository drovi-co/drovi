"""Update RLS policies to allow internal service bypass.

Revision ID: 011_update_rls_policies_internal
Revises: 010_add_rls_policies
Create Date: 2026-02-02

"""
from typing import Sequence, Union

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "011_update_rls_policies_internal"
down_revision: Union[str, None] = "010_add_rls_policies"
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
    _reset_policy("organizations", "id")
    _reset_policy("memberships", "org_id")
    _reset_policy("invites", "org_id")
    _reset_policy("connections", "organization_id")
    _reset_policy("oauth_tokens", "organization_id")
    _reset_policy("sync_job_history", "organization_id")
    _reset_policy("event_records", "organization_id")
    _reset_policy("webhook_subscriptions", "organization_id")
    _reset_policy("contact", "organization_id")
    _reset_policy("unified_intelligence_object", "organization_id")
    _reset_policy("deduplication_candidate", "organization_id")
    _reset_policy("source_account", "organization_id")
    _reset_policy("live_session", "organization_id")
    _reset_policy("evidence_artifact", "organization_id")
    _reset_policy("api_keys", "organization_id")


def downgrade() -> None:
    # Revert to strict org-only policies
    tables = [
        ("organizations", "id"),
        ("memberships", "org_id"),
        ("invites", "org_id"),
        ("connections", "organization_id"),
        ("oauth_tokens", "organization_id"),
        ("sync_job_history", "organization_id"),
        ("event_records", "organization_id"),
        ("webhook_subscriptions", "organization_id"),
        ("contact", "organization_id"),
        ("unified_intelligence_object", "organization_id"),
        ("deduplication_candidate", "organization_id"),
        ("source_account", "organization_id"),
        ("live_session", "organization_id"),
        ("evidence_artifact", "organization_id"),
        ("api_keys", "organization_id"),
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
