from __future__ import annotations

from dataclasses import dataclass
from datetime import timedelta
from typing import Any

from temporalio import workflow


@dataclass(frozen=True)
class WaitForJobResult:
    job_id: str
    status: str
    snapshot: dict[str, Any]


async def wait_for_background_job(
    *,
    job_id: str,
    poll_every: timedelta = timedelta(seconds=5),
    timeout: timedelta = timedelta(hours=6),
) -> WaitForJobResult:
    """
    Wait until a durable background job reaches a terminal state.

    The job plane statuses are stored in Postgres:
    - queued
    - running
    - succeeded
    - failed
    - cancelled

    This helper is deterministic because it relies on Temporal timers and activities.
    """
    start = workflow.now()
    deadline = start + timeout

    while True:
        snap = await workflow.execute_activity(
            "jobs.get_snapshot",
            str(job_id),
            start_to_close_timeout=timedelta(seconds=10),
        )
        if snap is None:
            raise RuntimeError(f"background job not found: {job_id}")
        if not isinstance(snap, dict):
            raise RuntimeError("jobs.get_snapshot returned non-object payload")

        status = str(snap.get("status") or "")
        if status in ("succeeded", "failed", "cancelled"):
            return WaitForJobResult(job_id=str(job_id), status=status, snapshot=snap)

        if workflow.now() >= deadline:
            raise TimeoutError(f"Timed out waiting for job {job_id} (last_status={status})")

        await workflow.sleep(poll_every)

