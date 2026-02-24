"""Lakehouse read/query interfaces for analytics and model training."""

from __future__ import annotations

from datetime import datetime, timezone
import json
from pathlib import Path
from typing import Any

from src.lakehouse.control_plane import list_partitions


def _parse_iso(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        if parsed.tzinfo is None:
            return parsed.replace(tzinfo=timezone.utc)
        return parsed.astimezone(timezone.utc)
    except Exception:
        return None


def _load_partition_rows(path: str) -> list[dict[str, Any]]:
    file_path = Path(path)
    if not file_path.exists():
        return []
    rows: list[dict[str, Any]] = []
    with file_path.open("r", encoding="utf-8") as handle:
        for line in handle:
            text = line.strip()
            if not text:
                continue
            try:
                rows.append(json.loads(text))
            except Exception:
                continue
    return rows


async def query_lakehouse_table(
    *,
    organization_id: str,
    table_name: str,
    start_time: datetime | None = None,
    end_time: datetime | None = None,
    limit: int = 5000,
    dedupe_by_key: bool = True,
) -> list[dict[str, Any]]:
    partitions = await list_partitions(
        organization_id=organization_id,
        table_name=table_name,
        quality_status="passed",
        limit=2000,
    )
    rows: list[dict[str, Any]] = []
    for partition in partitions:
        partition_path = partition.get("partition_path")
        if not partition_path:
            continue
        rows.extend(_load_partition_rows(str(partition_path)))

    filtered: list[dict[str, Any]] = []
    for row in rows:
        event_time = _parse_iso(
            row.get("event_time")
            or row.get("observed_at")
            or (row.get("_meta") or {}).get("event_time")
        )
        if start_time and event_time and event_time < start_time:
            continue
        if end_time and event_time and event_time > end_time:
            continue
        filtered.append(row)

    if not dedupe_by_key:
        return filtered[: max(1, limit)]

    latest_by_key: dict[str, dict[str, Any]] = {}
    for row in filtered:
        key = (
            str(row.get("record_key"))
            or str(row.get("observation_id"))
            or str(row.get("feature_key"))
            or str(row.get("simulation_key"))
            or str(row.get("eval_key"))
            or str((row.get("_meta") or {}).get("record_key"))
        )
        event_time = _parse_iso(
            row.get("event_time")
            or row.get("observed_at")
            or (row.get("_meta") or {}).get("event_time")
        )
        previous = latest_by_key.get(key)
        if previous is None:
            latest_by_key[key] = row
            continue
        previous_time = _parse_iso(
            previous.get("event_time")
            or previous.get("observed_at")
            or (previous.get("_meta") or {}).get("event_time")
        )
        if event_time and previous_time:
            if event_time >= previous_time:
                latest_by_key[key] = row
        elif event_time and not previous_time:
            latest_by_key[key] = row

    deduped = list(latest_by_key.values())
    deduped.sort(
        key=lambda row: _parse_iso(
            row.get("event_time")
            or row.get("observed_at")
            or (row.get("_meta") or {}).get("event_time")
            or ""
        )
        or datetime.now(timezone.utc),
        reverse=True,
    )
    return deduped[: max(1, limit)]
