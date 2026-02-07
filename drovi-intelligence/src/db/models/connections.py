"""
Connection Database Models

SQLAlchemy models for connection management, OAuth tokens,
sync state, and job history.
"""

from datetime import datetime
from typing import Any
from uuid import uuid4

from sqlalchemy import (
    JSON,
    Boolean,
    Column,
    DateTime,
    Enum,
    ForeignKey,
    Integer,
    LargeBinary,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import ARRAY, UUID
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import relationship

Base = declarative_base()


class Connection(Base):
    """
    Represents a connection to an external data source.

    Stores configuration, authentication status, and sync settings.
    """

    __tablename__ = "connections"

    # Identity
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid4)
    organization_id = Column(String(100), nullable=False, index=True)  # Text ID like "org_xyz"
    created_by_user_id = Column(String(100), nullable=True, index=True)
    visibility = Column(String(20), nullable=False, default="org_shared", index=True)  # org_shared | private

    # Connector info
    connector_type = Column(String(50), nullable=False, index=True)  # gmail, slack, etc.
    name = Column(String(255), nullable=False)
    description = Column(Text, nullable=True)

    # Configuration (encrypted sensitive data stored in oauth_tokens)
    config = Column(JSON, nullable=False, default=dict)  # Non-sensitive config
    streams_config = Column(JSON, nullable=False, default=list)  # Stream configurations

    # Sync settings
    sync_frequency_minutes = Column(Integer, default=5)
    sync_enabled = Column(Boolean, default=True)
    backfill_enabled = Column(Boolean, default=True)
    backfill_start_date = Column(DateTime, nullable=True)

    # Status
    status = Column(
        String(20),
        nullable=False,
        default="pending_auth",
        index=True,
    )  # active, paused, error, pending_auth

    # Sync metadata
    last_sync_at = Column(DateTime, nullable=True)
    last_sync_status = Column(String(20), nullable=True)  # success, failed, partial
    last_sync_error = Column(Text, nullable=True)
    last_sync_records = Column(Integer, default=0)

    # Timestamps
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    # Relationships
    oauth_token = relationship("OAuthToken", back_populates="connection", uselist=False)
    sync_states = relationship("SyncState", back_populates="connection")
    job_history = relationship("SyncJobHistory", back_populates="connection")

    def __repr__(self) -> str:
        return f"<Connection {self.connector_type}:{self.name} ({self.status})>"


class OAuthToken(Base):
    """
    Stores encrypted OAuth2 tokens for a connection.

    All sensitive token data is encrypted at rest.
    """

    __tablename__ = "oauth_tokens"

    # Identity
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid4)
    connection_id = Column(
        UUID(as_uuid=True),
        ForeignKey("connections.id", ondelete="CASCADE"),
        nullable=False,
        unique=True,
    )
    organization_id = Column(String(100), nullable=False, index=True)  # Text ID like "org_xyz"

    # Provider
    provider = Column(String(50), nullable=False)  # google, microsoft, slack, etc.

    # Encrypted tokens
    access_token_encrypted = Column(LargeBinary, nullable=False)
    refresh_token_encrypted = Column(LargeBinary, nullable=True)

    # Token metadata (not sensitive)
    token_type = Column(String(20), default="Bearer")
    expires_at = Column(DateTime, nullable=True, index=True)
    scopes = Column(ARRAY(String), default=list)

    # Timestamps
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    # Relationship
    connection = relationship("Connection", back_populates="oauth_token")

    def __repr__(self) -> str:
        return f"<OAuthToken {self.provider} expires={self.expires_at}>"


class SyncState(Base):
    """
    Stores sync checkpoint state for each stream.

    Enables incremental sync with cursor-based pagination.
    """

    __tablename__ = "sync_states"

    # Identity
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid4)
    connection_id = Column(
        UUID(as_uuid=True),
        ForeignKey("connections.id", ondelete="CASCADE"),
        nullable=False,
    )

    # Stream identification
    stream_name = Column(String(100), nullable=False)

    # Cursor state (JSON for flexibility across providers)
    # Examples:
    #   Gmail: {"historyId": "123456"}
    #   Slack: {"latest_ts": "1234567890.123456"}
    #   Notion: {"last_edited_time": "2024-01-01T00:00:00Z"}
    cursor_state = Column(JSON, nullable=False, default=dict)

    # Progress tracking
    records_synced = Column(Integer, default=0)
    bytes_synced = Column(Integer, default=0)

    # Status
    status = Column(String(20), default="idle")  # idle, syncing, completed, failed
    error_message = Column(Text, nullable=True)

    # Timestamps
    last_sync_started_at = Column(DateTime, nullable=True)
    last_sync_completed_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    # Unique constraint on connection + stream
    __table_args__ = (
        UniqueConstraint("connection_id", "stream_name", name="uix_sync_state_connection_stream"),
    )

    # Relationship
    connection = relationship("Connection", back_populates="sync_states")

    def __repr__(self) -> str:
        return f"<SyncState {self.stream_name} ({self.status})>"


