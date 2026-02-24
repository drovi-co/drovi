"""Add source sync run ledger table for continuous ingest orchestration.

Revision ID: 068_source_sync_run_ledger
Revises: 067_world_brain_phase1_foundation
Create Date: 2026-02-22
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB, UUID


# revision identifiers, used by Alembic.
revision: str = "068_source_sync_run_ledger"
down_revision: Union[str, None] = "067_world_brain_phase1_foundation"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _enable_rls(table: str, column: str = "organization_id") -> None:
    policy_name = f"{table}_org_isolation"
    op.execute(
        f"""
        ALTER TABLE {table} ENABLE ROW LEVEL SECURITY;
        ALTER TABLE {table} FORCE ROW LEVEL SECURITY;
        DROP POLICY IF EXISTS {policy_name} ON {table};
        CREATE POLICY {policy_name} ON {table}
            USING (
                current_setting('app.is_internal', true) = 'true'
                OR {column}::text = current_setting('app.organization_id', true)
            )
            WITH CHECK (
                current_setting('app.is_internal', true) = 'true'
                OR {column}::text = current_setting('app.organization_id', true)
            );
        """
    )


def upgrade() -> None:
    op.create_table(
        "source_sync_run",
        sa.Column("id", sa.Text(), primary_key=True, nullable=False),
        sa.Column(
            "organization_id",
            sa.Text(),
            sa.ForeignKey("organizations.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "connection_id",
            UUID(as_uuid=True),
            sa.ForeignKey("connections.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("connector_type", sa.String(length=64), nullable=False),
        sa.Column("run_kind", sa.String(length=32), nullable=False, server_default="continuous"),
        sa.Column("status", sa.String(length=32), nullable=False, server_default="running"),
        sa.Column("retry_class", sa.String(length=32), nullable=True),
        sa.Column("scheduled_interval_minutes", sa.Integer(), nullable=True),
        sa.Column("freshness_lag_minutes", sa.Integer(), nullable=True),
        sa.Column("quota_headroom_ratio", sa.Float(), nullable=True),
        sa.Column("voi_priority", sa.Float(), nullable=True),
        sa.Column("records_synced", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("bytes_synced", sa.BigInteger(), nullable=False, server_default="0"),
        sa.Column("cost_units", sa.Float(), nullable=True),
        sa.Column("checkpoint_before", JSONB(astext_type=sa.Text()), nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column("checkpoint_after", JSONB(astext_type=sa.Text()), nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column("watermark_before", sa.DateTime(timezone=True), nullable=True),
        sa.Column("watermark_after", sa.DateTime(timezone=True), nullable=True),
        sa.Column("metadata", JSONB(astext_type=sa.Text()), nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("duration_seconds", sa.Integer(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
    )

    op.create_index("source_sync_run_org_idx", "source_sync_run", ["organization_id"])
    op.create_index("source_sync_run_connection_idx", "source_sync_run", ["connection_id"])
    op.create_index("source_sync_run_connector_idx", "source_sync_run", ["connector_type"])
    op.create_index("source_sync_run_status_idx", "source_sync_run", ["status"])
    op.create_index("source_sync_run_started_at_idx", "source_sync_run", ["started_at"])

    _enable_rls("source_sync_run")


def downgrade() -> None:
    op.drop_index("source_sync_run_started_at_idx", table_name="source_sync_run")
    op.drop_index("source_sync_run_status_idx", table_name="source_sync_run")
    op.drop_index("source_sync_run_connector_idx", table_name="source_sync_run")
    op.drop_index("source_sync_run_connection_idx", table_name="source_sync_run")
    op.drop_index("source_sync_run_org_idx", table_name="source_sync_run")
    op.drop_table("source_sync_run")
