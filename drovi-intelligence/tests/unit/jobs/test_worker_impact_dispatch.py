from __future__ import annotations

from datetime import datetime, timezone
from unittest.mock import AsyncMock

import pytest

from src.jobs.queue import ClaimedJob
from src.jobs.worker import JobsWorker

pytestmark = [pytest.mark.unit, pytest.mark.asyncio]


class _FakeImpactService:
    def __init__(self) -> None:
        self.compute_and_persist_impacts = AsyncMock(
            return_value={"persisted_count": 2, "candidates_evaluated": 2}
        )
        self.preview_impacts = AsyncMock(
            return_value={"candidate_count": 2}
        )


async def test_worker_dispatches_impact_compute_job(monkeypatch: pytest.MonkeyPatch) -> None:
    worker = JobsWorker()
    job = ClaimedJob(
        id="job_impact_1",
        organization_id="org_test",
        job_type="impact.compute",
        status="running",
        priority=1,
        run_at=datetime.now(timezone.utc),
        resource_key="impact:compute:org_test",
        attempts=1,
        max_attempts=3,
        payload={"organization_id": "org_test"},
    )
    handler = AsyncMock(return_value={"persisted_count": 2})
    monkeypatch.setattr(worker, "_run_impact_compute", handler)

    result = await worker._dispatch(job)

    assert result["persisted_count"] == 2
    assert handler.await_count == 1


async def test_run_impact_compute_invokes_service_persist_mode(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    worker = JobsWorker()
    service = _FakeImpactService()
    monkeypatch.setattr(
        "src.world_model.service.get_impact_intelligence_service",
        AsyncMock(return_value=service),
    )

    job = ClaimedJob(
        id="job_impact_2",
        organization_id="org_test",
        job_type="impact.compute",
        status="running",
        priority=1,
        run_at=datetime.now(timezone.utc),
        resource_key="impact:compute:org_test",
        attempts=1,
        max_attempts=3,
        payload={
            "organization_id": "org_test",
            "external_events": [{"event_id": "ev_1", "entity_refs": ["acme"]}],
            "internal_objects": [{"id": "obj_1", "entity_refs": ["acme"], "type": "commitment"}],
            "persist": True,
        },
    )

    result = await worker._run_impact_compute(job)

    assert result["persisted_count"] == 2
    assert service.compute_and_persist_impacts.await_count == 1


async def test_run_impact_compute_invokes_service_preview_mode(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    worker = JobsWorker()
    service = _FakeImpactService()
    monkeypatch.setattr(
        "src.world_model.service.get_impact_intelligence_service",
        AsyncMock(return_value=service),
    )

    job = ClaimedJob(
        id="job_impact_3",
        organization_id="org_test",
        job_type="impact.compute",
        status="running",
        priority=1,
        run_at=datetime.now(timezone.utc),
        resource_key="impact:compute:org_test",
        attempts=1,
        max_attempts=3,
        payload={
            "organization_id": "org_test",
            "external_events": [{"event_id": "ev_1", "entity_refs": ["acme"]}],
            "internal_objects": [{"id": "obj_1", "entity_refs": ["acme"], "type": "commitment"}],
            "persist": False,
        },
    )

    result = await worker._run_impact_compute(job)

    assert result["candidate_count"] == 2
    assert service.preview_impacts.await_count == 1
