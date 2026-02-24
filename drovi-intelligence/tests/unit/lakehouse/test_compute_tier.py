from __future__ import annotations

import pytest

from src.lakehouse.compute_tier import LakehouseComputeTier

pytestmark = [pytest.mark.unit]


def test_compute_tier_uses_interactive_lane_for_high_priority_small_queries() -> None:
    plan = LakehouseComputeTier().plan(
        lookback_hours=24,
        estimated_rows=120_000,
        priority="critical",
    )
    assert plan.mode == "interactive"
    assert plan.queue == "lakehouse-interactive"


def test_compute_tier_uses_historical_lane_for_large_scans() -> None:
    plan = LakehouseComputeTier().plan(
        lookback_hours=24 * 90,
        estimated_rows=8_000_000,
        priority="normal",
    )
    assert plan.mode == "historical_batch"
    assert plan.queue == "lakehouse-historical"
