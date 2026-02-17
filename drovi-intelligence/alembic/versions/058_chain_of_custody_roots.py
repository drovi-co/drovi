"""Add chain-of-custody daily roots and evidence reason codes.

Revision ID: 058_chain_of_custody_roots
Revises: 057_continuum_migration_decommission
Create Date: 2026-02-17
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

# revision identifiers, used by Alembic.
revision: str = "058_chain_of_custody_roots"
down_revision: Union[str, None] = "057_continuum_migration_decommission"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "evidence_audit_log",
        sa.Column("reason_code", sa.Text(), nullable=True),
    )
    op.create_index(
        "evidence_audit_reason_idx",
        "evidence_audit_log",
        ["organization_id", "reason_code"],
    )

    op.create_table(
        "custody_daily_root",
        sa.Column(
            "id",
            sa.UUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column("organization_id", sa.Text(), nullable=False),
        sa.Column("root_date", sa.Date(), nullable=False),
        sa.Column("artifact_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("event_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("leaf_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("merkle_root", sa.Text(), nullable=False),
        sa.Column("signed_root", sa.Text(), nullable=False),
        sa.Column("signature_alg", sa.Text(), nullable=False, server_default="hmac-sha256"),
        sa.Column("signature_key_id", sa.Text(), nullable=True),
        sa.Column("metadata", JSONB, nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.UniqueConstraint("organization_id", "root_date", name="custody_daily_root_org_date_uniq"),
    )
    op.create_index(
        "custody_daily_root_org_idx",
        "custody_daily_root",
        ["organization_id", "root_date"],
    )


def downgrade() -> None:
    op.drop_index("custody_daily_root_org_idx", table_name="custody_daily_root")
    op.drop_table("custody_daily_root")

    op.drop_index("evidence_audit_reason_idx", table_name="evidence_audit_log")
    op.drop_column("evidence_audit_log", "reason_code")
