"""Lakehouse backfill/replay/quality jobs."""

from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from src.db.client import get_db_pool
from src.db.rls import rls_context
from src.lakehouse.control_plane import (
    get_checkpoint,
    list_partitions,
    set_partition_quality,
    upsert_checkpoint,
)
from src.lakehouse.lifecycle import LakehouseLifecycleManager
from src.lakehouse.quality import evaluate_and_gate_partition
from src.lakehouse.writer import write_lake_record


def _as_utc(value: datetime | None) -> datetime | None:
    if value is None:
        return None
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def _parse_datetime(value: str | datetime | None) -> datetime | None:
    if value is None:
        return None
    if isinstance(value, datetime):
        return _as_utc(value)
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        return _as_utc(parsed)
    except Exception:
        return None


async def run_lakehouse_backfill(
    *,
    organization_id: str,
    start_time: datetime,
    end_time: datetime,
    source_key: str = "backfill",
) -> dict[str, Any]:
    """
    Backfill historical lakehouse layers from archived evidence and snapshots.
    """
    start = _as_utc(start_time) or datetime.now(timezone.utc)
    end = _as_utc(end_time) or datetime.now(timezone.utc)

    bronze_written = 0
    silver_written = 0
    with rls_context(None, is_internal=True):
        pool = await get_db_pool()
        async with pool.acquire() as conn:
            snapshot_rows = await conn.fetch(
                """
                SELECT
                    id::text,
                    organization_id,
                    frontier_entry_id::text,
                    url,
                    fetched_at,
                    storage_ref,
                    parsed_text
                FROM crawl_snapshot
                WHERE organization_id = $1
                  AND fetched_at BETWEEN $2::timestamptz AND $3::timestamptz
                ORDER BY fetched_at ASC
                LIMIT 5000
                """,
                organization_id,
                start,
                end,
            )

            sync_rows = await conn.fetch(
                """
                SELECT
                    id::text,
                    organization_id,
                    connector_type,
                    run_kind,
                    status,
                    started_at,
                    completed_at,
                    metadata
                FROM source_sync_run
                WHERE organization_id = $1
                  AND started_at BETWEEN $2::timestamptz AND $3::timestamptz
                ORDER BY started_at ASC
                LIMIT 5000
                """,
                organization_id,
                start,
                end,
            )

    for row in snapshot_rows:
        fetched_at = _as_utc(row["fetched_at"]) or datetime.now(timezone.utc)
        storage_ref = str(row["storage_ref"] or "")
        storage_exists = bool(storage_ref and Path(storage_ref).exists())
        bronze = await write_lake_record(
            table_name="bronze.raw_observations",
            schema_version="1.0",
            organization_id=organization_id,
            source_key=source_key,
            record_key=f"crawl_snapshot:{row['id']}",
            event_time=fetched_at,
            payload={
                "record_key": f"crawl_snapshot:{row['id']}",
                "organization_id": organization_id,
                "source_key": source_key,
                "event_time": fetched_at.isoformat(),
                "payload": {
                    "snapshot_id": row["id"],
                    "frontier_entry_id": row["frontier_entry_id"],
                    "url": row["url"],
                    "storage_ref": storage_ref,
                    "storage_exists": storage_exists,
                },
                "metadata": {"backfill": True},
            },
            idempotency_key=f"backfill:crawl:{row['id']}",
            metadata={"job_type": "lakehouse.backfill"},
        )
        bronze_written += 1 if bronze.accepted else 0

        if row["parsed_text"]:
            silver = await write_lake_record(
                table_name="silver.observations",
                schema_version="1.0",
                organization_id=organization_id,
                source_key=source_key,
                record_key=f"observation:{row['id']}",
                event_time=fetched_at,
                payload={
                    "observation_id": row["id"],
                    "organization_id": organization_id,
                    "source_key": source_key,
                    "observed_at": fetched_at.isoformat(),
                    "normalized_text": str(row["parsed_text"]),
                    "entities": [],
                    "evidence_links": [storage_ref] if storage_ref else [],
                    "metadata": {"backfill": True},
                },
                idempotency_key=f"backfill:silver:{row['id']}",
                metadata={"job_type": "lakehouse.backfill"},
            )
            silver_written += 1 if silver.accepted else 0

    for row in sync_rows:
        started_at = _as_utc(row["started_at"]) or datetime.now(timezone.utc)
        await write_lake_record(
            table_name="bronze.raw_observations",
            schema_version="1.0",
            organization_id=organization_id,
            source_key=str(row["connector_type"] or source_key),
            record_key=f"source_sync_run:{row['id']}",
            event_time=started_at,
            payload={
                "record_key": f"source_sync_run:{row['id']}",
                "organization_id": organization_id,
                "source_key": str(row["connector_type"] or source_key),
                "event_time": started_at.isoformat(),
                "payload": {
                    "run_kind": row["run_kind"],
                    "status": row["status"],
                    "completed_at": str(row["completed_at"]) if row["completed_at"] else None,
                    "metadata": row["metadata"] or {},
                },
                "metadata": {"backfill": True},
            },
            idempotency_key=f"backfill:sync_run:{row['id']}",
            metadata={"job_type": "lakehouse.backfill"},
        )

    return {
        "organization_id": organization_id,
        "start_time": start.isoformat(),
        "end_time": end.isoformat(),
        "bronze_written": bronze_written,
        "silver_written": silver_written,
        "snapshot_rows": len(snapshot_rows),
        "source_sync_rows": len(sync_rows),
    }


