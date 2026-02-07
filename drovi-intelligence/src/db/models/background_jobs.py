"""Durable background jobs queue models."""

from __future__ import annotations

from datetime import datetime
from uuid import uuid4

from sqlalchemy import JSON, Column, DateTime, Integer, Text, UniqueConstraint

from src.db.models.connections import Base


class BackgroundJob(Base):
    __tablename__ = "background_job"

    id = Column(Text, primary_key=True, default=lambda: str(uuid4()))
    organization_id = Column(Text, nullable=False, index=True)

    job_type = Column(Text, nullable=False, index=True)
    status = Column(Text, nullable=False, index=True)  # queued, running, succeeded, failed, cancelled
    priority = Column(Integer, nullable=False, default=0)
    run_at = Column(DateTime(timezone=True), nullable=False)
    resource_key = Column(Text, nullable=True, index=True)

    attempts = Column(Integer, nullable=False, default=0)
    max_attempts = Column(Integer, nullable=False, default=5)

    lease_until = Column(DateTime(timezone=True), nullable=True, index=True)
    locked_by = Column(Text, nullable=True)

    started_at = Column(DateTime(timezone=True), nullable=True)
    completed_at = Column(DateTime(timezone=True), nullable=True)

    idempotency_key = Column(Text, nullable=True)
    payload = Column(JSON, nullable=False, default=dict)
    result = Column(JSON, nullable=True)
    last_error = Column(Text, nullable=True)

    created_at = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow)
    updated_at = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow)

    __table_args__ = (
        UniqueConstraint(
            "organization_id",
            "idempotency_key",
            name="background_job_org_idempotency_uq",
        ),
    )
