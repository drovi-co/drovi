"""World crawl fabric persistence schema.

Revision ID: 069_world_crawl_fabric
Revises: 068_source_sync_run_ledger
Create Date: 2026-02-23
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB


# revision identifiers, used by Alembic.
revision: str = "069_world_crawl_fabric"
down_revision: Union[str, None] = "068_source_sync_run_ledger"
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
        "crawl_frontier_entry",
        sa.Column("id", sa.Text(), primary_key=True, nullable=False),
        sa.Column(
            "organization_id",
            sa.Text(),
            sa.ForeignKey("organizations.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("source_key", sa.Text(), nullable=False),
        sa.Column("seed_type", sa.Text(), nullable=False, server_default="manual"),
        sa.Column("url", sa.Text(), nullable=False),
        sa.Column("normalized_url", sa.Text(), nullable=False),
        sa.Column("domain", sa.Text(), nullable=False),
        sa.Column("priority", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("freshness_policy_minutes", sa.Integer(), nullable=False, server_default="60"),
        sa.Column("next_fetch_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("last_fetch_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("status", sa.Text(), nullable=False, server_default="queued"),
        sa.Column("fetch_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("failure_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("last_http_status", sa.Integer(), nullable=True),
        sa.Column("last_error", sa.Text(), nullable=True),
        sa.Column("policy_state", sa.Text(), nullable=False, server_default="allowed"),
        sa.Column("legal_hold", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("takedown", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("metadata", JSONB(astext_type=sa.Text()), nullable=False, server_default=sa.text("'{}'::jsonb")),
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
        sa.UniqueConstraint(
            "organization_id",
            "normalized_url",
            name="crawl_frontier_org_url_unique",
        ),
    )
    op.create_index(
        "crawl_frontier_entry_org_idx",
        "crawl_frontier_entry",
        ["organization_id"],
    )
    op.create_index(
        "crawl_frontier_entry_domain_status_fetch_idx",
        "crawl_frontier_entry",
        ["domain", "status", "next_fetch_at"],
    )
    op.create_index(
        "crawl_frontier_entry_next_fetch_idx",
        "crawl_frontier_entry",
        ["next_fetch_at"],
    )
    op.create_index(
        "crawl_frontier_entry_priority_idx",
        "crawl_frontier_entry",
        ["priority"],
    )

    op.create_table(
        "crawl_policy_rule",
        sa.Column("id", sa.Text(), primary_key=True, nullable=False),
        sa.Column(
            "organization_id",
            sa.Text(),
            sa.ForeignKey("organizations.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("rule_type", sa.Text(), nullable=False),
        sa.Column("scope", sa.Text(), nullable=False),
        sa.Column("action", sa.Text(), nullable=False),
        sa.Column("reason", sa.Text(), nullable=True),
        sa.Column("active", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("created_by", sa.Text(), nullable=True),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("metadata", JSONB(astext_type=sa.Text()), nullable=False, server_default=sa.text("'{}'::jsonb")),
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
        sa.UniqueConstraint(
            "organization_id",
            "rule_type",
            "scope",
            name="crawl_policy_rule_org_type_scope_unique",
        ),
    )
    op.create_index("crawl_policy_rule_org_idx", "crawl_policy_rule", ["organization_id"])
    op.create_index("crawl_policy_rule_active_idx", "crawl_policy_rule", ["active"])
    op.create_index("crawl_policy_rule_scope_idx", "crawl_policy_rule", ["scope"])

    op.create_table(
        "crawl_snapshot",
        sa.Column("id", sa.Text(), primary_key=True, nullable=False),
        sa.Column(
            "organization_id",
            sa.Text(),
            sa.ForeignKey("organizations.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "frontier_entry_id",
            sa.Text(),
            sa.ForeignKey("crawl_frontier_entry.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("url", sa.Text(), nullable=False),
        sa.Column("content_type", sa.Text(), nullable=True),
        sa.Column("http_status", sa.Integer(), nullable=True),
        sa.Column("fetched_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("rendered", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("payload_hash", sa.Text(), nullable=False),
        sa.Column("payload_size_bytes", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("storage_ref", sa.Text(), nullable=True),
        sa.Column("parsed_text", sa.Text(), nullable=True),
        sa.Column("parsed_metadata", JSONB(astext_type=sa.Text()), nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column(
            "diff_from_snapshot_id",
            sa.Text(),
            sa.ForeignKey("crawl_snapshot.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("significance_score", sa.Float(), nullable=True),
        sa.Column("is_meaningful_delta", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
    )
    op.create_index("crawl_snapshot_org_idx", "crawl_snapshot", ["organization_id"])
    op.create_index("crawl_snapshot_frontier_idx", "crawl_snapshot", ["frontier_entry_id"])
    op.create_index("crawl_snapshot_payload_hash_idx", "crawl_snapshot", ["payload_hash"])
    op.create_index("crawl_snapshot_fetched_at_idx", "crawl_snapshot", ["fetched_at"])

    op.create_table(
        "crawl_audit_log",
        sa.Column("id", sa.Text(), primary_key=True, nullable=False),
        sa.Column(
            "organization_id",
            sa.Text(),
            sa.ForeignKey("organizations.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "frontier_entry_id",
            sa.Text(),
            sa.ForeignKey("crawl_frontier_entry.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "snapshot_id",
            sa.Text(),
            sa.ForeignKey("crawl_snapshot.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("event_type", sa.Text(), nullable=False),
        sa.Column("severity", sa.Text(), nullable=False, server_default="info"),
        sa.Column("decision", sa.Text(), nullable=True),
        sa.Column("reason", sa.Text(), nullable=True),
        sa.Column("actor", sa.Text(), nullable=True),
        sa.Column("metadata", JSONB(astext_type=sa.Text()), nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column(
            "occurred_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
    )
    op.create_index("crawl_audit_log_org_idx", "crawl_audit_log", ["organization_id"])
    op.create_index("crawl_audit_log_event_idx", "crawl_audit_log", ["event_type"])
    op.create_index("crawl_audit_log_occurred_idx", "crawl_audit_log", ["occurred_at"])

    _enable_rls("crawl_frontier_entry")
    _enable_rls("crawl_policy_rule")
    _enable_rls("crawl_snapshot")
    _enable_rls("crawl_audit_log")


def downgrade() -> None:
    op.drop_index("crawl_audit_log_occurred_idx", table_name="crawl_audit_log")
    op.drop_index("crawl_audit_log_event_idx", table_name="crawl_audit_log")
    op.drop_index("crawl_audit_log_org_idx", table_name="crawl_audit_log")
    op.drop_table("crawl_audit_log")

    op.drop_index("crawl_snapshot_fetched_at_idx", table_name="crawl_snapshot")
    op.drop_index("crawl_snapshot_payload_hash_idx", table_name="crawl_snapshot")
    op.drop_index("crawl_snapshot_frontier_idx", table_name="crawl_snapshot")
    op.drop_index("crawl_snapshot_org_idx", table_name="crawl_snapshot")
    op.drop_table("crawl_snapshot")

    op.drop_index("crawl_policy_rule_scope_idx", table_name="crawl_policy_rule")
    op.drop_index("crawl_policy_rule_active_idx", table_name="crawl_policy_rule")
    op.drop_index("crawl_policy_rule_org_idx", table_name="crawl_policy_rule")
    op.drop_table("crawl_policy_rule")

    op.drop_index("crawl_frontier_entry_priority_idx", table_name="crawl_frontier_entry")
    op.drop_index("crawl_frontier_entry_next_fetch_idx", table_name="crawl_frontier_entry")
    op.drop_index("crawl_frontier_entry_domain_status_fetch_idx", table_name="crawl_frontier_entry")
    op.drop_index("crawl_frontier_entry_org_idx", table_name="crawl_frontier_entry")
    op.drop_table("crawl_frontier_entry")
