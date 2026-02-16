from __future__ import annotations

from datetime import timedelta
from typing import Any

from temporalio import workflow


# Keep in sync with the legacy scheduler defaults (but do not import APScheduler modules here).
DEFAULT_SYNC_SCHEDULES: dict[str, dict[str, int]] = {
    "gmail": {"interval_minutes": 5},
    "outlook": {"interval_minutes": 5},
    "slack": {"interval_minutes": 5},
    "teams": {"interval_minutes": 5},
    "notion": {"interval_minutes": 15},
    "google_docs": {"interval_minutes": 15},
    "google_calendar": {"interval_minutes": 15},
    "hubspot": {"interval_minutes": 60},
    "whatsapp": {"interval_minutes": 15},
}


@workflow.defn(name="connectors.scheduled_sync_sweep")
class ScheduledSyncSweepWorkflow:
    """
    Sweep all active connections and enqueue idempotent scheduled sync jobs.

    This replaces the in-memory APScheduler "reconcile_connection_schedules" loop.
    """

    @workflow.run
    async def run(self, req: dict[str, Any]) -> dict[str, Any]:
        default_interval = int(req.get("default_interval_minutes") or 5)
        default_interval = max(1, min(default_interval, 24 * 60))

        sweep_limit = int(req.get("sweep_limit") or 5000)
        sweep_limit = max(1, min(sweep_limit, 50_000))

        rows = await workflow.execute_activity(
            "connections.list_active",
            {"limit": sweep_limit},
            start_to_close_timeout=timedelta(seconds=10),
        )
        if not isinstance(rows, list):
            raise RuntimeError("connections.list_active returned non-list payload")

        now_ts = int(workflow.now().timestamp())
        enqueued = 0
        skipped = 0

        for row in rows:
            if not isinstance(row, dict):
                continue

            connection_id = str(row.get("connection_id") or "")
            organization_id = str(row.get("organization_id") or "")
            connector_type = str(row.get("connector_type") or "")
            interval_minutes_raw = row.get("sync_frequency_minutes")

            if not connection_id or not organization_id:
                skipped += 1
                continue

            if interval_minutes_raw:
                try:
                    interval_minutes = int(interval_minutes_raw)
                except Exception:
                    interval_minutes = 0
            else:
                interval_minutes = 0

            if interval_minutes <= 0:
                interval_minutes = DEFAULT_SYNC_SCHEDULES.get(connector_type, {}).get(
                    "interval_minutes",
                    default_interval,
                )

            interval_minutes = max(1, interval_minutes)
            bucket_size = max(60, interval_minutes * 60)
            bucket = now_ts // bucket_size
            idempotency_key = f"scheduled_sync:{connection_id}:{bucket}"

            await workflow.execute_activity(
                "jobs.enqueue",
                {
                    "organization_id": organization_id,
                    "job_type": "connector.sync",
                    "payload": {
                        "connection_id": connection_id,
                        "organization_id": organization_id,
                        "scheduled": True,
                    },
                    "priority": 0,
                    "max_attempts": 3,
                    "idempotency_key": idempotency_key,
                    "resource_key": f"connection:{connection_id}",
                },
                start_to_close_timeout=timedelta(seconds=10),
            )
            enqueued += 1

        return {"enqueued": enqueued, "skipped": skipped, "scanned": len(rows)}

