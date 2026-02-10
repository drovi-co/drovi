from __future__ import annotations

from dataclasses import asdict
from datetime import timedelta
from typing import Any

import structlog
from temporalio import activity

from src.db import client as db_client
from src.db.rls import rls_context
from src.jobs.queue import EnqueueJobRequest, enqueue_job, get_job_snapshot
from src.kernel.time import parse_iso8601

logger = structlog.get_logger()


@activity.defn(name="jobs.enqueue")
async def enqueue_background_job(req: dict[str, Any]) -> str:
    """
    Enqueue a Postgres durable background job.

    Args payload is a JSON-serializable dict (Temporal data converter friendly).
    """
    organization_id = str(req.get("organization_id") or "")
    job_type = str(req.get("job_type") or "")
    payload = req.get("payload") or {}
    if not organization_id or not job_type:
        raise ValueError("jobs.enqueue requires organization_id and job_type")
    if not isinstance(payload, dict):
        raise ValueError("jobs.enqueue payload must be an object")

    run_at_raw = req.get("run_at")
    run_at = parse_iso8601(str(run_at_raw)) if run_at_raw else None

    request = EnqueueJobRequest(
        organization_id=organization_id,
        job_type=job_type,
        payload=payload,
        priority=int(req.get("priority") or 0),
        run_at=run_at,
        max_attempts=int(req.get("max_attempts") or 5),
        idempotency_key=str(req.get("idempotency_key")) if req.get("idempotency_key") else None,
        resource_key=str(req.get("resource_key")) if req.get("resource_key") else None,
    )

    job_id = await enqueue_job(request)
    logger.info(
        "temporal_activity_enqueued_job",
        job_id=job_id,
        organization_id=organization_id,
        job_type=job_type,
    )
    return job_id


@activity.defn(name="jobs.get_snapshot")
async def get_background_job_snapshot(job_id: str) -> dict[str, Any] | None:
    snap = await get_job_snapshot(job_id=str(job_id))
    if not snap:
        return None
    data = asdict(snap)
    # Convert datetimes for Temporal JSON converter.
    for key in ("run_at", "started_at", "completed_at"):
        value = data.get(key)
        data[key] = value.isoformat() if value else None
    return data


@activity.defn(name="connections.list_active")
async def list_active_connections(req: dict[str, Any] | None = None) -> list[dict[str, Any]]:
    """
    List active connections for the scheduled sync sweep.

    Returned values must be JSON-serializable (Temporal default data converter).
    """
    req = req or {}
    limit = int(req.get("limit") or 5000)
    limit = max(1, min(limit, 50_000))

    with rls_context(None, is_internal=True):
        pool = await db_client.get_db_pool()
        async with pool.acquire() as conn:
            rows = await conn.fetch(
                """
                SELECT
                    id::text as id,
                    organization_id,
                    connector_type,
                    sync_frequency_minutes
                FROM connections
                WHERE sync_enabled = TRUE
                  AND status IN ('active', 'connected')
                ORDER BY organization_id ASC, id ASC
                LIMIT $1
                """,
                limit,
            )

    return [
        {
            "connection_id": str(r["id"]),
            "organization_id": str(r["organization_id"]),
            "connector_type": str(r["connector_type"]),
            "sync_frequency_minutes": int(r["sync_frequency_minutes"] or 0),
        }
        for r in (rows or [])
    ]
