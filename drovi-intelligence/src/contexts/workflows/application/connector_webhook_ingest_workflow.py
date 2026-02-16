from __future__ import annotations

import hashlib
import json
from datetime import timedelta
from typing import Any

from temporalio import workflow

from src.contexts.workflows.application._job_wait import wait_for_background_job


@workflow.defn(name="connectors.webhook_ingest")
class ConnectorWebhookIngestWorkflow:
    """
    Handle an inbound connector webhook event.

    In the current architecture, webhook payloads are first persisted via the
    inbox/outbox tables, then we trigger a targeted connector sync as needed.

    This workflow is intentionally thin: it dedupes using the webhook event id or
    payload hash, then delegates execution to the durable jobs plane.
    """

    @workflow.run
    async def run(self, req: dict[str, Any]) -> dict[str, Any]:
        organization_id = str(req.get("organization_id") or "")
        connection_id = str(req.get("connection_id") or "")
        provider = str(req.get("provider") or "")
        event_type = str(req.get("event_type") or "")
        if not organization_id or not connection_id or not provider or not event_type:
            raise ValueError(
                "ConnectorWebhookIngestWorkflow requires organization_id, connection_id, provider, event_type"
            )

        payload = req.get("payload") or {}
        if not isinstance(payload, dict):
            raise ValueError("payload must be an object")

        event_id = req.get("event_id")
        if event_id:
            dedupe = f"{provider}:{connection_id}:{event_id}"
        else:
            payload_str = json.dumps(payload, sort_keys=True, default=str)
            digest = hashlib.sha256(payload_str.encode("utf-8")).hexdigest()[:24]
            dedupe = f"{provider}:{connection_id}:{digest}"

        idempotency_key = f"webhook_sync:{dedupe}"
        streams = req.get("streams") or None
        if streams is not None and not isinstance(streams, list):
            raise ValueError("streams must be a list or null")

        job_id = await workflow.execute_activity(
            "jobs.enqueue",
            {
                "organization_id": organization_id,
                "job_type": "connector.sync",
                "payload": {
                    "connection_id": connection_id,
                    "organization_id": organization_id,
                    "scheduled": False,
                    "sync_job_type": "webhook",
                    "streams": streams,
                    "sync_params": req.get("sync_params") or {},
                    "webhook_event_type": event_type,
                },
                "priority": 2,
                "max_attempts": 3,
                "idempotency_key": idempotency_key,
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
            "idempotency_key": idempotency_key,
        }

