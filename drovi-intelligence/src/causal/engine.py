"""Causal edge maintenance and propagation."""

from __future__ import annotations

from collections import deque
from dataclasses import dataclass, field
from datetime import datetime
import hashlib
import json
import math
from typing import Any

from src.kernel.time import utc_now


def _clamp(value: float, low: float, high: float) -> float:
    return max(low, min(high, value))


def _stable_hash(payload: Any) -> str:
    encoded = json.dumps(payload, sort_keys=True, separators=(",", ":"), default=str)
    return hashlib.sha256(encoded.encode("utf-8")).hexdigest()[:20]


def _normalize_lag_distribution(
    lag_hours: float,
    lag_distribution: dict[str, float] | None,
) -> dict[str, float]:
    base = max(0.0, float(lag_hours))
    if not lag_distribution:
        return {
            "p10": round(max(0.0, base * 0.5), 4),
            "p50": round(base, 4),
            "p90": round(max(base, base * 1.5), 4),
            "sample_size": 1.0,
        }

    p10 = max(0.0, float(lag_distribution.get("p10", base * 0.5)))
    p50 = max(0.0, float(lag_distribution.get("p50", base)))
    p90 = max(p50, float(lag_distribution.get("p90", max(base, p50 * 1.5))))
    sample_size = max(1.0, float(lag_distribution.get("sample_size", 1.0)))
    return {
        "p10": round(min(p10, p50), 4),
        "p50": round(p50, 4),
        "p90": round(max(p90, p50), 4),
        "sample_size": round(sample_size, 4),
    }


@dataclass(slots=True)
class CausalEdge:
    edge_id: str
    source_ref: str
    target_ref: str
    sign: int  # -1 or +1
    strength: float
    lag_hours: float
    confidence: float
    evidence_refs: list[str] = field(default_factory=list)
    lag_distribution: dict[str, float] | None = None
    updated_at: datetime = field(default_factory=utc_now)

    def __post_init__(self) -> None:
        self.sign = -1 if int(self.sign) < 0 else 1
        self.strength = _clamp(float(self.strength), 0.01, 1.0)
        self.confidence = _clamp(float(self.confidence), 0.01, 1.0)
        self.lag_hours = max(0.0, float(self.lag_hours))
        self.lag_distribution = _normalize_lag_distribution(self.lag_hours, self.lag_distribution)
        self.lag_hours = float(self.lag_distribution["p50"])

    def to_dict(self) -> dict[str, Any]:
        return {
            "edge_id": self.edge_id,
            "source_ref": self.source_ref,
            "target_ref": self.target_ref,
            "sign": self.sign,
            "strength": round(self.strength, 4),
            "lag_hours": round(self.lag_hours, 4),
            "lag_distribution": dict(self.lag_distribution or {}),
            "confidence": round(self.confidence, 4),
            "evidence_refs": list(self.evidence_refs),
            "updated_at": self.updated_at.isoformat(),
        }


@dataclass(slots=True)
class ObservedOutcome:
    source_ref: str
    target_ref: str
    observed_delta: float
    expected_delta: float
    observation_confidence: float
    observed_lag_hours: float | None = None
    conflict_weight: float = 0.0
    evidence_ref: str | None = None


@dataclass(slots=True)
class PropagationImpact:
    source_ref: str
    target_ref: str
    hop: int
    expected_delta: float
    confidence: float
    path: list[str]
    cumulative_lag_hours: float = 0.0

    def to_dict(self) -> dict[str, Any]:
        return {
            "source_ref": self.source_ref,
            "target_ref": self.target_ref,
            "hop": self.hop,
            "expected_delta": round(self.expected_delta, 6),
            "confidence": round(self.confidence, 6),
            "path": list(self.path),
            "cumulative_lag_hours": round(self.cumulative_lag_hours, 4),
        }


