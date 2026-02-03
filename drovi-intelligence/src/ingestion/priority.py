"""
Ingestion priority helpers.
"""

from __future__ import annotations

from typing import Any


PRIORITY_MAP: dict[str, int] = {
    "critical": 0,
    "urgent": 1,
    "high": 2,
    "normal": 5,
    "default": 5,
    "low": 8,
    "background": 9,
}

SOURCE_PRIORITY: dict[str, int] = {
    "connector_webhook": 0,
    "webhook": 0,
    "email": 3,
    "slack": 3,
    "meeting": 4,
    "call": 4,
    "transcript": 4,
    "calendar": 5,
    "document": 6,
    "notion": 6,
    "google_docs": 6,
    "crm": 7,
    "whatsapp": 6,
    "api": 6,
    "manual": 7,
}

JOB_PRIORITY: dict[str, int] = {
    "webhook": 0,
    "on_demand": 2,
    "scheduled": 5,
    "backfill": 8,
}


def parse_priority_value(value: Any | None) -> int | None:
    """Parse priority values into a numeric priority."""
    if value is None:
        return None
    string_value = str(value).strip().lower()
    if not string_value:
        return None
    if string_value.isdigit():
        return int(string_value)
    return PRIORITY_MAP.get(string_value)


def compute_ingest_priority(
    source_type: str | None,
    job_type: str | None = None,
    is_vip: bool = False,
    explicit_priority: Any | None = None,
    default_priority: int = 5,
) -> int:
    """Compute an ingestion priority (lower = higher priority)."""
    explicit = parse_priority_value(explicit_priority)
    if explicit is not None:
        return explicit

    source_key = (source_type or "").lower()
    job_key = (job_type or "").lower()

    source_priority = SOURCE_PRIORITY.get(source_key, default_priority)
    job_priority = JOB_PRIORITY.get(job_key, None)

    if job_priority is None:
        priority = source_priority
    elif job_priority <= 1:
        priority = job_priority
    elif job_priority >= 8:
        priority = max(source_priority, job_priority)
    else:
        priority = min(source_priority, job_priority)
    if is_vip:
        priority = max(0, priority - 2)
    return priority
