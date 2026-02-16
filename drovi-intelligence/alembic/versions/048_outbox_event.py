"""Derived index outbox events.

Revision ID: 048_outbox_event
Revises: 047_documents_smart_drive
Create Date: 2026-02-10

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "048_outbox_event"
down_revision: Union[str, None] = "047_documents_smart_drive"
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
                         USING (
                            current_setting(''app.is_internal'', true) = ''true''
                            OR {column} = current_setting(''app.organization_id'', true)
                         )';
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
        "outbox_event",
        sa.Column("id", sa.Text, primary_key=True),
        sa.Column("organization_id", sa.Text, nullable=False),
        sa.Column("event_type", sa.Text, nullable=False),
        sa.Column("status", sa.Text, nullable=False, server_default="pending"),  # pending, processing, succeeded, failed
        sa.Column("priority", sa.Integer, nullable=False, server_default="0"),
        sa.Column("attempts", sa.Integer, nullable=False, server_default="0"),
        sa.Column("max_attempts", sa.Integer, nullable=False, server_default="10"),
        sa.Column("lease_until", sa.DateTime(timezone=True), nullable=True),
        sa.Column("locked_by", sa.Text, nullable=True),
        sa.Column("idempotency_key", sa.Text, nullable=True),
        sa.Column("payload_version", sa.Integer, nullable=False, server_default="1"),
        sa.Column("payload", sa.JSON, nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column("last_error", sa.Text, nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )

    op.create_index(
        "outbox_event_status_priority_idx",
        "outbox_event",
        ["status", "priority", "created_at"],
    )
    op.create_index(
        "outbox_event_org_idx",
        "outbox_event",
        ["organization_id"],
    )
    op.create_index(
        "outbox_event_type_idx",
        "outbox_event",
        ["event_type"],
    )
    op.create_index(
        "outbox_event_lease_idx",
        "outbox_event",
        ["lease_until"],
    )

    op.create_unique_constraint(
        "outbox_event_org_idempotency_uq",
        "outbox_event",
        ["organization_id", "idempotency_key"],
    )

    _enable_rls("outbox_event", "organization_id")


def downgrade() -> None:
    op.drop_constraint("outbox_event_org_idempotency_uq", "outbox_event", type_="unique")
    op.drop_index("outbox_event_lease_idx", table_name="outbox_event")
    op.drop_index("outbox_event_type_idx", table_name="outbox_event")
    op.drop_index("outbox_event_org_idx", table_name="outbox_event")
    op.drop_index("outbox_event_status_priority_idx", table_name="outbox_event")
    op.drop_table("outbox_event")
