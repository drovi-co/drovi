from __future__ import annotations

from src.agentos.quality import (
    BeliefStateEvalCase,
    evaluate_belief_state,
    run_world_brain_regression_suite,
)


def test_evaluate_belief_state_computes_accuracy_and_calibration() -> None:
    result = evaluate_belief_state(
        cases=[
            BeliefStateEvalCase(
                case_id="c1",
                predicted_state="asserted",
                expected_state="asserted",
                predicted_probability=0.9,
                observed_outcome=1,
                evidence_refs=["ev1"],
            ),
            BeliefStateEvalCase(
                case_id="c2",
                predicted_state="degraded",
                expected_state="asserted",
                predicted_probability=0.2,
                observed_outcome=1,
                evidence_refs=[],
            ),
        ]
    )

    assert result["cases_total"] == 2
    assert result["belief_state_accuracy"] == 0.5
    assert result["calibration_error"] >= 0.0
    assert result["evidence_coverage"] == 0.5


def test_world_brain_regression_suite_includes_all_benchmark_families() -> None:
    suite = run_world_brain_regression_suite(
        belief_cases=[
            BeliefStateEvalCase(
                case_id="b1",
                predicted_state="asserted",
                expected_state="asserted",
                predicted_probability=0.82,
                observed_outcome=1,
                evidence_refs=["ev1"],
            ),
            BeliefStateEvalCase(
                case_id="b2",
                predicted_state="degraded",
                expected_state="degraded",
                predicted_probability=0.12,
                observed_outcome=0,
                evidence_refs=["ev2"],
            ),
        ],
        min_belief_accuracy=0.5,
        max_calibration_error=0.6,
        min_constraint_recall=0.8,
    )

    assert suite["suite"] == "world-brain-regression-v1"
    assert "hypothesis" in suite
    assert "causal" in suite
    assert "normative" in suite
    assert "impact" in suite
    assert isinstance(suite["gates"], dict)

