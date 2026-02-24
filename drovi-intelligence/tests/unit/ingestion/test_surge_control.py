from __future__ import annotations

import pytest

from src.ingestion.surge_control import apply_ingest_surge_controls, parse_source_throttle_map

pytestmark = [pytest.mark.unit]


def test_surge_control_drops_noncritical_events_when_kill_switch_enabled() -> None:
    decision = apply_ingest_surge_controls(
        source_type="rss_osint",
        base_priority=7,
        kill_switch=True,
        noncritical_threshold=3,
    )
    assert decision.drop_event is True
    assert "kill_switch_drop_noncritical" in decision.reason_codes


def test_surge_control_degrades_priority_for_throttled_source() -> None:
    decision = apply_ingest_surge_controls(
        source_type="worldnewsapi",
        base_priority=3,
        kill_switch=False,
        source_throttle_map={"worldnewsapi": 2.0},
    )
    assert decision.drop_event is False
    assert decision.priority > 3
    assert "source_priority_degraded" in decision.reason_codes


def test_parse_source_throttle_map_normalizes_values() -> None:
    parsed = parse_source_throttle_map({" WorldNewsAPI ": "2.5", "": 10, "rss": -5})
    assert parsed["worldnewsapi"] == pytest.approx(2.5)
    assert parsed["rss"] == pytest.approx(0.5)
