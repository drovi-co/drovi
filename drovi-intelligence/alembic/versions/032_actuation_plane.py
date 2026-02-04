"""Actuation plane persistence.

Revision ID: 032_actuation_plane
Revises: 031_continuum_runtime
Create Date: 2026-02-04

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "032_actuation_plane"
down_revision: Union[str, None] = "031_continuum_runtime"
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
        "actuation_action",
        sa.Column("id", sa.Text, primary_key=True),
        sa.Column("organization_id", sa.Text, nullable=False),
        sa.Column("driver", sa.Text, nullable=False),
        sa.Column("action_type", sa.Text, nullable=False),
        sa.Column("tier", sa.Text, nullable=False),
        sa.Column("status", sa.Text, nullable=False),
        sa.Column("input_payload", sa.JSON, nullable=True),
        sa.Column("draft_payload", sa.JSON, nullable=True),
        sa.Column("stage_payload", sa.JSON, nullable=True),
        sa.Column("result_payload", sa.JSON, nullable=True),
        sa.Column("rollback_payload", sa.JSON, nullable=True),
        sa.Column("rollback_result", sa.JSON, nullable=True),
        sa.Column("policy_decisions", sa.JSON, nullable=True),
        sa.Column("created_by", sa.Text, nullable=True),
        sa.Column("approval_by", sa.Text, nullable=True),
        sa.Column("approval_reason", sa.Text, nullable=True),
        sa.Column("error_message", sa.Text, nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("executed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("rolled_back_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("actuation_org_idx", "actuation_action", ["organization_id"])
    op.create_index("actuation_status_idx", "actuation_action", ["status"])
    op.create_index("actuation_driver_idx", "actuation_action", ["driver"])
    op.create_index("actuation_action_type_idx", "actuation_action", ["action_type"])

    _enable_rls("actuation_action", "organization_id")


def downgrade() -> None:
    op.drop_index("actuation_action_type_idx", table_name="actuation_action")
    op.drop_index("actuation_driver_idx", table_name="actuation_action")
    op.drop_index("actuation_status_idx", table_name="actuation_action")
    op.drop_index("actuation_org_idx", table_name="actuation_action")
    op.drop_table("actuation_action")
