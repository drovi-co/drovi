"""Create vertical extension payload + typed projection tables.

Revision ID: 050_vertical_extension_tables
Revises: 049_console_preaggregates_and_temporal_indexes
Create Date: 2026-02-12
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "050_vertical_extension_tables"
down_revision: Union[str, None] = "049_console_preaggregates_and_temporal_indexes"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "uio_extension_payload",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False, server_default=sa.text("gen_random_uuid()")),
        sa.Column("uio_id", sa.Text(), nullable=False),
        sa.Column("organization_id", sa.Text(), nullable=False),
        sa.Column("plugin_id", sa.Text(), nullable=False),
        sa.Column("type", sa.Text(), nullable=False),
        sa.Column("schema_version", sa.Text(), nullable=False, server_default=sa.text("'1.0'")),
        sa.Column("payload", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("NOW()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("NOW()")),
        sa.ForeignKeyConstraint(["uio_id"], ["unified_intelligence_object.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("uio_id", "type", name="uio_extension_payload_uio_type_key"),
    )
    op.create_index(
        "uio_extension_payload_org_type_idx",
        "uio_extension_payload",
        ["organization_id", "type"],
        unique=False,
    )

    op.create_table(
        "legal_matter",
        sa.Column("uio_id", sa.Text(), nullable=False),
        sa.Column("organization_id", sa.Text(), nullable=False),
        sa.Column("matter_code", sa.Text(), nullable=True),
        sa.Column("client_name", sa.Text(), nullable=False),
        sa.Column("practice_area", sa.Text(), nullable=True),
        sa.Column("lead_counsel", sa.Text(), nullable=True),
        sa.Column("status", sa.Text(), nullable=False, server_default=sa.text("'open'")),
        sa.Column("opened_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("closed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("risk_score", sa.Float(), nullable=True),
        sa.Column("metadata", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("NOW()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("NOW()")),
        sa.ForeignKeyConstraint(["uio_id"], ["unified_intelligence_object.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("uio_id"),
    )
    op.create_index(
        "legal_matter_org_status_idx",
        "legal_matter",
        ["organization_id", "status"],
        unique=False,
    )

    op.create_table(
        "legal_advice",
        sa.Column("uio_id", sa.Text(), nullable=False),
        sa.Column("organization_id", sa.Text(), nullable=False),
        sa.Column("matter_uio_id", sa.Text(), nullable=True),
        sa.Column("advice_text", sa.Text(), nullable=False),
        sa.Column("jurisdiction", sa.Text(), nullable=True),
        sa.Column("author_name", sa.Text(), nullable=True),
        sa.Column("supersedes_uio_id", sa.Text(), nullable=True),
        sa.Column("effective_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("confidence", sa.Float(), nullable=False, server_default=sa.text("0.5")),
        sa.Column("metadata", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("NOW()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("NOW()")),
        sa.ForeignKeyConstraint(["matter_uio_id"], ["legal_matter.uio_id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["supersedes_uio_id"], ["legal_advice.uio_id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["uio_id"], ["unified_intelligence_object.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("uio_id"),
    )
    op.create_index(
        "legal_advice_org_effective_idx",
        "legal_advice",
        ["organization_id", "effective_at"],
        unique=False,
    )

    op.create_table(
        "accounting_filing_deadline",
        sa.Column("uio_id", sa.Text(), nullable=False),
        sa.Column("organization_id", sa.Text(), nullable=False),
        sa.Column("client_name", sa.Text(), nullable=False),
        sa.Column("filing_type", sa.Text(), nullable=False),
        sa.Column("due_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("jurisdiction", sa.Text(), nullable=True),
        sa.Column("period_label", sa.Text(), nullable=True),
        sa.Column("owner_name", sa.Text(), nullable=True),
        sa.Column("status", sa.Text(), nullable=False, server_default=sa.text("'pending'")),
        sa.Column("metadata", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("NOW()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("NOW()")),
        sa.ForeignKeyConstraint(["uio_id"], ["unified_intelligence_object.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("uio_id"),
    )
    op.create_index(
        "accounting_filing_deadline_org_due_idx",
        "accounting_filing_deadline",
        ["organization_id", "due_at"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index("accounting_filing_deadline_org_due_idx", table_name="accounting_filing_deadline")
    op.drop_table("accounting_filing_deadline")

    op.drop_index("legal_advice_org_effective_idx", table_name="legal_advice")
    op.drop_table("legal_advice")

    op.drop_index("legal_matter_org_status_idx", table_name="legal_matter")
    op.drop_table("legal_matter")

    op.drop_index("uio_extension_payload_org_type_idx", table_name="uio_extension_payload")
    op.drop_table("uio_extension_payload")

