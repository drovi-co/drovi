"""
Event Database Models

SQLAlchemy models for event persistence and replay.
"""

from datetime import datetime
from uuid import uuid4

from sqlalchemy import (
    JSON,
    Column,
    DateTime,
    Index,
    String,
    Text,
)
from sqlalchemy.dialects.postgresql import UUID

from .connections import Base


class EventRecord(Base):
    """
    Persistent record of published events.

    Enables:
    - Event replay for offline subscribers
    - Audit trail of all system events
    - Historical event queries
    """

    __tablename__ = "event_records"

    # Identity
    id = Column(String(50), primary_key=True)  # UUID format
    organization_id = Column(String(255), nullable=False, index=True)

    # Event details
    event_type = Column(String(100), nullable=False, index=True)
    payload = Column(JSON, nullable=False, default=dict)

    # Tracking
    correlation_id = Column(String(50), nullable=True, index=True)
    source = Column(String(50), nullable=True)  # orchestrator, scheduler, api, etc.

    # Timestamps
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False, index=True)

    # Composite indexes for efficient queries
    __table_args__ = (
        Index('idx_events_org_type_time', 'organization_id', 'event_type', 'created_at'),
        Index('idx_events_org_time', 'organization_id', 'created_at'),
    )

    def __repr__(self) -> str:
        return f"<EventRecord {self.id} ({self.event_type})>"


# Alembic migration SQL for reference:
"""
-- Create event_records table
CREATE TABLE event_records (
    id VARCHAR(50) PRIMARY KEY,
    organization_id VARCHAR(255) NOT NULL,
    event_type VARCHAR(100) NOT NULL,
    payload JSONB NOT NULL DEFAULT '{}',
    correlation_id VARCHAR(50),
    source VARCHAR(50),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_events_org ON event_records(organization_id);
CREATE INDEX idx_events_type ON event_records(event_type);
CREATE INDEX idx_events_time ON event_records(created_at);
CREATE INDEX idx_events_corr ON event_records(correlation_id);
CREATE INDEX idx_events_org_type_time ON event_records(organization_id, event_type, created_at);
CREATE INDEX idx_events_org_time ON event_records(organization_id, created_at);

-- Partition by month for better performance at scale (optional)
-- CREATE TABLE event_records_2024_01 PARTITION OF event_records
--     FOR VALUES FROM ('2024-01-01') TO ('2024-02-01');
"""
