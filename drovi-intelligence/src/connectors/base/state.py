"""
Connector State Management

Provides checkpointing and state tracking for incremental syncs.
Enables resumable syncs and reliable data extraction.
"""

from datetime import datetime
from typing import Any

from pydantic import BaseModel, Field

from src.connectors.cursors import merge_cursor_state_monotonic

class SyncCheckpoint(BaseModel):
    """
    Checkpoint state for a single stream.

    Stores cursor position for incremental sync resumption.
    """

    # Stream identification
    stream_name: str
    connection_id: str

    # Cursor state (provider-specific)
    # Examples:
    #   Gmail: {"historyId": "123456"}
    #   Slack: {"latest_ts": "1234567890.123456"}
    #   Notion: {"last_edited_time": "2024-01-01T00:00:00Z"}
    cursor: dict[str, Any] = Field(default_factory=dict)

    # Sync progress
    records_synced: int = 0
    bytes_synced: int = 0

    # Timestamps
    last_sync_started_at: datetime | None = None
    last_sync_completed_at: datetime | None = None

    # Status
    status: str = "idle"  # idle, syncing, completed, failed
    error_message: str | None = None

    class Config:
        """Pydantic config."""
        extra = "allow"

    def update_cursor(self, new_cursor: dict[str, Any]) -> None:
        """Update the cursor with new values."""
        # Prevent obvious cursor regressions; only blocks when comparable and new < old.
        self.cursor = merge_cursor_state_monotonic(self.cursor, new_cursor)

    def mark_started(self) -> None:
        """Mark sync as started."""
        self.status = "syncing"
        self.last_sync_started_at = datetime.utcnow()
        self.error_message = None

    def mark_completed(self, records: int = 0, bytes_count: int = 0) -> None:
        """Mark sync as completed."""
        self.status = "completed"
        self.last_sync_completed_at = datetime.utcnow()
        self.records_synced += records
        self.bytes_synced += bytes_count

    def mark_failed(self, error: str) -> None:
        """Mark sync as failed."""
        self.status = "failed"
        self.error_message = error


class ConnectorState(BaseModel):
    """
    Complete state for a connector instance.

    Aggregates checkpoint state across all streams.
    """

    # Connection identification
    connection_id: str
    connector_type: str

    # Per-stream checkpoints
    stream_states: dict[str, SyncCheckpoint] = Field(default_factory=dict)

    # Global state
    last_sync_at: datetime | None = None
    total_records_synced: int = 0
    total_bytes_synced: int = 0

    # Metadata
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)

    class Config:
        """Pydantic config."""
        extra = "allow"

    def get_stream_state(self, stream_name: str) -> SyncCheckpoint:
        """Get or create state for a stream."""
        if stream_name not in self.stream_states:
            self.stream_states[stream_name] = SyncCheckpoint(
                stream_name=stream_name,
                connection_id=self.connection_id,
            )
        return self.stream_states[stream_name]

    def get_cursor(self, stream_name: str) -> dict[str, Any]:
        """Get cursor for a stream."""
        return self.get_stream_state(stream_name).cursor

    def update_cursor(self, stream_name: str, cursor: dict[str, Any]) -> None:
        """Update cursor for a stream."""
        state = self.get_stream_state(stream_name)
        state.update_cursor(cursor)
        self.updated_at = datetime.utcnow()

    def mark_sync_started(self, stream_name: str) -> None:
        """Mark stream sync as started."""
        state = self.get_stream_state(stream_name)
        state.mark_started()
        self.updated_at = datetime.utcnow()

    def mark_sync_completed(
        self,
        stream_name: str,
        records: int = 0,
        bytes_count: int = 0,
    ) -> None:
        """Mark stream sync as completed."""
        state = self.get_stream_state(stream_name)
        state.mark_completed(records, bytes_count)

        self.total_records_synced += records
        self.total_bytes_synced += bytes_count
        self.last_sync_at = datetime.utcnow()
        self.updated_at = datetime.utcnow()

    def mark_sync_failed(self, stream_name: str, error: str) -> None:
        """Mark stream sync as failed."""
        state = self.get_stream_state(stream_name)
        state.mark_failed(error)
        self.updated_at = datetime.utcnow()

    def to_dict(self) -> dict[str, Any]:
        """Serialize state to dictionary for persistence."""
        return {
            "connection_id": self.connection_id,
            "connector_type": self.connector_type,
            "stream_states": {
                name: checkpoint.model_dump()
                for name, checkpoint in self.stream_states.items()
            },
            "last_sync_at": self.last_sync_at.isoformat() if self.last_sync_at else None,
            "total_records_synced": self.total_records_synced,
            "total_bytes_synced": self.total_bytes_synced,
            "created_at": self.created_at.isoformat(),
            "updated_at": self.updated_at.isoformat(),
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "ConnectorState":
        """Deserialize state from dictionary."""
        stream_states = {}
        for name, checkpoint_data in data.get("stream_states", {}).items():
            stream_states[name] = SyncCheckpoint(**checkpoint_data)

        return cls(
            connection_id=data["connection_id"],
            connector_type=data["connector_type"],
            stream_states=stream_states,
            last_sync_at=datetime.fromisoformat(data["last_sync_at"]) if data.get("last_sync_at") else None,
            total_records_synced=data.get("total_records_synced", 0),
            total_bytes_synced=data.get("total_bytes_synced", 0),
            created_at=datetime.fromisoformat(data["created_at"]) if data.get("created_at") else datetime.utcnow(),
            updated_at=datetime.fromisoformat(data["updated_at"]) if data.get("updated_at") else datetime.utcnow(),
        )
