from __future__ import annotations

import pytest

from src.ops.slo import WorldBrainSLOEvaluator

pytestmark = [pytest.mark.unit]


def test_slo_evaluator_flags_latency_violation() -> None:
    evaluator = WorldBrainSLOEvaluator()
    result = evaluator.evaluate(
        operation="belief_update",
        samples=[{"latency_ms": 1000, "error": False} for _ in range(30)],
    )
    assert result["passed"] is False
    assert result["latency_pass"] is False


def test_slo_evaluator_flags_error_budget_violation() -> None:
    evaluator = WorldBrainSLOEvaluator()
    samples = [{"latency_ms": 100, "error": False} for _ in range(40)]
    samples.extend([{"latency_ms": 110, "error": True} for _ in range(5)])
    result = evaluator.evaluate(operation="impact_compute", samples=samples)
    assert result["passed"] is False
    assert result["error_pass"] is False


def test_slo_evaluator_multi_operation_summary() -> None:
    evaluator = WorldBrainSLOEvaluator()
    summary = evaluator.evaluate_many(
        samples_by_operation={
            "belief_update": [{"latency_ms": 100, "error": False} for _ in range(40)],
            "impact_compute": [{"latency_ms": 120, "error": False} for _ in range(40)],
            "tape_publish": [{"latency_ms": 400, "error": False} for _ in range(60)],
        }
    )
    assert summary["passed"] is True
    assert summary["violation_count"] == 0
