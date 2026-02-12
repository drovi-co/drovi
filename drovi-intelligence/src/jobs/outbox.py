"""Outbox events for async side-effects (derived indexes, external sinks).

This is a lightweight queue stored in Postgres (`outbox_event`) with:
- idempotency keys (per org)
- leases for crash-only processing
- bounded retries with exponential backoff

The jobs worker can drain this table via a job_type (Phase 6), or a dedicated
worker loop can be introduced later.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Any
from uuid import uuid4

import structlog

from src.db import client as db_client
from src.db.rls import rls_context
from src.jobs.queue import compute_backoff_seconds
from src.kernel.time import utc_now

logger = structlog.get_logger()


@dataclass(frozen=True)
class EnqueueOutboxEventRequest:
    organization_id: str
    event_type: str
    payload: dict[str, Any]
    priority: int = 0
    max_attempts: int = 10
    idempotency_key: str | None = None
    payload_version: int = 1


async def enqueue_outbox_event(request: EnqueueOutboxEventRequest) -> str:
    event_id = str(uuid4())
    now = utc_now()

    with rls_context(None, is_internal=True):
        pool = await db_client.get_db_pool()
        async with pool.acquire() as conn:
            row = await conn.fetchrow(
                """
                INSERT INTO outbox_event (
                    id, organization_id, event_type, status, priority,
                    attempts, max_attempts, idempotency_key,
                    payload_version, payload,
                    created_at, updated_at
                )
                VALUES (
                    $1, $2, $3, 'pending', $4,
                    0, $5, $6,
                    $7, $8,
                    $9, $9
                )
                ON CONFLICT (organization_id, idempotency_key)
                DO UPDATE SET updated_at = EXCLUDED.updated_at
                RETURNING id
                """,
                event_id,
                request.organization_id,
                request.event_type,
                int(request.priority),
                int(max(1, request.max_attempts)),
                request.idempotency_key,
                int(max(1, request.payload_version)),
                request.payload,
                now,
            )

    return str(row["id"]) if row else event_id


@dataclass(frozen=True)
class ClaimedOutboxEvent:
    id: str
    organization_id: str
    event_type: str
    priority: int
    attempts: int
    max_attempts: int
    payload_version: int
    payload: dict[str, Any]


async def claim_outbox_events(
    *,
    worker_id: str,
    lease_seconds: int,
    limit: int,
) -> list[ClaimedOutboxEvent]:
    now = utc_now()
    lease_until = now + timedelta(seconds=max(5, int(lease_seconds)))
    limit = max(1, min(int(limit), 2000))

    with rls_context(None, is_internal=True):
        pool = await db_client.get_db_pool()
        async with pool.acquire() as conn:
            rows = await conn.fetch(
                """
                WITH picked AS (
                    SELECT id
                    FROM outbox_event
                    WHERE status IN ('pending', 'processing')
                      AND attempts < max_attempts
                      AND (lease_until IS NULL OR lease_until < $1)
                    ORDER BY priority DESC, created_at ASC
                    FOR UPDATE SKIP LOCKED
                    LIMIT $2
                )
                UPDATE outbox_event oe
                SET status = 'processing',
                    locked_by = $3,
                    lease_until = $4,
                    attempts = oe.attempts + 1,
                    updated_at = $1
                FROM picked
                WHERE oe.id = picked.id
                RETURNING
                    oe.id::text,
                    oe.organization_id,
                    oe.event_type,
                    oe.priority,
                    oe.attempts,
                    oe.max_attempts,
                    oe.payload_version,
                    oe.payload
                """,
                now,
                limit,
                worker_id,
                lease_until,
            )

    out: list[ClaimedOutboxEvent] = []
    for row in rows or []:
        out.append(
            ClaimedOutboxEvent(
                id=str(row["id"]),
                organization_id=row["organization_id"],
                event_type=row["event_type"],
                priority=int(row["priority"] or 0),
                attempts=int(row["attempts"] or 0),
                max_attempts=int(row["max_attempts"] or 10),
                payload_version=int(row["payload_version"] or 1),
                payload=row["payload"] or {},
            )
        )
    return out


async def mark_outbox_succeeded(*, event_id: str, worker_id: str) -> None:
    now = utc_now()
    with rls_context(None, is_internal=True):
        pool = await db_client.get_db_pool()
        async with pool.acquire() as conn:
            await conn.execute(
                """
                UPDATE outbox_event
                SET status = 'succeeded',
                    lease_until = NULL,
                    locked_by = NULL,
                    last_error = NULL,
                    updated_at = $2
                WHERE id = $1
                """,
                event_id,
                now,
            )


async def mark_outbox_failed(
    *,
    event_id: str,
    error: str,
    attempts: int,
    max_attempts: int,
) -> None:
    now = utc_now()
    status = "pending" if attempts < max_attempts else "failed"
    backoff_seconds = compute_backoff_seconds(attempt=attempts)
    cooldown_until = now + timedelta(seconds=max(1, int(backoff_seconds)))

    with rls_context(None, is_internal=True):
        pool = await db_client.get_db_pool()
        async with pool.acquire() as conn:
            await conn.execute(
                """
                UPDATE outbox_event
                SET status = $2,
                    lease_until = CASE WHEN $2 = 'pending' THEN $3::timestamptz ELSE NULL END,
                    locked_by = NULL,
                    last_error = $4,
                    updated_at = $5::timestamptz
                WHERE id = $1
                """,
                event_id,
                status,
                cooldown_until,
                error,
                now,
            )

    logger.warning(
        "Outbox event failed",
        event_id=event_id,
        attempts=attempts,
        max_attempts=max_attempts,
        status=status,
        backoff_seconds=int(backoff_seconds),
        error=str(error),
    )

