"""Continuum Exchange persistence.

Revision ID: 035_continuum_exchange
Revises: 034_simulation_engine
Create Date: 2026-02-04

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "035_continuum_exchange"
down_revision: Union[str, None] = "034_simulation_engine"
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
        "continuum_bundle",
        sa.Column("id", sa.Text, primary_key=True),
        sa.Column("organization_id", sa.Text, nullable=False),
        sa.Column("name", sa.Text, nullable=False),
        sa.Column("description", sa.Text, nullable=True),
        sa.Column("created_by", sa.Text, nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("continuum_bundle_org_idx", "continuum_bundle", ["organization_id"])

    op.create_table(
        "continuum_bundle_version",
        sa.Column("id", sa.Text, primary_key=True),
        sa.Column("bundle_id", sa.Text, sa.ForeignKey("continuum_bundle.id", ondelete="CASCADE"), nullable=False),
        sa.Column("organization_id", sa.Text, nullable=False),
        sa.Column("version", sa.Text, nullable=False),
        sa.Column("manifest", sa.JSON, nullable=False),
        sa.Column("signature", sa.Text, nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("continuum_bundle_version_bundle_idx", "continuum_bundle_version", ["bundle_id"])
    op.create_index("continuum_bundle_version_org_idx", "continuum_bundle_version", ["organization_id"])

    op.create_table(
        "continuum_bundle_installation",
        sa.Column("id", sa.Text, primary_key=True),
        sa.Column("bundle_id", sa.Text, nullable=False),
        sa.Column("bundle_version_id", sa.Text, nullable=False),
        sa.Column("organization_id", sa.Text, nullable=False),
        sa.Column("continuum_id", sa.Text, nullable=False),
        sa.Column("installed_by", sa.Text, nullable=True),
        sa.Column("installed_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("continuum_bundle_install_org_idx", "continuum_bundle_installation", ["organization_id"])
    op.create_index("continuum_bundle_install_bundle_idx", "continuum_bundle_installation", ["bundle_id"])

    _enable_rls("continuum_bundle", "organization_id")
    _enable_rls("continuum_bundle_version", "organization_id")
    _enable_rls("continuum_bundle_installation", "organization_id")


def downgrade() -> None:
    op.drop_index("continuum_bundle_install_bundle_idx", table_name="continuum_bundle_installation")
    op.drop_index("continuum_bundle_install_org_idx", table_name="continuum_bundle_installation")
    op.drop_table("continuum_bundle_installation")

    op.drop_index("continuum_bundle_version_org_idx", table_name="continuum_bundle_version")
    op.drop_index("continuum_bundle_version_bundle_idx", table_name="continuum_bundle_version")
    op.drop_table("continuum_bundle_version")

    op.drop_index("continuum_bundle_org_idx", table_name="continuum_bundle")
    op.drop_table("continuum_bundle")
