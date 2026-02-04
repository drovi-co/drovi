"""Continuum Exchange metadata fields.

Revision ID: 036_continuum_exchange_metadata
Revises: 035_continuum_exchange
Create Date: 2026-02-04

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "036_continuum_exchange_metadata"
down_revision: Union[str, None] = "035_continuum_exchange"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "continuum_bundle",
        sa.Column("visibility", sa.Text, nullable=False, server_default="private"),
    )
    op.add_column(
        "continuum_bundle",
        sa.Column("governance_status", sa.Text, nullable=False, server_default="pending"),
    )
    op.add_column(
        "continuum_bundle",
        sa.Column("price_cents", sa.Integer, nullable=True),
    )
    op.add_column(
        "continuum_bundle",
        sa.Column("currency", sa.Text, nullable=True),
    )
    op.add_column(
        "continuum_bundle",
        sa.Column("billing_model", sa.Text, nullable=True),
    )

    op.create_index("continuum_bundle_visibility_idx", "continuum_bundle", ["visibility"])
    op.create_index("continuum_bundle_governance_idx", "continuum_bundle", ["governance_status"])


def downgrade() -> None:
    op.drop_index("continuum_bundle_governance_idx", table_name="continuum_bundle")
    op.drop_index("continuum_bundle_visibility_idx", table_name="continuum_bundle")

    op.drop_column("continuum_bundle", "billing_model")
    op.drop_column("continuum_bundle", "currency")
    op.drop_column("continuum_bundle", "price_cents")
    op.drop_column("continuum_bundle", "governance_status")
    op.drop_column("continuum_bundle", "visibility")
