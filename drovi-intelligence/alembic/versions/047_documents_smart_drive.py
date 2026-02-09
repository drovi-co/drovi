"""Smart Drive: documents, uploads, and parsed chunks.

Revision ID: 047_documents_smart_drive
Revises: 046_add_locales
Create Date: 2026-02-09
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB


revision: str = "047_documents_smart_drive"
down_revision: Union[str, None] = "046_add_locales"
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
        "document",
        sa.Column("id", sa.Text, primary_key=True),
        sa.Column("organization_id", sa.Text, nullable=False),
        sa.Column("title", sa.Text, nullable=True),
        sa.Column("file_name", sa.Text, nullable=False),
        sa.Column("file_type", sa.Text, nullable=False),
        sa.Column("mime_type", sa.Text, nullable=True),
        sa.Column("byte_size", sa.BigInteger, nullable=True),
        sa.Column("sha256", sa.Text, nullable=False),
        sa.Column("storage_backend", sa.Text, nullable=False, server_default="s3"),
        sa.Column("storage_path", sa.Text, nullable=False),
        sa.Column("evidence_artifact_id", sa.Text, nullable=True),
        sa.Column("status", sa.Text, nullable=False, server_default="uploading"),
        sa.Column("folder_path", sa.Text, nullable=False, server_default="/"),
        sa.Column("tags", JSONB, nullable=False, server_default="[]"),
        sa.Column("created_by_user_id", sa.Text, nullable=True),
        sa.Column("page_count", sa.Integer, nullable=True),
        sa.Column("metadata", JSONB, nullable=False, server_default="{}"),
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
        sa.Column("processed_at", sa.DateTime(timezone=True), nullable=True),
        sa.UniqueConstraint("organization_id", "sha256", name="document_org_sha256_unique"),
    )
    op.create_index("document_org_idx", "document", ["organization_id"])
    op.create_index("document_status_idx", "document", ["status"])
    op.create_index("document_folder_idx", "document", ["folder_path"])

    op.create_table(
        "document_upload",
        sa.Column("id", sa.Text, primary_key=True),
        sa.Column(
            "document_id",
            sa.Text,
            sa.ForeignKey("document.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("organization_id", sa.Text, nullable=False),
        sa.Column("status", sa.Text, nullable=False, server_default="initiated"),
        sa.Column("s3_upload_id", sa.Text, nullable=False),
        sa.Column("s3_key", sa.Text, nullable=False),
        sa.Column("part_size_bytes", sa.Integer, nullable=False),
        sa.Column("expected_sha256", sa.Text, nullable=False),
        sa.Column("expected_byte_size", sa.BigInteger, nullable=False),
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
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("document_upload_org_idx", "document_upload", ["organization_id"])
    op.create_index("document_upload_doc_idx", "document_upload", ["document_id"])
    op.create_index("document_upload_status_idx", "document_upload", ["status"])

    op.create_table(
        "document_chunk",
        sa.Column("id", sa.Text, primary_key=True),
        sa.Column(
            "document_id",
            sa.Text,
            sa.ForeignKey("document.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("organization_id", sa.Text, nullable=False),
        sa.Column("chunk_index", sa.Integer, nullable=False),
        sa.Column("page_index", sa.Integer, nullable=True),
        sa.Column("text", sa.Text, nullable=False),
        sa.Column("content_hash", sa.Text, nullable=False),
        sa.Column("layout_blocks", JSONB, nullable=False, server_default="[]"),
        sa.Column("image_artifact_id", sa.Text, nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
    )
    op.create_index("document_chunk_org_idx", "document_chunk", ["organization_id"])
    op.create_index("document_chunk_doc_idx", "document_chunk", ["document_id"])
    op.create_index("document_chunk_page_idx", "document_chunk", ["page_index"])

    # RLS: org isolation
    _enable_rls("document", "organization_id")
    _enable_rls("document_upload", "organization_id")
    _enable_rls("document_chunk", "organization_id")


def downgrade() -> None:
    op.execute(
        """
        DO $$
        BEGIN
            EXECUTE 'DROP POLICY IF EXISTS document_chunk_org_isolation ON document_chunk';
            EXECUTE 'DROP POLICY IF EXISTS document_upload_org_isolation ON document_upload';
            EXECUTE 'DROP POLICY IF EXISTS document_org_isolation ON document';
        EXCEPTION
            WHEN undefined_table THEN
                RAISE NOTICE 'Skipping policy drop (table missing)';
        END
        $$;
        """
    )

    op.drop_index("document_chunk_page_idx", table_name="document_chunk")
    op.drop_index("document_chunk_doc_idx", table_name="document_chunk")
    op.drop_index("document_chunk_org_idx", table_name="document_chunk")
    op.drop_table("document_chunk")

    op.drop_index("document_upload_status_idx", table_name="document_upload")
    op.drop_index("document_upload_doc_idx", table_name="document_upload")
    op.drop_index("document_upload_org_idx", table_name="document_upload")
    op.drop_table("document_upload")

    op.drop_index("document_folder_idx", table_name="document")
    op.drop_index("document_status_idx", table_name="document")
    op.drop_index("document_org_idx", table_name="document")
    op.drop_table("document")

