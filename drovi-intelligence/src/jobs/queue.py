"""Postgres-backed durable background job queue."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Any
from uuid import uuid4

import structlog

from src.db import client as db_client
from src.db.rls import rls_context
from src.kernel.time import utc_now

logger = structlog.get_logger()


@dataclass(frozen=True)
class EnqueueJobRequest:
    organization_id: str
    job_type: str
    payload: dict[str, Any]
    priority: int = 0
    run_at: datetime | None = None
    max_attempts: int = 5
    idempotency_key: str | None = None
    resource_key: str | None = None


async def enqueue_job(request: EnqueueJobRequest) -> str:
    """
    Enqueue a durable job.

    Idempotency: if `idempotency_key` is provided, the (organization_id, idempotency_key)
    unique constraint ensures deduplication.
    """
    job_id = str(uuid4())
    now = utc_now()
    run_at = request.run_at or now

    with rls_context(None, is_internal=True):
        pool = await db_client.get_db_pool()
        async with pool.acquire() as conn:
            row = await conn.fetchrow(
                """
                INSERT INTO background_job (
                    id, organization_id, job_type, status, priority, run_at,
                    resource_key, attempts, max_attempts, idempotency_key, payload,
                    created_at, updated_at
                )
                VALUES (
                    $1, $2, $3, 'queued', $4, $5,
                    $6, 0, $7, $8, $9,
                    $10, $10
                )
                ON CONFLICT (organization_id, idempotency_key)
                DO UPDATE SET updated_at = EXCLUDED.updated_at
                RETURNING id
                """,
                job_id,
                request.organization_id,
                request.job_type,
                int(request.priority),
                run_at,
                request.resource_key,
                int(max(1, request.max_attempts)),
                request.idempotency_key,
                request.payload,
                now,
            )

    # If we hit the idempotency constraint, we return the existing row's id.
    return str(row["id"]) if row else job_id


@dataclass(frozen=True)
class ClaimedJob:
    id: str
    organization_id: str
    job_type: str
    status: str
    priority: int
    run_at: datetime
    resource_key: str | None
    attempts: int
    max_attempts: int
    payload: dict[str, Any]


async def claim_next_job(*, worker_id: str, lease_seconds: int) -> ClaimedJob | None:
    """
    Claim the next runnable job using a lease (FOR UPDATE SKIP LOCKED).

    Resource isolation:
    - If `resource_key` is set, we avoid claiming when another running job has the same resource_key
      and its lease has not expired.
    """
    now = utc_now()
    lease_until = now + timedelta(seconds=max(5, lease_seconds))

    with rls_context(None, is_internal=True):
        pool = await db_client.get_db_pool()
        async with pool.acquire() as conn:
            row = await conn.fetchrow(
                """
                UPDATE background_job
                SET status = 'running',
                    locked_by = $1,
                    lease_until = $2,
                    attempts = attempts + 1,
                    started_at = COALESCE(started_at, $3),
                    updated_at = $3
                WHERE id = (
                    SELECT bj.id
                    FROM background_job bj
                    WHERE bj.status = 'queued'
                      AND bj.run_at <= $3
                      AND (bj.lease_until IS NULL OR bj.lease_until < $3)
                      AND (
                        bj.resource_key IS NULL
                        OR NOT EXISTS (
                          SELECT 1
                          FROM background_job running
                          WHERE running.status = 'running'
                            AND running.resource_key = bj.resource_key
                            AND running.lease_until > $3
                        )
                      )
                    ORDER BY bj.priority DESC, bj.run_at ASC, bj.created_at ASC
                    FOR UPDATE SKIP LOCKED
                    LIMIT 1
                )
                RETURNING
                    id::text,
                    organization_id,
                    job_type,
                    status,
                    priority,
                    run_at,
                    resource_key,
                    attempts,
                    max_attempts,
                    payload
                """,
                worker_id,
                lease_until,
                now,
            )

    if not row:
        return None

    return ClaimedJob(
        id=str(row["id"]),
        organization_id=row["organization_id"],
        job_type=row["job_type"],
        status=row["status"],
        priority=int(row["priority"] or 0),
        run_at=row["run_at"],
        resource_key=row["resource_key"],
        attempts=int(row["attempts"] or 0),
        max_attempts=int(row["max_attempts"] or 5),
        payload=row["payload"] or {},
    )


async def mark_job_succeeded(*, job_id: str, result: dict[str, Any] | None = None) -> None:
    now = utc_now()
    with rls_context(None, is_internal=True):
        pool = await db_client.get_db_pool()
        async with pool.acquire() as conn:
            await conn.execute(
                """
                UPDATE background_job
                SET status = 'succeeded',
                    completed_at = $2,
                    lease_until = NULL,
                    result = $3,
                    last_error = NULL,
                    updated_at = $2
                WHERE id = $1
                """,
                job_id,
                now,
                result or {},
            )


async def mark_job_failed(
    *,
    job_id: str,
    error: str,
    attempts: int,
    max_attempts: int,
    backoff_seconds: int,
) -> None:
    now = utc_now()
    status = "queued" if attempts < max_attempts else "failed"
    next_run_at = now + timedelta(seconds=max(1, backoff_seconds))

    with rls_context(None, is_internal=True):
        pool = await db_client.get_db_pool()
        async with pool.acquire() as conn:
            await conn.execute(
                """
                UPDATE background_job
                SET status = $2,
                    completed_at = CASE WHEN $2 = 'failed' THEN $3::timestamptz ELSE NULL END,
                    lease_until = NULL,
                    last_error = $4,
                    run_at = CASE WHEN $2 = 'queued' THEN $5::timestamptz ELSE run_at END,
                    updated_at = $3::timestamptz
                WHERE id = $1
                """,
                job_id,
                status,
                now,
                error,
                next_run_at,
            )


async def cancel_job(*, job_id: str) -> bool:
    now = utc_now()
    with rls_context(None, is_internal=True):
        pool = await db_client.get_db_pool()
        async with pool.acquire() as conn:
            status = await conn.fetchval(
                """
                UPDATE background_job
                SET status = 'cancelled',
                    completed_at = $2,
                    lease_until = NULL,
                    updated_at = $2
                WHERE id = $1 AND status IN ('queued', 'running')
                RETURNING status
                """,
                job_id,
                now,
            )
    return status is not None


async def extend_lease(*, job_id: str, worker_id: str, lease_seconds: int) -> bool:
    now = utc_now()
    lease_until = now + timedelta(seconds=max(5, lease_seconds))
    with rls_context(None, is_internal=True):
        pool = await db_client.get_db_pool()
        async with pool.acquire() as conn:
            updated = await conn.execute(
                """
                UPDATE background_job
                SET lease_until = $3,
                    updated_at = $2
                WHERE id = $1
                  AND status = 'running'
                  AND locked_by = $4
                """,
                job_id,
                now,
                lease_until,
                worker_id,
            )
    # asyncpg returns strings like "UPDATE 1"
    return str(updated).endswith("1")


async def requeue_expired_running_jobs(*, limit: int = 500) -> int:
    """
    Requeue jobs that were marked 'running' but whose lease expired.

    Without this, a worker crash can leave jobs stuck in 'running' forever.
    """
    now = utc_now()
    safe_limit = int(max(1, limit))

    with rls_context(None, is_internal=True):
        pool = await db_client.get_db_pool()
        async with pool.acquire() as conn:
            rows = await conn.fetch(
                """
                WITH expired AS (
                    SELECT id
                    FROM background_job
                    WHERE status = 'running'
                      AND lease_until IS NOT NULL
                      AND lease_until < $2::timestamptz
                    ORDER BY lease_until ASC
                    LIMIT $1
                    FOR UPDATE SKIP LOCKED
                )
                UPDATE background_job bj
                SET status = CASE WHEN bj.attempts >= bj.max_attempts THEN 'failed' ELSE 'queued' END,
                    completed_at = CASE WHEN bj.attempts >= bj.max_attempts THEN $2::timestamptz ELSE NULL END,
                    lease_until = NULL,
                    locked_by = NULL,
                    last_error = COALESCE(bj.last_error, 'Lease expired'),
                    run_at = CASE WHEN bj.attempts >= bj.max_attempts THEN bj.run_at ELSE $2::timestamptz END,
                    updated_at = $2::timestamptz
                FROM expired
                WHERE bj.id = expired.id
                RETURNING bj.id::text
                """,
                safe_limit,
                now,
            )

    return len(rows or [])


def compute_backoff_seconds(*, attempt: int) -> int:
    # Small exponential backoff with clamp.
    # attempt=1 -> 2s, attempt=2 -> 4s, attempt=3 -> 8s
    return min(300, max(2, 2 ** attempt))
