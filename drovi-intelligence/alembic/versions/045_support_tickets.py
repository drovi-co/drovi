"""Support tickets (Phase 5).

Revision ID: 045_support_tickets
Revises: 044_org_connector_policies
Create Date: 2026-02-08

Adds pilot-facing support ticketing tables used by:
- the web app "Contact support" flow
- the admin app ticket inbox
- inbound support email ingestion
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = "045_support_tickets"
down_revision: Union[str, None] = "044_org_connector_policies"
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
            EXECUTE 'DROP POLICY IF EXISTS {policy_name} ON {table}';
            EXECUTE 'CREATE POLICY {policy_name} ON {table}
                     USING (
                        current_setting(''app.is_internal'', true) = ''true''
                        OR {column} = current_setting(''app.organization_id'', true)
                     )';
        EXCEPTION
            WHEN undefined_table THEN
                RAISE NOTICE 'Table {table} does not exist, skipping RLS';
        END
        $$;
        """
    )


def upgrade() -> None:
    op.create_table(
        "support_ticket",
        sa.Column("id", sa.Text, primary_key=True),
        sa.Column("organization_id", sa.Text, nullable=False),
        sa.Column("created_by_user_id", sa.Text, nullable=True),
        sa.Column("created_by_email", sa.Text, nullable=False),
        sa.Column("subject", sa.Text, nullable=False),
        sa.Column("status", sa.Text, nullable=False, server_default="open"),
        sa.Column("priority", sa.Text, nullable=False, server_default="normal"),
        sa.Column("assignee_email", sa.Text, nullable=True),
        sa.Column("created_via", sa.Text, nullable=False, server_default="web"),
        sa.Column(
            "metadata",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default=sa.text("'{}'::jsonb"),
        ),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("last_message_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("closed_at", sa.DateTime(timezone=True), nullable=True),
    )

    op.create_index(
        "support_ticket_org_status_idx",
        "support_ticket",
        ["organization_id", "status", "updated_at"],
    )
    op.create_index(
        "support_ticket_assignee_idx",
        "support_ticket",
        ["assignee_email", "status", "updated_at"],
    )
    op.create_index(
        "support_ticket_created_by_idx",
        "support_ticket",
        ["created_by_email", "created_at"],
    )

    op.create_table(
        "support_ticket_message",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("ticket_id", sa.Text, sa.ForeignKey("support_ticket.id", ondelete="CASCADE"), nullable=False),
        sa.Column("organization_id", sa.Text, nullable=False),
        sa.Column("direction", sa.Text, nullable=False),  # inbound|outbound
        sa.Column("visibility", sa.Text, nullable=False, server_default="external"),  # external|internal
        sa.Column("author_type", sa.Text, nullable=False),  # user|admin|email|system
        sa.Column("author_email", sa.Text, nullable=True),
        sa.Column("author_user_id", sa.Text, nullable=True),
        sa.Column("subject", sa.Text, nullable=True),
        sa.Column("body_text", sa.Text, nullable=False),
        sa.Column("body_html", sa.Text, nullable=True),
        sa.Column(
            "raw_payload",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default=sa.text("'{}'::jsonb"),
        ),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )

    op.create_index(
        "support_ticket_message_ticket_idx",
        "support_ticket_message",
        ["ticket_id", "created_at"],
    )
    op.create_index(
        "support_ticket_message_org_idx",
        "support_ticket_message",
        ["organization_id", "created_at"],
    )

    op.create_table(
        "support_ticket_attachment",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column(
            "message_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("support_ticket_message.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("organization_id", sa.Text, nullable=False),
        sa.Column("storage_key", sa.Text, nullable=False),
        sa.Column("filename", sa.Text, nullable=False),
        sa.Column("content_type", sa.Text, nullable=True),
        sa.Column("size_bytes", sa.Integer, nullable=True),
        sa.Column("is_inline", sa.Boolean, nullable=False, server_default=sa.text("false")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )

    op.create_index(
        "support_ticket_attachment_message_idx",
        "support_ticket_attachment",
        ["message_id"],
    )
    op.create_index(
        "support_ticket_attachment_org_idx",
        "support_ticket_attachment",
        ["organization_id", "created_at"],
    )

    _enable_rls("support_ticket", "organization_id")
    _enable_rls("support_ticket_message", "organization_id")
    _enable_rls("support_ticket_attachment", "organization_id")


def downgrade() -> None:
    op.drop_index("support_ticket_attachment_org_idx", table_name="support_ticket_attachment")
    op.drop_index("support_ticket_attachment_message_idx", table_name="support_ticket_attachment")
    op.drop_table("support_ticket_attachment")

    op.drop_index("support_ticket_message_org_idx", table_name="support_ticket_message")
    op.drop_index("support_ticket_message_ticket_idx", table_name="support_ticket_message")
    op.drop_table("support_ticket_message")

    op.drop_index("support_ticket_created_by_idx", table_name="support_ticket")
    op.drop_index("support_ticket_assignee_idx", table_name="support_ticket")
    op.drop_index("support_ticket_org_status_idx", table_name="support_ticket")
    op.drop_table("support_ticket")

