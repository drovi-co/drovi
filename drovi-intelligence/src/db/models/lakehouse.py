"""Lakehouse control-plane persistence models."""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import BigInteger, Column, DateTime, Float, ForeignKey, Integer, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB

from src.db.models.connections import Base


class LakehouseCheckpoint(Base):
    __tablename__ = "lakehouse_checkpoint"

    id = Column(Text, primary_key=True)
    organization_id = Column(Text, ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False, index=True)
    checkpoint_key = Column(Text, nullable=False, index=True)
    cursor = Column(JSONB, nullable=False, default=dict)
    checkpoint_metadata = Column("metadata", JSONB, nullable=False, default=dict)
    updated_at = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow)

    __table_args__ = (
        UniqueConstraint(
            "organization_id",
            "checkpoint_key",
            name="lakehouse_checkpoint_org_key_unique",
        ),
    )


class LakehousePartition(Base):
    __tablename__ = "lakehouse_partition"

    id = Column(Text, primary_key=True)
    organization_id = Column(Text, ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False, index=True)
    layer = Column(Text, nullable=False)
    table_name = Column(Text, nullable=False, index=True)
    partition_key = Column(Text, nullable=False)
    partition_path = Column(Text, nullable=False)
    table_format = Column(Text, nullable=False, default="iceberg")
    schema_version = Column(Text, nullable=False, default="1.0")
    row_count = Column(Integer, nullable=False, default=0)
    bytes_written = Column(BigInteger, nullable=False, default=0)
    first_event_at = Column(DateTime(timezone=True), nullable=True)
    last_event_at = Column(DateTime(timezone=True), nullable=True)
    quality_status = Column(Text, nullable=False, default="pending", index=True)
    quality_report = Column(JSONB, nullable=False, default=dict)
    retention_until = Column(DateTime(timezone=True), nullable=True)
    partition_metadata = Column("metadata", JSONB, nullable=False, default=dict)
    created_at = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow)
    updated_at = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow)

    __table_args__ = (
        UniqueConstraint(
            "organization_id",
            "table_name",
            "partition_key",
            name="lakehouse_partition_org_table_key_unique",
        ),
    )


class LakehouseCostAttribution(Base):
    __tablename__ = "lakehouse_cost_attribution"

    id = Column(Text, primary_key=True)
    organization_id = Column(Text, ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False, index=True)
    source_key = Column(Text, nullable=False, index=True)
    table_name = Column(Text, nullable=False)
    partition_key = Column(Text, nullable=False)
    records_written = Column(Integer, nullable=False, default=0)
    bytes_written = Column(BigInteger, nullable=False, default=0)
    compute_millis = Column(BigInteger, nullable=False, default=0)
    cost_units = Column(Float, nullable=False, default=0.0)
    period_start = Column(DateTime(timezone=True), nullable=False, index=True)
    period_end = Column(DateTime(timezone=True), nullable=False, index=True)
    attribution_metadata = Column("metadata", JSONB, nullable=False, default=dict)
    created_at = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow)
