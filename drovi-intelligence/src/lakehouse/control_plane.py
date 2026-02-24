"""Lakehouse control-plane persistence helpers."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any
from uuid import uuid4

from src.db.client import get_db_pool
from src.db.rls import rls_context


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _as_utc(value: datetime | None) -> datetime | None:
    if value is None:
        return None
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


async def upsert_checkpoint(
    *,
    organization_id: str,
    checkpoint_key: str,
    cursor: dict[str, Any],
    metadata: dict[str, Any] | None = None,
) -> None:
    now = _utc_now()
    with rls_context(None, is_internal=True):
        pool = await get_db_pool()
        async with pool.acquire() as conn:
            await conn.execute(
                """
                INSERT INTO lakehouse_checkpoint (
                    id,
                    organization_id,
                    checkpoint_key,
                    cursor,
                    metadata,
                    updated_at
                )
                VALUES (
                    $1, $2, $3, $4::jsonb, $5::jsonb, $6::timestamptz
                )
                ON CONFLICT (organization_id, checkpoint_key)
                DO UPDATE SET
                    cursor = EXCLUDED.cursor,
                    metadata = COALESCE(lakehouse_checkpoint.metadata, '{}'::jsonb) || EXCLUDED.metadata,
                    updated_at = EXCLUDED.updated_at
                """,
                str(uuid4()),
                organization_id,
                checkpoint_key,
                cursor or {},
                metadata or {},
                now,
            )


async def get_checkpoint(
    *,
    organization_id: str,
    checkpoint_key: str,
) -> dict[str, Any] | None:
    with rls_context(None, is_internal=True):
        pool = await get_db_pool()
        async with pool.acquire() as conn:
            row = await conn.fetchrow(
                """
                SELECT cursor, metadata, updated_at
                FROM lakehouse_checkpoint
                WHERE organization_id = $1
                  AND checkpoint_key = $2
                """,
                organization_id,
                checkpoint_key,
            )
    return dict(row) if row else None


async def upsert_partition_state(
    *,
    organization_id: str,
    layer: str,
    table_name: str,
    partition_key: str,
    partition_path: str,
    table_format: str,
    schema_version: str,
    row_count_delta: int,
    bytes_written_delta: int,
    first_event_at: datetime | None,
    last_event_at: datetime | None,
    retention_until: datetime | None = None,
    metadata_patch: dict[str, Any] | None = None,
) -> None:
    now = _utc_now()
    with rls_context(None, is_internal=True):
        pool = await get_db_pool()
        async with pool.acquire() as conn:
            await conn.execute(
                """
                INSERT INTO lakehouse_partition (
                    id,
                    organization_id,
                    layer,
                    table_name,
                    partition_key,
                    partition_path,
                    table_format,
                    schema_version,
                    row_count,
                    bytes_written,
                    first_event_at,
                    last_event_at,
                    quality_status,
                    quality_report,
                    retention_until,
                    metadata,
                    created_at,
                    updated_at
                )
                VALUES (
                    $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::timestamptz, $12::timestamptz,
                    'pending', '{}'::jsonb, $13::timestamptz, $14::jsonb, $15::timestamptz, $15::timestamptz
                )
                ON CONFLICT (organization_id, table_name, partition_key)
                DO UPDATE SET
                    partition_path = EXCLUDED.partition_path,
                    table_format = EXCLUDED.table_format,
                    schema_version = EXCLUDED.schema_version,
                    row_count = COALESCE(lakehouse_partition.row_count, 0) + EXCLUDED.row_count,
                    bytes_written = COALESCE(lakehouse_partition.bytes_written, 0) + EXCLUDED.bytes_written,
                    first_event_at = COALESCE(
                        LEAST(lakehouse_partition.first_event_at, EXCLUDED.first_event_at),
                        EXCLUDED.first_event_at,
                        lakehouse_partition.first_event_at
                    ),
                    last_event_at = COALESCE(
                        GREATEST(lakehouse_partition.last_event_at, EXCLUDED.last_event_at),
                        EXCLUDED.last_event_at,
                        lakehouse_partition.last_event_at
                    ),
                    retention_until = COALESCE(EXCLUDED.retention_until, lakehouse_partition.retention_until),
                    metadata = COALESCE(lakehouse_partition.metadata, '{}'::jsonb) || EXCLUDED.metadata,
                    updated_at = EXCLUDED.updated_at
                """,
                str(uuid4()),
                organization_id,
                layer,
                table_name,
                partition_key,
                partition_path,
                table_format,
                schema_version,
                max(0, int(row_count_delta)),
                max(0, int(bytes_written_delta)),
                _as_utc(first_event_at),
                _as_utc(last_event_at),
                _as_utc(retention_until),
                metadata_patch or {},
                now,
            )


async def set_partition_quality(
    *,
    organization_id: str,
    table_name: str,
    partition_key: str,
    quality_status: str,
    quality_report: dict[str, Any],
) -> None:
    with rls_context(None, is_internal=True):
        pool = await get_db_pool()
        async with pool.acquire() as conn:
            await conn.execute(
                """
                UPDATE lakehouse_partition
                SET quality_status = $4,
                    quality_report = $5::jsonb,
                    updated_at = $6::timestamptz
                WHERE organization_id = $1
                  AND table_name = $2
                  AND partition_key = $3
                """,
                organization_id,
                table_name,
                partition_key,
                quality_status,
                quality_report or {},
                _utc_now(),
            )


async def list_partitions(
    *,
    organization_id: str,
    table_name: str | None = None,
    quality_status: str | None = None,
    limit: int = 200,
) -> list[dict[str, Any]]:
    safe_limit = max(1, min(int(limit), 2000))
    with rls_context(None, is_internal=True):
        pool = await get_db_pool()
        async with pool.acquire() as conn:
            if table_name and quality_status:
                rows = await conn.fetch(
                    """
                    SELECT
                        id::text,
                        organization_id,
                        layer,
                        table_name,
                        partition_key,
                        partition_path,
                        table_format,
                        schema_version,
                        row_count,
                        bytes_written,
                        first_event_at,
                        last_event_at,
                        quality_status,
                        quality_report,
                        retention_until,
                        metadata,
                        created_at,
                        updated_at
                    FROM lakehouse_partition
                    WHERE organization_id = $1
                      AND table_name = $2
                      AND quality_status = $3
                    ORDER BY updated_at DESC
                    LIMIT $4
                    """,
                    organization_id,
                    table_name,
                    quality_status,
                    safe_limit,
                )
            elif table_name:
                rows = await conn.fetch(
                    """
                    SELECT
                        id::text,
                        organization_id,
                        layer,
                        table_name,
                        partition_key,
                        partition_path,
                        table_format,
                        schema_version,
                        row_count,
                        bytes_written,
                        first_event_at,
                        last_event_at,
                        quality_status,
                        quality_report,
                        retention_until,
                        metadata,
                        created_at,
                        updated_at
                    FROM lakehouse_partition
                    WHERE organization_id = $1
                      AND table_name = $2
                    ORDER BY updated_at DESC
                    LIMIT $3
                    """,
                    organization_id,
                    table_name,
                    safe_limit,
                )
            elif quality_status:
                rows = await conn.fetch(
                    """
                    SELECT
                        id::text,
                        organization_id,
                        layer,
                        table_name,
                        partition_key,
                        partition_path,
                        table_format,
                        schema_version,
                        row_count,
                        bytes_written,
                        first_event_at,
                        last_event_at,
                        quality_status,
                        quality_report,
                        retention_until,
                        metadata,
                        created_at,
                        updated_at
                    FROM lakehouse_partition
                    WHERE organization_id = $1
                      AND quality_status = $2
                    ORDER BY updated_at DESC
                    LIMIT $3
                    """,
                    organization_id,
                    quality_status,
                    safe_limit,
                )
            else:
                rows = await conn.fetch(
                    """
                    SELECT
                        id::text,
                        organization_id,
                        layer,
                        table_name,
                        partition_key,
                        partition_path,
                        table_format,
                        schema_version,
                        row_count,
                        bytes_written,
                        first_event_at,
                        last_event_at,
                        quality_status,
                        quality_report,
                        retention_until,
                        metadata,
                        created_at,
                        updated_at
                    FROM lakehouse_partition
                    WHERE organization_id = $1
                    ORDER BY updated_at DESC
                    LIMIT $2
                    """,
                    organization_id,
                    safe_limit,
                )
    return [dict(row) for row in rows]


async def record_cost_attribution(
    *,
    organization_id: str,
    source_key: str,
    table_name: str,
    partition_key: str,
    records_written: int,
    bytes_written: int,
    compute_millis: int,
    cost_units: float,
    period_start: datetime,
    period_end: datetime,
    metadata: dict[str, Any] | None = None,
) -> None:
    with rls_context(None, is_internal=True):
        pool = await get_db_pool()
        async with pool.acquire() as conn:
            await conn.execute(
                """
                INSERT INTO lakehouse_cost_attribution (
                    id,
                    organization_id,
                    source_key,
                    table_name,
                    partition_key,
                    records_written,
                    bytes_written,
                    compute_millis,
                    cost_units,
                    period_start,
                    period_end,
                    metadata,
                    created_at
                )
                VALUES (
                    $1, $2, $3, $4, $5, $6, $7, $8, $9, $10::timestamptz, $11::timestamptz, $12::jsonb, $13::timestamptz
                )
                """,
                str(uuid4()),
                organization_id,
                source_key,
                table_name,
                partition_key,
                max(0, int(records_written)),
                max(0, int(bytes_written)),
                max(0, int(compute_millis)),
                float(max(cost_units, 0.0)),
                _as_utc(period_start) or _utc_now(),
                _as_utc(period_end) or _utc_now(),
                metadata or {},
                _utc_now(),
            )


async def summarize_cost_attribution(
    *,
    organization_id: str,
    source_key: str | None = None,
    table_name: str | None = None,
    group_by: str = "source_table",
    limit: int = 500,
) -> list[dict[str, Any]]:
    from src.ops.cost_attribution import summarize_cost_records

    safe_limit = max(1, min(int(limit), 5000))
    with rls_context(None, is_internal=True):
        pool = await get_db_pool()
        async with pool.acquire() as conn:
            if source_key and table_name:
                rows = await conn.fetch(
                    """
                    SELECT
                        organization_id,
                        source_key,
                        table_name,
                        records_written,
                        bytes_written,
                        compute_millis,
                        cost_units,
                        metadata
                    FROM lakehouse_cost_attribution
                    WHERE organization_id = $1
                      AND source_key = $2
                      AND table_name = $3
                    ORDER BY created_at DESC
                    LIMIT $4
                    """,
                    organization_id,
                    source_key,
                    table_name,
                    safe_limit,
                )
            elif source_key:
                rows = await conn.fetch(
                    """
                    SELECT
                        organization_id,
                        source_key,
                        table_name,
                        records_written,
                        bytes_written,
                        compute_millis,
                        cost_units,
                        metadata
                    FROM lakehouse_cost_attribution
                    WHERE organization_id = $1
                      AND source_key = $2
                    ORDER BY created_at DESC
                    LIMIT $3
                    """,
                    organization_id,
                    source_key,
                    safe_limit,
                )
            elif table_name:
                rows = await conn.fetch(
                    """
                    SELECT
                        organization_id,
                        source_key,
                        table_name,
                        records_written,
                        bytes_written,
                        compute_millis,
                        cost_units,
                        metadata
                    FROM lakehouse_cost_attribution
                    WHERE organization_id = $1
                      AND table_name = $2
                    ORDER BY created_at DESC
                    LIMIT $3
                    """,
                    organization_id,
                    table_name,
                    safe_limit,
                )
            else:
                rows = await conn.fetch(
                    """
                    SELECT
                        organization_id,
                        source_key,
                        table_name,
                        records_written,
                        bytes_written,
                        compute_millis,
                        cost_units,
                        metadata
                    FROM lakehouse_cost_attribution
                    WHERE organization_id = $1
                    ORDER BY created_at DESC
                    LIMIT $2
                    """,
                    organization_id,
                    safe_limit,
                )
    return summarize_cost_records(
        records=[dict(row) for row in rows],
        group_by=group_by,
    )
