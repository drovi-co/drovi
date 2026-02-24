"""Lakehouse platform control-plane tables.

Revision ID: 070_lakehouse_platform
Revises: 069_world_crawl_fabric
Create Date: 2026-02-23
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB


# revision identifiers, used by Alembic.
revision: str = "070_lakehouse_platform"
down_revision: Union[str, None] = "069_world_crawl_fabric"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _enable_rls(table: str, column: str = "organization_id") -> None:
    policy_name = f"{table}_org_isolation"
    op.execute(f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY;")
    op.execute(f"ALTER TABLE {table} FORCE ROW LEVEL SECURITY;")
    op.execute(f"DROP POLICY IF EXISTS {policy_name} ON {table};")
    op.execute(
        f"""
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
        "lakehouse_checkpoint",
        sa.Column("id", sa.Text(), primary_key=True, nullable=False),
        sa.Column(
            "organization_id",
            sa.Text(),
            sa.ForeignKey("organizations.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("checkpoint_key", sa.Text(), nullable=False),
        sa.Column("cursor", JSONB(astext_type=sa.Text()), nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column("metadata", JSONB(astext_type=sa.Text()), nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint(
            "organization_id",
            "checkpoint_key",
            name="lakehouse_checkpoint_org_key_unique",
        ),
    )
    op.create_index("lakehouse_checkpoint_org_idx", "lakehouse_checkpoint", ["organization_id"])
    op.create_index("lakehouse_checkpoint_key_idx", "lakehouse_checkpoint", ["checkpoint_key"])

    op.create_table(
        "lakehouse_partition",
        sa.Column("id", sa.Text(), primary_key=True, nullable=False),
        sa.Column(
            "organization_id",
            sa.Text(),
            sa.ForeignKey("organizations.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("layer", sa.Text(), nullable=False),
        sa.Column("table_name", sa.Text(), nullable=False),
        sa.Column("partition_key", sa.Text(), nullable=False),
        sa.Column("partition_path", sa.Text(), nullable=False),
        sa.Column("table_format", sa.Text(), nullable=False, server_default="iceberg"),
        sa.Column("schema_version", sa.Text(), nullable=False, server_default="1.0"),
        sa.Column("row_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("bytes_written", sa.BigInteger(), nullable=False, server_default="0"),
        sa.Column("first_event_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_event_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("quality_status", sa.Text(), nullable=False, server_default="pending"),
        sa.Column(
            "quality_report",
            JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default=sa.text("'{}'::jsonb"),
        ),
        sa.Column("retention_until", sa.DateTime(timezone=True), nullable=True),
        sa.Column("metadata", JSONB(astext_type=sa.Text()), nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint(
            "organization_id",
            "table_name",
            "partition_key",
            name="lakehouse_partition_org_table_key_unique",
        ),
    )
    op.create_index("lakehouse_partition_org_idx", "lakehouse_partition", ["organization_id"])
    op.create_index("lakehouse_partition_table_idx", "lakehouse_partition", ["table_name"])
    op.create_index("lakehouse_partition_quality_idx", "lakehouse_partition", ["quality_status"])

    op.create_table(
        "lakehouse_cost_attribution",
        sa.Column("id", sa.Text(), primary_key=True, nullable=False),
        sa.Column(
            "organization_id",
            sa.Text(),
            sa.ForeignKey("organizations.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("source_key", sa.Text(), nullable=False),
        sa.Column("table_name", sa.Text(), nullable=False),
        sa.Column("partition_key", sa.Text(), nullable=False),
        sa.Column("records_written", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("bytes_written", sa.BigInteger(), nullable=False, server_default="0"),
        sa.Column("compute_millis", sa.BigInteger(), nullable=False, server_default="0"),
        sa.Column("cost_units", sa.Float(), nullable=False, server_default="0"),
        sa.Column("period_start", sa.DateTime(timezone=True), nullable=False),
        sa.Column("period_end", sa.DateTime(timezone=True), nullable=False),
        sa.Column("metadata", JSONB(astext_type=sa.Text()), nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_index(
        "lakehouse_cost_attribution_org_idx",
        "lakehouse_cost_attribution",
        ["organization_id"],
    )
    op.create_index(
        "lakehouse_cost_attribution_source_idx",
        "lakehouse_cost_attribution",
        ["source_key"],
    )
    op.create_index(
        "lakehouse_cost_attribution_period_idx",
        "lakehouse_cost_attribution",
        ["period_start", "period_end"],
    )

    _enable_rls("lakehouse_checkpoint")
    _enable_rls("lakehouse_partition")
    _enable_rls("lakehouse_cost_attribution")


def downgrade() -> None:
    op.drop_index("lakehouse_cost_attribution_period_idx", table_name="lakehouse_cost_attribution")
    op.drop_index("lakehouse_cost_attribution_source_idx", table_name="lakehouse_cost_attribution")
    op.drop_index("lakehouse_cost_attribution_org_idx", table_name="lakehouse_cost_attribution")
    op.drop_table("lakehouse_cost_attribution")

    op.drop_index("lakehouse_partition_quality_idx", table_name="lakehouse_partition")
    op.drop_index("lakehouse_partition_table_idx", table_name="lakehouse_partition")
    op.drop_index("lakehouse_partition_org_idx", table_name="lakehouse_partition")
    op.drop_table("lakehouse_partition")

    op.drop_index("lakehouse_checkpoint_key_idx", table_name="lakehouse_checkpoint")
    op.drop_index("lakehouse_checkpoint_org_idx", table_name="lakehouse_checkpoint")
    op.drop_table("lakehouse_checkpoint")
