"""Add evidence retention fields and audit log.

Revision ID: 012_evidence_retention_audit
Revises: 011_update_rls_policies_internal
Create Date: 2026-02-02

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

# revision identifiers, used by Alembic.
revision: str = "012_evidence_retention_audit"
down_revision: Union[str, None] = "011_update_rls_policies_internal"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("evidence_artifact", sa.Column("immutable", sa.Boolean, server_default="true"))
    op.add_column("evidence_artifact", sa.Column("legal_hold", sa.Boolean, server_default="false"))
    op.add_column("evidence_artifact", sa.Column("retention_until", sa.DateTime(timezone=True), nullable=True))
    op.add_column("evidence_artifact", sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("evidence_artifact", sa.Column("deleted_by", sa.Text, nullable=True))

    op.create_table(
        "evidence_audit_log",
        sa.Column("id", sa.UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("evidence_artifact_id", sa.Text, nullable=False),
        sa.Column("organization_id", sa.Text, nullable=False),
        sa.Column("action", sa.Text, nullable=False),
        sa.Column("actor_type", sa.Text, nullable=False),
        sa.Column("actor_id", sa.Text, nullable=True),
        sa.Column("metadata", JSONB, nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_index("evidence_audit_org_idx", "evidence_audit_log", ["organization_id"])
    op.create_index("evidence_audit_artifact_idx", "evidence_audit_log", ["evidence_artifact_id"])


def downgrade() -> None:
    op.drop_index("evidence_audit_artifact_idx", table_name="evidence_audit_log")
    op.drop_index("evidence_audit_org_idx", table_name="evidence_audit_log")
    op.drop_table("evidence_audit_log")

    op.drop_column("evidence_artifact", "deleted_by")
    op.drop_column("evidence_artifact", "deleted_at")
    op.drop_column("evidence_artifact", "retention_until")
    op.drop_column("evidence_artifact", "legal_hold")
    op.drop_column("evidence_artifact", "immutable")
