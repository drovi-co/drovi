from __future__ import annotations

from datetime import datetime, timezone
from unittest.mock import AsyncMock

import pytest

from src.jobs.queue import ClaimedJob
from src.jobs.worker import JobDispatchError, JobsWorker

pytestmark = [pytest.mark.unit, pytest.mark.asyncio]


async def test_non_retryable_dispatch_error_marks_job_failed_terminally(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    worker = JobsWorker()
    job = ClaimedJob(
        id="job_1",
        organization_id="org_test",
        job_type="connector.sync",
        status="running",
        priority=1,
        run_at=datetime.now(timezone.utc),
        resource_key="connection:conn_1",
        attempts=1,
        max_attempts=3,
        payload={},
    )

    async def _dispatch(_job: ClaimedJob):
        raise JobDispatchError("permanent failure", retryable=False)

    async def _heartbeat(_job_id: str) -> None:
        return None

    mark_failed = AsyncMock()
    monkeypatch.setattr(worker, "_dispatch", _dispatch)
    monkeypatch.setattr(worker, "_lease_heartbeat", _heartbeat)
    monkeypatch.setattr("src.jobs.worker.mark_job_failed", mark_failed)

    await worker._execute_claimed_job(job)

    kwargs = mark_failed.await_args.kwargs
    assert kwargs["attempts"] == job.max_attempts
    assert kwargs["backoff_seconds"] == 0
