"""Continuum runtime persistence.

Revision ID: 031_continuum_runtime
Revises: 030_add_confidence_calibration_event
Create Date: 2026-02-04

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "031_continuum_runtime"
down_revision: Union[str, None] = "030_add_confidence_calibration_event"
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
        "continuum",
        sa.Column("id", sa.Text, primary_key=True),
        sa.Column("organization_id", sa.Text, nullable=False),
        sa.Column("name", sa.Text, nullable=False),
        sa.Column("description", sa.Text, nullable=True),
        sa.Column("status", sa.Text, nullable=False, server_default="draft"),
        sa.Column("current_version", sa.Integer, nullable=False, server_default="1"),
        sa.Column("active_version", sa.Integer, nullable=False, server_default="1"),
        sa.Column("schedule_type", sa.Text, nullable=False, server_default="interval"),
        sa.Column("schedule_interval_minutes", sa.Integer, nullable=True),
        sa.Column("schedule_cron", sa.Text, nullable=True),
        sa.Column("escalation_policy", sa.JSON, nullable=True),
        sa.Column("created_by", sa.Text, nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("last_run_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("next_run_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("continuum_org_idx", "continuum", ["organization_id"])
    op.create_index("continuum_status_idx", "continuum", ["status"])
    op.create_index("continuum_next_run_idx", "continuum", ["next_run_at"])

    op.create_table(
        "continuum_version",
        sa.Column("id", sa.Text, primary_key=True),
        sa.Column("continuum_id", sa.Text, sa.ForeignKey("continuum.id", ondelete="CASCADE"), nullable=False),
        sa.Column("organization_id", sa.Text, nullable=False),
        sa.Column("version", sa.Integer, nullable=False),
        sa.Column("definition", sa.JSON, nullable=False),
        sa.Column("definition_hash", sa.Text, nullable=True),
        sa.Column("created_by", sa.Text, nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("is_active", sa.Boolean, nullable=False, server_default=sa.false()),
    )
    op.create_index("continuum_version_org_idx", "continuum_version", ["organization_id"])
    op.create_index("continuum_version_continuum_idx", "continuum_version", ["continuum_id"])
    op.create_index("continuum_version_active_idx", "continuum_version", ["continuum_id", "is_active"])
    op.create_unique_constraint(
        "continuum_version_unique",
        "continuum_version",
        ["continuum_id", "version"],
    )

    op.create_table(
        "continuum_run",
        sa.Column("id", sa.Text, primary_key=True),
        sa.Column("continuum_id", sa.Text, sa.ForeignKey("continuum.id", ondelete="CASCADE"), nullable=False),
        sa.Column("organization_id", sa.Text, nullable=False),
        sa.Column("version", sa.Integer, nullable=False),
        sa.Column("status", sa.Text, nullable=False),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("error_message", sa.Text, nullable=True),
        sa.Column("run_metadata", sa.JSON, nullable=True),
        sa.Column("step_results", sa.JSON, nullable=True),
        sa.Column("attempt", sa.Integer, nullable=False, server_default="1"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("continuum_run_org_idx", "continuum_run", ["organization_id"])
    op.create_index("continuum_run_continuum_idx", "continuum_run", ["continuum_id"])
    op.create_index("continuum_run_status_idx", "continuum_run", ["status"])

    op.create_table(
        "continuum_alert",
        sa.Column("id", sa.Text, primary_key=True),
        sa.Column("continuum_id", sa.Text, sa.ForeignKey("continuum.id", ondelete="CASCADE"), nullable=False),
        sa.Column("organization_id", sa.Text, nullable=False),
        sa.Column("alert_type", sa.Text, nullable=False),
        sa.Column("severity", sa.Text, nullable=False),
        sa.Column("status", sa.Text, nullable=False, server_default="open"),
        sa.Column("title", sa.Text, nullable=False),
        sa.Column("description", sa.Text, nullable=True),
        sa.Column("details", sa.JSON, nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("resolved_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("resolved_by", sa.Text, nullable=True),
    )
    op.create_index("continuum_alert_org_idx", "continuum_alert", ["organization_id"])
    op.create_index("continuum_alert_continuum_idx", "continuum_alert", ["continuum_id"])
    op.create_index("continuum_alert_status_idx", "continuum_alert", ["status"])

    _enable_rls("continuum", "organization_id")
    _enable_rls("continuum_version", "organization_id")
    _enable_rls("continuum_run", "organization_id")
    _enable_rls("continuum_alert", "organization_id")


def downgrade() -> None:
    op.drop_index("continuum_alert_status_idx", table_name="continuum_alert")
    op.drop_index("continuum_alert_continuum_idx", table_name="continuum_alert")
    op.drop_index("continuum_alert_org_idx", table_name="continuum_alert")
    op.drop_table("continuum_alert")

    op.drop_index("continuum_run_status_idx", table_name="continuum_run")
    op.drop_index("continuum_run_continuum_idx", table_name="continuum_run")
    op.drop_index("continuum_run_org_idx", table_name="continuum_run")
    op.drop_table("continuum_run")

    op.drop_constraint("continuum_version_unique", "continuum_version", type_="unique")
    op.drop_index("continuum_version_active_idx", table_name="continuum_version")
    op.drop_index("continuum_version_continuum_idx", table_name="continuum_version")
    op.drop_index("continuum_version_org_idx", table_name="continuum_version")
    op.drop_table("continuum_version")

    op.drop_index("continuum_next_run_idx", table_name="continuum")
    op.drop_index("continuum_status_idx", table_name="continuum")
    op.drop_index("continuum_org_idx", table_name="continuum")
    op.drop_table("continuum")
