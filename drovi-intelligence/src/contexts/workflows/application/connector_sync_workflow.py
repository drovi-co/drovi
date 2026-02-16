from __future__ import annotations

import hashlib
from datetime import timedelta
from typing import Any

from temporalio import workflow

from src.contexts.workflows.application._job_wait import wait_for_background_job


@workflow.defn(name="connectors.sync")
class ConnectorSyncWorkflow:
    """
    Orchestrates a single connector sync run.

    Execution is delegated to the durable jobs plane (`background_job`) so retries
    and crash recovery are handled consistently across the system.
    """

    @workflow.run
    async def run(self, req: dict[str, Any]) -> dict[str, Any]:
        organization_id = str(req.get("organization_id") or "")
        connection_id = str(req.get("connection_id") or "")
        if not organization_id or not connection_id:
            raise ValueError("ConnectorSyncWorkflow requires organization_id and connection_id")

        scheduled = bool(req.get("scheduled") or False)
        streams = req.get("streams") or None
        if streams is not None and not isinstance(streams, list):
            raise ValueError("streams must be a list or null")

        payload: dict[str, Any] = {
            "connection_id": connection_id,
            "organization_id": organization_id,
            "streams": streams,
            "full_refresh": bool(req.get("full_refresh") or False),
            "scheduled": scheduled,
        }

        for key in ("sync_params", "sync_job_type", "backfill_start", "backfill_end"):
            if key in req and req.get(key) is not None:
                payload[key] = req.get(key)

        # Stable idempotency within a workflow run (and safe to call multiple times).
        idempotency_key = req.get("idempotency_key")
        if not idempotency_key:
            material = f"syncwf:{connection_id}:{workflow.info().run_id}:{int(scheduled)}"
            idempotency_key = hashlib.sha256(material.encode("utf-8")).hexdigest()

        job_id = await workflow.execute_activity(
            "jobs.enqueue",
            {
                "organization_id": organization_id,
                "job_type": "connector.sync",
                "payload": payload,
                "priority": int(req.get("priority") or 0),
                "max_attempts": int(req.get("max_attempts") or 3),
                "idempotency_key": str(idempotency_key),
                "resource_key": f"connection:{connection_id}",
            },
            start_to_close_timeout=timedelta(seconds=15),
        )

        final = await wait_for_background_job(
            job_id=str(job_id),
            poll_every=timedelta(seconds=5),
            timeout=timedelta(hours=6),
        )

        return {
            "job_id": final.job_id,
            "status": final.status,
            "result": final.snapshot.get("result") if isinstance(final.snapshot, dict) else None,
            "last_error": final.snapshot.get("last_error") if isinstance(final.snapshot, dict) else None,
        }

