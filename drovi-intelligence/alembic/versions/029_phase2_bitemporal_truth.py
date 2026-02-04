"""Phase 2 bi-temporal truth + contradictions + evidence hash chains.

Revision ID: 029_phase2_bitemporal_truth
Revises: 028_add_sensor_permission_table
Create Date: 2026-02-04

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "029_phase2_bitemporal_truth"
down_revision: Union[str, None] = "028_add_sensor_permission_table"
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
    op.add_column(
        "unified_intelligence_object",
        sa.Column(
            "belief_state",
            sa.Text,
            nullable=False,
            server_default="asserted",
        ),
    )
    op.add_column(
        "unified_intelligence_object",
        sa.Column(
            "truth_state",
            sa.Text,
            nullable=False,
            server_default="unknown",
        ),
    )
    op.add_column(
        "unified_intelligence_object",
        sa.Column(
            "last_update_reason",
            sa.Text,
            nullable=True,
        ),
    )

    op.create_index(
        "uio_belief_state_idx",
        "unified_intelligence_object",
        ["belief_state"],
    )
    op.create_index(
        "uio_truth_state_idx",
        "unified_intelligence_object",
        ["truth_state"],
    )

    op.add_column(
        "unified_object_timeline",
        sa.Column("event_reason", sa.Text, nullable=True),
    )

    op.create_table(
        "uio_contradiction",
        sa.Column("id", sa.Text, primary_key=True),
        sa.Column("organization_id", sa.Text, nullable=False),
        sa.Column(
            "uio_a_id",
            sa.Text,
            sa.ForeignKey("unified_intelligence_object.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "uio_b_id",
            sa.Text,
            sa.ForeignKey("unified_intelligence_object.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("contradiction_type", sa.Text, nullable=False),
        sa.Column("severity", sa.Text, nullable=False, server_default="medium"),
        sa.Column("status", sa.Text, nullable=False, server_default="open"),
        sa.Column("evidence_quote", sa.Text, nullable=True),
        sa.Column("evidence_artifact_id", sa.Text, nullable=True),
        sa.Column("detected_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("resolved_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("resolution_reason", sa.Text, nullable=True),
        sa.Column("resolved_by", sa.Text, nullable=True),
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

    op.create_index("uio_contradiction_org_idx", "uio_contradiction", ["organization_id"])
    op.create_index("uio_contradiction_status_idx", "uio_contradiction", ["status"])
    op.create_index("uio_contradiction_uio_a_idx", "uio_contradiction", ["uio_a_id"])
    op.create_index("uio_contradiction_uio_b_idx", "uio_contradiction", ["uio_b_id"])
    op.create_unique_constraint(
        "uio_contradiction_pair_unique",
        "uio_contradiction",
        ["uio_a_id", "uio_b_id"],
    )

    op.add_column(
        "evidence_artifact",
        sa.Column("chain_id", sa.Text, nullable=True),
    )
    op.add_column(
        "evidence_artifact",
        sa.Column("chain_sequence", sa.Integer, nullable=True),
    )
    op.add_column(
        "evidence_artifact",
        sa.Column("chain_prev_hash", sa.Text, nullable=True),
    )
    op.add_column(
        "evidence_artifact",
        sa.Column("chain_hash", sa.Text, nullable=True),
    )
    op.create_index("evidence_chain_id_idx", "evidence_artifact", ["chain_id"])
    op.create_index("evidence_chain_sequence_idx", "evidence_artifact", ["chain_sequence"])

    _enable_rls("uio_contradiction", "organization_id")


def downgrade() -> None:
    op.execute(
        """
        DO $$
        BEGIN
            EXECUTE 'DROP POLICY IF EXISTS uio_contradiction_org_isolation ON uio_contradiction';
            EXECUTE 'ALTER TABLE uio_contradiction NO FORCE ROW LEVEL SECURITY';
            EXECUTE 'ALTER TABLE uio_contradiction DISABLE ROW LEVEL SECURITY';
        EXCEPTION
            WHEN undefined_table THEN
                RAISE NOTICE 'Table uio_contradiction does not exist, skipping RLS disable';
        END
        $$;
        """
    )

    op.drop_index("evidence_chain_sequence_idx", table_name="evidence_artifact")
    op.drop_index("evidence_chain_id_idx", table_name="evidence_artifact")
    op.drop_column("evidence_artifact", "chain_hash")
    op.drop_column("evidence_artifact", "chain_prev_hash")
    op.drop_column("evidence_artifact", "chain_sequence")
    op.drop_column("evidence_artifact", "chain_id")

    op.drop_constraint("uio_contradiction_pair_unique", "uio_contradiction", type_="unique")
    op.drop_index("uio_contradiction_uio_b_idx", table_name="uio_contradiction")
    op.drop_index("uio_contradiction_uio_a_idx", table_name="uio_contradiction")
    op.drop_index("uio_contradiction_status_idx", table_name="uio_contradiction")
    op.drop_index("uio_contradiction_org_idx", table_name="uio_contradiction")
    op.drop_table("uio_contradiction")

    op.drop_column("unified_object_timeline", "event_reason")

    op.drop_index("uio_truth_state_idx", table_name="unified_intelligence_object")
    op.drop_index("uio_belief_state_idx", table_name="unified_intelligence_object")
    op.drop_column("unified_intelligence_object", "last_update_reason")
    op.drop_column("unified_intelligence_object", "truth_state")
    op.drop_column("unified_intelligence_object", "belief_state")
