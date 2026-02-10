from datetime import datetime, timezone

from src.connectors.cursors import merge_cursor_state_monotonic


def test_merge_cursor_blocks_numeric_regression() -> None:
    old = {"historyId": "10"}
    new = {"historyId": "9"}
    merged = merge_cursor_state_monotonic(old, new)
    assert merged["historyId"] == "10"


def test_merge_cursor_allows_numeric_advance() -> None:
    old = {"historyId": "10"}
    new = {"historyId": "11"}
    merged = merge_cursor_state_monotonic(old, new)
    assert merged["historyId"] == "11"


def test_merge_cursor_blocks_datetime_regression() -> None:
    old = {"updated": "2026-02-01T00:00:00Z"}
    new = {"updated": "2026-01-01T00:00:00Z"}
    merged = merge_cursor_state_monotonic(old, new)
    assert merged["updated"] == "2026-02-01T00:00:00Z"


def test_merge_cursor_allows_datetime_advance() -> None:
    old = {"updated": "2026-02-01T00:00:00Z"}
    new = {"updated": "2026-02-02T00:00:00+00:00"}
    merged = merge_cursor_state_monotonic(old, new)
    assert merged["updated"] == "2026-02-02T00:00:00+00:00"


def test_merge_cursor_accepts_opaque_tokens() -> None:
    old = {"deltaLink": "https://graph.microsoft.com/v1.0/me/messages/delta?$skiptoken=abc"}
    new = {"deltaLink": "https://graph.microsoft.com/v1.0/me/messages/delta?$skiptoken=zzz"}
    merged = merge_cursor_state_monotonic(old, new)
    assert merged["deltaLink"] == new["deltaLink"]


def test_merge_cursor_merges_nested_dicts_monotonically() -> None:
    old = {"channel_cursors": {"C1": "100.0", "C2": "5.0"}}
    new = {"channel_cursors": {"C1": "99.0", "C3": "1.0"}}
    merged = merge_cursor_state_monotonic(old, new)
    assert merged["channel_cursors"]["C1"] == "100.0"
    assert merged["channel_cursors"]["C2"] == "5.0"
    assert merged["channel_cursors"]["C3"] == "1.0"


def test_merge_cursor_accepts_datetime_objects() -> None:
    old_dt = datetime(2026, 2, 1, tzinfo=timezone.utc)
    new_dt = datetime(2026, 2, 2, tzinfo=timezone.utc)
    merged = merge_cursor_state_monotonic({"ts": old_dt}, {"ts": new_dt})
    assert merged["ts"] == new_dt

