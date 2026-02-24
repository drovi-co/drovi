"""Lakehouse data-quality checks and gating."""

from __future__ import annotations

from collections import Counter
from datetime import datetime, timezone
import json
from pathlib import Path
from typing import Any

from src.config import get_settings
from src.lakehouse.contracts import get_table_schema
from src.lakehouse.control_plane import set_partition_quality


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


def _load_rows(file_path: str) -> list[dict[str, Any]]:
    path = Path(file_path)
    if not path.exists():
        return []
    rows: list[dict[str, Any]] = []
    with path.open("r", encoding="utf-8") as handle:
        for line in handle:
            cleaned = line.strip()
            if not cleaned:
                continue
            try:
                rows.append(json.loads(cleaned))
            except Exception:
                continue
    return rows


def evaluate_partition_quality(
    *,
    table_name: str,
    file_path: str,
) -> dict[str, Any]:
    settings = get_settings()
    rows = _load_rows(file_path)
    schema = get_table_schema(table_name, schema_version="1.0")
    required = [field.name for field in schema.fields if field.required]

    row_count = len(rows)
    null_violations = 0
    uniqueness_violations = 0
    stale_rows = 0
    keys = Counter()
    now = datetime.now(timezone.utc)
    max_staleness = max(60, int(settings.lakehouse_quality_max_staleness_seconds))

    for row in rows:
        for key in required:
            if key not in row or row.get(key) is None:
                null_violations += 1

        primary_value = row.get(schema.primary_key)
        if primary_value is not None:
            keys[str(primary_value)] += 1

        event_time = _parse_iso(row.get(schema.event_time_field))
        if event_time:
            if (now - event_time).total_seconds() > max_staleness:
                stale_rows += 1

    uniqueness_violations = sum(max(0, count - 1) for count in keys.values())
    completeness = 1.0 if row_count == 0 else max(0.0, 1.0 - (null_violations / float(row_count * max(1, len(required)))))
    uniqueness = 1.0 if row_count == 0 else max(0.0, 1.0 - (uniqueness_violations / float(row_count)))
    freshness = 1.0 if row_count == 0 else max(0.0, 1.0 - (stale_rows / float(row_count)))

    status = "passed"
    if completeness < float(settings.lakehouse_quality_min_completeness):
        status = "failed"
    if uniqueness < float(settings.lakehouse_quality_min_uniqueness):
        status = "failed"
    if freshness < float(settings.lakehouse_quality_min_freshness):
        status = "failed"

    return {
        "status": status,
        "row_count": row_count,
        "completeness": round(completeness, 6),
        "uniqueness": round(uniqueness, 6),
        "freshness": round(freshness, 6),
        "null_violations": null_violations,
        "uniqueness_violations": uniqueness_violations,
        "stale_rows": stale_rows,
        "checked_at": now.isoformat(),
    }


async def evaluate_and_gate_partition(
    *,
    organization_id: str,
    table_name: str,
    partition_key: str,
    file_path: str,
) -> dict[str, Any]:
    report = evaluate_partition_quality(table_name=table_name, file_path=file_path)
    await set_partition_quality(
        organization_id=organization_id,
        table_name=table_name,
        partition_key=partition_key,
        quality_status="passed" if report["status"] == "passed" else "blocked",
        quality_report=report,
    )
    return report
