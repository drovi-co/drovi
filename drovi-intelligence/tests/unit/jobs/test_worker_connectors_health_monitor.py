from __future__ import annotations

from datetime import datetime, timezone
from unittest.mock import AsyncMock

import pytest

from src.jobs.queue import ClaimedJob
from src.jobs.worker import JobsWorker

pytestmark = [pytest.mark.unit, pytest.mark.asyncio]


async def test_worker_runs_connectors_health_monitor_job(monkeypatch: pytest.MonkeyPatch) -> None:
    worker = JobsWorker()
    job = ClaimedJob(
        id="job_health_1",
        organization_id="internal",
        job_type="connectors.health_monitor",
        status="running",
        priority=0,
        run_at=datetime.now(timezone.utc),
        resource_key="system:connectors_health_monitor",
        attempts=1,
        max_attempts=1,
        payload={"organization_id": "internal"},
    )

    mock_run = AsyncMock(
        return_value={
            "checked_connections": 3,
            "alerts": 1,
            "auto_recovery_enqueued": 1,
        }
    )
    monkeypatch.setattr(
        "src.connectors.health_monitor.run_connectors_health_monitor",
        mock_run,
    )

    result = await worker._run_connectors_health_monitor(job)
    assert result["checked_connections"] == 3
    assert result["alerts"] == 1
    mock_run.assert_awaited_once_with(job.payload)
