from datetime import timezone

from hypothesis import assume, given, strategies as st

from src.connectors.cursors import merge_cursor_state_monotonic
from src.connectors.scheduling.backfill import generate_backfill_windows


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
    start=st.datetimes(timezones=st.just(timezone.utc)),
    end=st.datetimes(timezones=st.just(timezone.utc)),
    window_days=st.integers(min_value=1, max_value=30),
)
def test_backfill_windows_cover_range(start, end, window_days: int) -> None:
    assume(start <= end)
    windows = generate_backfill_windows(start, end, window_days=window_days)
    if start == end:
        assert windows == []
        return

    assert windows[0].start == start
    assert windows[-1].end == end

    for left, right in zip(windows, windows[1:], strict=False):
        assert left.end == right.start
        assert left.start < left.end

