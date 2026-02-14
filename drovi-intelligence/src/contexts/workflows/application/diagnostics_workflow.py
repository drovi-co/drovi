from __future__ import annotations

import hashlib
from datetime import timedelta
from typing import Any

from temporalio import workflow

from src.contexts.workflows.application._job_wait import wait_for_background_job


@workflow.defn(name="diagnostics.noop")
class DiagnosticsNoopWorkflow:
    """
    Internal smoke-test workflow.

    This provides a deterministic, safe way to validate:
    Temporal -> activity -> Postgres durable job -> jobs worker -> completion polling.
    """

    @workflow.run
    async def run(self, req: dict[str, Any]) -> dict[str, Any]:
        organization_id = str(req.get("organization_id") or "internal")
        material = f"noop:{workflow.info().run_id}"
        idempotency_key = hashlib.sha256(material.encode("utf-8")).hexdigest()

        job_id = await workflow.execute_activity(
            "jobs.enqueue",
            {
                "organization_id": organization_id,
                "job_type": "system.noop",
                "payload": {},
                "priority": 10,
                "max_attempts": 1,
                "idempotency_key": idempotency_key,
                "resource_key": "system:noop",
            },
            start_to_close_timeout=timedelta(seconds=10),
        )

        final = await wait_for_background_job(
            job_id=str(job_id),
            poll_every=timedelta(seconds=1),
            timeout=timedelta(minutes=5),
        )
        if final.status != "succeeded":
            raise RuntimeError(f"system.noop job did not succeed (status={final.status})")
        return {"job_id": final.job_id, "status": final.status}

