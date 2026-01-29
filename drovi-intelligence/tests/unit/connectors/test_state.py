"""
Unit tests for Connector State Management.

Tests ConnectorState and SyncCheckpoint classes.
"""

import pytest
from datetime import datetime, timedelta
from freezegun import freeze_time

from src.connectors.base.state import ConnectorState, SyncCheckpoint

pytestmark = pytest.mark.unit


# =============================================================================
# SyncCheckpoint Tests
# =============================================================================


class TestSyncCheckpoint:
    """Tests for SyncCheckpoint model."""

    def test_required_fields(self):
        """Test required fields."""
        checkpoint = SyncCheckpoint(
            stream_name="messages",
            connection_id="conn_123",
        )

        assert checkpoint.stream_name == "messages"
        assert checkpoint.connection_id == "conn_123"

    def test_default_cursor(self):
        """Test default cursor is empty dict."""
        checkpoint = SyncCheckpoint(
            stream_name="messages",
            connection_id="conn_123",
        )

        assert checkpoint.cursor == {}

    def test_default_progress(self):
        """Test default progress values."""
        checkpoint = SyncCheckpoint(
            stream_name="messages",
            connection_id="conn_123",
        )

        assert checkpoint.records_synced == 0
        assert checkpoint.bytes_synced == 0

    def test_default_status(self):
        """Test default status is idle."""
        checkpoint = SyncCheckpoint(
            stream_name="messages",
            connection_id="conn_123",
        )

        assert checkpoint.status == "idle"

    def test_update_cursor(self):
        """Test updating cursor."""
        checkpoint = SyncCheckpoint(
            stream_name="messages",
            connection_id="conn_123",
            cursor={"historyId": "123"},
        )

        checkpoint.update_cursor({"historyId": "456", "pageToken": "abc"})

        assert checkpoint.cursor["historyId"] == "456"
        assert checkpoint.cursor["pageToken"] == "abc"

    def test_update_cursor_merges(self):
        """Test update_cursor merges with existing."""
        checkpoint = SyncCheckpoint(
            stream_name="messages",
            connection_id="conn_123",
            cursor={"historyId": "123", "other": "value"},
        )

        checkpoint.update_cursor({"historyId": "456"})

        assert checkpoint.cursor["historyId"] == "456"
        assert checkpoint.cursor["other"] == "value"

    def test_mark_started(self):
        """Test marking sync as started."""
        checkpoint = SyncCheckpoint(
            stream_name="messages",
            connection_id="conn_123",
        )

        checkpoint.mark_started()

        assert checkpoint.status == "syncing"
        assert checkpoint.last_sync_started_at is not None
        assert checkpoint.error_message is None

    def test_mark_started_clears_error(self):
        """Test mark_started clears previous error."""
        checkpoint = SyncCheckpoint(
            stream_name="messages",
            connection_id="conn_123",
            error_message="Previous error",
        )

        checkpoint.mark_started()

        assert checkpoint.error_message is None

    def test_mark_completed(self):
        """Test marking sync as completed."""
        checkpoint = SyncCheckpoint(
            stream_name="messages",
            connection_id="conn_123",
        )

        checkpoint.mark_completed(records=100, bytes_count=5000)

        assert checkpoint.status == "completed"
        assert checkpoint.last_sync_completed_at is not None
        assert checkpoint.records_synced == 100
        assert checkpoint.bytes_synced == 5000

    def test_mark_completed_accumulates(self):
        """Test mark_completed accumulates counts."""
        checkpoint = SyncCheckpoint(
            stream_name="messages",
            connection_id="conn_123",
            records_synced=50,
            bytes_synced=2500,
        )

        checkpoint.mark_completed(records=100, bytes_count=5000)

        assert checkpoint.records_synced == 150
        assert checkpoint.bytes_synced == 7500

    def test_mark_failed(self):
        """Test marking sync as failed."""
        checkpoint = SyncCheckpoint(
            stream_name="messages",
            connection_id="conn_123",
        )

        checkpoint.mark_failed("Connection timeout")

        assert checkpoint.status == "failed"
        assert checkpoint.error_message == "Connection timeout"

    def test_with_initial_cursor(self):
        """Test creating with initial cursor."""
        checkpoint = SyncCheckpoint(
            stream_name="messages",
            connection_id="conn_123",
            cursor={"historyId": "12345"},
        )

        assert checkpoint.cursor["historyId"] == "12345"


# =============================================================================
# ConnectorState Tests
# =============================================================================


