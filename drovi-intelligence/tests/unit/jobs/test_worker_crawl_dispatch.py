from __future__ import annotations

from datetime import datetime, timezone
from unittest.mock import AsyncMock

import pytest

from src.jobs.queue import ClaimedJob
from src.jobs.worker import JobsWorker

pytestmark = [pytest.mark.unit, pytest.mark.asyncio]


async def test_worker_dispatches_crawl_fetch_job(monkeypatch: pytest.MonkeyPatch) -> None:
    worker = JobsWorker()
    job = ClaimedJob(
        id="job_1",
        organization_id="org_test",
        job_type="crawl.fetch",
        status="running",
        priority=1,
        run_at=datetime.now(timezone.utc),
        resource_key="crawl-domain:example.com:0",
        attempts=1,
        max_attempts=3,
        payload={"frontier_entry_id": "frontier_1"},
    )
    handler = AsyncMock(return_value={"status": "succeeded"})
    monkeypatch.setattr(worker, "_run_crawl_fetch", handler)

    result = await worker._dispatch(job)

    assert result["status"] == "succeeded"
    assert handler.await_count == 1


async def test_worker_dispatches_crawl_diff_job(monkeypatch: pytest.MonkeyPatch) -> None:
    worker = JobsWorker()
    job = ClaimedJob(
        id="job_2",
        organization_id="org_test",
        job_type="crawl.diff",
        status="running",
        priority=1,
        run_at=datetime.now(timezone.utc),
        resource_key="crawl-diff:frontier_1",
        attempts=1,
        max_attempts=3,
        payload={"snapshot_id": "snapshot_1"},
    )
    handler = AsyncMock(return_value={"status": "succeeded", "meaningful": True})
    monkeypatch.setattr(worker, "_run_crawl_diff", handler)

    result = await worker._dispatch(job)

    assert result["meaningful"] is True
    assert handler.await_count == 1


async def test_worker_dispatches_lakehouse_replay_job(monkeypatch: pytest.MonkeyPatch) -> None:
    worker = JobsWorker()
    job = ClaimedJob(
        id="job_3",
        organization_id="org_test",
        job_type="lakehouse.replay",
        status="running",
        priority=1,
        run_at=datetime.now(timezone.utc),
        resource_key="lakehouse:replay:org_test",
        attempts=1,
        max_attempts=3,
        payload={"checkpoint_key": "replay:test"},
    )
    handler = AsyncMock(return_value={"status": "ok", "replayed_events": 10})
    monkeypatch.setattr(worker, "_run_lakehouse_replay", handler)

    result = await worker._dispatch(job)

    assert result["replayed_events"] == 10
    assert handler.await_count == 1


async def test_worker_dispatches_lakehouse_quality_job(monkeypatch: pytest.MonkeyPatch) -> None:
    worker = JobsWorker()
    job = ClaimedJob(
        id="job_4",
        organization_id="org_test",
        job_type="lakehouse.quality",
        status="running",
        priority=1,
        run_at=datetime.now(timezone.utc),
        resource_key="lakehouse:quality:org_test",
        attempts=1,
        max_attempts=3,
        payload={},
    )
    handler = AsyncMock(return_value={"status": "ok", "checked": 4})
    monkeypatch.setattr(worker, "_run_lakehouse_quality", handler)

    result = await worker._dispatch(job)

    assert result["checked"] == 4
    assert handler.await_count == 1


async def test_worker_dispatches_lakehouse_retention_job(monkeypatch: pytest.MonkeyPatch) -> None:
    worker = JobsWorker()
    job = ClaimedJob(
        id="job_5",
        organization_id="org_test",
        job_type="lakehouse.retention",
        status="running",
        priority=1,
        run_at=datetime.now(timezone.utc),
        resource_key="lakehouse:retention:org_test",
        attempts=1,
        max_attempts=3,
        payload={},
    )
    handler = AsyncMock(return_value={"status": "ok", "deleted_files": 3})
    monkeypatch.setattr(worker, "_run_lakehouse_retention", handler)

    result = await worker._dispatch(job)

    assert result["deleted_files"] == 3
    assert handler.await_count == 1


async def test_worker_dispatches_source_reliability_calibration_job(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    worker = JobsWorker()
    job = ClaimedJob(
        id="job_6",
        organization_id="org_test",
        job_type="source.reliability.calibrate",
        status="running",
        priority=1,
        run_at=datetime.now(timezone.utc),
        resource_key="source_reliability:org_test",
        attempts=1,
        max_attempts=3,
        payload={},
    )
    handler = AsyncMock(return_value={"updated_profiles": 2})
    monkeypatch.setattr(worker, "_run_source_reliability_calibration", handler)

    result = await worker._dispatch(job)

    assert result["updated_profiles"] == 2
    assert handler.await_count == 1
