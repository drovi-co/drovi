"""Create audit_log table.

Revision ID: 014_audit_log_table
Revises: 013_rls_evidence_audit
Create Date: 2026-02-02

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

# revision identifiers, used by Alembic.
revision: str = "014_audit_log_table"
down_revision: Union[str, None] = "013_rls_evidence_audit"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "audit_log",
        sa.Column("id", sa.UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("organization_id", sa.Text, nullable=False),
        sa.Column("action", sa.Text, nullable=False),
        sa.Column("actor_type", sa.Text, nullable=False),
        sa.Column("actor_id", sa.Text, nullable=True),
        sa.Column("resource_type", sa.Text, nullable=True),
        sa.Column("resource_id", sa.Text, nullable=True),
        sa.Column("metadata", JSONB, nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_index("audit_log_org_idx", "audit_log", ["organization_id"])
    op.create_index("audit_log_action_idx", "audit_log", ["action"])

    op.execute(
        """
        DO $$
        BEGIN
            EXECUTE 'ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY';
            EXECUTE 'ALTER TABLE audit_log FORCE ROW LEVEL SECURITY';
            EXECUTE 'CREATE POLICY audit_log_org_isolation ON audit_log
                     USING (
                        current_setting(''app.is_internal'', true) = ''true''
                        OR organization_id = current_setting(''app.organization_id'', true)
                     )';
        EXCEPTION
            WHEN undefined_table THEN
                RAISE NOTICE 'Table audit_log does not exist, skipping RLS';
        END
        $$;
        """
    )


def downgrade() -> None:
    op.drop_index("audit_log_action_idx", table_name="audit_log")
    op.drop_index("audit_log_org_idx", table_name="audit_log")
    op.drop_table("audit_log")
