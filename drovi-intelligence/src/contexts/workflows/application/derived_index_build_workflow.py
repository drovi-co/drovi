from __future__ import annotations

import hashlib
from datetime import timedelta
from typing import Any

from temporalio import workflow

from src.contexts.workflows.application._job_wait import wait_for_background_job


@workflow.defn(name="indexes.derived_build")
class DerivedIndexBuildWorkflow:
    """
    Derived index build / drain workflow.

    Today this is used as a resilience primitive to batch-drain existing outboxes
    (e.g. connector webhook outbox) via the durable jobs plane.

    Phase 6 will expand this to the canonical truth outbox (graph/vector/indexes).
    """

    @workflow.run
    async def run(self, req: dict[str, Any]) -> dict[str, Any]:
        organization_id = str(req.get("organization_id") or "internal")
        limit = int(req.get("limit") or 100)
        limit = max(1, min(limit, 2000))

        total_published = 0
        batch = 0

        while True:
            batch += 1
            bucket = int(workflow.now().timestamp()) // 60
            material = f"outbox_flush:{bucket}:{batch}:{limit}"
            idempotency_key = hashlib.sha256(material.encode("utf-8")).hexdigest()

            job_id = await workflow.execute_activity(
                "jobs.enqueue",
                {
                    "organization_id": organization_id,
                    "job_type": "webhook.outbox.flush",
                    "payload": {"limit": limit},
                    "priority": 0,
                    "max_attempts": 3,
                    "idempotency_key": idempotency_key,
                    "resource_key": "system:webhook_outbox_flush",
                },
                start_to_close_timeout=timedelta(seconds=15),
            )

            final = await wait_for_background_job(
                job_id=str(job_id),
                poll_every=timedelta(seconds=5),
                timeout=timedelta(hours=1),
            )
            if final.status != "succeeded":
                raise RuntimeError(
                    f"outbox flush job failed (job_id={final.job_id}, status={final.status})"
                )

            result = final.snapshot.get("result") if isinstance(final.snapshot, dict) else {}
            published = int((result or {}).get("published") or 0)
            total_published += published

            # Stop when we drained the backlog.
            if published < limit:
                break

            # Backpressure: keep the loop polite. The job plane is the main throughput lever.
            await workflow.sleep(timedelta(seconds=2))

        return {"published_total": total_published, "batches": batch, "limit": limit}

