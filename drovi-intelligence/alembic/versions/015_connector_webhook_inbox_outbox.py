"""Create connector webhook inbox/outbox tables.

Revision ID: 015_connector_webhook_inbox_outbox
Revises: 014_audit_log_table
Create Date: 2026-02-02

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

# revision identifiers, used by Alembic.
revision: str = "015_connector_webhook_inbox_outbox"
down_revision: Union[str, None] = "014_audit_log_table"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "connector_webhook_inbox",
        sa.Column("id", sa.UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("provider", sa.String(length=50), nullable=False),
        sa.Column("connection_id", sa.UUID(as_uuid=True), sa.ForeignKey("connections.id", ondelete="CASCADE"), nullable=False),
        sa.Column("organization_id", sa.String(length=100), nullable=False),
        sa.Column("idempotency_key", sa.String(length=200), nullable=False, unique=True),
        sa.Column("event_type", sa.String(length=100), nullable=False),
        sa.Column("payload", JSONB, nullable=False),
        sa.Column("status", sa.String(length=20), nullable=False, server_default="pending"),
        sa.Column("attempt_count", sa.Integer, nullable=False, server_default="0"),
        sa.Column("error_message", sa.Text, nullable=True),
        sa.Column("received_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("processed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_index("connector_webhook_inbox_org_idx", "connector_webhook_inbox", ["organization_id"])
    op.create_index("connector_webhook_inbox_provider_idx", "connector_webhook_inbox", ["provider"])
    op.create_index("connector_webhook_inbox_status_idx", "connector_webhook_inbox", ["status"])

    op.create_table(
        "connector_webhook_outbox",
        sa.Column("id", sa.UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("inbox_id", sa.UUID(as_uuid=True), sa.ForeignKey("connector_webhook_inbox.id", ondelete="CASCADE"), nullable=False),
        sa.Column("provider", sa.String(length=50), nullable=False),
        sa.Column("organization_id", sa.String(length=100), nullable=False),
        sa.Column("event_type", sa.String(length=100), nullable=False),
        sa.Column("payload", JSONB, nullable=False),
        sa.Column("status", sa.String(length=20), nullable=False, server_default="pending"),
        sa.Column("attempt_count", sa.Integer, nullable=False, server_default="0"),
        sa.Column("last_attempt_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("published_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_index("connector_webhook_outbox_org_idx", "connector_webhook_outbox", ["organization_id"])
    op.create_index("connector_webhook_outbox_provider_idx", "connector_webhook_outbox", ["provider"])
    op.create_index("connector_webhook_outbox_status_idx", "connector_webhook_outbox", ["status"])

    op.execute(
        """
        DO $$
        BEGIN
            EXECUTE 'ALTER TABLE connector_webhook_inbox ENABLE ROW LEVEL SECURITY';
            EXECUTE 'ALTER TABLE connector_webhook_inbox FORCE ROW LEVEL SECURITY';
            EXECUTE 'CREATE POLICY connector_webhook_inbox_org_isolation ON connector_webhook_inbox
                     USING (
                        current_setting(''app.is_internal'', true) = ''true''
                        OR organization_id = current_setting(''app.organization_id'', true)
                     )';

            EXECUTE 'ALTER TABLE connector_webhook_outbox ENABLE ROW LEVEL SECURITY';
            EXECUTE 'ALTER TABLE connector_webhook_outbox FORCE ROW LEVEL SECURITY';
            EXECUTE 'CREATE POLICY connector_webhook_outbox_org_isolation ON connector_webhook_outbox
                     USING (
                        current_setting(''app.is_internal'', true) = ''true''
                        OR organization_id = current_setting(''app.organization_id'', true)
                     )';
        EXCEPTION
            WHEN undefined_table THEN
                RAISE NOTICE 'Connector webhook tables not found, skipping RLS';
        END
        $$;
        """
    )


def downgrade() -> None:
    op.drop_index("connector_webhook_outbox_status_idx", table_name="connector_webhook_outbox")
    op.drop_index("connector_webhook_outbox_provider_idx", table_name="connector_webhook_outbox")
    op.drop_index("connector_webhook_outbox_org_idx", table_name="connector_webhook_outbox")
    op.drop_table("connector_webhook_outbox")

    op.drop_index("connector_webhook_inbox_status_idx", table_name="connector_webhook_inbox")
    op.drop_index("connector_webhook_inbox_provider_idx", table_name="connector_webhook_inbox")
    op.drop_index("connector_webhook_inbox_org_idx", table_name="connector_webhook_inbox")
    op.drop_table("connector_webhook_inbox")
