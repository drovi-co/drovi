"""Deterministic red-team benchmark for hypothesis selection quality."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from src.hypothesis.engine import HypothesisEngine


def _clamp(value: float, low: float, high: float) -> float:
    return max(low, min(high, value))


@dataclass(frozen=True)
class HypothesisBenchmarkCase:
    case_id: str
    proposition: str
    observations: list[str]
    base_probability: float
    expected_top_mode: str  # baseline | alternative


def default_hypothesis_benchmark_cases() -> list[HypothesisBenchmarkCase]:
    return [
        HypothesisBenchmarkCase(
            case_id="dense_evidence_baseline_1",
            proposition="Supply chain constraints will increase delivery risk this quarter",
            observations=[
                "Shipping delay index rose 17%",
                "Port congestion remains elevated",
                "Vendor notices indicate long lead times",
                "Backorder queue expanded week-over-week",
                "Procurement risk committee issued warning",
                "Insurance premiums increased for freight",
            ],
            base_probability=0.68,
            expected_top_mode="baseline",
        ),
        HypothesisBenchmarkCase(
            case_id="dense_evidence_baseline_2",
            proposition="Tax policy assumption remains valid for current advisory package",
            observations=[
                "Agency guidance reaffirmed current interpretation",
                "No superseding ruling found",
                "Counsel note aligns with prior stance",
                "Peer filings follow the same interpretation",
            ],
            base_probability=0.62,
            expected_top_mode="baseline",
        ),
        HypothesisBenchmarkCase(
            case_id="sparse_signal_alternative_1",
            proposition="Revenue decline is solely due to seasonal demand",
            observations=[
                "One anomalous churn cluster appeared in enterprise accounts",
                "Pricing discount requests are increasing",
                "Support escalations mention competitor feature parity",
            ],
            base_probability=0.52,
            expected_top_mode="alternative",
        ),
        HypothesisBenchmarkCase(
            case_id="sparse_signal_alternative_2",
            proposition="Model performance dip is harmless random drift",
            observations=[
                "False positives doubled in critical class",
                "Drift monitor confidence dropped below baseline",
            ],
            base_probability=0.41,
            expected_top_mode="alternative",
        ),
        HypothesisBenchmarkCase(
            case_id="minimal_signal_alternative_3",
            proposition="Operational slowdown has no external drivers",
            observations=[],
            base_probability=0.36,
            expected_top_mode="alternative",
        ),
    ]


def run_hypothesis_red_team_benchmark(
    *,
    engine: HypothesisEngine | None = None,
    top_k: int = 3,
    pass_threshold: float = 0.78,
) -> dict[str, Any]:
    runner = engine or HypothesisEngine()
    cases = default_hypothesis_benchmark_cases()
    k = max(1, min(int(top_k), 10))

    case_results: list[dict[str, Any]] = []
    top_hits = 0
    alternative_coverage_hits = 0
    margin_sum = 0.0
    top_score_sum = 0.0

    for case in cases:
        candidates = runner.generate_alternatives(
            belief_id=f"benchmark::{case.case_id}",
            proposition=case.proposition,
            observations=case.observations,
            base_probability=case.base_probability,
            max_candidates=max(4, k),
        )
        if not candidates:
            continue

        top = candidates[0]
        second_score = candidates[1].score() if len(candidates) > 1 else 0.0
        margin = _clamp(top.score() - second_score, 0.0, 1.0)
        top_mode = "alternative" if "alternative" in top.tags else "baseline"
        expected_hit = top_mode == case.expected_top_mode
        top_hits += 1 if expected_hit else 0
        margin_sum += margin
        top_score_sum += top.score()

        top_k_slice = candidates[:k]
        alternative_in_top_k = any("alternative" in candidate.tags for candidate in top_k_slice)
        alternative_coverage_hits += 1 if alternative_in_top_k else 0

        case_results.append(
            {
                "case_id": case.case_id,
                "expected_top_mode": case.expected_top_mode,
                "predicted_top_mode": top_mode,
                "passed": expected_hit,
                "top_hypothesis_id": top.hypothesis_id,
                "top_hypothesis_text": top.hypothesis_text,
                "top_score": round(top.score(), 4),
                "runner_up_margin": round(margin, 4),
                "alternative_in_top_k": alternative_in_top_k,
            }
        )

    total = max(1, len(case_results))
    top1_accuracy = top_hits / total
    alternative_coverage = alternative_coverage_hits / total
    avg_margin = margin_sum / total
    avg_top_score = top_score_sum / total
    normalized_margin = _clamp(avg_margin / 0.2, 0.0, 1.0)
    benchmark_score = _clamp(
        (0.55 * top1_accuracy)
        + (0.20 * alternative_coverage)
        + (0.15 * normalized_margin)
        + (0.10 * avg_top_score),
        0.0,
        1.0,
    )
    passed = benchmark_score >= _clamp(pass_threshold, 0.0, 1.0)

    return {
        "benchmark": "hypothesis-red-team-v1",
        "cases_total": len(case_results),
        "top1_accuracy": round(top1_accuracy, 4),
        "alternative_coverage_at_k": round(alternative_coverage, 4),
        "average_margin": round(avg_margin, 4),
        "average_top_score": round(avg_top_score, 4),
        "benchmark_score": round(benchmark_score, 4),
        "pass_threshold": round(_clamp(pass_threshold, 0.0, 1.0), 4),
        "passed": passed,
        "cases": case_results,
    }
