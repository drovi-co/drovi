from __future__ import annotations

from datetime import datetime, timezone
from unittest.mock import AsyncMock

import pytest

from src.connectors.base.config import AuthConfig, AuthType, ConnectorConfig
from src.jobs.queue import ClaimedJob
from src.jobs.worker import JobsWorker

pytestmark = [pytest.mark.unit, pytest.mark.asyncio]


async def test_worker_backfill_plan_enqueues_windowed_sync_jobs(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    worker = JobsWorker()
    job = ClaimedJob(
        id="job_backfill_plan",
        organization_id="org_test",
        job_type="connector.backfill_plan",
        status="running",
        priority=0,
        run_at=datetime.now(timezone.utc),
        resource_key="connection:conn_1",
        attempts=1,
        max_attempts=3,
        payload={
            "connection_id": "conn_1",
            "organization_id": "org_test",
            "start_date": "2026-01-01T00:00:00+00:00",
            "end_date": "2026-01-08T00:00:00+00:00",
            "window_days": 3,
            "streams": ["messages"],
            "throttle_seconds": 0,
        },
    )

    config = ConnectorConfig(
        connection_id="conn_1",
        organization_id="org_test",
        connector_type="gmail",
        name="Gmail",
        auth=AuthConfig(auth_type=AuthType.NONE),
    )
    monkeypatch.setattr(
        "src.connectors.connection_service.get_connection_config",
        AsyncMock(return_value=config),
    )

    enqueue_calls: list = []

    async def _enqueue_job(request):
        enqueue_calls.append(request)
        return f"job_sync_{len(enqueue_calls)}"

    monkeypatch.setattr("src.jobs.queue.enqueue_job", _enqueue_job)

    result = await worker._run_connector_backfill_plan(job)

    assert result["window_job_ids"] == ["job_sync_1", "job_sync_2", "job_sync_3"]
    assert len(enqueue_calls) == 3
    for request in enqueue_calls:
        assert request.job_type == "connector.sync"
        assert request.payload["sync_job_type"] == "backfill"
        assert request.payload["full_refresh"] is True
        assert request.payload["streams"] == ["messages"]

    windows = [
        (
            request.payload["backfill_start"],
            request.payload["backfill_end"],
        )
        for request in enqueue_calls
    ]
    assert windows[0][0].startswith("2026-01-01")
    assert windows[-1][1].startswith("2026-01-08")
