"""Add organization security policy and break-glass grants.

Revision ID: 059_security_posture_controls
Revises: 058_chain_of_custody_roots
Create Date: 2026-02-17
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "059_security_posture_controls"
down_revision: Union[str, None] = "058_chain_of_custody_roots"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _enable_rls(table: str, column: str = "organization_id") -> None:
    policy_name = f"{table}_org_isolation"
    op.execute(
        f"""
        DO $$
        BEGIN
            IF EXISTS (
                SELECT 1
                FROM information_schema.tables
                WHERE table_schema = 'public'
                  AND table_name = '{table}'
            ) THEN
                EXECUTE 'ALTER TABLE {table} ENABLE ROW LEVEL SECURITY';
                EXECUTE 'ALTER TABLE {table} FORCE ROW LEVEL SECURITY';
                EXECUTE 'DROP POLICY IF EXISTS {policy_name} ON {table}';
                EXECUTE 'CREATE POLICY {policy_name} ON {table}
                    USING (
                        current_setting(''app.is_internal'', true) = ''true''
                        OR {column}::text = current_setting(''app.organization_id'', true)
                    )
                    WITH CHECK (
                        current_setting(''app.is_internal'', true) = ''true''
                        OR {column}::text = current_setting(''app.organization_id'', true)
                    )';
            END IF;
        END $$;
        """
    )


def upgrade() -> None:
    op.create_table(
        "organization_security_policy",
        sa.Column(
            "organization_id",
            sa.Text(),
            sa.ForeignKey("organizations.id", ondelete="CASCADE"),
            primary_key=True,
            nullable=False,
        ),
        sa.Column("sso_enforced", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column(
            "password_fallback_enabled",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("true"),
        ),
        sa.Column(
            "password_fallback_environments",
            sa.ARRAY(sa.Text()),
            nullable=False,
            server_default=sa.text("ARRAY['development','test']::text[]"),
        ),
        sa.Column(
            "ip_allowlist",
            sa.ARRAY(sa.Text()),
            nullable=False,
            server_default=sa.text("ARRAY[]::text[]"),
        ),
        sa.Column(
            "evidence_masking_enabled",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("true"),
        ),
        sa.Column(
            "break_glass_enabled",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
        ),
        sa.Column(
            "break_glass_required_actions",
            sa.ARRAY(sa.Text()),
            nullable=False,
            server_default=sa.text("ARRAY[]::text[]"),
        ),
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
    op.create_index(
        "organization_security_policy_updated_idx",
        "organization_security_policy",
        ["updated_at"],
    )

    op.create_table(
        "security_break_glass_grant",
        sa.Column(
            "id",
            sa.UUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text("gen_random_uuid()"),
            nullable=False,
        ),
        sa.Column(
            "organization_id",
            sa.Text(),
            sa.ForeignKey("organizations.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("scope", sa.Text(), nullable=False, server_default=sa.text("'*'")),
        sa.Column("justification", sa.Text(), nullable=False),
        sa.Column("token_hash", sa.Text(), nullable=False),
        sa.Column("created_by_subject", sa.Text(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("revoked_by_subject", sa.Text(), nullable=True),
        sa.Column("last_used_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "use_count",
            sa.Integer(),
            nullable=False,
            server_default=sa.text("0"),
        ),
        sa.UniqueConstraint("token_hash", name="security_break_glass_grant_token_hash_key"),
    )
    op.create_index(
        "security_break_glass_grant_org_expires_idx",
        "security_break_glass_grant",
        ["organization_id", "expires_at"],
    )

    _enable_rls("organization_security_policy")
    _enable_rls("security_break_glass_grant")


def downgrade() -> None:
    op.drop_index("security_break_glass_grant_org_expires_idx", table_name="security_break_glass_grant")
    op.drop_table("security_break_glass_grant")

    op.drop_index("organization_security_policy_updated_idx", table_name="organization_security_policy")
    op.drop_table("organization_security_policy")
