from __future__ import annotations

from datetime import datetime, timezone
from unittest.mock import AsyncMock

import pytest

from src.jobs.queue import ClaimedJob
from src.jobs.worker import JobsWorker

pytestmark = [pytest.mark.unit, pytest.mark.asyncio]


async def test_worker_dispatches_learning_feedback_ingest_job(monkeypatch: pytest.MonkeyPatch) -> None:
    worker = JobsWorker()
    job = ClaimedJob(
        id="job_learn_1",
        organization_id="org_test",
        job_type="learning.feedback.ingest",
        status="running",
        priority=1,
        run_at=datetime.now(timezone.utc),
        resource_key="learning:feedback:org_test",
        attempts=1,
        max_attempts=3,
        payload={"events": []},
    )
    handler = AsyncMock(return_value={"feedback_count": 1})
    monkeypatch.setattr(worker, "_run_learning_feedback_ingest", handler)

    result = await worker._dispatch(job)

    assert result["feedback_count"] == 1
    assert handler.await_count == 1


async def test_run_learning_feedback_ingest_builds_snapshot() -> None:
    worker = JobsWorker()
    job = ClaimedJob(
        id="job_learn_2",
        organization_id="org_test",
        job_type="learning.feedback.ingest",
        status="running",
        priority=1,
        run_at=datetime.now(timezone.utc),
        resource_key="learning:feedback:org_test",
        attempts=1,
        max_attempts=3,
        payload={
            "events": [
                {
                    "event_id": "ev_1",
                    "target_ref": "obj_1",
                    "source_key": "ui",
                    "event_type": "user_correction",
                    "occurred_at": "2026-02-20T10:00:00Z",
                    "metadata": {"verdict": "accepted"},
                }
            ]
        },
    )

    result = await worker._run_learning_feedback_ingest(job)

    assert result["feedback_count"] == 1
    assert result["snapshot"]["sample_size"] == 1


async def test_run_learning_recalibrate_returns_scheduled_jobs() -> None:
    worker = JobsWorker()
    job = ClaimedJob(
        id="job_learn_3",
        organization_id="org_test",
        job_type="learning.recalibrate",
        status="running",
        priority=1,
        run_at=datetime.now(timezone.utc),
        resource_key="learning:recalibrate:org_test",
        attempts=1,
        max_attempts=3,
        payload={
            "organization_id": "org_test",
            "last_recalibration_at": "2026-02-20T10:00:00Z",
            "last_retrain_at": "2026-02-10T10:00:00Z",
            "new_feedback_count": 200,
            "now": "2026-02-23T10:00:00Z",
        },
    )

    result = await worker._run_learning_recalibrate(job)

    assert result["decision"]["should_recalibrate"] is True
    assert result["decision"]["should_retrain"] is True
    assert len(result["scheduled_jobs"]) >= 1


async def test_run_mlops_shadow_and_canary_evaluate_control_rollout() -> None:
    worker = JobsWorker()
    shadow_job = ClaimedJob(
        id="job_mlops_1",
        organization_id="org_test",
        job_type="mlops.shadow.evaluate",
        status="running",
        priority=1,
        run_at=datetime.now(timezone.utc),
        resource_key="mlops:shadow:org_test",
        attempts=1,
        max_attempts=3,
        payload={
            "baseline_outputs": [{"score": 0.8}],
            "candidate_outputs": [{"score": 0.2}],
            "expected_labels": [1],
            "accuracy": 0.7,
            "calibration_error": 0.3,
            "latency_p95_ms": 2000,
        },
    )

    shadow_result = await worker._run_mlops_shadow_evaluate(shadow_job)
    assert shadow_result["blocked"] is True

    canary_job = ClaimedJob(
        id="job_mlops_2",
        organization_id="org_test",
        job_type="mlops.canary.evaluate",
        status="running",
        priority=1,
        run_at=datetime.now(timezone.utc),
        resource_key="mlops:canary:org_test",
        attempts=1,
        max_attempts=3,
        payload={
            "baseline_metrics": {"accuracy": 0.9, "latency_p95_ms": 200, "cost_per_1k_tokens": 0.4},
            "canary_metrics": {"accuracy": 0.8, "latency_p95_ms": 600, "cost_per_1k_tokens": 0.9},
            "prediction_outcomes": [[0.9, 0], [0.8, 0]],
            "events": [{"model_id": "mdl_1", "latency_ms": 2000, "cost_per_1k_tokens": 0.9}],
        },
    )

    canary_result = await worker._run_mlops_canary_evaluate(canary_job)
    assert canary_result["rollback"] is True

