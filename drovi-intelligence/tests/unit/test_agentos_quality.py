from __future__ import annotations

from src.agentos.quality.calibration import _build_buckets
from src.agentos.quality.evaluator import OfflineEvaluationRunner, _p95
from src.agentos.quality.models import RegressionGateRecord
from src.agentos.quality.regression_gates import _evaluate_gate
from src.agentos.quality.scoring import _completion_score, clamp


def test_offline_eval_case_match_handles_nested_payloads() -> None:
    expected = {
        "subject": "Renewal summary",
        "sections": {
            "risks": ["missing signature", "stale advice"],
            "score": 0.82,
        },
    }
    observed = {
        "subject": "Renewal summary",
        "sections": {
            "risks": ["stale advice", "missing signature", "extra context"],
            "score": 0.82,
            "note": "generated",
        },
        "extra": True,
    }
    assert OfflineEvaluationRunner._case_matches(expected, observed) is True


def test_p95_returns_high_tail_value() -> None:
    values = [120.0, 140.0, 160.0, 200.0, 1000.0]
    assert _p95(values) >= 200.0


def test_completion_score_weights_terminal_states() -> None:
    assert _completion_score(status="completed") == 1.0
    assert _completion_score(status="running") == 0.6
    assert _completion_score(status="failed") == 0.0


def test_clamp_bounds_values() -> None:
    assert clamp(1.2, 0.0, 1.0) == 1.0
    assert clamp(-0.2, 0.0, 1.0) == 0.0
    assert clamp(0.6, 0.0, 1.0) == 0.6


def test_calibration_buckets_aggregate_confidence_vs_outcome() -> None:
    observations = [
        {"confidence": 0.91, "outcome": 0.7},
        {"confidence": 0.93, "outcome": 1.0},
        {"confidence": 0.41, "outcome": 0.4},
    ]
    buckets = _build_buckets(observations)
    assert len(buckets) == 2
    high_bucket = [bucket for bucket in buckets if bucket.bucket_start == 0.9][0]
    assert high_bucket.count == 2
    assert high_bucket.avg_confidence > high_bucket.avg_outcome


def test_regression_gate_max_drop_blocks_when_delta_exceeds_threshold() -> None:
    gate = RegressionGateRecord(
        id="aggate_1",
        organization_id="org_test",
        role_id=None,
        deployment_id=None,
        metric_name="quality_score",
        comparator="max_drop",
        threshold=0.1,
        lookback_days=14,
        min_samples=10,
        severity="blocker",
        is_enabled=True,
        metadata={},
        created_by_user_id="user_1",
    )
    evaluation = _evaluate_gate(
        gate=gate,
        baseline_value=0.82,
        current_value=0.64,
        sample_count=20,
    )
    assert evaluation.verdict == "block"
    assert evaluation.blocked is True