class TestConnectorState:
    """Tests for ConnectorState model."""

    def test_required_fields(self):
        """Test required fields."""
        state = ConnectorState(
            connection_id="conn_123",
            connector_type="gmail",
        )

        assert state.connection_id == "conn_123"
        assert state.connector_type == "gmail"

    def test_default_stream_states(self):
        """Test default stream states is empty."""
        state = ConnectorState(
            connection_id="conn_123",
            connector_type="gmail",
        )

        assert state.stream_states == {}

    def test_default_totals(self):
        """Test default totals."""
        state = ConnectorState(
            connection_id="conn_123",
            connector_type="gmail",
        )

        assert state.total_records_synced == 0
        assert state.total_bytes_synced == 0
        assert state.last_sync_at is None

    def test_get_stream_state_creates(self):
        """Test get_stream_state creates new checkpoint."""
        state = ConnectorState(
            connection_id="conn_123",
            connector_type="gmail",
        )

        checkpoint = state.get_stream_state("messages")

        assert checkpoint.stream_name == "messages"
        assert checkpoint.connection_id == "conn_123"
        assert "messages" in state.stream_states

    def test_get_stream_state_returns_existing(self):
        """Test get_stream_state returns existing checkpoint."""
        state = ConnectorState(
            connection_id="conn_123",
            connector_type="gmail",
        )
        state.stream_states["messages"] = SyncCheckpoint(
            stream_name="messages",
            connection_id="conn_123",
            cursor={"historyId": "123"},
        )

        checkpoint = state.get_stream_state("messages")

        assert checkpoint.cursor["historyId"] == "123"

    def test_get_cursor(self):
        """Test getting cursor for stream."""
        state = ConnectorState(
            connection_id="conn_123",
            connector_type="gmail",
        )
        state.stream_states["messages"] = SyncCheckpoint(
            stream_name="messages",
            connection_id="conn_123",
            cursor={"historyId": "123"},
        )

        cursor = state.get_cursor("messages")

        assert cursor["historyId"] == "123"

    def test_get_cursor_new_stream(self):
        """Test getting cursor for new stream."""
        state = ConnectorState(
            connection_id="conn_123",
            connector_type="gmail",
        )

        cursor = state.get_cursor("messages")

        assert cursor == {}

    def test_update_cursor(self):
        """Test updating cursor."""
        state = ConnectorState(
            connection_id="conn_123",
            connector_type="gmail",
        )

        state.update_cursor("messages", {"historyId": "456"})

        assert state.get_cursor("messages")["historyId"] == "456"

    def test_update_cursor_updates_timestamp(self):
        """Test update_cursor updates updated_at."""
        state = ConnectorState(
            connection_id="conn_123",
            connector_type="gmail",
        )
        original_updated = state.updated_at

        # Small delay to ensure different timestamp
        import time
        time.sleep(0.001)

        state.update_cursor("messages", {"historyId": "456"})

        assert state.updated_at >= original_updated

    def test_mark_sync_started(self):
        """Test marking sync started."""
        state = ConnectorState(
            connection_id="conn_123",
            connector_type="gmail",
        )

        state.mark_sync_started("messages")

        assert state.stream_states["messages"].status == "syncing"

    def test_mark_sync_completed(self):
        """Test marking sync completed."""
        state = ConnectorState(
            connection_id="conn_123",
            connector_type="gmail",
        )

        state.mark_sync_completed("messages", records=100, bytes_count=5000)

        assert state.stream_states["messages"].status == "completed"
        assert state.total_records_synced == 100
        assert state.total_bytes_synced == 5000
        assert state.last_sync_at is not None

    def test_mark_sync_completed_accumulates_totals(self):
        """Test mark_sync_completed accumulates global totals."""
        state = ConnectorState(
            connection_id="conn_123",
            connector_type="gmail",
            total_records_synced=50,
            total_bytes_synced=2500,
        )

        state.mark_sync_completed("messages", records=100, bytes_count=5000)

        assert state.total_records_synced == 150
        assert state.total_bytes_synced == 7500

    def test_mark_sync_failed(self):
        """Test marking sync failed."""
        state = ConnectorState(
            connection_id="conn_123",
            connector_type="gmail",
        )

        state.mark_sync_failed("messages", "Rate limit exceeded")

        assert state.stream_states["messages"].status == "failed"
        assert state.stream_states["messages"].error_message == "Rate limit exceeded"

    def test_to_dict(self):
        """Test serialization to dictionary."""
        state = ConnectorState(
            connection_id="conn_123",
            connector_type="gmail",
        )
        state.stream_states["messages"] = SyncCheckpoint(
            stream_name="messages",
            connection_id="conn_123",
            cursor={"historyId": "123"},
        )

        data = state.to_dict()

        assert data["connection_id"] == "conn_123"
        assert data["connector_type"] == "gmail"
        assert "messages" in data["stream_states"]
        assert data["stream_states"]["messages"]["cursor"]["historyId"] == "123"

    def test_to_dict_with_dates(self):
        """Test serialization with datetime fields."""
        state = ConnectorState(
            connection_id="conn_123",
            connector_type="gmail",
            last_sync_at=datetime(2024, 1, 15, 10, 30),
        )

        data = state.to_dict()

        assert data["last_sync_at"] == "2024-01-15T10:30:00"

    def test_to_dict_no_last_sync(self):
        """Test serialization with no last_sync_at."""
        state = ConnectorState(
            connection_id="conn_123",
            connector_type="gmail",
        )

        data = state.to_dict()

        assert data["last_sync_at"] is None

    def test_from_dict(self):
        """Test deserialization from dictionary."""
        data = {
            "connection_id": "conn_123",
            "connector_type": "gmail",
            "stream_states": {
                "messages": {
                    "stream_name": "messages",
                    "connection_id": "conn_123",
                    "cursor": {"historyId": "123"},
                    "records_synced": 100,
                    "bytes_synced": 5000,
                    "status": "completed",
                },
            },
            "last_sync_at": "2024-01-15T10:30:00",
            "total_records_synced": 100,
            "total_bytes_synced": 5000,
            "created_at": "2024-01-01T00:00:00",
            "updated_at": "2024-01-15T10:30:00",
        }

        state = ConnectorState.from_dict(data)

        assert state.connection_id == "conn_123"
        assert state.connector_type == "gmail"
        assert state.total_records_synced == 100
        assert state.last_sync_at == datetime(2024, 1, 15, 10, 30)
        assert "messages" in state.stream_states
        assert state.stream_states["messages"].cursor["historyId"] == "123"

    def test_from_dict_no_last_sync(self):
        """Test deserialization without last_sync_at."""
        data = {
            "connection_id": "conn_123",
            "connector_type": "gmail",
            "stream_states": {},
            "last_sync_at": None,
            "total_records_synced": 0,
            "total_bytes_synced": 0,
            "created_at": "2024-01-01T00:00:00",
            "updated_at": "2024-01-01T00:00:00",
        }

        state = ConnectorState.from_dict(data)

        assert state.last_sync_at is None

    def test_from_dict_missing_timestamps(self):
        """Test deserialization with missing timestamps."""
        data = {
            "connection_id": "conn_123",
            "connector_type": "gmail",
            "stream_states": {},
        }

        state = ConnectorState.from_dict(data)

        assert state.created_at is not None
        assert state.updated_at is not None

    def test_roundtrip_serialization(self):
        """Test roundtrip serialization."""
        original = ConnectorState(
            connection_id="conn_123",
            connector_type="gmail",
            total_records_synced=500,
            total_bytes_synced=25000,
        )
        original.stream_states["messages"] = SyncCheckpoint(
            stream_name="messages",
            connection_id="conn_123",
            cursor={"historyId": "123", "pageToken": "abc"},
            records_synced=500,
        )

        data = original.to_dict()
        restored = ConnectorState.from_dict(data)

        assert restored.connection_id == original.connection_id
        assert restored.connector_type == original.connector_type
        assert restored.total_records_synced == original.total_records_synced
        assert restored.stream_states["messages"].cursor == original.stream_states["messages"].cursor


