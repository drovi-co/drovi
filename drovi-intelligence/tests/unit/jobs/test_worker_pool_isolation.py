from __future__ import annotations

import asyncio
from types import SimpleNamespace

import pytest

from src.jobs.worker import JobsWorker

pytestmark = [pytest.mark.unit, pytest.mark.asyncio]


async def test_jobs_worker_parses_allowed_job_types_from_settings(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        "src.jobs.worker.get_settings",
        lambda: SimpleNamespace(
            job_worker_lease_seconds=600,
            job_worker_poll_interval_seconds=0.01,
            job_worker_reaper_interval_seconds=60,
            job_worker_reaper_limit=100,
            job_worker_allowed_job_types=["impact.compute", " normative.sentinel ", "", None],
        ),
    )

    worker = JobsWorker()
    assert worker._allowed_job_types == ["impact.compute", "normative.sentinel"]


async def test_jobs_worker_passes_allowed_job_types_to_claim_query(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        "src.jobs.worker.get_settings",
        lambda: SimpleNamespace(
            job_worker_lease_seconds=600,
            job_worker_poll_interval_seconds=0.01,
            job_worker_reaper_interval_seconds=60,
            job_worker_reaper_limit=100,
            job_worker_allowed_job_types=["impact.compute", "normative.sentinel"],
        ),
    )
    worker = JobsWorker()

    captured: dict[str, object] = {}

    async def fake_claim_next_job(**kwargs):  # noqa: ANN003
        captured.update(kwargs)
        await worker.shutdown()
        return None

    async def fake_reaper() -> None:
        await worker._shutdown.wait()

    monkeypatch.setattr("src.jobs.worker.claim_next_job", fake_claim_next_job)
    monkeypatch.setattr(worker, "_reap_expired_running_jobs", fake_reaper)

    await asyncio.wait_for(worker.run_forever(), timeout=2.0)

    assert captured.get("allowed_job_types") == ["impact.compute", "normative.sentinel"]
