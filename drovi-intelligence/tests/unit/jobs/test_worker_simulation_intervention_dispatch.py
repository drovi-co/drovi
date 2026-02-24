from __future__ import annotations

from datetime import datetime, timezone
from unittest.mock import AsyncMock

import pytest

from src.jobs.queue import ClaimedJob
from src.jobs.worker import JobsWorker


pytestmark = [pytest.mark.unit, pytest.mark.asyncio]


class _FakeSimulationResponse:
    def model_dump(self, mode: str = "json") -> dict:
        return {"simulation_id": "sim_1", "scenario_name": "what_if"}


async def test_worker_dispatches_simulation_job(monkeypatch: pytest.MonkeyPatch) -> None:
    worker = JobsWorker()
    handler = AsyncMock(return_value={"simulation_id": "sim_1"})
    monkeypatch.setattr(worker, "_run_simulation", handler)

    job = ClaimedJob(
        id="job_sim_1",
        organization_id="org_test",
        job_type="simulation.run",
        status="running",
        priority=1,
        run_at=datetime.now(timezone.utc),
        resource_key="simulation:run:org_test",
        attempts=1,
        max_attempts=3,
        payload={"organization_id": "org_test"},
    )

    result = await worker._dispatch(job)

    assert result["simulation_id"] == "sim_1"
    assert handler.await_count == 1


async def test_run_simulation_job_invokes_engine(monkeypatch: pytest.MonkeyPatch) -> None:
    worker = JobsWorker()
    run_mock = AsyncMock(return_value=_FakeSimulationResponse())
    monkeypatch.setattr("src.simulation.engine.run_simulation", run_mock)

    job = ClaimedJob(
        id="job_sim_2",
        organization_id="org_test",
        job_type="simulation.run",
        status="running",
        priority=1,
        run_at=datetime.now(timezone.utc),
        resource_key="simulation:run:org_test",
        attempts=1,
        max_attempts=3,
        payload={"organization_id": "org_test", "scenario_name": "what_if", "persist": False},
    )

    result = await worker._run_simulation(job)

    assert result["simulation_id"] == "sim_1"
    assert run_mock.await_count == 1


async def test_run_intervention_propose_job_invokes_service(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    worker = JobsWorker()
    service = AsyncMock()
    service.propose_and_persist = AsyncMock(return_value={"intervention_id": "intv_1"})
    monkeypatch.setattr(
        "src.intervention.service.get_intervention_service",
        AsyncMock(return_value=service),
    )

    job = ClaimedJob(
        id="job_intv_1",
        organization_id="org_test",
        job_type="intervention.propose",
        status="running",
        priority=1,
        run_at=datetime.now(timezone.utc),
        resource_key="intervention:propose:org_test:entity_1",
        attempts=1,
        max_attempts=3,
        payload={
            "organization_id": "org_test",
            "target_ref": "entity_1",
            "pressure_score": 0.8,
            "causal_confidence": 0.7,
        },
    )

    result = await worker._run_intervention_propose(job)

    assert result["intervention_id"] == "intv_1"
    assert service.propose_and_persist.await_count == 1


async def test_run_intervention_capture_outcome_job_invokes_service(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    worker = JobsWorker()
    service = AsyncMock()
    service.capture_outcome = AsyncMock(return_value={"realized_outcome_id": "out_1"})
    monkeypatch.setattr(
        "src.intervention.service.get_intervention_service",
        AsyncMock(return_value=service),
    )

    job = ClaimedJob(
        id="job_out_1",
        organization_id="org_test",
        job_type="intervention.outcome.capture",
        status="running",
        priority=1,
        run_at=datetime.now(timezone.utc),
        resource_key="intervention:outcome:org_test:intv_1",
        attempts=1,
        max_attempts=3,
        payload={
            "organization_id": "org_test",
            "intervention_plan_id": "intv_1",
            "outcome_type": "execution_success",
            "outcome_payload": {"risk_delta": -0.1},
            "measured_at": "2026-02-23T12:00:00Z",
        },
    )

    result = await worker._run_intervention_capture_outcome(job)

    assert result["realized_outcome_id"] == "out_1"
    assert service.capture_outcome.await_count == 1
