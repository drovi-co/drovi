"""Add entity_versions table for change tracking.

Revision ID: 039_add_entity_versions
Revises: 038_add_invite_email
Create Date: 2026-02-05
"""

from alembic import op

# revision identifiers, used by Alembic.
revision = "039_add_entity_versions"
down_revision = "038_add_invite_email"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS entity_versions (
            id BIGSERIAL PRIMARY KEY,
            entity_id TEXT NOT NULL,
            entity_type TEXT NOT NULL,
            version INTEGER NOT NULL,
            data JSONB NOT NULL,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            created_by TEXT,
            change_reason TEXT,
            UNIQUE(entity_id, entity_type, version)
        );
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_entity_versions_entity
        ON entity_versions(entity_id, entity_type);
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_entity_versions_created
        ON entity_versions(created_at);
        """
    )


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS entity_versions;")
