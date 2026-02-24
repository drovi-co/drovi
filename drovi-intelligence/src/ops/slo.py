"""World Brain SLO definitions and evaluators."""

from __future__ import annotations

from dataclasses import dataclass
import math
from typing import Any


def _safe_float(value: Any, default: float = 0.0) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def _percentile(values: list[float], percentile: float) -> float:
    if not values:
        return 0.0
    ordered = sorted(values)
    if len(ordered) == 1:
        return float(ordered[0])
    rank = (max(0.0, min(float(percentile), 100.0)) / 100.0) * (len(ordered) - 1)
    lower = int(math.floor(rank))
    upper = int(math.ceil(rank))
    if lower == upper:
        return float(ordered[lower])
    fraction = rank - lower
    return float(ordered[lower] + (ordered[upper] - ordered[lower]) * fraction)


@dataclass(frozen=True, slots=True)
class SLODefinition:
    operation: str
    p95_ms: float
    max_error_rate: float
    min_samples: int = 20


WORLD_BRAIN_P95_SLOS: tuple[SLODefinition, ...] = (
    # P14.01 baseline SLOs for critical cognitive paths.
    SLODefinition(operation="belief_update", p95_ms=250.0, max_error_rate=0.02, min_samples=25),
    SLODefinition(operation="impact_compute", p95_ms=400.0, max_error_rate=0.03, min_samples=25),
    SLODefinition(operation="tape_publish", p95_ms=1000.0, max_error_rate=0.01, min_samples=50),
)


class WorldBrainSLOEvaluator:
    """Evaluates operation samples against World Brain latency and error budgets."""

    def __init__(self, definitions: tuple[SLODefinition, ...] | None = None) -> None:
        self._definitions = {item.operation: item for item in (definitions or WORLD_BRAIN_P95_SLOS)}

    def evaluate(self, *, operation: str, samples: list[dict[str, Any]]) -> dict[str, Any]:
        definition = self._definitions.get(operation)
        if definition is None:
            raise ValueError(f"Unknown SLO operation: {operation}")

        latencies = [_safe_float(sample.get("latency_ms"), -1.0) for sample in samples]
        valid_latencies = [value for value in latencies if value >= 0.0]
        failures = sum(1 for sample in samples if bool(sample.get("error")))
        sample_count = len(samples)
        p95 = _percentile(valid_latencies, 95.0)
        error_rate = (failures / sample_count) if sample_count else 0.0

        latency_pass = sample_count < definition.min_samples or p95 <= definition.p95_ms
        error_pass = sample_count < definition.min_samples or error_rate <= definition.max_error_rate
        passed = bool(latency_pass and error_pass)

        return {
            "operation": operation,
            "sample_count": sample_count,
            "min_samples": definition.min_samples,
            "p95_latency_ms": round(p95, 3),
            "latency_budget_ms": round(definition.p95_ms, 3),
            "latency_pass": latency_pass,
            "error_rate": round(error_rate, 6),
            "error_budget": round(definition.max_error_rate, 6),
            "error_pass": error_pass,
            "passed": passed,
        }

    def evaluate_many(
        self,
        *,
        samples_by_operation: dict[str, list[dict[str, Any]]],
    ) -> dict[str, Any]:
        evaluations = {
            operation: self.evaluate(operation=operation, samples=samples_by_operation.get(operation, []))
            for operation in sorted(self._definitions)
        }
        violations = [item for item in evaluations.values() if not bool(item.get("passed"))]
        return {
            "operations": evaluations,
            "violation_count": len(violations),
            "passed": not violations,
        }

