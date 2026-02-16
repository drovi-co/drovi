"""Continuum migration tracking and shadow validation tables.

Revision ID: 057_continuum_migration_decommission
Revises: 056_agentos_quality_optimization
Create Date: 2026-02-14
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "057_continuum_migration_decommission"
down_revision: Union[str, None] = "056_agentos_quality_optimization"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _jsonb_default() -> sa.TextClause:
    return sa.text("'{}'::jsonb")


def _utc_now() -> sa.TextClause:
    return sa.text("NOW()")


def upgrade() -> None:
    op.create_table(
        "continuum_agent_migration",
        sa.Column("id", sa.Text(), nullable=False),
        sa.Column("organization_id", sa.Text(), nullable=False),
        sa.Column("continuum_id", sa.Text(), nullable=False),
        sa.Column("continuum_version", sa.Integer(), nullable=False),
        sa.Column("mode", sa.Text(), nullable=False, server_default=sa.text("'dry_run'")),
        sa.Column("migration_status", sa.Text(), nullable=False, server_default=sa.text("'completed'")),
        sa.Column("equivalence_score", sa.Float(), nullable=False, server_default=sa.text("0")),
        sa.Column(
            "equivalence_report",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default=_jsonb_default(),
        ),
        sa.Column("role_id", sa.Text(), nullable=True),
        sa.Column("profile_id", sa.Text(), nullable=True),
        sa.Column("playbook_id", sa.Text(), nullable=True),
        sa.Column("deployment_id", sa.Text(), nullable=True),
        sa.Column("trigger_id", sa.Text(), nullable=True),
        sa.Column("migrated_by_user_id", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=_utc_now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=_utc_now()),
        sa.CheckConstraint("mode IN ('dry_run', 'applied')", name="continuum_agent_migration_mode_check"),
        sa.CheckConstraint(
            "migration_status IN ('completed', 'failed', 'skipped')",
            name="continuum_agent_migration_status_check",
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "organization_id",
            "continuum_id",
            "continuum_version",
            "mode",
            name="continuum_agent_migration_org_continuum_version_mode_key",
        ),
    )
    op.create_index(
        "continuum_agent_migration_org_created_idx",
        "continuum_agent_migration",
        ["organization_id", "created_at"],
        unique=False,
    )
    op.create_index(
        "continuum_agent_migration_org_continuum_idx",
        "continuum_agent_migration",
        ["organization_id", "continuum_id"],
        unique=False,
    )
    op.create_index(
        "continuum_agent_migration_deployment_idx",
        "continuum_agent_migration",
        ["deployment_id"],
        unique=False,
    )

    op.create_table(
        "continuum_shadow_validation",
        sa.Column("id", sa.Text(), nullable=False),
        sa.Column("organization_id", sa.Text(), nullable=False),
        sa.Column("continuum_id", sa.Text(), nullable=False),
        sa.Column("migration_id", sa.Text(), nullable=True),
        sa.Column("window_start", sa.DateTime(timezone=True), nullable=False),
        sa.Column("window_end", sa.DateTime(timezone=True), nullable=False),
        sa.Column("continuum_run_count", sa.Integer(), nullable=False, server_default=sa.text("0")),
        sa.Column("agent_run_count", sa.Integer(), nullable=False, server_default=sa.text("0")),
        sa.Column("status_parity", sa.Float(), nullable=False, server_default=sa.text("0")),
        sa.Column("duration_parity", sa.Float(), nullable=False, server_default=sa.text("0")),
        sa.Column("score", sa.Float(), nullable=False, server_default=sa.text("0")),
        sa.Column(
            "report",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default=_jsonb_default(),
        ),
        sa.Column("created_by_user_id", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=_utc_now()),
        sa.ForeignKeyConstraint(["migration_id"], ["continuum_agent_migration.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "continuum_shadow_validation_org_created_idx",
        "continuum_shadow_validation",
        ["organization_id", "created_at"],
        unique=False,
    )
    op.create_index(
        "continuum_shadow_validation_org_continuum_idx",
        "continuum_shadow_validation",
        ["organization_id", "continuum_id"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index("continuum_shadow_validation_org_continuum_idx", table_name="continuum_shadow_validation")
    op.drop_index("continuum_shadow_validation_org_created_idx", table_name="continuum_shadow_validation")
    op.drop_table("continuum_shadow_validation")

    op.drop_index("continuum_agent_migration_deployment_idx", table_name="continuum_agent_migration")
    op.drop_index("continuum_agent_migration_org_continuum_idx", table_name="continuum_agent_migration")
    op.drop_index("continuum_agent_migration_org_created_idx", table_name="continuum_agent_migration")
    op.drop_table("continuum_agent_migration")
