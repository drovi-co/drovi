"""Enable row-level security policies for multi-tenant isolation.

Revision ID: 010_add_rls_policies
Revises: 009_create_api_keys_table
Create Date: 2026-02-02

"""
from typing import Sequence, Union

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "010_add_rls_policies"
down_revision: Union[str, None] = "009_create_api_keys_table"
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
    # Core org-scoped tables
    _enable_rls("organizations", "id")
    _enable_rls("memberships", "org_id")
    _enable_rls("invites", "org_id")
    _enable_rls("connections", "organization_id")
    _enable_rls("oauth_tokens", "organization_id")
    _enable_rls("sync_job_history", "organization_id")
    _enable_rls("event_records", "organization_id")
    _enable_rls("webhook_subscriptions", "organization_id")

    # Intelligence + contacts
    _enable_rls("contact", "organization_id")
    _enable_rls("unified_intelligence_object", "organization_id")
    _enable_rls("deduplication_candidate", "organization_id")

    # Sources
    _enable_rls("source_account", "organization_id")

    # Live ingestion + evidence
    _enable_rls("live_session", "organization_id")
    _enable_rls("evidence_artifact", "organization_id")

    # API keys
    _enable_rls("api_keys", "organization_id")


def downgrade() -> None:
    # Disable RLS and drop policies
    tables = [
        "api_keys",
        "evidence_artifact",
        "live_session",
        "source_account",
        "deduplication_candidate",
        "unified_intelligence_object",
        "contact",
        "webhook_subscriptions",
        "event_records",
        "sync_job_history",
        "oauth_tokens",
        "connections",
        "invites",
        "memberships",
        "organizations",
    ]
    for table in tables:
        op.execute(
            f"""
            DO $$
            BEGIN
                EXECUTE 'DROP POLICY IF EXISTS {table}_org_isolation ON {table}';
                EXECUTE 'ALTER TABLE {table} NO FORCE ROW LEVEL SECURITY';
                EXECUTE 'ALTER TABLE {table} DISABLE ROW LEVEL SECURITY';
            EXCEPTION
                WHEN undefined_table THEN
                    RAISE NOTICE 'Table {table} does not exist, skipping RLS disable';
            END
            $$;
            """
        )
