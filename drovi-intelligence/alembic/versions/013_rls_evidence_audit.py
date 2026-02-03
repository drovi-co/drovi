"""Add RLS policy for evidence audit log.

Revision ID: 013_rls_evidence_audit
Revises: 012_evidence_retention_audit
Create Date: 2026-02-02

"""
from typing import Sequence, Union

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "013_rls_evidence_audit"
down_revision: Union[str, None] = "012_evidence_retention_audit"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute(
        """
        DO $$
        BEGIN
            EXECUTE 'ALTER TABLE evidence_audit_log ENABLE ROW LEVEL SECURITY';
            EXECUTE 'ALTER TABLE evidence_audit_log FORCE ROW LEVEL SECURITY';
            EXECUTE 'DROP POLICY IF EXISTS evidence_audit_log_org_isolation ON evidence_audit_log';
            EXECUTE 'CREATE POLICY evidence_audit_log_org_isolation ON evidence_audit_log
                     USING (
                        current_setting(''app.is_internal'', true) = ''true''
                        OR organization_id = current_setting(''app.organization_id'', true)
                     )';
        EXCEPTION
            WHEN undefined_table THEN
                RAISE NOTICE 'Table evidence_audit_log does not exist, skipping RLS';
        END
        $$;
        """
    )


def downgrade() -> None:
    op.execute(
        """
        DO $$
        BEGIN
            EXECUTE 'DROP POLICY IF EXISTS evidence_audit_log_org_isolation ON evidence_audit_log';
            EXECUTE 'ALTER TABLE evidence_audit_log NO FORCE ROW LEVEL SECURITY';
            EXECUTE 'ALTER TABLE evidence_audit_log DISABLE ROW LEVEL SECURITY';
        EXCEPTION
            WHEN undefined_table THEN
                RAISE NOTICE 'Table evidence_audit_log does not exist, skipping RLS downgrade';
        END
        $$;
        """
    )
