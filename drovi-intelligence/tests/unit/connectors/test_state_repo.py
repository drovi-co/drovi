"""
Unit tests for ConnectorStateRepository.
"""

from contextlib import asynccontextmanager
from datetime import datetime
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from src.connectors.state_repo import ConnectorStateRepository

pytestmark = pytest.mark.unit


@pytest.mark.asyncio
async def test_get_state_loads_streams():
    session = AsyncMock()
    rows = MagicMock()
    rows.mappings.return_value.all.return_value = [
        {
            "stream_name": "messages",
            "cursor_state": {"historyId": "123"},
            "records_synced": 10,
            "bytes_synced": 2048,
            "status": "completed",
            "error_message": None,
            "last_sync_started_at": datetime(2024, 1, 1),
            "last_sync_completed_at": datetime(2024, 1, 2),
        }
    ]
    session.execute.return_value = rows

    @asynccontextmanager
    async def fake_session():
        yield session

    with patch("src.connectors.state_repo.get_db_session", fake_session):
        repo = ConnectorStateRepository()
        state = await repo.get_state("conn_123", "gmail")

    assert "messages" in state.stream_states
    checkpoint = state.stream_states["messages"]
    assert checkpoint.cursor == {"historyId": "123"}
    assert checkpoint.records_synced == 10
    assert checkpoint.bytes_synced == 2048
    assert checkpoint.status == "completed"


@pytest.mark.asyncio
async def test_upsert_stream_state_executes():
    session = AsyncMock()
    session.execute = AsyncMock()
    session.commit = AsyncMock()

    @asynccontextmanager
    async def fake_session():
        yield session

    with patch("src.connectors.state_repo.get_db_session", fake_session):
        repo = ConnectorStateRepository()
        await repo.upsert_stream_state(
            connection_id="conn_123",
            stream_name="messages",
            cursor_state={"historyId": "456"},
            status="syncing",
        )

    session.execute.assert_called()
    session.commit.assert_called()
