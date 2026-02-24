"""Add derivation rule table for memory evolution.

Revision ID: 066_derivation_rule
Revises: 065_intelligence_prediction
Create Date: 2026-02-21
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


# revision identifiers, used by Alembic.
revision: str = "066_derivation_rule"
down_revision: Union[str, None] = "065_intelligence_prediction"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "derivation_rule",
        sa.Column("id", sa.Text(), primary_key=True, nullable=False),
        sa.Column(
            "organization_id",
            sa.Text(),
            sa.ForeignKey("organizations.id", ondelete="CASCADE"),
            nullable=True,
        ),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("input_pattern", sa.Text(), nullable=False),
        sa.Column("output_entity_type", sa.Text(), nullable=False),
        sa.Column(
            "output_template",
            sa.dialects.postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
        ),
        sa.Column("confidence_multiplier", sa.Float(), nullable=False, server_default="0.8"),
        sa.Column("domain", sa.Text(), nullable=True),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("times_matched", sa.Float(), nullable=False, server_default="0"),
        sa.Column("last_matched_at", sa.DateTime(timezone=True), nullable=True),
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
    op.create_index("derivation_rule_org_idx", "derivation_rule", ["organization_id"])
    op.create_index("derivation_rule_active_idx", "derivation_rule", ["is_active"])
    op.create_index("derivation_rule_domain_idx", "derivation_rule", ["domain"])

    op.execute("ALTER TABLE derivation_rule ENABLE ROW LEVEL SECURITY;")
    op.execute("ALTER TABLE derivation_rule FORCE ROW LEVEL SECURITY;")
    op.execute("DROP POLICY IF EXISTS derivation_rule_org_isolation ON derivation_rule;")
    op.execute(
        """
        CREATE POLICY derivation_rule_org_isolation ON derivation_rule
            USING (
                current_setting('app.is_internal', true) = 'true'
                OR organization_id IS NULL
                OR organization_id::text = current_setting('app.organization_id', true)
            )
            WITH CHECK (
                current_setting('app.is_internal', true) = 'true'
                OR organization_id IS NULL
                OR organization_id::text = current_setting('app.organization_id', true)
            );
        """
    )


def downgrade() -> None:
    op.drop_index("derivation_rule_domain_idx", table_name="derivation_rule")
    op.drop_index("derivation_rule_active_idx", table_name="derivation_rule")
    op.drop_index("derivation_rule_org_idx", table_name="derivation_rule")
    op.drop_table("derivation_rule")
