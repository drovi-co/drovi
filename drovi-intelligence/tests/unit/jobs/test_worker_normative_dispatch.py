from __future__ import annotations

from datetime import datetime, timezone
from unittest.mock import AsyncMock

import pytest

from src.jobs.queue import ClaimedJob
from src.jobs.worker import JobsWorker

pytestmark = [pytest.mark.unit, pytest.mark.asyncio]


class _FakeNormativeService:
    def __init__(self) -> None:
        self.run_violation_sentinel = AsyncMock(
            return_value={"constraints_evaluated": 3, "signals_persisted": 2}
        )


async def test_worker_dispatches_normative_sentinel_job(monkeypatch: pytest.MonkeyPatch) -> None:
    worker = JobsWorker()
    job = ClaimedJob(
        id="job_norm_1",
        organization_id="org_test",
        job_type="normative.sentinel",
        status="running",
        priority=1,
        run_at=datetime.now(timezone.utc),
        resource_key="normative:sentinel:org_test",
        attempts=1,
        max_attempts=3,
        payload={"organization_id": "org_test"},
    )
    handler = AsyncMock(return_value={"signals_persisted": 2})
    monkeypatch.setattr(worker, "_run_normative_sentinel", handler)

    result = await worker._dispatch(job)

    assert result["signals_persisted"] == 2
    assert handler.await_count == 1


async def test_run_normative_sentinel_invokes_normative_service(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    worker = JobsWorker()
    service = _FakeNormativeService()
    monkeypatch.setattr(
        "src.normative.service.get_normative_intelligence_service",
        AsyncMock(return_value=service),
    )

    job = ClaimedJob(
        id="job_norm_2",
        organization_id="org_test",
        job_type="normative.sentinel",
        status="running",
        priority=1,
        run_at=datetime.now(timezone.utc),
        resource_key="normative:sentinel:org_test",
        attempts=1,
        max_attempts=3,
        payload={
            "organization_id": "org_test",
            "facts": {"internal": {"overdue_commitments": 2}},
            "include_warnings": True,
            "publish_events": False,
            "max_constraints": 200,
        },
    )

    result = await worker._run_normative_sentinel(job)

    assert result["constraints_evaluated"] == 3
    assert service.run_violation_sentinel.await_count == 1
