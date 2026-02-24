"""Deterministic backtests for causal-vs-correlation impact ranking."""

from __future__ import annotations

from dataclasses import dataclass
from math import log2
from typing import Any

from src.causal.engine import CausalEdge, CausalEngine


@dataclass(frozen=True)
class CausalBacktestCase:
    case_id: str
    origin_ref: str
    shock_magnitude: float
    edges: list[CausalEdge]
    truth_effects: dict[str, float]
    max_hops: int = 3


def _ndcg_at_k(predicted_targets: list[str], truth_effects: dict[str, float], k: int = 5) -> float:
    if not predicted_targets:
        return 0.0
    limit = max(1, min(k, len(predicted_targets)))
    gains = [abs(float(truth_effects.get(target, 0.0))) for target in predicted_targets[:limit]]
    dcg = 0.0
    for idx, gain in enumerate(gains, start=1):
        dcg += gain / log2(idx + 1)

    ideal = sorted((abs(float(value)) for value in truth_effects.values()), reverse=True)[:limit]
    idcg = 0.0
    for idx, gain in enumerate(ideal, start=1):
        idcg += gain / log2(idx + 1)

    if idcg <= 0:
        return 0.0
    return dcg / idcg


def default_causal_backtest_cases() -> list[CausalBacktestCase]:
    return [
        CausalBacktestCase(
            case_id="semiconductor_chain",
            origin_ref="geopolitical_risk",
            shock_magnitude=1.0,
            edges=[
                CausalEdge("e1", "geopolitical_risk", "export_controls", 1, 0.85, 12, 0.9),
                CausalEdge("e2", "export_controls", "supplier_delay", 1, 0.8, 24, 0.85),
                CausalEdge("e3", "supplier_delay", "portfolio_drawdown", 1, 0.75, 36, 0.8),
                CausalEdge("e4", "geopolitical_risk", "portfolio_drawdown", 1, 0.2, 12, 0.4),
            ],
            truth_effects={
                "export_controls": 0.75,
                "supplier_delay": 0.68,
                "portfolio_drawdown": 0.61,
            },
        ),
        CausalBacktestCase(
            case_id="regulatory_legal_chain",
            origin_ref="regulation_update",
            shock_magnitude=0.9,
            edges=[
                CausalEdge("e5", "regulation_update", "policy_obligation", 1, 0.8, 8, 0.88),
                CausalEdge("e6", "policy_obligation", "contract_template_risk", 1, 0.82, 24, 0.86),
                CausalEdge("e7", "contract_template_risk", "renewal_exposure", 1, 0.7, 36, 0.81),
                CausalEdge("e8", "regulation_update", "renewal_exposure", 1, 0.22, 12, 0.42),
            ],
            truth_effects={
                "policy_obligation": 0.71,
                "contract_template_risk": 0.63,
                "renewal_exposure": 0.54,
            },
        ),
        CausalBacktestCase(
            case_id="macro_financing_chain",
            origin_ref="rate_hike_signal",
            shock_magnitude=0.85,
            edges=[
                CausalEdge("e9", "rate_hike_signal", "funding_cost", 1, 0.84, 6, 0.9),
                CausalEdge("e10", "funding_cost", "runway_pressure", 1, 0.79, 18, 0.86),
                CausalEdge("e11", "runway_pressure", "hiring_freeze_risk", 1, 0.76, 24, 0.82),
                CausalEdge("e12", "rate_hike_signal", "hiring_freeze_risk", 1, 0.18, 10, 0.4),
            ],
            truth_effects={
                "funding_cost": 0.69,
                "runway_pressure": 0.58,
                "hiring_freeze_risk": 0.52,
            },
        ),
    ]


def run_causal_backtest(
    *,
    engine: CausalEngine | None = None,
    max_k: int = 5,
    min_improvement: float = 0.03,
    min_causal_quality: float = 0.72,
) -> dict[str, Any]:
    causal_engine = engine or CausalEngine()
    cases = default_causal_backtest_cases()

    case_results: list[dict[str, Any]] = []
    causal_scores: list[float] = []
    correlation_scores: list[float] = []

    for case in cases:
        impacts = causal_engine.propagate_second_order_impacts(
            edges=case.edges,
            origin_ref=case.origin_ref,
            magnitude=case.shock_magnitude,
            max_hops=case.max_hops,
        )
        causal_rank = [item.target_ref for item in impacts]
        direct_edges = [edge for edge in case.edges if edge.source_ref == case.origin_ref]
        direct_edges.sort(key=lambda edge: (-abs(edge.strength * edge.confidence), edge.target_ref))
        correlation_rank = [edge.target_ref for edge in direct_edges]

        causal_ndcg = _ndcg_at_k(causal_rank, case.truth_effects, k=max_k)
        correlation_ndcg = _ndcg_at_k(correlation_rank, case.truth_effects, k=max_k)
        improvement = causal_ndcg - correlation_ndcg

        causal_scores.append(causal_ndcg)
        correlation_scores.append(correlation_ndcg)

        case_results.append(
            {
                "case_id": case.case_id,
                "causal_ndcg": round(causal_ndcg, 4),
                "correlation_ndcg": round(correlation_ndcg, 4),
                "improvement": round(improvement, 4),
                "causal_top_targets": causal_rank[:max_k],
                "correlation_top_targets": correlation_rank[:max_k],
            }
        )

    case_count = max(1, len(case_results))
    avg_causal = sum(causal_scores) / case_count
    avg_correlation = sum(correlation_scores) / case_count
    avg_improvement = avg_causal - avg_correlation
    passed = avg_improvement >= min_improvement and avg_causal >= min_causal_quality

    return {
        "benchmark": "causal-vs-correlation-v1",
        "cases_total": len(case_results),
        "average_causal_ndcg": round(avg_causal, 4),
        "average_correlation_ndcg": round(avg_correlation, 4),
        "average_improvement": round(avg_improvement, 4),
        "min_improvement_threshold": round(min_improvement, 4),
        "min_causal_quality_threshold": round(min_causal_quality, 4),
        "passed": passed,
        "cases": case_results,
    }
