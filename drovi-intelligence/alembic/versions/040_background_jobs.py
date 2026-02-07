"""Durable background jobs queue.

Revision ID: 040_background_jobs
Revises: 039_add_entity_versions
Create Date: 2026-02-06

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "040_background_jobs"
down_revision: Union[str, None] = "039_add_entity_versions"
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
        "background_job",
        sa.Column("id", sa.Text, primary_key=True),
        sa.Column("organization_id", sa.Text, nullable=False),
        sa.Column("job_type", sa.Text, nullable=False),
        sa.Column("status", sa.Text, nullable=False),  # queued, running, succeeded, failed, cancelled
        sa.Column("priority", sa.Integer, nullable=False, server_default="0"),
        sa.Column("run_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("resource_key", sa.Text, nullable=True),
        sa.Column("attempts", sa.Integer, nullable=False, server_default="0"),
        sa.Column("max_attempts", sa.Integer, nullable=False, server_default="5"),
        sa.Column("lease_until", sa.DateTime(timezone=True), nullable=True),
        sa.Column("locked_by", sa.Text, nullable=True),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("idempotency_key", sa.Text, nullable=True),
        sa.Column("payload", sa.JSON, nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column("result", sa.JSON, nullable=True),
        sa.Column("last_error", sa.Text, nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )

    op.create_index(
        "background_job_status_run_idx",
        "background_job",
        ["status", "run_at"],
    )
    op.create_index(
        "background_job_org_idx",
        "background_job",
        ["organization_id"],
    )
    op.create_index(
        "background_job_type_idx",
        "background_job",
        ["job_type"],
    )
    op.create_index(
        "background_job_resource_idx",
        "background_job",
        ["resource_key"],
    )
    op.create_index(
        "background_job_lease_idx",
        "background_job",
        ["lease_until"],
    )

    # Uniqueness for idempotency keys (Postgres allows multiple NULLs).
    op.create_unique_constraint(
        "background_job_org_idempotency_uq",
        "background_job",
        ["organization_id", "idempotency_key"],
    )

    _enable_rls("background_job", "organization_id")


def downgrade() -> None:
    op.drop_constraint("background_job_org_idempotency_uq", "background_job", type_="unique")
    op.drop_index("background_job_lease_idx", table_name="background_job")
    op.drop_index("background_job_resource_idx", table_name="background_job")
    op.drop_index("background_job_type_idx", table_name="background_job")
    op.drop_index("background_job_org_idx", table_name="background_job")
    op.drop_index("background_job_status_run_idx", table_name="background_job")
    op.drop_table("background_job")