async def run_lakehouse_replay(
    *,
    organization_id: str,
    checkpoint_key: str,
    max_events: int = 2000,
) -> dict[str, Any]:
    checkpoint = await get_checkpoint(
        organization_id=organization_id,
        checkpoint_key=checkpoint_key,
    )
    last_created_at = _parse_datetime((checkpoint or {}).get("cursor", {}).get("last_created_at"))
    last_event_id = (checkpoint or {}).get("cursor", {}).get("last_event_id")

    replayed = 0
    silver_written = 0
    gold_written = 0
    with rls_context(None, is_internal=True):
        pool = await get_db_pool()
        async with pool.acquire() as conn:
            if last_created_at and last_event_id:
                rows = await conn.fetch(
                    """
                    SELECT
                        id::text,
                        organization_id,
                        event_type,
                        payload,
                        created_at
                    FROM event_records
                    WHERE organization_id = $1
                      AND (
                        created_at > $2::timestamptz
                        OR (created_at = $2::timestamptz AND id > $3)
                      )
                    ORDER BY created_at ASC, id ASC
                    LIMIT $4
                    """,
                    organization_id,
                    last_created_at,
                    last_event_id,
                    max(1, int(max_events)),
                )
            else:
                rows = await conn.fetch(
                    """
                    SELECT
                        id::text,
                        organization_id,
                        event_type,
                        payload,
                        created_at
                    FROM event_records
                    WHERE organization_id = $1
                    ORDER BY created_at ASC, id ASC
                    LIMIT $2
                    """,
                    organization_id,
                    max(1, int(max_events)),
                )

    new_last_created_at: datetime | None = last_created_at
    new_last_event_id: str | None = last_event_id
    for row in rows:
        replayed += 1
        created_at = _as_utc(row["created_at"]) or datetime.now(timezone.utc)
        event_type = str(row["event_type"] or "")
        payload = row["payload"] or {}

        if event_type == "observation.normalized.v1":
            observation_id = str(payload.get("observation_id") or row["id"])
            result = await write_lake_record(
                table_name="silver.observations",
                schema_version="1.0",
                organization_id=organization_id,
                source_key="event_replay",
                record_key=f"event_record:{row['id']}",
                event_time=created_at,
                payload={
                    "observation_id": observation_id,
                    "organization_id": organization_id,
                    "source_key": "event_replay",
                    "observed_at": created_at.isoformat(),
                    "normalized_text": str(payload.get("normalized_text") or ""),
                    "entities": payload.get("entities") or [],
                    "evidence_links": payload.get("evidence_links") or [],
                    "metadata": {"replayed_event_id": row["id"], "event_type": event_type},
                },
                idempotency_key=f"replay:{row['id']}",
                metadata={"checkpoint_key": checkpoint_key},
            )
            silver_written += 1 if result.accepted else 0
        elif event_type in {"impact.edge.computed.v1", "simulation.completed.v1"}:
            feature_key = str(payload.get("impact_edge_id") or payload.get("simulation_id") or row["id"])
            result = await write_lake_record(
                table_name="gold.impact_features",
                schema_version="1.0",
                organization_id=organization_id,
                source_key="event_replay",
                record_key=f"event_record:{row['id']}",
                event_time=created_at,
                payload={
                    "feature_key": feature_key,
                    "organization_id": organization_id,
                    "source_key": "event_replay",
                    "event_time": created_at.isoformat(),
                    "feature_vector": payload if isinstance(payload, dict) else {"value": payload},
                    "labels": {"event_type": event_type},
                },
                idempotency_key=f"replay:{row['id']}",
                metadata={"checkpoint_key": checkpoint_key},
            )
            gold_written += 1 if result.accepted else 0

        new_last_created_at = created_at
        new_last_event_id = str(row["id"])

    await upsert_checkpoint(
        organization_id=organization_id,
        checkpoint_key=checkpoint_key,
        cursor={
            "last_created_at": new_last_created_at.isoformat() if new_last_created_at else None,
            "last_event_id": new_last_event_id,
            "replayed_count": replayed,
        },
        metadata={"checkpoint_kind": "event_replay"},
    )
    return {
        "organization_id": organization_id,
        "checkpoint_key": checkpoint_key,
        "replayed_events": replayed,
        "silver_written": silver_written,
        "gold_written": gold_written,
        "last_event_id": new_last_event_id,
    }


