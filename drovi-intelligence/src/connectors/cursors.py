"""Cursor merge/comparison helpers.

Goal:
- Prevent cursor regression (which can cause replays or infinite loops).
- Be conservative: only block updates when we are confident the cursor went backwards.

Cursor shapes vary across connectors:
- Gmail: {"historyId": "123"}
- Notion: {"last_edited_time": "2026-01-01T00:00:00Z"}
- Slack: {"channel_cursors": {"C123": "1700000000.123"}}
- Outlook delta: {"deltaLink": "https://..."} (opaque, not comparable)
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation
from typing import Any


@dataclass(frozen=True)
class CursorCompareResult:
    comparable: bool
    is_forward_or_equal: bool


def _try_parse_decimal(value: Any) -> Decimal | None:
    if isinstance(value, (int, float)):
        return Decimal(str(value))
    if isinstance(value, str):
        stripped = value.strip()
        if not stripped:
            return None
        try:
            return Decimal(stripped)
        except InvalidOperation:
            return None
    return None


def _try_parse_iso_datetime(value: Any) -> datetime | None:
    if isinstance(value, datetime):
        return value
    if not isinstance(value, str):
        return None
    raw = value.strip()
    if not raw:
        return None
    # Common "Z" suffix.
    if raw.endswith("Z"):
        raw = raw[:-1] + "+00:00"
    try:
        dt = datetime.fromisoformat(raw)
    except Exception:
        return None
    if dt.tzinfo is None:
        # Treat naive as UTC for comparison purposes only.
        dt = dt.replace(tzinfo=timezone.utc)
    return dt


def compare_cursor_values(old_value: Any, new_value: Any) -> CursorCompareResult:
    """
    Compare two cursor values and decide if the new cursor is >= old.

    Returns:
      comparable=False when we cannot safely compare (treat as opaque).
      In that case, callers should generally accept the new value.
    """
    if new_value is None:
        return CursorCompareResult(comparable=True, is_forward_or_equal=False)
    if old_value is None:
        return CursorCompareResult(comparable=True, is_forward_or_equal=True)

    old_num = _try_parse_decimal(old_value)
    new_num = _try_parse_decimal(new_value)
    if old_num is not None and new_num is not None:
        return CursorCompareResult(comparable=True, is_forward_or_equal=new_num >= old_num)

    old_dt = _try_parse_iso_datetime(old_value)
    new_dt = _try_parse_iso_datetime(new_value)
    if old_dt is not None and new_dt is not None:
        return CursorCompareResult(comparable=True, is_forward_or_equal=new_dt >= old_dt)

    # Opaque values (delta tokens/links/etc): do not block updates.
    return CursorCompareResult(comparable=False, is_forward_or_equal=True)


def merge_cursor_state_monotonic(old: dict[str, Any], new: dict[str, Any]) -> dict[str, Any]:
    """
    Merge cursor dicts while preventing obvious regressions.

    - Recurses through nested dicts.
    - For scalar values, blocks the update only when comparable and new < old.
    - For opaque values, always accepts the new value.
    """
    merged: dict[str, Any] = dict(old or {})
    for key, new_value in (new or {}).items():
        if new_value is None:
            continue
        old_value = merged.get(key)
        if isinstance(old_value, dict) and isinstance(new_value, dict):
            merged[key] = merge_cursor_state_monotonic(old_value, new_value)
            continue
        if old_value is None:
            merged[key] = new_value
            continue

        comparison = compare_cursor_values(old_value, new_value)
        if comparison.comparable and not comparison.is_forward_or_equal:
            # Reject regression.
            continue
        merged[key] = new_value
    return merged

