"""Baseline model families and graph-backend strategy benchmarks."""

from __future__ import annotations

from dataclasses import dataclass
from math import log
from statistics import quantiles
from typing import Any, Literal


def _clamp(value: float, low: float, high: float) -> float:
    return max(low, min(high, value))


def _p95(values: list[float]) -> float:
    if not values:
        return 0.0
    if len(values) == 1:
        return values[0]
    return quantiles(values, n=100, method="inclusive")[94]


class TemporalForecastBaseline:
    """Simple state-space/transformer-inspired trend baseline for drift prediction."""

    def __init__(self, *, mode: Literal["state_space", "transformer"] = "state_space") -> None:
        self.mode = mode
        self._series: list[float] = []
        self._trend = 0.0
        self._level = 0.0

    def fit(self, series: list[float]) -> None:
        if not series:
            raise ValueError("series cannot be empty")
        self._series = [float(value) for value in series]
        self._level = self._series[-1]
        if len(self._series) == 1:
            self._trend = 0.0
            return

        deltas = [self._series[idx] - self._series[idx - 1] for idx in range(1, len(self._series))]
        avg_delta = sum(deltas) / len(deltas)
        if self.mode == "transformer":
            # Heavier weight on recent change.
            self._trend = (0.7 * deltas[-1]) + (0.3 * avg_delta)
        else:
            self._trend = avg_delta

    def predict(self, *, horizon: int) -> list[float]:
        if horizon <= 0:
            return []
        predictions: list[float] = []
        base = self._level
        for step in range(1, horizon + 1):
            predictions.append(base + (self._trend * step))
        return predictions


class GraphImpactBaseline:
    """Lightweight link prediction baseline for exposure/impact propagation."""

    def score_links(
        self,
        *,
        edges: list[tuple[str, str]],
        candidate_pairs: list[tuple[str, str]],
    ) -> dict[str, float]:
        neighbors: dict[str, set[str]] = {}
        for source, target in edges:
            neighbors.setdefault(source, set()).add(target)
            neighbors.setdefault(target, set()).add(source)

        scores: dict[str, float] = {}
        for source, target in candidate_pairs:
            src_n = neighbors.get(source, set())
            tgt_n = neighbors.get(target, set())
            common = src_n & tgt_n
            common_neighbors = len(common)
            adamic_adar = sum(1.0 / max(log(len(neighbors.get(node, [])) + 1), 1.0) for node in common)
            preferential_attachment = len(src_n) * len(tgt_n)
            score = (0.5 * common_neighbors) + (0.3 * adamic_adar) + (0.2 * (preferential_attachment / 25.0))
            scores[f"{source}->{target}"] = round(_clamp(score / 5.0, 0.0, 1.0), 4)
        return scores


class VerifierNLIBaseline:
    """Heuristic verifier/NLI baseline for contradiction and consistency scoring."""

    _NEGATIONS = {"not", "never", "no", "none", "without", "cannot", "can't"}

    def score(self, *, claim: str, evidence: str) -> dict[str, float]:
        claim_tokens = {token.lower() for token in claim.split() if token.strip()}
        evidence_tokens = {token.lower() for token in evidence.split() if token.strip()}
        if not claim_tokens:
            return {"support": 0.0, "contradiction": 0.0, "consistency": 0.0}

        overlap = len(claim_tokens & evidence_tokens) / len(claim_tokens)
        claim_neg = bool(claim_tokens & self._NEGATIONS)
        evidence_neg = bool(evidence_tokens & self._NEGATIONS)
        negation_mismatch = 1.0 if claim_neg != evidence_neg else 0.0
        contradiction = _clamp((0.6 * negation_mismatch) + (0.4 * (1.0 - overlap)), 0.0, 1.0)
        support = _clamp((0.7 * overlap) + (0.3 * (1.0 - negation_mismatch)), 0.0, 1.0)
        consistency = _clamp((support - (0.6 * contradiction)), 0.0, 1.0)
        return {
            "support": round(support, 4),
            "contradiction": round(contradiction, 4),
            "consistency": round(consistency, 4),
        }


