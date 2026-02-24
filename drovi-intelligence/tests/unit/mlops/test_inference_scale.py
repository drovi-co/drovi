from __future__ import annotations

import pytest

from src.mlops.inference_scale import InferenceScalePlanner

pytestmark = [pytest.mark.unit]


def test_inference_scale_routes_heavy_models_to_gpu_pool() -> None:
    planner = InferenceScalePlanner()
    decision = planner.route_request(
        model_family="verifier_nli",
        risk_class="high",
        sla_minutes=10,
        backlog_depth=120,
    )

    assert decision.pool_id == "inference-gpu-heavy"
    assert decision.priority_class in {"p0", "p1"}


def test_inference_scale_routes_throughput_models_to_cpu_pool() -> None:
    planner = InferenceScalePlanner()
    decision = planner.route_request(
        model_family="temporal_forecast",
        risk_class="low",
        sla_minutes=120,
        backlog_depth=20,
    )

    assert decision.pool_id == "inference-cpu-throughput"
    assert decision.priority_class == "p3"


def test_inference_autoscale_scales_up_on_backlog_and_latency() -> None:
    planner = InferenceScalePlanner()
    decision = planner.autoscale_pool(
        pool_id="inference-gpu-heavy",
        backlog_depth=1200,
        p95_latency_ms=2600.0,
        utilization=0.92,
        current_replicas=4,
    )

    assert decision.action == "scale_up"
    assert decision.desired_replicas > decision.current_replicas


def test_inference_autoscale_scales_down_in_low_pressure_window() -> None:
    planner = InferenceScalePlanner()
    decision = planner.autoscale_pool(
        pool_id="inference-cpu-throughput",
        backlog_depth=5,
        p95_latency_ms=200.0,
        utilization=0.2,
        current_replicas=8,
    )

    assert decision.action in {"scale_down", "hold"}
    assert decision.desired_replicas <= decision.current_replicas


def test_inference_autoscale_rejects_unknown_pool() -> None:
    planner = InferenceScalePlanner()
    with pytest.raises(ValueError):
        planner.autoscale_pool(
            pool_id="missing-pool",
            backlog_depth=0,
            p95_latency_ms=0,
            utilization=0.0,
            current_replicas=1,
        )
