"""Add notification emails to organizations.

Revision ID: 027_add_org_notification_emails
Revises: 026_add_brief_fields_and_task_extraction_context
Create Date: 2026-02-04

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import ARRAY

# revision identifiers, used by Alembic.
revision: str = "027_add_org_notification_emails"
down_revision: Union[str, None] = "026_add_brief_fields_and_task_extraction_context"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "organizations",
        sa.Column(
            "notification_emails",
            ARRAY(sa.String()),
            nullable=False,
            server_default="{}",
        ),
    )


def downgrade() -> None:
    op.drop_column("organizations", "notification_emails")
