"""Create signal candidate table for fast extraction.

Revision ID: 018_create_signal_candidate_table
Revises: 017_create_contact_identity_table
Create Date: 2026-02-02

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

# revision identifiers, used by Alembic.
revision: str = "018_create_signal_candidate_table"
down_revision: Union[str, None] = "017_create_contact_identity_table"
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
        "signal_candidate",
        sa.Column("id", sa.Text, primary_key=True),
        sa.Column("organization_id", sa.Text, nullable=False),
        sa.Column("analysis_id", sa.Text, nullable=True),
        sa.Column("candidate_type", sa.Text, nullable=False),
        sa.Column("title", sa.Text, nullable=True),
        sa.Column("content", sa.Text, nullable=True),
        sa.Column("evidence_text", sa.Text, nullable=True),
        sa.Column("confidence", sa.Float, nullable=True),
        sa.Column("conversation_id", sa.Text, nullable=True),
        sa.Column("source_type", sa.Text, nullable=True),
        sa.Column("source_id", sa.Text, nullable=True),
        sa.Column("source_message_id", sa.Text, nullable=True),
        sa.Column("raw_payload", JSONB, nullable=False, server_default="{}"),
        sa.Column("status", sa.Text, nullable=False, server_default="new"),
        sa.Column("processed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
    )

    op.create_index(
        "signal_candidate_org_idx",
        "signal_candidate",
        ["organization_id"],
    )
    op.create_index(
        "signal_candidate_type_idx",
        "signal_candidate",
        ["candidate_type"],
    )
    op.create_index(
        "signal_candidate_conversation_idx",
        "signal_candidate",
        ["conversation_id"],
    )
    op.create_index(
        "signal_candidate_created_idx",
        "signal_candidate",
        ["created_at"],
    )

    _enable_rls("signal_candidate", "organization_id")


def downgrade() -> None:
    op.execute(
        """
        DO $$
        BEGIN
            EXECUTE 'DROP POLICY IF EXISTS signal_candidate_org_isolation ON signal_candidate';
            EXECUTE 'ALTER TABLE signal_candidate NO FORCE ROW LEVEL SECURITY';
            EXECUTE 'ALTER TABLE signal_candidate DISABLE ROW LEVEL SECURITY';
        EXCEPTION
            WHEN undefined_table THEN
                RAISE NOTICE 'Table signal_candidate does not exist, skipping RLS disable';
        END
        $$;
        """
    )
    op.drop_index("signal_candidate_created_idx", table_name="signal_candidate")
    op.drop_index("signal_candidate_conversation_idx", table_name="signal_candidate")
    op.drop_index("signal_candidate_type_idx", table_name="signal_candidate")
    op.drop_index("signal_candidate_org_idx", table_name="signal_candidate")
    op.drop_table("signal_candidate")
