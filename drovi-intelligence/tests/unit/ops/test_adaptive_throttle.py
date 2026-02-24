from __future__ import annotations

import pytest

from src.ops.adaptive_throttle import (
    apply_adaptive_throttle_sync_params,
    derive_adaptive_throttle,
)

pytestmark = [pytest.mark.unit]


def test_adaptive_throttle_prioritizes_high_voi_or_sla_pressure() -> None:
    decision = derive_adaptive_throttle(
        voi_priority=0.95,
        freshness_lag_minutes=120,
        freshness_slo_minutes=30,
        queue_depth_ratio=0.92,
        degradation_throttle_multiplier=1.0,
    )

    assert decision.max_parallel_streams >= 3
    assert decision.batch_size >= 160
    assert decision.defer_seconds == 0
    assert "high_voi_or_sla_pressure" in decision.reason_codes


def test_adaptive_throttle_applies_queue_backpressure_for_low_voi() -> None:
    decision = derive_adaptive_throttle(
        voi_priority=0.2,
        freshness_lag_minutes=15,
        freshness_slo_minutes=60,
        queue_depth_ratio=0.9,
        degradation_throttle_multiplier=1.0,
    )

    assert decision.max_parallel_streams == 1
    assert decision.batch_size <= 64
    assert decision.defer_seconds >= 60
    assert decision.priority_delta >= 1


def test_adaptive_throttle_sync_params_are_embedded() -> None:
    decision = derive_adaptive_throttle(
        voi_priority=0.5,
        freshness_lag_minutes=20,
        freshness_slo_minutes=60,
        queue_depth_ratio=0.2,
        degradation_throttle_multiplier=1.7,
    )
    payload = apply_adaptive_throttle_sync_params(sync_params={"run_kind": "scheduled"}, decision=decision)

    assert payload["run_kind"] == "scheduled"
    assert isinstance(payload["adaptive_batch_size"], int)
    assert isinstance(payload["adaptive_reason_codes"], list)
    assert payload["adaptive_batch_size"] >= 32
