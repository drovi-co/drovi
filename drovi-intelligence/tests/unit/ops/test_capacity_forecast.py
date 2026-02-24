from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pytest

from src.ops.capacity_forecast import CapacityBudget, CapacityForecastEngine

pytestmark = [pytest.mark.unit]


def _history() -> list[dict]:
    anchor = datetime(2026, 2, 20, tzinfo=UTC)
    return [
        {
            "timestamp": (anchor + timedelta(days=i)).isoformat(),
            "event_rate_eps": 100.0 * (1 + (0.05 * i)),
            "storage_bytes": 1_000_000_000.0 * (1 + (0.08 * i)),
            "graph_nodes": 10_000_000.0 * (1 + (0.04 * i)),
        }
        for i in range(7)
    ]


def test_capacity_forecast_builds_projection_and_budget_breach_estimates() -> None:
    engine = CapacityForecastEngine()
    dashboard = engine.build_dashboard(
        history=_history(),
        horizon_days=14,
        budget=CapacityBudget(
            max_event_rate_eps=500.0,
            max_storage_bytes=2_000_000_000.0,
            max_graph_nodes=12_000_000.0,
        ),
    )

    assert dashboard["history_points"] == 7
    assert dashboard["horizon_days"] == 14
    assert len(dashboard["projection"]) == 14
    assert dashboard["estimated_breach_days"]["event_rate_eps"] is not None
    assert dashboard["estimated_breach_days"]["storage_bytes"] is not None


def test_capacity_forecast_requires_history() -> None:
    engine = CapacityForecastEngine()
    with pytest.raises(ValueError):
        engine.build_dashboard(history=[], horizon_days=10)
