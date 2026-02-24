"""Shadow/canary deployment controls, monitoring, and rollback decisions."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any


def _safe_float(value: Any, default: float = 0.0) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def _clamp(value: float, low: float, high: float) -> float:
    return max(low, min(high, value))


@dataclass(slots=True)
class RegressionGateConfig:
    min_accuracy: float = 0.8
    max_calibration_error: float = 0.15
    max_latency_p95_ms: float = 1500.0


class ModelRegressionGate:
    """Blocks promotions when quality metrics regress beyond allowed thresholds."""

    def __init__(self, config: RegressionGateConfig | None = None) -> None:
        self._config = config or RegressionGateConfig()

    def evaluate(self, metrics: dict[str, float]) -> dict[str, Any]:
        accuracy = _safe_float(metrics.get("accuracy"))
        calibration_error = _safe_float(metrics.get("calibration_error"), default=1.0)
        latency_p95 = _safe_float(metrics.get("latency_p95_ms"), default=10_000.0)

        checks = {
            "accuracy": accuracy >= self._config.min_accuracy,
            "calibration_error": calibration_error <= self._config.max_calibration_error,
            "latency_p95_ms": latency_p95 <= self._config.max_latency_p95_ms,
        }
        blocked = not all(checks.values())
        return {
            "blocked": blocked,
            "checks": checks,
            "metrics": {
                "accuracy": round(accuracy, 4),
                "calibration_error": round(calibration_error, 4),
                "latency_p95_ms": round(latency_p95, 3),
            },
            "thresholds": {
                "min_accuracy": self._config.min_accuracy,
                "max_calibration_error": self._config.max_calibration_error,
                "max_latency_p95_ms": self._config.max_latency_p95_ms,
            },
        }


class ShadowDeploymentFramework:
    """Compares candidate outputs to production outputs without affecting users."""

    def evaluate(
        self,
        *,
        baseline_outputs: list[dict[str, Any]],
        candidate_outputs: list[dict[str, Any]],
        expected_labels: list[int] | None = None,
        max_disagreement_rate: float = 0.25,
    ) -> dict[str, Any]:
        total = min(len(baseline_outputs), len(candidate_outputs))
        if total == 0:
            return {
                "passed": False,
                "reason": "no_overlap_between_baseline_and_candidate",
                "disagreement_rate": 1.0,
                "accuracy_delta": 0.0,
                "sample_count": 0,
            }

        disagreements = 0
        for idx in range(total):
            if baseline_outputs[idx] != candidate_outputs[idx]:
                disagreements += 1
        disagreement_rate = disagreements / total

        baseline_acc = None
        candidate_acc = None
        accuracy_delta = 0.0
        if expected_labels is not None and expected_labels:
            label_count = min(total, len(expected_labels))
            baseline_hits = 0
            candidate_hits = 0
            for idx in range(label_count):
                expected = int(expected_labels[idx])
                baseline_pred = 1 if _safe_float(baseline_outputs[idx].get("score"), 0.0) >= 0.5 else 0
                candidate_pred = 1 if _safe_float(candidate_outputs[idx].get("score"), 0.0) >= 0.5 else 0
                baseline_hits += 1 if baseline_pred == expected else 0
                candidate_hits += 1 if candidate_pred == expected else 0
            baseline_acc = baseline_hits / label_count
            candidate_acc = candidate_hits / label_count
            accuracy_delta = candidate_acc - baseline_acc

        passed = disagreement_rate <= _clamp(max_disagreement_rate, 0.0, 1.0)
        return {
            "passed": passed,
            "sample_count": total,
            "disagreement_rate": round(disagreement_rate, 4),
            "max_disagreement_rate": round(max_disagreement_rate, 4),
            "baseline_accuracy": round(baseline_acc, 4) if baseline_acc is not None else None,
            "candidate_accuracy": round(candidate_acc, 4) if candidate_acc is not None else None,
            "accuracy_delta": round(accuracy_delta, 4),
        }


class CanaryRolloutController:
    """Controls canary progression and triggers rollback on regressions."""

    def evaluate_window(
        self,
        *,
        baseline_metrics: dict[str, float],
        canary_metrics: dict[str, float],
        max_accuracy_drop: float = 0.03,
        max_latency_increase_ms: float = 200.0,
        max_cost_increase_ratio: float = 0.3,
    ) -> dict[str, Any]:
        accuracy_drop = _safe_float(baseline_metrics.get("accuracy")) - _safe_float(canary_metrics.get("accuracy"))
        latency_increase = _safe_float(canary_metrics.get("latency_p95_ms")) - _safe_float(
            baseline_metrics.get("latency_p95_ms")
        )
        base_cost = max(0.0001, _safe_float(baseline_metrics.get("cost_per_1k_tokens"), 0.1))
        canary_cost = _safe_float(canary_metrics.get("cost_per_1k_tokens"), 0.1)
        cost_increase_ratio = (canary_cost - base_cost) / base_cost

        rollback = (
            accuracy_drop > max_accuracy_drop
            or latency_increase > max_latency_increase_ms
            or cost_increase_ratio > max_cost_increase_ratio
        )

        return {
            "rollback": rollback,
            "action": "rollback" if rollback else "continue",
            "metrics": {
                "accuracy_drop": round(accuracy_drop, 4),
                "latency_increase_ms": round(latency_increase, 3),
                "cost_increase_ratio": round(cost_increase_ratio, 4),
            },
            "thresholds": {
                "max_accuracy_drop": max_accuracy_drop,
                "max_latency_increase_ms": max_latency_increase_ms,
                "max_cost_increase_ratio": max_cost_increase_ratio,
            },
        }


class CalibrationMonitor:
    """Monitors calibration drift and emits degradation alerts."""

    def monitor(
        self,
        *,
        prediction_outcomes: list[tuple[float, int]],
        alert_threshold: float = 0.1,
    ) -> dict[str, Any]:
        if not prediction_outcomes:
            return {"alert": False, "calibration_error": 0.0, "sample_count": 0}

        error_sum = 0.0
        for probability, outcome in prediction_outcomes:
            error_sum += abs(_clamp(probability, 0.0, 1.0) - (1.0 if int(outcome) > 0 else 0.0))
        mae = error_sum / len(prediction_outcomes)
        return {
            "alert": mae > _clamp(alert_threshold, 0.0, 1.0),
            "calibration_error": round(mae, 4),
            "sample_count": len(prediction_outcomes),
            "alert_threshold": round(_clamp(alert_threshold, 0.0, 1.0), 4),
        }


class ModelSLADashboard:
    """Aggregates per-model cost/latency metrics and SLA breaches."""

    def summarize(
        self,
        *,
        events: list[dict[str, Any]],
        latency_sla_ms: float = 1500.0,
    ) -> dict[str, Any]:
        aggregates: dict[str, dict[str, float]] = {}
        for event in events:
            model_id = str(event.get("model_id") or event.get("artifact_id") or "unknown")
            bucket = aggregates.setdefault(
                model_id,
                {
                    "count": 0.0,
                    "latency_sum": 0.0,
                    "cost_sum": 0.0,
                    "latency_sla_breaches": 0.0,
                },
            )
            latency = _safe_float(event.get("latency_ms"))
            cost = _safe_float(event.get("cost_per_1k_tokens"))
            bucket["count"] += 1.0
            bucket["latency_sum"] += latency
            bucket["cost_sum"] += cost
            if latency > latency_sla_ms:
                bucket["latency_sla_breaches"] += 1.0

        per_model = {}
        for model_id, bucket in aggregates.items():
            count = max(bucket["count"], 1.0)
            per_model[model_id] = {
                "requests": int(bucket["count"]),
                "avg_latency_ms": round(bucket["latency_sum"] / count, 3),
                "avg_cost_per_1k_tokens": round(bucket["cost_sum"] / count, 4),
                "latency_sla_breaches": int(bucket["latency_sla_breaches"]),
                "latency_sla_breach_rate": round(bucket["latency_sla_breaches"] / count, 4),
            }
        return {
            "models": per_model,
            "latency_sla_ms": latency_sla_ms,
            "model_count": len(per_model),
        }

