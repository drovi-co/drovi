"""Add intelligence prediction table for calibration.

Revision ID: 065_intelligence_prediction
Revises: 064_blindspot_feedback
Create Date: 2026-02-21
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


# revision identifiers, used by Alembic.
revision: str = "065_intelligence_prediction"
down_revision: Union[str, None] = "064_blindspot_feedback"
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
        "intelligence_prediction",
        sa.Column("id", sa.Text(), primary_key=True, nullable=False),
        sa.Column(
            "organization_id",
            sa.Text(),
            sa.ForeignKey("organizations.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("uio_id", sa.Text(), nullable=True),
        sa.Column("prediction_type", sa.Text(), nullable=False),
        sa.Column(
            "predicted_outcome",
            sa.dialects.postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
        ),
        sa.Column("confidence", sa.Float(), nullable=False),
        sa.Column("predicted_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("evaluate_by", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "actual_outcome",
            sa.dialects.postgresql.JSONB(astext_type=sa.Text()),
            nullable=True,
        ),
        sa.Column("outcome_status", sa.Text(), nullable=False, server_default="pending"),
        sa.Column("outcome_recorded_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("outcome_source", sa.Text(), nullable=True),
        sa.Column("calibration_error", sa.Float(), nullable=True),
        sa.Column("brier_score", sa.Float(), nullable=True),
        sa.Column("model_used", sa.Text(), nullable=True),
        sa.Column(
            "extraction_context",
            sa.dialects.postgresql.JSONB(astext_type=sa.Text()),
            nullable=True,
        ),
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
    op.create_index(
        "prediction_org_idx",
        "intelligence_prediction",
        ["organization_id"],
    )
    op.create_index(
        "prediction_type_idx",
        "intelligence_prediction",
        ["prediction_type"],
    )
    op.create_index(
        "prediction_status_idx",
        "intelligence_prediction",
        ["outcome_status"],
    )
    op.create_index(
        "prediction_uio_idx",
        "intelligence_prediction",
        ["uio_id"],
    )
    op.create_index(
        "prediction_evaluate_by_idx",
        "intelligence_prediction",
        ["evaluate_by"],
    )
    op.create_index(
        "prediction_org_type_status_idx",
        "intelligence_prediction",
        ["organization_id", "prediction_type", "outcome_status"],
    )
    _enable_rls("intelligence_prediction")


def downgrade() -> None:
    op.drop_index(
        "prediction_org_type_status_idx",
        table_name="intelligence_prediction",
    )
    op.drop_index(
        "prediction_evaluate_by_idx",
        table_name="intelligence_prediction",
    )
    op.drop_index(
        "prediction_uio_idx",
        table_name="intelligence_prediction",
    )
    op.drop_index(
        "prediction_status_idx",
        table_name="intelligence_prediction",
    )
    op.drop_index(
        "prediction_type_idx",
        table_name="intelligence_prediction",
    )
    op.drop_index(
        "prediction_org_idx",
        table_name="intelligence_prediction",
    )
    op.drop_table("intelligence_prediction")