# =============================================================================
# Multi-Stream State Tests
# =============================================================================


class TestMultiStreamState:
    """Tests for managing state across multiple streams."""

    def test_multiple_streams(self):
        """Test managing multiple stream states."""
        state = ConnectorState(
            connection_id="conn_123",
            connector_type="gmail",
        )

        state.mark_sync_started("messages")
        state.mark_sync_started("threads")
        state.mark_sync_started("labels")

        assert len(state.stream_states) == 3

    def test_independent_stream_states(self):
        """Test streams have independent states."""
        state = ConnectorState(
            connection_id="conn_123",
            connector_type="gmail",
        )

        state.mark_sync_started("messages")
        state.mark_sync_completed("messages", records=100)
        state.mark_sync_started("threads")
        state.mark_sync_failed("threads", "Error")

        assert state.stream_states["messages"].status == "completed"
        assert state.stream_states["threads"].status == "failed"

    def test_total_accumulation_across_streams(self):
        """Test totals accumulate across all streams."""
        state = ConnectorState(
            connection_id="conn_123",
            connector_type="gmail",
        )

        state.mark_sync_completed("messages", records=100, bytes_count=5000)
        state.mark_sync_completed("threads", records=50, bytes_count=2500)
        state.mark_sync_completed("labels", records=10, bytes_count=500)

        assert state.total_records_synced == 160
        assert state.total_bytes_synced == 8000

    def test_stream_cursors_independent(self):
        """Test stream cursors are independent."""
        state = ConnectorState(
            connection_id="conn_123",
            connector_type="gmail",
        )

        state.update_cursor("messages", {"historyId": "123"})
        state.update_cursor("threads", {"ts": "456.789"})

        assert state.get_cursor("messages") == {"historyId": "123"}
        assert state.get_cursor("threads") == {"ts": "456.789"}
