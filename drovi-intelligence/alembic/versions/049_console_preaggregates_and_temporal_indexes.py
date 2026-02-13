"""Console pre-aggregates + bi-temporal range indexes.

Revision ID: 049_console_preaggregates_and_temporal_indexes
Revises: 048_outbox_event
Create Date: 2026-02-12
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "049_console_preaggregates_and_temporal_indexes"
down_revision: Union[str, None] = "048_outbox_event"
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
                         USING (
                            current_setting(''app.is_internal'', true) = ''true''
                            OR {column} = current_setting(''app.organization_id'', true)
                         )';
            END IF;
        EXCEPTION
            WHEN undefined_table THEN
                RAISE NOTICE 'Table {table} does not exist, skipping RLS';
        END
        $$;
        """
    )


def upgrade() -> None:
    # Required for combined GiST index (organization_id + tstzrange).
    op.execute("CREATE EXTENSION IF NOT EXISTS btree_gist")

    # Bi-temporal range modeling on UIO truth spine.
    op.execute(
        """
        ALTER TABLE unified_intelligence_object
        ADD COLUMN IF NOT EXISTS valid_range tstzrange
        GENERATED ALWAYS AS (
            tstzrange(valid_from, COALESCE(valid_to, 'infinity'::timestamptz), '[)')
        ) STORED
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS uio_org_valid_range_gist_idx
        ON unified_intelligence_object
        USING GIST (organization_id, valid_range)
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS uio_org_created_id_idx
        ON unified_intelligence_object (organization_id, created_at DESC, id DESC)
        """
    )

    # Keyset pagination indexes for pilot/admin hot lists.
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS document_org_created_id_idx
        ON document (organization_id, created_at DESC, id DESC)
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS support_ticket_updated_id_idx
        ON support_ticket (updated_at DESC, id DESC)
        """
    )

    # Console pre-aggregates for low-latency admin/console metrics.
    op.create_table(
        "console_org_metrics",
        sa.Column("organization_id", sa.Text, primary_key=True),
        sa.Column("total_count", sa.Integer, nullable=False, server_default="0"),
        sa.Column("active_count", sa.Integer, nullable=False, server_default="0"),
        sa.Column("at_risk_count", sa.Integer, nullable=False, server_default="0"),
        sa.Column("overdue_count", sa.Integer, nullable=False, server_default="0"),
        sa.Column("avg_confidence", sa.Float, nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_table(
        "console_org_histogram_hour",
        sa.Column("organization_id", sa.Text, nullable=False),
        sa.Column("bucket", sa.DateTime(timezone=True), nullable=False),
        sa.Column("count", sa.Integer, nullable=False, server_default="0"),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.PrimaryKeyConstraint("organization_id", "bucket", name="console_org_histogram_hour_pk"),
    )
    op.create_index(
        "console_org_histogram_hour_updated_idx",
        "console_org_histogram_hour",
        ["updated_at"],
    )

    _enable_rls("console_org_metrics", "organization_id")
    _enable_rls("console_org_histogram_hour", "organization_id")


def downgrade() -> None:
    op.execute(
        """
        DO $$
        BEGIN
            EXECUTE 'DROP POLICY IF EXISTS console_org_metrics_org_isolation ON console_org_metrics';
            EXECUTE 'ALTER TABLE console_org_metrics NO FORCE ROW LEVEL SECURITY';
            EXECUTE 'ALTER TABLE console_org_metrics DISABLE ROW LEVEL SECURITY';
            EXECUTE 'DROP POLICY IF EXISTS console_org_histogram_hour_org_isolation ON console_org_histogram_hour';
            EXECUTE 'ALTER TABLE console_org_histogram_hour NO FORCE ROW LEVEL SECURITY';
            EXECUTE 'ALTER TABLE console_org_histogram_hour DISABLE ROW LEVEL SECURITY';
        EXCEPTION
            WHEN undefined_table THEN
                RAISE NOTICE 'RLS teardown skipped for missing tables';
        END
        $$;
        """
    )

    op.drop_index("console_org_histogram_hour_updated_idx", table_name="console_org_histogram_hour")
    op.drop_table("console_org_histogram_hour")
    op.drop_table("console_org_metrics")

    op.execute("DROP INDEX IF EXISTS support_ticket_updated_id_idx")
    op.execute("DROP INDEX IF EXISTS document_org_created_id_idx")
    op.execute("DROP INDEX IF EXISTS uio_org_created_id_idx")
    op.execute("DROP INDEX IF EXISTS uio_org_valid_range_gist_idx")
    op.execute("ALTER TABLE unified_intelligence_object DROP COLUMN IF EXISTS valid_range")
