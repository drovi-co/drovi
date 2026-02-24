"""Lakehouse write path (bronze/silver/gold) with schema checks and idempotent upserts."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
import hashlib
import json
from pathlib import Path
import time
from typing import Any
from uuid import uuid4

from src.config import get_settings
from src.lakehouse.contracts import get_table_schema, validate_schema_payload
from src.lakehouse.control_plane import (
    get_checkpoint,
    record_cost_attribution,
    upsert_checkpoint,
    upsert_partition_state,
)


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _parse_event_time(value: str | datetime | None) -> datetime:
    if isinstance(value, datetime):
        event_time = value
    elif isinstance(value, str):
        normalized = value.replace("Z", "+00:00")
        event_time = datetime.fromisoformat(normalized)
    else:
        event_time = _utc_now()
    if event_time.tzinfo is None:
        return event_time.replace(tzinfo=timezone.utc)
    return event_time.astimezone(timezone.utc)


def _json_dumps(payload: dict[str, Any]) -> str:
    return json.dumps(payload, sort_keys=True, ensure_ascii=True, separators=(",", ":"))


def _sha256_text(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def _lake_root() -> Path:
    settings = get_settings()
    return Path(settings.lakehouse_storage_path).expanduser()


def _table_paths(*, table_name: str, organization_id: str) -> tuple[Path, Path]:
    table_slug = table_name.replace(".", "_")
    root = _lake_root()
    index_path = root / "_indexes" / table_slug / f"org={organization_id}.json"
    watermark_path = root / "_watermarks" / table_slug / f"org={organization_id}.json"
    return index_path, watermark_path


def _load_json(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {}
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return {}


def _write_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(_json_dumps(payload), encoding="utf-8")


def _partition_key(event_time: datetime) -> str:
    return event_time.strftime("date=%Y-%m-%d")


def _partition_path(
    *,
    table_name: str,
    organization_id: str,
    source_key: str,
    event_time: datetime,
) -> Path:
    root = _lake_root()
    layer, table_short = table_name.split(".", 1)
    return (
        root
        / layer
        / table_short
        / f"org={organization_id}"
        / f"source={source_key}"
        / _partition_key(event_time)
    )


def _retention_until(event_time: datetime, retention_days: int) -> datetime:
    return event_time + timedelta(days=max(1, int(retention_days)))


def _compute_cost_units(*, bytes_written: int, compute_millis: int, records_written: int) -> float:
    # Lightweight blended cost model for attribution and FinOps controls.
    return round(
        (max(bytes_written, 0) / float(1024 * 1024 * 50))
        + (max(compute_millis, 0) / 10000.0)
        + (max(records_written, 0) / 20000.0),
        6,
    )


@dataclass(frozen=True)
class LakehouseWriteResult:
    accepted: bool
    table_name: str
    partition_key: str
    partition_path: str
    record_key: str
    late_arrival: bool
    reason: str | None = None


async def write_lake_record(
    *,
    table_name: str,
    schema_version: str,
    payload: dict[str, Any],
    organization_id: str,
    source_key: str,
    record_key: str,
    event_time: str | datetime | None,
    idempotency_key: str | None = None,
    metadata: dict[str, Any] | None = None,
    retention_days: int | None = None,
) -> LakehouseWriteResult:
    started = time.perf_counter()
    settings = get_settings()
    schema = get_table_schema(table_name, schema_version=schema_version)
    is_valid, errors = validate_schema_payload(
        table_name=table_name,
        schema_version=schema_version,
        payload=payload,
    )
    if not is_valid:
        return LakehouseWriteResult(
            accepted=False,
            table_name=table_name,
            partition_key="",
            partition_path="",
            record_key=record_key,
            late_arrival=False,
            reason="schema_invalid:" + ",".join(errors),
        )

    event_time_dt = _parse_event_time(event_time)
    partition_key = _partition_key(event_time_dt)
    partition_dir = _partition_path(
        table_name=table_name,
        organization_id=organization_id,
        source_key=source_key,
        event_time=event_time_dt,
    )
    partition_dir.mkdir(parents=True, exist_ok=True)
    data_file = partition_dir / "records.jsonl"

    index_path, watermark_path = _table_paths(
        table_name=table_name,
        organization_id=organization_id,
    )
    index_doc = _load_json(index_path)
    watermark_doc = _load_json(watermark_path)
    idempotency_doc = index_doc.setdefault("_idempotency", {})
    record_index = index_doc.setdefault("records", {})

    event_payload = {
        **payload,
        "_meta": {
            "record_key": record_key,
            "organization_id": organization_id,
            "source_key": source_key,
            "event_time": event_time_dt.isoformat(),
            "ingested_at": _utc_now().isoformat(),
            "idempotency_key": idempotency_key,
            "metadata": metadata or {},
        },
    }
    payload_hash = _sha256_text(_json_dumps(event_payload))
    existing = record_index.get(record_key) or {}
    existing_event_time_raw = existing.get("event_time")
    existing_payload_hash = existing.get("payload_hash")
    existing_event_time = _parse_event_time(existing_event_time_raw) if existing_event_time_raw else None

    if idempotency_key and idempotency_doc.get(idempotency_key):
        return LakehouseWriteResult(
            accepted=False,
            table_name=table_name,
            partition_key=partition_key,
            partition_path=str(data_file),
            record_key=record_key,
            late_arrival=False,
            reason="duplicate_idempotency_key",
        )
    if existing_event_time and existing_event_time > event_time_dt:
        return LakehouseWriteResult(
            accepted=False,
            table_name=table_name,
            partition_key=partition_key,
            partition_path=str(data_file),
            record_key=record_key,
            late_arrival=True,
            reason="stale_event",
        )
    if existing_event_time and existing_event_time == event_time_dt and existing_payload_hash == payload_hash:
        return LakehouseWriteResult(
            accepted=False,
            table_name=table_name,
            partition_key=partition_key,
            partition_path=str(data_file),
            record_key=record_key,
            late_arrival=False,
            reason="duplicate_payload",
        )

    checkpoint_key = f"lakehouse_watermark:{table_name}"
    checkpoint = await get_checkpoint(organization_id=organization_id, checkpoint_key=checkpoint_key)
    watermark_time: datetime | None = None
    if checkpoint and isinstance(checkpoint.get("cursor"), dict):
        raw_watermark = checkpoint["cursor"].get("max_event_time")
        if raw_watermark:
            watermark_time = _parse_event_time(raw_watermark)

    late_arrival = (
        bool(watermark_time)
        and event_time_dt < watermark_time
        and (watermark_time - event_time_dt).total_seconds() > float(settings.lakehouse_late_arrival_grace_seconds)
    )

    line = _json_dumps(event_payload)
    with data_file.open("a", encoding="utf-8") as handle:
        handle.write(line + "\n")
    bytes_written = len(line.encode("utf-8")) + 1
    elapsed_millis = int((time.perf_counter() - started) * 1000)
    cost_units = _compute_cost_units(
        bytes_written=bytes_written,
        compute_millis=elapsed_millis,
        records_written=1,
    )

    record_index[record_key] = {
        "event_time": event_time_dt.isoformat(),
        "payload_hash": payload_hash,
        "partition_path": str(data_file),
        "table_name": table_name,
    }
    if idempotency_key:
        idempotency_doc[idempotency_key] = {
            "record_key": record_key,
            "event_time": event_time_dt.isoformat(),
        }
    watermark_doc["max_event_time"] = max(
        event_time_dt,
        watermark_time or event_time_dt,
    ).isoformat()
    _write_json(index_path, index_doc)
    _write_json(watermark_path, watermark_doc)

    await upsert_checkpoint(
        organization_id=organization_id,
        checkpoint_key=checkpoint_key,
        cursor={
            "max_event_time": watermark_doc["max_event_time"],
            "last_record_key": record_key,
            "last_partition_key": partition_key,
        },
        metadata={"table_name": table_name, "schema_version": schema_version},
    )
    await upsert_partition_state(
        organization_id=organization_id,
        layer=schema.layer,
        table_name=table_name,
        partition_key=partition_key,
        partition_path=str(data_file),
        table_format=settings.lakehouse_table_format,
        schema_version=schema_version,
        row_count_delta=1,
        bytes_written_delta=bytes_written,
        first_event_at=event_time_dt,
        last_event_at=event_time_dt,
        retention_until=_retention_until(
            event_time_dt,
            int(retention_days) if retention_days is not None else int(settings.lakehouse_retention_days_default),
        ),
        metadata_patch={
            "source_key": source_key,
            "late_arrival": late_arrival,
        },
    )
    await record_cost_attribution(
        organization_id=organization_id,
        source_key=source_key,
        table_name=table_name,
        partition_key=partition_key,
        records_written=1,
        bytes_written=bytes_written,
        compute_millis=elapsed_millis,
        cost_units=cost_units,
        period_start=event_time_dt,
        period_end=_utc_now(),
        metadata={
            "schema_version": schema_version,
            **(metadata or {}),
        },
    )

    return LakehouseWriteResult(
        accepted=True,
        table_name=table_name,
        partition_key=partition_key,
        partition_path=str(data_file),
        record_key=record_key,
        late_arrival=late_arrival,
    )
