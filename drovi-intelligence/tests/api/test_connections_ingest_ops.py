from __future__ import annotations

from contextlib import asynccontextmanager
from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4

import pytest

pytestmark = [pytest.mark.api, pytest.mark.asyncio]


def _session_result(value):
    return SimpleNamespace(scalar_one_or_none=lambda: value)


async def test_pause_ingest_updates_connection_state(async_client) -> None:
    connection = SimpleNamespace(
        id=str(uuid4()),
        organization_id="org_test",
        config={},
        sync_enabled=True,
        status="active",
        updated_at=None,
    )

    session = AsyncMock()
    session.execute = AsyncMock(return_value=_session_result(connection))

    @asynccontextmanager
    async def fake_get_db_session():
        yield session

    with patch("src.db.client.get_db_session", fake_get_db_session):
        response = await async_client.post(f"/api/v1/connections/{connection.id}/ingest/pause")

    assert response.status_code == 200
    assert response.json()["status"] == "paused"
    assert connection.sync_enabled is False
    assert connection.status == "paused"
    assert connection.config["ingest_control"]["manual_pause"] is True
    assert session.commit.await_count == 1


async def test_replay_ingest_enqueues_replay_job(async_client) -> None:
    connection = SimpleNamespace(
        id=uuid4(),
        organization_id="org_test",
        streams_config=["events"],
    )
    session = AsyncMock()
    session.execute = AsyncMock(
        side_effect=[
            _session_result(connection),
            _session_result(None),  # sync state lookup
        ]
    )
    session.add = MagicMock()

    @asynccontextmanager
    async def fake_get_db_session():
        yield session

    with (
        patch("src.db.client.get_db_session", fake_get_db_session),
        patch("src.jobs.queue.enqueue_job", AsyncMock(return_value="job_replay_1")) as mock_enqueue,
    ):
        response = await async_client.post(
            f"/api/v1/connections/{connection.id}/ingest/replay",
            json={
                "checkpoint_cursor": {"last_publish_date": "2026-02-20T00:00:00Z"},
                "streams": ["events"],
                "full_refresh": False,
            },
        )

    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "queued"
    assert data["replay_job_id"] == "job_replay_1"
    request = mock_enqueue.await_args.args[0]
    assert request.job_type == "connector.sync"
    assert request.payload["sync_job_type"] == "replay"
    assert request.payload["sync_params"]["checkpoint_override"] is True
    assert session.add.call_count == 1


async def test_list_ingest_runs_returns_run_ledger(async_client) -> None:
    connection = SimpleNamespace(
        id=str(uuid4()),
        organization_id="org_test",
    )
    session = AsyncMock()
    session.execute = AsyncMock(return_value=_session_result(connection))

    @asynccontextmanager
    async def fake_get_db_session():
        yield session

    runs = [
        {
            "id": "run_1",
            "status": "succeeded",
            "run_kind": "continuous",
            "started_at": datetime.now(timezone.utc).isoformat(),
        }
    ]

    with (
        patch("src.db.client.get_db_session", fake_get_db_session),
        patch(
            "src.connectors.scheduling.run_ledger.list_source_sync_runs",
            AsyncMock(return_value=runs),
        ),
    ):
        response = await async_client.get(f"/api/v1/connections/{connection.id}/ingest/runs?limit=10")

    assert response.status_code == 200
    data = response.json()
    assert data["connection_id"] == connection.id
    assert data["runs"] == runs
