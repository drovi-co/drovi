"""Add org connector policies.

Revision ID: 044_org_connector_policies
Revises: 043_update_rls_background_job_internal
Create Date: 2026-02-07

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import ARRAY


# revision identifiers, used by Alembic.
revision: str = "044_org_connector_policies"
down_revision: Union[str, None] = "043_update_rls_background_job_internal"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Restrict which connectors can be added for an org. NULL means "allow all".
    op.add_column(
        "organizations",
        sa.Column("allowed_connectors", ARRAY(sa.String()), nullable=True),
    )

    # Default connection visibility for new connections created by users.
    op.add_column(
        "organizations",
        sa.Column(
            "default_connection_visibility",
            sa.String(length=20),
            nullable=False,
            server_default="org_shared",
        ),
    )


def downgrade() -> None:
    op.drop_column("organizations", "default_connection_visibility")
    op.drop_column("organizations", "allowed_connectors")

