"""Add tamper-evident audit ledger hash chain.

Revision ID: 033_audit_ledger_chain
Revises: 032_actuation_plane
Create Date: 2026-02-04

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "033_audit_ledger_chain"
down_revision: Union[str, None] = "032_actuation_plane"
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
    op.add_column("audit_log", sa.Column("sequence", sa.BigInteger, nullable=True))
    op.add_column("audit_log", sa.Column("prev_hash", sa.Text, nullable=True))
    op.add_column("audit_log", sa.Column("entry_hash", sa.Text, nullable=True))
    op.create_index("audit_log_sequence_idx", "audit_log", ["organization_id", "sequence"])

    op.create_table(
        "audit_ledger_head",
        sa.Column("organization_id", sa.Text, primary_key=True),
        sa.Column("last_sequence", sa.BigInteger, nullable=False, server_default="0"),
        sa.Column("last_hash", sa.Text, nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("audit_ledger_head_org_idx", "audit_ledger_head", ["organization_id"])

    _enable_rls("audit_ledger_head", "organization_id")


def downgrade() -> None:
    op.drop_index("audit_ledger_head_org_idx", table_name="audit_ledger_head")
    op.drop_table("audit_ledger_head")
    op.drop_index("audit_log_sequence_idx", table_name="audit_log")
    op.drop_column("audit_log", "entry_hash")
    op.drop_column("audit_log", "prev_hash")
    op.drop_column("audit_log", "sequence")
