"""Outbox event models for derived index and async side-effects."""

from __future__ import annotations

from datetime import datetime
from uuid import uuid4

from sqlalchemy import JSON, Column, DateTime, Integer, Text, UniqueConstraint

from src.db.models.connections import Base


class OutboxEvent(Base):
    __tablename__ = "outbox_event"

    id = Column(Text, primary_key=True, default=lambda: str(uuid4()))
    organization_id = Column(Text, nullable=False, index=True)

    event_type = Column(Text, nullable=False, index=True)
    status = Column(Text, nullable=False, index=True)  # pending, processing, succeeded, failed
    priority = Column(Integer, nullable=False, default=0)

    attempts = Column(Integer, nullable=False, default=0)
    max_attempts = Column(Integer, nullable=False, default=10)

    lease_until = Column(DateTime(timezone=True), nullable=True, index=True)
    locked_by = Column(Text, nullable=True)

    idempotency_key = Column(Text, nullable=True)
    payload_version = Column(Integer, nullable=False, default=1)
    payload = Column(JSON, nullable=False, default=dict)

    last_error = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow)
    updated_at = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow)

    __table_args__ = (
        UniqueConstraint(
            "organization_id",
            "idempotency_key",
            name="outbox_event_org_idempotency_uq",
        ),
    )

