from datetime import datetime, timezone

from src.connectors.scheduling.backfill import generate_backfill_windows


def test_generate_backfill_windows_contiguous() -> None:
    start = datetime(2026, 1, 1, tzinfo=timezone.utc)
    end = datetime(2026, 1, 10, tzinfo=timezone.utc)
    windows = generate_backfill_windows(start, end, window_days=3)

    assert windows
    assert windows[0].start == start
    assert windows[-1].end == end

    # Contiguous, non-overlapping windows
    for left, right in zip(windows, windows[1:], strict=False):
        assert left.end == right.start
        assert left.start < left.end


def test_generate_backfill_windows_empty_when_no_range() -> None:
    start = datetime(2026, 1, 1, tzinfo=timezone.utc)
    windows = generate_backfill_windows(start, start, window_days=7)
    assert windows == []

