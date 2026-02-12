from datetime import datetime, timedelta, timezone

import pytest

hypothesis = pytest.importorskip("hypothesis")

from hypothesis import given, strategies as st  # noqa: E402

from src.connectors.cursors import merge_cursor_state_monotonic
from src.connectors.scheduling.backfill import MAX_BACKFILL_WINDOWS, generate_backfill_windows


@given(
    old=st.integers(min_value=0, max_value=10_000),
    updates=st.lists(st.integers(min_value=0, max_value=10_000), min_size=0, max_size=50),
)
def test_numeric_cursor_monotonic_under_updates(old: int, updates: list[int]) -> None:
    cursor = {"x": str(old)}
    for value in updates:
        cursor = merge_cursor_state_monotonic(cursor, {"x": str(value)})
    assert int(cursor["x"]) == max([old, *updates])


@given(
    start=st.datetimes(
        min_value=datetime(2000, 1, 1),
        max_value=datetime(9900, 1, 1),
        timezones=st.just(timezone.utc),
    ),
    delta_days=st.integers(min_value=0, max_value=3650),
    window_days=st.integers(min_value=1, max_value=30),
)
def test_backfill_windows_cover_range(start, delta_days: int, window_days: int) -> None:
    end = start + timedelta(days=delta_days)
    windows = generate_backfill_windows(start, end, window_days=window_days)
    if start == end:
        assert windows == []
        return

    assert windows[0].start == start
    assert windows[-1].end == end

    for left, right in zip(windows, windows[1:], strict=False):
        assert left.end == right.start
        assert left.start < left.end


def test_backfill_windows_guardrail_avoids_explosive_lists() -> None:
    start = datetime(2000, 1, 1, tzinfo=timezone.utc)
    end = start + timedelta(days=MAX_BACKFILL_WINDOWS + 1)
    with pytest.raises(ValueError):
        generate_backfill_windows(start, end, window_days=1)
