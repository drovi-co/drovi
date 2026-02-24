from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pytest

from src.ops.world_brain_autoscaler import (
    ANNOTATION_LAST_SCALE_AT,
    HPAPoolState,
    aggregate_pool_queue_depths,
    build_scale_decision,
)

pytestmark = [pytest.mark.unit]


def test_aggregate_pool_queue_depths_groups_jobs_by_pool() -> None:
    counts = {
        "connector.sync": 17,
        "impact.compute": 8,
        "simulation.run": 3,
        "hypothesis.generate": 5,
    }
    out = aggregate_pool_queue_depths(counts)
    assert out["normalize"] == 17
    assert out["graph"] >= 8
    assert out["ml"] >= 5
    assert out["simulation"] == 3
    assert out["critical"] >= 17


def test_scale_decision_scales_up_on_pressure() -> None:
    state = HPAPoolState(
        pool="critical",
        hpa_name="drovi-world-critical-worker",
        min_replicas=1,
        max_replicas=12,
        annotations={},
    )
    decision = build_scale_decision(
        state=state,
        queue_depth=300,
        freshness_lag_minutes=200.0,
        now=datetime.now(UTC),
        cooldown_seconds=300,
        max_step_change=2,
        scale_down_queue_threshold=5,
        scale_down_freshness_threshold_minutes=20,
    )
    assert decision.action == "scale_up"
    assert decision.desired_min_replicas > decision.current_min_replicas


def test_scale_decision_blocks_scale_down_during_cooldown() -> None:
    now = datetime.now(UTC)
    state = HPAPoolState(
        pool="ml",
        hpa_name="drovi-world-ml-worker",
        min_replicas=4,
        max_replicas=8,
        annotations={ANNOTATION_LAST_SCALE_AT: now.isoformat()},
    )
    decision = build_scale_decision(
        state=state,
        queue_depth=0,
        freshness_lag_minutes=0.0,
        now=now,
        cooldown_seconds=300,
        max_step_change=2,
        scale_down_queue_threshold=5,
        scale_down_freshness_threshold_minutes=20,
    )
    assert decision.action == "hold"
    assert decision.cooldown_blocked is True
    assert decision.desired_min_replicas == 4


def test_scale_decision_allows_scale_down_after_cooldown() -> None:
    now = datetime.now(UTC)
    state = HPAPoolState(
        pool="simulation",
        hpa_name="drovi-world-simulation-worker",
        min_replicas=5,
        max_replicas=8,
        annotations={ANNOTATION_LAST_SCALE_AT: (now - timedelta(hours=2)).isoformat()},
    )
    decision = build_scale_decision(
        state=state,
        queue_depth=0,
        freshness_lag_minutes=0.0,
        now=now,
        cooldown_seconds=300,
        max_step_change=2,
        scale_down_queue_threshold=5,
        scale_down_freshness_threshold_minutes=20,
    )
    assert decision.action == "scale_down"
    assert decision.desired_min_replicas == 3