def benchmark_causal_discovery(
    *,
    discovered_edges: set[tuple[str, str]],
    heuristic_edges: set[tuple[str, str]],
    truth_edges: set[tuple[str, str]],
) -> dict[str, Any]:
    def _f1(pred: set[tuple[str, str]]) -> tuple[float, float, float]:
        tp = len(pred & truth_edges)
        fp = len(pred - truth_edges)
        fn = len(truth_edges - pred)
        precision = tp / max(1, tp + fp)
        recall = tp / max(1, tp + fn)
        if precision + recall == 0:
            return 0.0, 0.0, 0.0
        f1 = 2 * precision * recall / (precision + recall)
        return precision, recall, f1

    discovery_p, discovery_r, discovery_f1 = _f1(discovered_edges)
    heuristic_p, heuristic_r, heuristic_f1 = _f1(heuristic_edges)
    return {
        "discovery": {
            "precision": round(discovery_p, 4),
            "recall": round(discovery_r, 4),
            "f1": round(discovery_f1, 4),
        },
        "heuristic": {
            "precision": round(heuristic_p, 4),
            "recall": round(heuristic_r, 4),
            "f1": round(heuristic_f1, 4),
        },
        "f1_improvement": round(discovery_f1 - heuristic_f1, 4),
        "passed": discovery_f1 >= heuristic_f1,
    }


@dataclass(frozen=True, slots=True)
class GraphBackendThresholds:
    max_p95_ms: float = 120.0
    min_qps: float = 800.0
    max_semantic_mismatch_rate: float = 0.01


class GraphBackendBenchmark:
    """Benchmarks graph abstraction hot paths and backend migration readiness."""

    def run_hot_path_benchmark(
        self,
        *,
        query_latencies_ms: dict[str, list[float]],
        query_qps: dict[str, float],
    ) -> dict[str, Any]:
        by_query = {}
        for query_name, latencies in query_latencies_ms.items():
            by_query[query_name] = {
                "p95_ms": round(_p95([float(value) for value in latencies]), 3),
                "avg_qps": round(float(query_qps.get(query_name, 0.0)), 2),
            }

        global_p95 = _p95([stats["p95_ms"] for stats in by_query.values()]) if by_query else 0.0
        min_qps = min((stats["avg_qps"] for stats in by_query.values()), default=0.0)
        return {
            "queries": by_query,
            "global_p95_ms": round(global_p95, 3),
            "min_query_qps": round(min_qps, 2),
        }

    def evaluate_secondary_backend(
        self,
        *,
        current_metrics: dict[str, float],
        candidate_metrics: dict[str, float],
        thresholds: GraphBackendThresholds | None = None,
    ) -> dict[str, Any]:
        limits = thresholds or GraphBackendThresholds()
        candidate_p95 = _safe_metric(candidate_metrics, "global_p95_ms")
        candidate_qps = _safe_metric(candidate_metrics, "min_query_qps")
        semantic_mismatch = _safe_metric(candidate_metrics, "semantic_mismatch_rate")

        checks = {
            "p95": candidate_p95 <= limits.max_p95_ms,
            "qps": candidate_qps >= limits.min_qps,
            "semantic_mismatch": semantic_mismatch <= limits.max_semantic_mismatch_rate,
            "improves_over_current_p95": candidate_p95 <= _safe_metric(current_metrics, "global_p95_ms"),
        }
        return {
            "checks": checks,
            "passed": all(checks.values()),
            "thresholds": {
                "max_p95_ms": limits.max_p95_ms,
                "min_qps": limits.min_qps,
                "max_semantic_mismatch_rate": limits.max_semantic_mismatch_rate,
            },
            "candidate_metrics": candidate_metrics,
            "current_metrics": current_metrics,
        }

    @staticmethod
    def migration_playbook() -> dict[str, Any]:
        return {
            "name": "graph-backend-migration-v1",
            "steps": [
                "Define semantic contract tests for all hot-path graph queries.",
                "Run dual-write from graph abstraction to current + candidate backend.",
                "Run dual-read shadow queries and compare result hashes.",
                "Gate canary cutover on mismatch rate and latency thresholds.",
                "Promote tenant cohorts progressively with rollback toggles.",
                "Freeze migration only after one full replay and consistency audit.",
            ],
            "semantic_guarantees": [
                "node_identity_stability",
                "edge_direction_preservation",
                "temporal_filter_equivalence",
                "path_query_result_equivalence",
            ],
        }


def _safe_metric(metrics: dict[str, Any], key: str) -> float:
    try:
        return float(metrics.get(key, 0.0))
    except (TypeError, ValueError):
        return 0.0

