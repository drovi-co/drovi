from __future__ import annotations

from datetime import datetime, timezone
from unittest.mock import AsyncMock

import pytest

from src.jobs.queue import ClaimedJob
from src.jobs.worker import JobsWorker

pytestmark = [pytest.mark.unit, pytest.mark.asyncio]


class _FakeHypothesisService:
    def __init__(self) -> None:
        self.generate_for_belief = AsyncMock(return_value={"accepted": 2, "rejected": 1})
        self.generate_for_contradiction = AsyncMock(return_value={"accepted": 1, "rejected": 2})
        self.generate_for_anomaly = AsyncMock(return_value={"accepted": 1, "rejected": 0})
        self.rescore_hypotheses = AsyncMock(return_value={"updated": 3, "rejected": 1})


async def test_worker_dispatches_hypothesis_generate_job(monkeypatch: pytest.MonkeyPatch) -> None:
    worker = JobsWorker()
    job = ClaimedJob(
        id="job_hyp_1",
        organization_id="org_test",
        job_type="hypothesis.generate",
        status="running",
        priority=1,
        run_at=datetime.now(timezone.utc),
        resource_key="hypothesis:belief:belief_1",
        attempts=1,
        max_attempts=3,
        payload={"organization_id": "org_test", "belief_id": "belief_1"},
    )
    handler = AsyncMock(return_value={"accepted": 2})
    monkeypatch.setattr(worker, "_run_hypothesis_generate", handler)

    result = await worker._dispatch(job)

    assert result["accepted"] == 2
    assert handler.await_count == 1


async def test_worker_dispatches_hypothesis_rescore_job(monkeypatch: pytest.MonkeyPatch) -> None:
    worker = JobsWorker()
    job = ClaimedJob(
        id="job_hyp_4",
        organization_id="org_test",
        job_type="hypothesis.rescore",
        status="running",
        priority=1,
        run_at=datetime.now(timezone.utc),
        resource_key="hypothesis:belief:belief_1",
        attempts=1,
        max_attempts=3,
        payload={"organization_id": "org_test", "belief_id": "belief_1"},
    )
    handler = AsyncMock(return_value={"updated": 1})
    monkeypatch.setattr(worker, "_run_hypothesis_rescore", handler)

    result = await worker._dispatch(job)

    assert result["updated"] == 1
    assert handler.await_count == 1


async def test_run_hypothesis_generate_routes_to_contradiction_flow(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    worker = JobsWorker()
    service = _FakeHypothesisService()
    monkeypatch.setattr(
        "src.hypothesis.service.get_hypothesis_service",
        AsyncMock(return_value=service),
    )

    job = ClaimedJob(
        id="job_hyp_2",
        organization_id="org_test",
        job_type="hypothesis.generate",
        status="running",
        priority=1,
        run_at=datetime.now(timezone.utc),
        resource_key="hypothesis:contradiction:ctr_1",
        attempts=1,
        max_attempts=3,
        payload={
            "organization_id": "org_test",
            "contradiction_id": "ctr_1",
            "contradiction_type": "policy_conflict",
            "severity": "critical",
            "uio_a_id": "uio_1",
            "uio_b_id": "uio_2",
            "evidence_quote": "Mutually incompatible obligations",
        },
    )

    result = await worker._run_hypothesis_generate(job)

    assert result["accepted"] == 1
    assert service.generate_for_contradiction.await_count == 1


async def test_run_hypothesis_rescore_uses_evidence_signals(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    worker = JobsWorker()
    service = _FakeHypothesisService()
    monkeypatch.setattr(
        "src.hypothesis.service.get_hypothesis_service",
        AsyncMock(return_value=service),
    )

    job = ClaimedJob(
        id="job_hyp_3",
        organization_id="org_test",
        job_type="hypothesis.rescore",
        status="running",
        priority=1,
        run_at=datetime.now(timezone.utc),
        resource_key="hypothesis:belief:belief_1",
        attempts=1,
        max_attempts=3,
        payload={
            "organization_id": "org_test",
            "belief_id": "belief_1",
            "evidence_signals": [
                {"direction": "support", "strength": 0.3},
                {"direction": "contradict", "strength": 0.8},
            ],
            "rejection_threshold": 0.6,
        },
    )

    result = await worker._run_hypothesis_rescore(job)

    assert result["updated"] == 3
    assert service.rescore_hypotheses.await_count == 1