class SyncJobHistory(Base):
    """
    Records history of sync job executions.

    Provides audit trail and debugging information.
    """

    __tablename__ = "sync_job_history"

    # Identity
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid4)
    connection_id = Column(
        UUID(as_uuid=True),
        ForeignKey("connections.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    organization_id = Column(String(100), nullable=False, index=True)  # Text ID like "org_xyz"

    # Job type
    job_type = Column(String(20), nullable=False)  # scheduled, on_demand, backfill, webhook

    # Scope
    streams = Column(ARRAY(String), default=list)  # Empty = all streams
    full_refresh = Column(Boolean, default=False)

    # Status
    status = Column(String(20), nullable=False, index=True)  # pending, running, completed, failed, cancelled

    # Timing
    started_at = Column(DateTime, nullable=True)
    completed_at = Column(DateTime, nullable=True)
    duration_seconds = Column(Integer, nullable=True)

    # Results
    records_synced = Column(Integer, default=0)
    bytes_synced = Column(Integer, default=0)
    streams_completed = Column(ARRAY(String), default=list)
    streams_failed = Column(ARRAY(String), default=list)

    # Error
    error_message = Column(Text, nullable=True)

    # Extra data
    extra_data = Column(JSON, default=dict)  # Additional job-specific data

    # Timestamps
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    # Relationship
    connection = relationship("Connection", back_populates="job_history")

    def __repr__(self) -> str:
        return f"<SyncJobHistory {self.job_type} ({self.status})>"


# Alembic migration SQL for reference:
"""
-- Create connections table
CREATE TABLE connections (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL,
    connector_type VARCHAR(50) NOT NULL,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    config JSONB NOT NULL DEFAULT '{}',
    streams_config JSONB NOT NULL DEFAULT '[]',
    sync_frequency_minutes INTEGER DEFAULT 5,
    sync_enabled BOOLEAN DEFAULT TRUE,
    backfill_enabled BOOLEAN DEFAULT TRUE,
    backfill_start_date TIMESTAMPTZ,
    status VARCHAR(20) NOT NULL DEFAULT 'pending_auth',
    last_sync_at TIMESTAMPTZ,
    last_sync_status VARCHAR(20),
    last_sync_error TEXT,
    last_sync_records INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_connections_org ON connections(organization_id);
CREATE INDEX idx_connections_type ON connections(connector_type);
CREATE INDEX idx_connections_status ON connections(status);

-- Create oauth_tokens table
CREATE TABLE oauth_tokens (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    connection_id UUID NOT NULL UNIQUE REFERENCES connections(id) ON DELETE CASCADE,
    organization_id UUID NOT NULL,
    provider VARCHAR(50) NOT NULL,
    access_token_encrypted BYTEA NOT NULL,
    refresh_token_encrypted BYTEA,
    token_type VARCHAR(20) DEFAULT 'Bearer',
    expires_at TIMESTAMPTZ,
    scopes TEXT[],
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_oauth_tokens_org ON oauth_tokens(organization_id);
CREATE INDEX idx_oauth_tokens_expires ON oauth_tokens(expires_at);

-- Create sync_states table
CREATE TABLE sync_states (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    connection_id UUID NOT NULL REFERENCES connections(id) ON DELETE CASCADE,
    stream_name VARCHAR(100) NOT NULL,
    cursor_state JSONB NOT NULL DEFAULT '{}',
    records_synced INTEGER DEFAULT 0,
    bytes_synced INTEGER DEFAULT 0,
    status VARCHAR(20) DEFAULT 'idle',
    error_message TEXT,
    last_sync_started_at TIMESTAMPTZ,
    last_sync_completed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(connection_id, stream_name)
);

-- Create sync_job_history table
CREATE TABLE sync_job_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    connection_id UUID NOT NULL REFERENCES connections(id) ON DELETE CASCADE,
    organization_id UUID NOT NULL,
    job_type VARCHAR(20) NOT NULL,
    streams TEXT[],
    full_refresh BOOLEAN DEFAULT FALSE,
    status VARCHAR(20) NOT NULL,
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    duration_seconds INTEGER,
    records_synced INTEGER DEFAULT 0,
    bytes_synced INTEGER DEFAULT 0,
    streams_completed TEXT[],
    streams_failed TEXT[],
    error_message TEXT,
    extra_data JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_sync_jobs_connection ON sync_job_history(connection_id);
CREATE INDEX idx_sync_jobs_org ON sync_job_history(organization_id);
CREATE INDEX idx_sync_jobs_status ON sync_job_history(status);
"""
