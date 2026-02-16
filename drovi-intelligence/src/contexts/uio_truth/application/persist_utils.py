"""Shared persistence utilities for the UIO truth spine.

These helpers are used by orchestrator adapters today. Phase 6 will continue
moving logic out of the LangGraph nodes and into application services here.
"""

from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Any


def serialize_for_graph(value: Any) -> str | float | int:
    """Serialize values for FalkorDB node/relationship properties.

    FalkorDB does not support list or dict property types, so we store those as JSON strings.
    """
    if value is None:
        return ""
    if isinstance(value, (list, dict)):
        return json.dumps(value)
    # Keep primitives (str/int/float/bool) as-is to preserve query ergonomics.
    return value


def temporal_fields(now: datetime) -> dict[str, datetime | None]:
    """Temporal fields for Postgres truth persistence (bi-temporal spine)."""
    return {
        "valid_from": now,
        "valid_to": None,
        "system_from": now,
        "system_to": None,
    }


def temporal_graph_props(now: datetime) -> dict[str, str | None]:
    """Temporal properties for graph nodes/relationships."""
    iso_now = now.isoformat()
    return {
        "validFrom": iso_now,
        "validTo": None,
        "systemFrom": iso_now,
        "systemTo": None,
    }


def temporal_relationship_props(now: datetime) -> dict[str, str | None]:
    """Temporal properties for graph relationships."""
    iso_now = now.isoformat()
    return {
        "validFrom": iso_now,
        "validTo": None,
        "systemFrom": iso_now,
        "systemTo": None,
        "createdAt": iso_now,
        "updatedAt": iso_now,
    }


def to_naive_utc(dt: datetime | None) -> datetime | None:
    """Convert a datetime to naive UTC for Postgres.

    - If tz-aware: convert to UTC and strip tzinfo.
    - If naive: return as-is (assumed UTC).
    """
    if dt is None:
        return None
    if dt.tzinfo is not None:
        return dt.astimezone(timezone.utc).replace(tzinfo=None)
    return dt


def normalize_compare_value(value: Any) -> Any:
    if value is None:
        return None
    if isinstance(value, datetime):
        return value.replace(tzinfo=None)
    if isinstance(value, str):
        return value.strip().lower()
    if isinstance(value, list):
        return sorted([str(item).strip().lower() for item in value])
    return value


def values_differ(a: Any, b: Any) -> bool:
    return normalize_compare_value(a) != normalize_compare_value(b)

