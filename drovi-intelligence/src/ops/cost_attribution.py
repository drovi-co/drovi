"""Cost attribution helpers for tenant/worker/pack accounting."""

from __future__ import annotations

from collections import defaultdict
from typing import Any


def _safe_float(value: Any) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return 0.0


def _safe_int(value: Any) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return 0


def summarize_cost_records(
    *,
    records: list[dict[str, Any]],
    group_by: str = "source_table",
) -> list[dict[str, Any]]:
    """
    Aggregate cost records by an operational dimension.

    group_by values:
    - source_table (default)
    - tenant
    - worker
    - pack
    """
    mode = str(group_by or "source_table").strip().lower()
    if mode not in {"source_table", "tenant", "worker", "pack"}:
        raise ValueError(f"Unsupported cost group_by mode: {group_by}")

    buckets: dict[tuple[str, str, str], dict[str, Any]] = defaultdict(
        lambda: {
            "organization_id": "",
            "source_key": "",
            "table_name": "",
            "worker_id": "unknown",
            "pack_id": "unknown",
            "records_written": 0,
            "bytes_written": 0,
            "compute_millis": 0,
            "cost_units": 0.0,
        }
    )
    for row in records:
        metadata = row.get("metadata") if isinstance(row.get("metadata"), dict) else {}
        organization_id = str(row.get("organization_id") or "unknown")
        source_key = str(row.get("source_key") or "unknown")
        table_name = str(row.get("table_name") or "unknown")
        worker_id = str(metadata.get("worker_id") or "unknown")
        pack_id = str(metadata.get("pack_id") or "unknown")

        if mode == "tenant":
            key = (organization_id, "*", "*")
        elif mode == "worker":
            key = (organization_id, worker_id, "*")
        elif mode == "pack":
            key = (organization_id, pack_id, "*")
        else:
            key = (organization_id, source_key, table_name)

        bucket = buckets[key]
        bucket["organization_id"] = organization_id
        bucket["source_key"] = source_key
        bucket["table_name"] = table_name
        bucket["worker_id"] = worker_id
        bucket["pack_id"] = pack_id
        bucket["records_written"] += _safe_int(row.get("records_written"))
        bucket["bytes_written"] += _safe_int(row.get("bytes_written"))
        bucket["compute_millis"] += _safe_int(row.get("compute_millis"))
        bucket["cost_units"] += _safe_float(row.get("cost_units"))

    items = list(buckets.values())
    for item in items:
        item["cost_units"] = round(_safe_float(item.get("cost_units")), 6)

    if mode == "tenant":
        return sorted(items, key=lambda item: (-_safe_float(item.get("cost_units")), item["organization_id"]))
    if mode == "worker":
        return sorted(items, key=lambda item: (-_safe_float(item.get("cost_units")), item["worker_id"]))
    if mode == "pack":
        return sorted(items, key=lambda item: (-_safe_float(item.get("cost_units")), item["pack_id"]))
    return sorted(items, key=lambda item: (-_safe_float(item.get("cost_units")), item["source_key"], item["table_name"]))