class CausalEngine:
    """Learns local causal fragments and propagates impact across the graph."""

    def __init__(self, *, adjacency_cache_size: int = 64) -> None:
        self._adjacency_cache_size = max(1, int(adjacency_cache_size))
        self._adjacency_cache: dict[str, dict[str, list[CausalEdge]]] = {}
        self._adjacency_cache_order: deque[str] = deque()

    def _adjacency_cache_key(self, edges: list[CausalEdge]) -> str:
        return _stable_hash(
            [
                {
                    "edge_id": edge.edge_id,
                    "source_ref": edge.source_ref,
                    "target_ref": edge.target_ref,
                    "updated_at": edge.updated_at.isoformat(),
                }
                for edge in edges
            ]
        )

    def _build_adjacency(self, edges: list[CausalEdge]) -> dict[str, list[CausalEdge]]:
        if not edges:
            return {}
        cache_key = self._adjacency_cache_key(edges)
        cached = self._adjacency_cache.get(cache_key)
        if cached is not None:
            return cached

        adjacency: dict[str, list[CausalEdge]] = {}
        for edge in edges:
            adjacency.setdefault(edge.source_ref, []).append(edge)
        for source_ref in adjacency:
            adjacency[source_ref] = sorted(
                adjacency[source_ref],
                key=lambda edge: (edge.target_ref, edge.edge_id),
            )

        self._adjacency_cache[cache_key] = adjacency
        self._adjacency_cache_order.append(cache_key)
        while len(self._adjacency_cache_order) > self._adjacency_cache_size:
            stale = self._adjacency_cache_order.popleft()
            self._adjacency_cache.pop(stale, None)
        return adjacency

    def update_edge(
        self,
        edge: CausalEdge,
        *,
        observed_delta: float,
        expected_delta: float,
        observation_confidence: float,
        observed_lag_hours: float | None = None,
        learning_rate: float = 0.2,
    ) -> CausalEdge:
        obs_conf = _clamp(observation_confidence, 0.0, 1.0)
        lr = _clamp(learning_rate, 0.01, 0.8)
        error = observed_delta - expected_delta

        normalized_error = abs(error) / max(abs(expected_delta), 0.1)
        direction_match = (observed_delta == 0) or ((observed_delta > 0) == (expected_delta > 0))

        if direction_match:
            strength_adjustment = lr * obs_conf * (1.0 - min(normalized_error, 1.2)) * 0.12
            next_strength = edge.strength + strength_adjustment
            next_confidence = edge.confidence + (0.12 * obs_conf) - (0.04 * normalized_error)
        else:
            penalty = lr * obs_conf * (0.08 + (0.12 * min(normalized_error, 1.5)))
            next_strength = edge.strength - penalty
            next_confidence = edge.confidence - ((0.15 + (0.1 * min(normalized_error, 1.0))) * obs_conf)

        edge.strength = _clamp(next_strength, 0.01, 1.0)
        edge.confidence = _clamp(next_confidence, 0.01, 1.0)

        if observed_lag_hours is not None:
            self._update_lag_distribution(
                edge,
                observed_lag_hours=max(0.0, float(observed_lag_hours)),
                observation_confidence=obs_conf,
                learning_rate=lr,
            )

        edge.updated_at = utc_now()
        return edge

    def update_edges_from_outcomes(
        self,
        *,
        edges: list[CausalEdge],
        outcomes: list[ObservedOutcome],
        learning_rate: float = 0.2,
    ) -> list[CausalEdge]:
        by_pair: dict[tuple[str, str], CausalEdge] = {
            (edge.source_ref, edge.target_ref): edge
            for edge in edges
        }

        for outcome in outcomes:
            edge = by_pair.get((outcome.source_ref, outcome.target_ref))
            if edge is None:
                continue

            self.update_edge(
                edge,
                observed_delta=outcome.observed_delta,
                expected_delta=outcome.expected_delta,
                observation_confidence=outcome.observation_confidence,
                observed_lag_hours=outcome.observed_lag_hours,
                learning_rate=learning_rate,
            )

            if outcome.conflict_weight > 0:
                self.degrade_confidence_on_conflict(
                    edge,
                    conflict_weight=outcome.conflict_weight,
                )

            if outcome.evidence_ref and outcome.evidence_ref not in edge.evidence_refs:
                edge.evidence_refs.append(outcome.evidence_ref)

        return sorted(edges, key=lambda item: item.edge_id)

    def degrade_confidence_on_conflict(
        self,
        edge: CausalEdge,
        *,
        conflict_weight: float,
        conflict_count: int = 1,
    ) -> CausalEdge:
        reduction = _clamp(conflict_weight, 0.0, 1.0) * (0.2 + (0.05 * min(max(conflict_count, 1), 5)))
        edge.confidence = _clamp(edge.confidence - reduction, 0.01, 1.0)
        edge.updated_at = utc_now()
        return edge

    def propagate_shock(
        self,
        *,
        edges: list[CausalEdge],
        origin_ref: str,
        magnitude: float,
        max_hops: int = 3,
        hop_decay: float = 0.65,
        horizon_hours: float | None = None,
        min_abs_delta: float = 0.01,
    ) -> list[PropagationImpact]:
        adjacency = self._build_adjacency(edges)

        impacts: list[PropagationImpact] = []
        frontier: deque[tuple[str, float, int, list[str], float, float]] = deque(
            [(origin_ref, float(magnitude), 0, [origin_ref], 0.0, 1.0)]
        )

        while frontier:
            current_ref, current_delta, hop, path, cumulative_lag, chain_confidence = frontier.popleft()
            if hop >= max_hops:
                continue

            for edge in adjacency.get(current_ref, []):
                next_hop = hop + 1
                next_cumulative_lag = cumulative_lag + max(0.0, edge.lag_hours)
                lag_decay = 1.0
                if horizon_hours and horizon_hours > 0:
                    lag_decay = math.exp(-next_cumulative_lag / float(horizon_hours))

                expected_delta = (
                    current_delta
                    * float(edge.sign)
                    * edge.strength
                    * edge.confidence
                    * (hop_decay ** hop)
                    * lag_decay
                )
                next_chain_confidence = _clamp(chain_confidence * edge.confidence, 0.0, 1.0)
                impact = PropagationImpact(
                    source_ref=origin_ref,
                    target_ref=edge.target_ref,
                    hop=next_hop,
                    expected_delta=expected_delta,
                    confidence=next_chain_confidence,
                    path=path + [edge.target_ref],
                    cumulative_lag_hours=next_cumulative_lag,
                )
                impacts.append(impact)

                if (
                    abs(expected_delta) >= max(0.0, float(min_abs_delta))
                    and edge.target_ref not in path
                ):
                    frontier.append(
                        (
                            edge.target_ref,
                            expected_delta,
                            next_hop,
                            impact.path,
                            next_cumulative_lag,
                            next_chain_confidence,
                        )
                    )

        impacts.sort(
            key=lambda item: (
                -abs(item.expected_delta),
                item.hop,
                item.target_ref,
                "->".join(item.path),
            )
        )
        return impacts

    def propagate_second_order_impacts(
        self,
        *,
        edges: list[CausalEdge],
        origin_ref: str,
        magnitude: float,
        max_hops: int = 3,
        hop_decay: float = 0.65,
        horizon_hours: float | None = None,
        min_abs_delta: float = 0.01,
    ) -> list[PropagationImpact]:
        raw = self.propagate_shock(
            edges=edges,
            origin_ref=origin_ref,
            magnitude=magnitude,
            max_hops=max(2, int(max_hops)),
            hop_decay=hop_decay,
            horizon_hours=horizon_hours,
            min_abs_delta=min_abs_delta,
        )

        grouped: dict[str, dict[str, Any]] = {}
        for impact in raw:
            bucket = grouped.get(impact.target_ref)
            if bucket is None:
                grouped[impact.target_ref] = {
                    "sum_delta": impact.expected_delta,
                    "max_conf": impact.confidence,
                    "min_hop": impact.hop,
                    "min_lag": impact.cumulative_lag_hours,
                    "best_path": list(impact.path),
                    "best_abs_delta": abs(impact.expected_delta),
                }
                continue

            bucket["sum_delta"] += impact.expected_delta
            bucket["max_conf"] = max(float(bucket["max_conf"]), impact.confidence)
            bucket["min_hop"] = min(int(bucket["min_hop"]), impact.hop)
            bucket["min_lag"] = min(float(bucket["min_lag"]), impact.cumulative_lag_hours)
            current_best_abs = float(bucket["best_abs_delta"])
            if abs(impact.expected_delta) > current_best_abs:
                bucket["best_path"] = list(impact.path)
                bucket["best_abs_delta"] = abs(impact.expected_delta)

        impacts = [
            PropagationImpact(
                source_ref=origin_ref,
                target_ref=target_ref,
                hop=int(payload["min_hop"]),
                expected_delta=float(payload["sum_delta"]),
                confidence=_clamp(float(payload["max_conf"]), 0.0, 1.0),
                path=list(payload["best_path"]),
                cumulative_lag_hours=float(payload["min_lag"]),
            )
            for target_ref, payload in grouped.items()
        ]
        impacts.sort(
            key=lambda item: (
                -abs(item.expected_delta),
                item.hop,
                item.target_ref,
                "->".join(item.path),
            )
        )
        return impacts

    @staticmethod
    def replay_stability_hash(impacts: list[PropagationImpact]) -> str:
        payload = [item.to_dict() for item in impacts]
        return _stable_hash(payload)

    @staticmethod
    def _update_lag_distribution(
        edge: CausalEdge,
        *,
        observed_lag_hours: float,
        observation_confidence: float,
        learning_rate: float,
    ) -> None:
        dist = _normalize_lag_distribution(edge.lag_hours, edge.lag_distribution)
        alpha = _clamp(learning_rate * observation_confidence, 0.02, 0.5)

        p10 = float(dist["p10"])
        p50 = float(dist["p50"])
        p90 = float(dist["p90"])
        sample_size = float(dist.get("sample_size", 1.0))

        next_p50 = (1.0 - alpha) * p50 + (alpha * observed_lag_hours)
        spread_low = max(0.5, next_p50 - p10)
        spread_high = max(0.5, p90 - next_p50)

        target_p10 = max(0.0, next_p50 - (0.8 * spread_low))
        target_p90 = max(next_p50, next_p50 + (0.8 * spread_high))

        next_p10 = (1.0 - alpha) * p10 + (alpha * target_p10)
        next_p90 = (1.0 - alpha) * p90 + (alpha * target_p90)

        edge.lag_distribution = {
            "p10": round(min(next_p10, next_p50), 4),
            "p50": round(next_p50, 4),
            "p90": round(max(next_p90, next_p50), 4),
            "sample_size": round(sample_size + 1.0, 4),
        }
        edge.lag_hours = float(edge.lag_distribution["p50"])