async def run_lakehouse_quality(
    *,
    organization_id: str,
    table_name: str | None = None,
    limit: int = 500,
) -> dict[str, Any]:
    if organization_id == "internal":
        with rls_context(None, is_internal=True):
            pool = await get_db_pool()
            async with pool.acquire() as conn:
                org_rows = await conn.fetch("SELECT id FROM organization WHERE status = 'active' LIMIT 500")

        aggregate = {"organization_id": organization_id, "checked": 0, "passed": 0, "blocked": 0, "reports": []}
        for org_row in org_rows:
            org_id = str(org_row["id"])
            result = await run_lakehouse_quality(
                organization_id=org_id,
                table_name=table_name,
                limit=limit,
            )
            aggregate["checked"] += int(result.get("checked") or 0)
            aggregate["passed"] += int(result.get("passed") or 0)
            aggregate["blocked"] += int(result.get("blocked") or 0)
            aggregate["reports"].extend(result.get("reports") or [])
        return aggregate

    partitions = await list_partitions(
        organization_id=organization_id,
        table_name=table_name,
        quality_status="pending",
        limit=limit,
    )
    checked = 0
    passed = 0
    blocked = 0
    reports: list[dict[str, Any]] = []

    for partition in partitions:
        file_path = partition.get("partition_path")
        if not file_path:
            continue
        report = await evaluate_and_gate_partition(
            organization_id=organization_id,
            table_name=str(partition["table_name"]),
            partition_key=str(partition["partition_key"]),
            file_path=str(file_path),
        )
        checked += 1
        if report["status"] == "passed":
            passed += 1
        else:
            blocked += 1
        reports.append({
            "table_name": partition["table_name"],
            "partition_key": partition["partition_key"],
            "status": report["status"],
        })

    return {
        "organization_id": organization_id,
        "checked": checked,
        "passed": passed,
        "blocked": blocked,
        "reports": reports,
    }


