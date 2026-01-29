"""
Webhook Database Models

SQLAlchemy models for webhook subscriptions and delivery tracking.
"""

from datetime import datetime
from uuid import uuid4

from sqlalchemy import (
    JSON,
    Boolean,
    Column,
    DateTime,
    ForeignKey,
    Integer,
    String,
    Text,
)
from sqlalchemy.dialects.postgresql import ARRAY, UUID
from sqlalchemy.orm import relationship

from .connections import Base


class WebhookSubscription(Base):
    """
    Represents a webhook subscription for an organization.

    Organizations can subscribe to receive webhook notifications
    for specific event types.
    """

    __tablename__ = "webhook_subscriptions"

    # Identity
    id = Column(String(50), primary_key=True)  # whsub_xxx format
    organization_id = Column(String(255), nullable=False, index=True)

    # Webhook configuration
    url = Column(Text, nullable=False)
    events = Column(ARRAY(String), nullable=False, default=list)  # Event type strings
    secret = Column(String(64), nullable=False)  # HMAC signing key

    # Status
    active = Column(Boolean, default=True, nullable=False)

    # Metadata
    name = Column(String(255), nullable=True)
    description = Column(Text, nullable=True)

    # Timestamps
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    # Relationships
    deliveries = relationship("WebhookDelivery", back_populates="subscription", cascade="all, delete-orphan")

    def __repr__(self) -> str:
        return f"<WebhookSubscription {self.id} ({len(self.events)} events)>"


class WebhookDelivery(Base):
    """
    Records a webhook delivery attempt.

    Tracks delivery status, retries, and response information.
    """

    __tablename__ = "webhook_deliveries"

    # Identity
    id = Column(String(50), primary_key=True)  # whdel_xxx format
    subscription_id = Column(
        String(50),
        ForeignKey("webhook_subscriptions.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    # Event info
    event_type = Column(String(50), nullable=False, index=True)
    payload = Column(JSON, nullable=False, default=dict)

    # Delivery status
    status = Column(String(20), nullable=False, default="pending", index=True)  # pending, delivered, failed, retrying

    # Retry tracking
    attempts = Column(Integer, default=0, nullable=False)
    max_attempts = Column(Integer, default=5, nullable=False)
    next_retry_at = Column(DateTime, nullable=True, index=True)
    last_attempt_at = Column(DateTime, nullable=True)

    # Response info
    response_code = Column(Integer, nullable=True)
    error_message = Column(Text, nullable=True)

    # Timestamps
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    delivered_at = Column(DateTime, nullable=True)

    # Relationship
    subscription = relationship("WebhookSubscription", back_populates="deliveries")

    def __repr__(self) -> str:
        return f"<WebhookDelivery {self.id} ({self.status})>"


# Alembic migration SQL for reference:
"""
-- Create webhook_subscriptions table
CREATE TABLE webhook_subscriptions (
    id VARCHAR(50) PRIMARY KEY,
    organization_id VARCHAR(255) NOT NULL,
    url TEXT NOT NULL,
    events TEXT[] NOT NULL DEFAULT '{}',
    secret VARCHAR(64) NOT NULL,
    active BOOLEAN NOT NULL DEFAULT TRUE,
    name VARCHAR(255),
    description TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_webhook_subs_org ON webhook_subscriptions(organization_id);

-- Create webhook_deliveries table
CREATE TABLE webhook_deliveries (
    id VARCHAR(50) PRIMARY KEY,
    subscription_id VARCHAR(50) NOT NULL REFERENCES webhook_subscriptions(id) ON DELETE CASCADE,
    event_type VARCHAR(50) NOT NULL,
    payload JSONB NOT NULL DEFAULT '{}',
    status VARCHAR(20) NOT NULL DEFAULT 'pending',
    attempts INTEGER NOT NULL DEFAULT 0,
    max_attempts INTEGER NOT NULL DEFAULT 5,
    next_retry_at TIMESTAMPTZ,
    last_attempt_at TIMESTAMPTZ,
    response_code INTEGER,
    error_message TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    delivered_at TIMESTAMPTZ
);

CREATE INDEX idx_webhook_del_sub ON webhook_deliveries(subscription_id);
CREATE INDEX idx_webhook_del_event ON webhook_deliveries(event_type);
CREATE INDEX idx_webhook_del_status ON webhook_deliveries(status);
CREATE INDEX idx_webhook_del_retry ON webhook_deliveries(next_retry_at) WHERE status = 'retrying';
"""
