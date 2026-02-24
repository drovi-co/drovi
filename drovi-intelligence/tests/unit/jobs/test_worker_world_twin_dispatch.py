from __future__ import annotations

from datetime import datetime, timezone
from unittest.mock import AsyncMock

import pytest

from src.jobs.queue import ClaimedJob
from src.jobs.worker import JobsWorker

pytestmark = [pytest.mark.unit, pytest.mark.asyncio]


class _FakeTwinService:
    def __init__(self) -> None:
        self.build_snapshot = AsyncMock(return_value={"snapshot_id": "snap_1"})
        self.apply_stream_event = AsyncMock(return_value={"snapshot_id": "snap_2"})


async def test_worker_dispatches_world_twin_snapshot_job(monkeypatch: pytest.MonkeyPatch) -> None:
    worker = JobsWorker()
    job = ClaimedJob(
        id="job_twin_1",
        organization_id="org_test",
        job_type="world_twin.snapshot",
        status="running",
        priority=1,
        run_at=datetime.now(timezone.utc),
        resource_key="world_twin:snapshot:org_test",
        attempts=1,
        max_attempts=3,
        payload={"organization_id": "org_test"},
    )
    handler = AsyncMock(return_value={"snapshot_id": "snap_1"})
    monkeypatch.setattr(worker, "_run_world_twin_snapshot", handler)

    result = await worker._dispatch(job)

    assert result["snapshot_id"] == "snap_1"
    assert handler.await_count == 1


async def test_run_world_twin_snapshot_invokes_service(monkeypatch: pytest.MonkeyPatch) -> None:
    worker = JobsWorker()
    service = _FakeTwinService()
    monkeypatch.setattr(
        "src.world_model.twin_service.get_world_twin_service",
        AsyncMock(return_value=service),
    )

    job = ClaimedJob(
        id="job_twin_2",
        organization_id="org_test",
        job_type="world_twin.snapshot",
        status="running",
        priority=1,
        run_at=datetime.now(timezone.utc),
        resource_key="world_twin:snapshot:org_test",
        attempts=1,
        max_attempts=3,
        payload={"organization_id": "org_test", "lookback_hours": 48, "role": "finance"},
    )

    result = await worker._run_world_twin_snapshot(job)

    assert result["snapshot_id"] == "snap_1"
    assert service.build_snapshot.await_count == 1


async def test_run_world_twin_stream_update_invokes_service(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    worker = JobsWorker()
    service = _FakeTwinService()
    monkeypatch.setattr(
        "src.world_model.twin_service.get_world_twin_service",
        AsyncMock(return_value=service),
    )

    job = ClaimedJob(
        id="job_twin_3",
        organization_id="org_test",
        job_type="world_twin.stream_update",
        status="running",
        priority=1,
        run_at=datetime.now(timezone.utc),
        resource_key="world_twin:stream:org_test",
        attempts=1,
        max_attempts=3,
        payload={
            "organization_id": "org_test",
            "event": {
                "event_id": "ev_1",
                "source": "worldnews",
                "domain": "legal",
                "reliability": 0.9,
                "entity_refs": ["acme"],
            },
        },
    )

    result = await worker._run_world_twin_stream_update(job)

    assert result["snapshot_id"] == "snap_2"
    assert service.apply_stream_event.await_count == 1
