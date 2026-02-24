from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from src.causal import run_causal_backtest
from src.hypothesis import run_hypothesis_red_team_benchmark
from src.normative import run_normative_benchmark
from src.world_model import run_impact_benchmark


def _clamp(value: float, low: float, high: float) -> float:
    return max(low, min(high, value))


@dataclass(frozen=True)
class BeliefStateEvalCase:
    case_id: str
    predicted_state: str
    expected_state: str
    predicted_probability: float
    observed_outcome: int
    evidence_refs: list[str]


def evaluate_belief_state(
    *,
    cases: list[BeliefStateEvalCase],
    bucket_count: int = 10,
) -> dict[str, float | int]:
    if not cases:
        return {
            "cases_total": 0,
            "belief_state_accuracy": 0.0,
            "calibration_error": 0.0,
            "brier_score": 0.0,
            "evidence_coverage": 0.0,
        }

    buckets: dict[int, list[tuple[float, float]]] = {}
    correct = 0
    brier = 0.0
    evidence_supported = 0

    max_bucket = max(1, int(bucket_count))
    for case in cases:
        prob = _clamp(float(case.predicted_probability), 0.0, 1.0)
        outcome = 1.0 if int(case.observed_outcome) > 0 else 0.0
        bucket = min(max_bucket - 1, int(prob * max_bucket))
        buckets.setdefault(bucket, []).append((prob, outcome))
        if str(case.predicted_state).strip().lower() == str(case.expected_state).strip().lower():
            correct += 1
        brier += (prob - outcome) ** 2
        if case.evidence_refs:
            evidence_supported += 1

    total = len(cases)
    ece = 0.0
    for rows in buckets.values():
        weight = len(rows) / total
        mean_prob = sum(item[0] for item in rows) / len(rows)
        mean_outcome = sum(item[1] for item in rows) / len(rows)
        ece += weight * abs(mean_prob - mean_outcome)

    return {
        "cases_total": total,
        "belief_state_accuracy": round(correct / total, 4),
        "calibration_error": round(ece, 4),
        "brier_score": round(brier / total, 4),
        "evidence_coverage": round(evidence_supported / total, 4),
    }


def run_world_brain_regression_suite(
    *,
    belief_cases: list[BeliefStateEvalCase],
    min_belief_accuracy: float = 0.8,
    max_calibration_error: float = 0.12,
    min_constraint_recall: float = 0.9,
) -> dict[str, Any]:
    belief = evaluate_belief_state(cases=belief_cases)
    hypothesis = run_hypothesis_red_team_benchmark()
    causal = run_causal_backtest()
    normative = run_normative_benchmark(target_recall=min_constraint_recall)
    impact = run_impact_benchmark()

    metrics = {
        "belief_state_accuracy": float(belief["belief_state_accuracy"]),
        "calibration_error": float(belief["calibration_error"]),
        "constraint_recall": float(normative["recall"]),
        "hypothesis_score": float(hypothesis["benchmark_score"]),
        "causal_ndcg": float(causal["average_causal_ndcg"]),
        "impact_precision_gain": float(impact["precision_gain"]),
    }

    gates = {
        "belief_state_accuracy": metrics["belief_state_accuracy"] >= _clamp(min_belief_accuracy, 0.0, 1.0),
        "calibration_error": metrics["calibration_error"] <= _clamp(max_calibration_error, 0.0, 1.0),
        "hypothesis_quality": bool(hypothesis["passed"]),
        "causal_backtest": bool(causal["passed"]),
        "constraint_detection": bool(normative["passed"]) and metrics["constraint_recall"] >= _clamp(min_constraint_recall, 0.0, 1.0),
        "impact_precision": bool(impact["passed"]),
    }
    passed = all(bool(value) for value in gates.values())

    return {
        "suite": "world-brain-regression-v1",
        "passed": passed,
        "belief": belief,
        "hypothesis": hypothesis,
        "causal": causal,
        "normative": normative,
        "impact": impact,
        "metrics": {key: round(value, 4) for key, value in metrics.items()},
        "gates": gates,
        "thresholds": {
            "min_belief_accuracy": round(_clamp(min_belief_accuracy, 0.0, 1.0), 4),
            "max_calibration_error": round(_clamp(max_calibration_error, 0.0, 1.0), 4),
            "min_constraint_recall": round(_clamp(min_constraint_recall, 0.0, 1.0), 4),
        },
    }

