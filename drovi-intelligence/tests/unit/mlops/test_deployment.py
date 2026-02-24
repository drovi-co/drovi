from src.mlops import (
    CalibrationMonitor,
    CanaryRolloutController,
    ModelRegressionGate,
    ModelSLADashboard,
    ShadowDeploymentFramework,
)


def test_model_regression_gate_blocks_low_quality_rollout() -> None:
    result = ModelRegressionGate().evaluate(
        {"accuracy": 0.71, "calibration_error": 0.24, "latency_p95_ms": 1900}
    )
    assert result["blocked"] is True
    assert result["checks"]["accuracy"] is False


def test_shadow_deployment_framework_measures_disagreement_rate() -> None:
    result = ShadowDeploymentFramework().evaluate(
        baseline_outputs=[{"score": 0.9}, {"score": 0.2}],
        candidate_outputs=[{"score": 0.8}, {"score": 0.2}],
        expected_labels=[1, 0],
        max_disagreement_rate=0.6,
    )
    assert result["sample_count"] == 2
    assert result["disagreement_rate"] == 0.5
    assert result["passed"] is True


def test_canary_controller_and_calibration_monitor_trigger_rollback_paths() -> None:
    rollout = CanaryRolloutController().evaluate_window(
        baseline_metrics={"accuracy": 0.9, "latency_p95_ms": 200, "cost_per_1k_tokens": 0.4},
        canary_metrics={"accuracy": 0.8, "latency_p95_ms": 550, "cost_per_1k_tokens": 0.7},
    )
    calibration = CalibrationMonitor().monitor(
        prediction_outcomes=[(0.9, 0), (0.8, 0), (0.7, 0)],
        alert_threshold=0.2,
    )

    assert rollout["rollback"] is True
    assert calibration["alert"] is True


def test_model_sla_dashboard_tracks_cost_latency_and_breaches() -> None:
    summary = ModelSLADashboard().summarize(
        events=[
            {"model_id": "mdl_1", "latency_ms": 100, "cost_per_1k_tokens": 0.2},
            {"model_id": "mdl_1", "latency_ms": 2100, "cost_per_1k_tokens": 0.25},
            {"model_id": "mdl_2", "latency_ms": 300, "cost_per_1k_tokens": 0.4},
        ],
        latency_sla_ms=1500,
    )

    assert summary["model_count"] == 2
    assert summary["models"]["mdl_1"]["latency_sla_breaches"] == 1

