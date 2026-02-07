"""Update RLS policy for background_job to allow internal bypass.

Revision ID: 043_update_rls_background_job_internal
Revises: 042_connection_visibility_and_owner
Create Date: 2026-02-07

This fixes a production foot-gun: the durable jobs worker/scheduler uses
`app.is_internal=true` to operate across organizations. The initial
background_job RLS policy only checked `app.organization_id`, which works
when running as the `postgres` superuser in dev but breaks under restricted
DB roles in production.
"""

from typing import Sequence, Union

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "043_update_rls_background_job_internal"
down_revision: Union[str, None] = "042_connection_visibility_and_owner"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    policy_name = "background_job_org_isolation"
    op.execute(
        f"""
        DO $$
        BEGIN
            EXECUTE 'ALTER TABLE background_job ENABLE ROW LEVEL SECURITY';
            EXECUTE 'ALTER TABLE background_job FORCE ROW LEVEL SECURITY';
            EXECUTE 'DROP POLICY IF EXISTS {policy_name} ON background_job';
            EXECUTE 'CREATE POLICY {policy_name} ON background_job
                     USING (
                        current_setting(''app.is_internal'', true) = ''true''
                        OR organization_id = current_setting(''app.organization_id'', true)
                     )';
        EXCEPTION
            WHEN undefined_table THEN
                RAISE NOTICE 'Table background_job does not exist, skipping RLS update';
        END
        $$;
        """
    )


def downgrade() -> None:
    policy_name = "background_job_org_isolation"
    op.execute(
        f"""
        DO $$
        BEGIN
            EXECUTE 'DROP POLICY IF EXISTS {policy_name} ON background_job';
            EXECUTE 'CREATE POLICY {policy_name} ON background_job
                     USING (organization_id = current_setting(''app.organization_id'', true))';
        EXCEPTION
            WHEN undefined_table THEN
                RAISE NOTICE 'Table background_job does not exist, skipping RLS downgrade';
        END
        $$;
        """
    )

