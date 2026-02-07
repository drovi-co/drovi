"""
API tests for Durable Jobs endpoints.

These are internal/admin operational endpoints.
"""

from __future__ import annotations

from contextlib import asynccontextmanager
from datetime import datetime
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

pytestmark = [pytest.mark.api, pytest.mark.asyncio]


def _job_row(job_id: str, *, org_id: str = "org_test", payload: dict | None = None) -> dict:
    now = datetime.utcnow()
    return {
        "id": job_id,
        "organization_id": org_id,
        "job_type": "connector.sync",
        "status": "queued",
        "priority": 0,
        "run_at": now,
        "resource_key": "connection:conn_123",
        "attempts": 0,
        "max_attempts": 3,
        "lease_until": None,
        "locked_by": None,
        "started_at": None,
        "completed_at": None,
        "idempotency_key": None,
        "payload": payload or {"connection_id": "conn_123"},
        "result": None,
        "last_error": None,
        "created_at": now,
        "updated_at": now,
    }


class TestJobsList:
    async def test_list_jobs_returns_rows(self, async_client):
        session = AsyncMock()
        result = MagicMock()
        result.mappings.return_value.all.return_value = [_job_row("job_1")]
        session.execute = AsyncMock(return_value=result)

        @asynccontextmanager
        async def fake_session():
            yield session

        with patch("src.api.routes.jobs.get_db_session", fake_session):
            response = await async_client.get("/api/v1/jobs")

        assert response.status_code == 200
        data = response.json()
        assert data["jobs"][0]["id"] == "job_1"


class TestJobsGet:
    async def test_get_job_404_when_missing(self, async_client):
        session = AsyncMock()
        result = MagicMock()
        result.mappings.return_value.first.return_value = None
        session.execute = AsyncMock(return_value=result)

        @asynccontextmanager
        async def fake_session():
            yield session

        with patch("src.api.routes.jobs.get_db_session", fake_session):
            response = await async_client.get("/api/v1/jobs/job_missing")

        assert response.status_code == 404


class TestJobsCancel:
    async def test_cancel_job_calls_queue(self, async_client):
        with patch("src.api.routes.jobs.cancel_job", AsyncMock(return_value=True)):
            response = await async_client.post("/api/v1/jobs/job_1/cancel")

        assert response.status_code == 200
        assert response.json()["cancelled"] is True


class TestJobsRetryReplay:
    async def test_retry_job_enqueues_new_job(self, async_client):
        session = AsyncMock()
        result = MagicMock()
        result.mappings.return_value.first.return_value = {
            "organization_id": "org_test",
            "job_type": "connector.sync",
            "priority": 1,
            "resource_key": "connection:conn_123",
            "max_attempts": 3,
            "payload": {"connection_id": "conn_123", "scheduled": False},
        }
        session.execute = AsyncMock(return_value=result)

        @asynccontextmanager
        async def fake_session():
            yield session

        with patch("src.api.routes.jobs.get_db_session", fake_session), patch(
            "src.api.routes.jobs.enqueue_job",
            AsyncMock(return_value="job_new"),
        ) as mock_enqueue:
            response = await async_client.post("/api/v1/jobs/job_1/retry")

        assert response.status_code == 200
        assert response.json()["job_id"] == "job_new"
        assert mock_enqueue.await_count == 1

    async def test_replay_job_applies_payload_overrides(self, async_client):
        session = AsyncMock()
        result = MagicMock()
        result.mappings.return_value.first.return_value = {
            "organization_id": "org_test",
            "job_type": "connector.sync",
            "priority": 1,
            "resource_key": "connection:conn_123",
            "max_attempts": 3,
            "payload": {"connection_id": "conn_123", "scheduled": False},
        }
        session.execute = AsyncMock(return_value=result)

        @asynccontextmanager
        async def fake_session():
            yield session

        with patch("src.api.routes.jobs.get_db_session", fake_session), patch(
            "src.api.routes.jobs.enqueue_job",
            AsyncMock(return_value="job_replay"),
        ) as mock_enqueue:
            response = await async_client.post(
                "/api/v1/jobs/job_1/replay",
                json={"payload_overrides": {"scheduled": True}},
            )

        assert response.status_code == 200
        assert response.json()["job_id"] == "job_replay"

        # Ensure merged payload is passed to enqueue_job.
        args, kwargs = mock_enqueue.await_args
        request = args[0]
        assert request.payload["connection_id"] == "conn_123"
        assert request.payload["scheduled"] is True

