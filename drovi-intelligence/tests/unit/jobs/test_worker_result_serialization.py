from __future__ import annotations

from datetime import date, datetime, timezone

import pytest

from src.jobs.worker import _to_json_compatible

pytestmark = pytest.mark.unit


def test_to_json_compatible_converts_nested_datetime_values() -> None:
    payload = {
        "job_id": "job_1",
        "completed_at": datetime(2026, 2, 16, 9, 32, 37, tzinfo=timezone.utc),
        "meta": {
            "window_start": datetime(2026, 2, 16, 8, 0, 0, tzinfo=timezone.utc),
            "window_end": date(2026, 2, 16),
        },
        "events": [
            {"at": datetime(2026, 2, 16, 9, 0, 0, tzinfo=timezone.utc)},
            {"tags": {"a", "b"}},
        ],
    }

    converted = _to_json_compatible(payload)

    assert converted["completed_at"] == "2026-02-16T09:32:37+00:00"
    assert converted["meta"]["window_start"] == "2026-02-16T08:00:00+00:00"
    assert converted["meta"]["window_end"] == "2026-02-16"
    assert converted["events"][0]["at"] == "2026-02-16T09:00:00+00:00"
    assert sorted(converted["events"][1]["tags"]) == ["a", "b"]
