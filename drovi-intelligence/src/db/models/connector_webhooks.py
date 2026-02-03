"""Connector webhook inbox/outbox models."""

from datetime import datetime
from uuid import uuid4

from sqlalchemy import Column, DateTime, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB, UUID

from src.db.models.connections import Base


class ConnectorWebhookInbox(Base):
    """Inbound connector webhook payloads (idempotent)."""

    __tablename__ = "connector_webhook_inbox"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid4)
    provider = Column(String(50), nullable=False)
    connection_id = Column(UUID(as_uuid=True), ForeignKey("connections.id", ondelete="CASCADE"), nullable=False)
    organization_id = Column(String(100), nullable=False, index=True)
    idempotency_key = Column(String(200), nullable=False, unique=True)
    event_type = Column(String(100), nullable=False)
    payload = Column(JSONB, nullable=False)
    status = Column(String(20), default="pending")  # pending, queued, processed, failed
    attempt_count = Column(Integer, default=0)
    error_message = Column(Text, nullable=True)
    received_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    processed_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    __table_args__ = (
        UniqueConstraint("idempotency_key", name="uix_connector_webhook_inbox_idempotency"),
    )


class ConnectorWebhookOutbox(Base):
    """Outbound queue for webhook processing (Kafka publish)."""

    __tablename__ = "connector_webhook_outbox"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid4)
    inbox_id = Column(UUID(as_uuid=True), ForeignKey("connector_webhook_inbox.id", ondelete="CASCADE"), nullable=False)
    provider = Column(String(50), nullable=False)
    organization_id = Column(String(100), nullable=False, index=True)
    event_type = Column(String(100), nullable=False)
    payload = Column(JSONB, nullable=False)
    status = Column(String(20), default="pending")  # pending, published, failed
    attempt_count = Column(Integer, default=0)
    last_attempt_at = Column(DateTime, nullable=True)
    published_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)


# Alembic migration SQL for reference:
"""
CREATE TABLE connector_webhook_inbox (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    provider VARCHAR(50) NOT NULL,
    connection_id UUID NOT NULL REFERENCES connections(id) ON DELETE CASCADE,
    organization_id VARCHAR(100) NOT NULL,
    idempotency_key VARCHAR(200) NOT NULL UNIQUE,
    event_type VARCHAR(100) NOT NULL,
    payload JSONB NOT NULL,
    status VARCHAR(20) DEFAULT 'pending',
    attempt_count INTEGER DEFAULT 0,
    error_message TEXT,
    received_at TIMESTAMPTZ DEFAULT now(),
    processed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE connector_webhook_outbox (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    inbox_id UUID NOT NULL REFERENCES connector_webhook_inbox(id) ON DELETE CASCADE,
    provider VARCHAR(50) NOT NULL,
    organization_id VARCHAR(100) NOT NULL,
    event_type VARCHAR(100) NOT NULL,
    payload JSONB NOT NULL,
    status VARCHAR(20) DEFAULT 'pending',
    attempt_count INTEGER DEFAULT 0,
    last_attempt_at TIMESTAMPTZ,
    published_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT now()
);
"""
