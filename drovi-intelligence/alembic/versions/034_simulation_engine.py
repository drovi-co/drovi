"""Simulation engine persistence.

Revision ID: 034_simulation_engine
Revises: 033_audit_ledger_chain
Create Date: 2026-02-04

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "034_simulation_engine"
down_revision: Union[str, None] = "033_audit_ledger_chain"
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
        "simulation_run",
        sa.Column("id", sa.Text, primary_key=True),
        sa.Column("organization_id", sa.Text, nullable=False),
        sa.Column("scenario_name", sa.Text, nullable=False),
        sa.Column("input_payload", sa.JSON, nullable=False),
        sa.Column("output_payload", sa.JSON, nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("simulation_run_org_idx", "simulation_run", ["organization_id"])
    op.create_index("simulation_run_created_idx", "simulation_run", ["created_at"])

    _enable_rls("simulation_run", "organization_id")


def downgrade() -> None:
    op.drop_index("simulation_run_created_idx", table_name="simulation_run")
    op.drop_index("simulation_run_org_idx", table_name="simulation_run")
    op.drop_table("simulation_run")