async def run_lakehouse_retention(
    *,
    organization_id: str,
    limit: int = 5000,
) -> dict[str, Any]:
    if organization_id == "internal":
        with rls_context(None, is_internal=True):
            pool = await get_db_pool()
            async with pool.acquire() as conn:
                org_rows = await conn.fetch("SELECT id FROM organization WHERE status = 'active' LIMIT 500")
        deleted = 0
        scanned = 0
        for org_row in org_rows:
            result = await run_lakehouse_retention(
                organization_id=str(org_row["id"]),
                limit=limit,
            )
            deleted += int(result.get("deleted_files") or 0)
            scanned += int(result.get("scanned_partitions") or 0)
        return {"organization_id": organization_id, "scanned_partitions": scanned, "deleted_files": deleted}

    partitions = await list_partitions(
        organization_id=organization_id,
        table_name=None,
        quality_status=None,
        limit=limit,
    )
    now = datetime.now(timezone.utc)
    scanned = 0
    deleted = 0
    for partition in partitions:
        scanned += 1
        retention_until = _parse_datetime(partition.get("retention_until"))
        if not retention_until or retention_until > now:
            continue
        partition_path = partition.get("partition_path")
        if partition_path and Path(str(partition_path)).exists():
            try:
                Path(str(partition_path)).unlink()
                deleted += 1
            except Exception:
                pass
        await set_partition_quality(
            organization_id=organization_id,
            table_name=str(partition["table_name"]),
            partition_key=str(partition["partition_key"]),
            quality_status="expired",
            quality_report={
                "status": "expired",
                "expired_at": now.isoformat(),
                "retention_until": retention_until.isoformat(),
            },
        )

    return {
        "organization_id": organization_id,
        "scanned_partitions": scanned,
        "deleted_files": deleted,
    }


async def run_lakehouse_lifecycle(
    *,
    organization_id: str,
    limit: int = 5000,
    warm_after_days: int = 7,
    cold_after_days: int = 30,
) -> dict[str, Any]:
    if organization_id == "internal":
        with rls_context(None, is_internal=True):
            pool = await get_db_pool()
            async with pool.acquire() as conn:
                org_rows = await conn.fetch("SELECT id FROM organization WHERE status = 'active' LIMIT 500")
        transitioned = 0
        scanned = 0
        for org_row in org_rows:
            result = await run_lakehouse_lifecycle(
                organization_id=str(org_row["id"]),
                limit=limit,
                warm_after_days=warm_after_days,
                cold_after_days=cold_after_days,
            )
            transitioned += int(result.get("transitioned") or 0)
            scanned += int(result.get("scanned_partitions") or 0)
        return {
            "organization_id": organization_id,
            "scanned_partitions": scanned,
            "transitioned": transitioned,
        }

    partitions = await list_partitions(
        organization_id=organization_id,
        table_name=None,
        quality_status=None,
        limit=limit,
    )
    manager = LakehouseLifecycleManager(
        warm_after_days=warm_after_days,
        cold_after_days=cold_after_days,
    )
    transitions = manager.plan_transitions(partitions=partitions)
    if not transitions:
        return {
            "organization_id": organization_id,
            "scanned_partitions": len(partitions),
            "transitioned": 0,
            "transitions": [],
        }

    with rls_context(None, is_internal=True):
        pool = await get_db_pool()
        async with pool.acquire() as conn:
            for transition in transitions:
                await conn.execute(
                    """
                    UPDATE lakehouse_partition
                    SET metadata = COALESCE(metadata, '{}'::jsonb) || $4::jsonb,
                        updated_at = NOW()
                    WHERE organization_id = $1
                      AND table_name = $2
                      AND partition_key = $3
                    """,
                    organization_id,
                    transition.table_name,
                    transition.partition_key,
                    {
                        "storage_class": transition.to_class,
                        "lifecycle_reason": transition.reason,
                        "lifecycle_updated_at": datetime.now(timezone.utc).isoformat(),
                    },
                )

    return {
        "organization_id": organization_id,
        "scanned_partitions": len(partitions),
        "transitioned": len(transitions),
        "transitions": [item.to_dict() for item in transitions],
    }
