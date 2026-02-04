"""Add confidence calibration event table.

Revision ID: 030_add_confidence_calibration_event
Revises: 029_phase2_bitemporal_truth
Create Date: 2026-02-04

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "030_add_confidence_calibration_event"
down_revision: Union[str, None] = "029_phase2_bitemporal_truth"
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
        "confidence_calibration_event",
        sa.Column("id", sa.Text, primary_key=True),
        sa.Column("organization_id", sa.Text, nullable=False),
        sa.Column("uio_id", sa.Text, nullable=True),
        sa.Column("item_type", sa.Text, nullable=False),
        sa.Column("confidence", sa.Float, nullable=False),
        sa.Column("was_correct", sa.Boolean, nullable=False),
        sa.Column("source", sa.Text, nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
    )

    op.create_index(
        "confidence_calibration_org_idx",
        "confidence_calibration_event",
        ["organization_id"],
    )
    op.create_index(
        "confidence_calibration_type_idx",
        "confidence_calibration_event",
        ["item_type"],
    )
    op.create_index(
        "confidence_calibration_created_idx",
        "confidence_calibration_event",
        ["created_at"],
    )

    _enable_rls("confidence_calibration_event", "organization_id")


def downgrade() -> None:
    op.execute(
        """
        DO $$
        BEGIN
            EXECUTE 'DROP POLICY IF EXISTS confidence_calibration_event_org_isolation ON confidence_calibration_event';
            EXECUTE 'ALTER TABLE confidence_calibration_event NO FORCE ROW LEVEL SECURITY';
            EXECUTE 'ALTER TABLE confidence_calibration_event DISABLE ROW LEVEL SECURITY';
        EXCEPTION
            WHEN undefined_table THEN
                RAISE NOTICE 'Table confidence_calibration_event does not exist, skipping RLS disable';
        END
        $$;
        """
    )

    op.drop_index("confidence_calibration_created_idx", table_name="confidence_calibration_event")
    op.drop_index("confidence_calibration_type_idx", table_name="confidence_calibration_event")
    op.drop_index("confidence_calibration_org_idx", table_name="confidence_calibration_event")
    op.drop_table("confidence_calibration_event")
