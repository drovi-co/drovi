"""Persistence helpers for source ingestion run ledger (`source_sync_run`)."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any
from uuid import uuid4

from src.db.client import get_db_pool
from src.db.rls import rls_context


@dataclass(frozen=True)
class SourceSyncRunStart:
    organization_id: str
    connection_id: str
    connector_type: str
    run_kind: str
    started_at: datetime
    scheduled_interval_minutes: int | None
    freshness_lag_minutes: int | None
    quota_headroom_ratio: float | None
    voi_priority: float | None
    checkpoint_before: dict[str, Any]
    watermark_before: datetime | None
    metadata: dict[str, Any]


def _as_utc(dt: datetime | None) -> datetime | None:
    if dt is None:
        return None
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


async def create_source_sync_run(start: SourceSyncRunStart) -> str:
    run_id = str(uuid4())
    with rls_context(None, is_internal=True):
        pool = await get_db_pool()
        async with pool.acquire() as conn:
            await conn.execute(
                """
                INSERT INTO source_sync_run (
                    id,
                    organization_id,
                    connection_id,
                    connector_type,
                    run_kind,
                    status,
                    scheduled_interval_minutes,
                    freshness_lag_minutes,
                    quota_headroom_ratio,
                    voi_priority,
                    checkpoint_before,
                    watermark_before,
                    metadata,
                    started_at,
                    created_at,
                    updated_at
                )
                VALUES (
                    $1, $2, $3::uuid, $4, $5, 'running',
                    $6, $7, $8, $9, $10::jsonb, $11::timestamptz, $12::jsonb,
                    $13::timestamptz, $14::timestamptz, $14::timestamptz
                )
                """,
                run_id,
                start.organization_id,
                start.connection_id,
                start.connector_type,
                start.run_kind,
                start.scheduled_interval_minutes,
                start.freshness_lag_minutes,
                start.quota_headroom_ratio,
                start.voi_priority,
                start.checkpoint_before or {},
                _as_utc(start.watermark_before),
                start.metadata or {},
                _as_utc(start.started_at) or _utc_now(),
                _utc_now(),
            )
    return run_id


async def finalize_source_sync_run(
    *,
    run_id: str,
    status: str,
    records_synced: int,
    bytes_synced: int,
    cost_units: float | None,
    retry_class: str | None,
    checkpoint_after: dict[str, Any],
    watermark_after: datetime | None,
    completed_at: datetime | None = None,
    metadata_patch: dict[str, Any] | None = None,
) -> None:
    completed = _as_utc(completed_at) or _utc_now()
    with rls_context(None, is_internal=True):
        pool = await get_db_pool()
        async with pool.acquire() as conn:
            await conn.execute(
                """
                UPDATE source_sync_run
                SET status = $2,
                    records_synced = $3,
                    bytes_synced = $4,
                    cost_units = $5,
                    retry_class = $6,
                    checkpoint_after = $7::jsonb,
                    watermark_after = $8::timestamptz,
                    completed_at = $9::timestamptz,
                    duration_seconds = GREATEST(
                        0,
                        FLOOR(EXTRACT(EPOCH FROM ($9::timestamptz - started_at)))
                    )::int,
                    metadata = COALESCE(metadata, '{}'::jsonb) || $10::jsonb,
                    updated_at = $9::timestamptz
                WHERE id = $1
                """,
                run_id,
                status,
                int(max(0, records_synced)),
                int(max(0, bytes_synced)),
                float(cost_units) if cost_units is not None else None,
                retry_class,
                checkpoint_after or {},
                _as_utc(watermark_after),
                completed,
                metadata_patch or {},
            )


async def count_recent_failed_runs(
    *,
    connection_id: str,
    within_minutes: int,
) -> int:
    lookback = _utc_now() - timedelta(minutes=max(1, int(within_minutes)))
    with rls_context(None, is_internal=True):
        pool = await get_db_pool()
        async with pool.acquire() as conn:
            value = await conn.fetchval(
                """
                SELECT COUNT(1)
                FROM source_sync_run
                WHERE connection_id = $1::uuid
                  AND status = 'failed'
                  AND started_at >= $2::timestamptz
                """,
                connection_id,
                lookback,
            )
    return int(value or 0)


async def list_source_sync_runs(
    *,
    connection_id: str,
    limit: int = 50,
) -> list[dict[str, Any]]:
    safe_limit = max(1, min(int(limit), 500))
    with rls_context(None, is_internal=True):
        pool = await get_db_pool()
        async with pool.acquire() as conn:
            rows = await conn.fetch(
                """
                SELECT
                    id::text,
                    organization_id,
                    connection_id::text,
                    connector_type,
                    run_kind,
                    status,
                    retry_class,
                    scheduled_interval_minutes,
                    freshness_lag_minutes,
                    quota_headroom_ratio,
                    voi_priority,
                    records_synced,
                    bytes_synced,
                    cost_units,
                    started_at,
                    completed_at,
                    duration_seconds,
                    metadata
                FROM source_sync_run
                WHERE connection_id = $1::uuid
                ORDER BY started_at DESC
                LIMIT $2
                """,
                connection_id,
                safe_limit,
            )

    payload: list[dict[str, Any]] = []
    for row in rows or []:
        payload.append(
            {
                "id": str(row["id"]),
                "organization_id": str(row["organization_id"]),
                "connection_id": str(row["connection_id"]),
                "connector_type": str(row["connector_type"]),
                "run_kind": str(row["run_kind"]),
                "status": str(row["status"]),
                "retry_class": str(row["retry_class"]) if row["retry_class"] else None,
                "scheduled_interval_minutes": (
                    int(row["scheduled_interval_minutes"])
                    if row["scheduled_interval_minutes"] is not None
                    else None
                ),
                "freshness_lag_minutes": (
                    int(row["freshness_lag_minutes"])
                    if row["freshness_lag_minutes"] is not None
                    else None
                ),
                "quota_headroom_ratio": (
                    float(row["quota_headroom_ratio"])
                    if row["quota_headroom_ratio"] is not None
                    else None
                ),
                "voi_priority": float(row["voi_priority"]) if row["voi_priority"] is not None else None,
                "records_synced": int(row["records_synced"] or 0),
                "bytes_synced": int(row["bytes_synced"] or 0),
                "cost_units": float(row["cost_units"]) if row["cost_units"] is not None else None,
                "started_at": row["started_at"].isoformat() if row["started_at"] else None,
                "completed_at": row["completed_at"].isoformat() if row["completed_at"] else None,
                "duration_seconds": int(row["duration_seconds"] or 0) if row["duration_seconds"] is not None else None,
                "metadata": row["metadata"] or {},
            }
        )
    return payload
