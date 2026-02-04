"""Add sensor permission table.

Revision ID: 028_add_sensor_permission_table
Revises: 027_add_org_notification_emails
Create Date: 2026-02-04

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import ARRAY

# revision identifiers, used by Alembic.
revision: str = "028_add_sensor_permission_table"
down_revision: Union[str, None] = "027_add_org_notification_emails"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "sensor_permission",
        sa.Column("id", sa.Text, primary_key=True),
        sa.Column("organization_id", sa.Text, nullable=False),
        sa.Column("sensor_id", sa.Text, nullable=False),
        sa.Column("status", sa.Text, nullable=False, server_default="active"),
        sa.Column("granted_scopes", ARRAY(sa.Text), nullable=False, server_default="{}"),
        sa.Column("reason", sa.Text, nullable=True),
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

    op.create_index("sensor_permission_org_idx", "sensor_permission", ["organization_id"])
    op.create_index("sensor_permission_sensor_idx", "sensor_permission", ["sensor_id"])
    op.create_unique_constraint(
        "sensor_permission_org_sensor_unique",
        "sensor_permission",
        ["organization_id", "sensor_id"],
    )


def downgrade() -> None:
    op.drop_constraint("sensor_permission_org_sensor_unique", "sensor_permission")
    op.drop_index("sensor_permission_sensor_idx", table_name="sensor_permission")
    op.drop_index("sensor_permission_org_idx", table_name="sensor_permission")
    op.drop_table("sensor_permission")
