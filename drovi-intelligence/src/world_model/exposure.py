"""Exposure topology graph and propagation primitives."""

from __future__ import annotations

from collections import deque
from dataclasses import dataclass, field
from typing import Any, Mapping


def _clamp(value: float, low: float, high: float) -> float:
    return max(low, min(high, value))


def _as_float(value: Any, default: float = 0.0) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def _as_list(value: Any) -> list[str]:
    if isinstance(value, list):
        return [str(item).strip() for item in value if str(item).strip()]
    if isinstance(value, tuple):
        return [str(item).strip() for item in value if str(item).strip()]
    if isinstance(value, str) and value.strip():
        return [value.strip()]
    return []


def _as_float_map(value: Any) -> dict[str, float]:
    if not isinstance(value, Mapping):
        return {}
    result: dict[str, float] = {}
    for key, item in value.items():
        text = str(key).strip()
        if not text:
            continue
        result[text] = _clamp(_as_float(item, 1.0), 0.1, 3.0)
    return result


def _as_int_map(value: Any) -> dict[str, int]:
    if not isinstance(value, Mapping):
        return {}
    result: dict[str, int] = {}
    for key, item in value.items():
        text = str(key).strip()
        if not text:
            continue
        try:
            parsed = int(item)
        except (TypeError, ValueError):
            continue
        result[text] = max(1, min(parsed, 8))
    return result


@dataclass(slots=True)
class ExposureEdge:
    source_ref: str
    target_ref: str
    edge_type: str
    weight: float
    propagation_limit: int = 3
    risk_multiplier: float = 1.0
    metadata: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return {
            "source_ref": self.source_ref,
            "target_ref": self.target_ref,
            "edge_type": self.edge_type,
            "weight": round(self.weight, 4),
            "propagation_limit": self.propagation_limit,
            "risk_multiplier": round(self.risk_multiplier, 4),
            "metadata": dict(self.metadata),
        }


@dataclass(slots=True)
class ExposureGraph:
    edges: list[ExposureEdge]
    adjacency: dict[str, list[ExposureEdge]]
    reverse_adjacency: dict[str, list[ExposureEdge]]

    def to_dict(self) -> dict[str, Any]:
        return {
            "edge_count": len(self.edges),
            "node_count": len(set(self.adjacency) | set(self.reverse_adjacency)),
            "edges": [edge.to_dict() for edge in self.edges],
        }


class ExposureTopologyEngine:
    """Builds tenant exposure graph and projects external shocks onto internal objects."""

    def __init__(self, *, projection_cache_size: int = 128) -> None:
        self._projection_cache_size = max(1, int(projection_cache_size))
        self._projection_cache: dict[str, dict[str, float]] = {}
        self._projection_cache_order: deque[str] = deque()

    def _projection_cache_key(
        self,
        *,
        graph: ExposureGraph,
        external_refs: list[str],
        max_depth: int,
        decay: float,
        min_score: float,
    ) -> str:
        import hashlib

        signature = {
            "refs": sorted(str(item).strip() for item in external_refs if str(item).strip()),
            "max_depth": max(1, int(max_depth)),
            "decay": round(float(decay), 4),
            "min_score": round(float(min_score), 4),
            "edges": [
                (
                    edge.source_ref,
                    edge.target_ref,
                    edge.edge_type,
                    round(float(edge.weight), 4),
                    int(edge.propagation_limit),
                    round(float(edge.risk_multiplier), 4),
                )
                for edge in graph.edges
            ],
        }
        return hashlib.sha256(str(signature).encode("utf-8")).hexdigest()[:40]

    def build_graph(
        self,
        *,
        internal_objects: list[Mapping[str, Any]],
        risk_overlay: Mapping[str, Any] | None = None,
    ) -> ExposureGraph:
        overlay = dict(risk_overlay or {})
        entity_multipliers = _as_float_map(overlay.get("entity_multipliers"))
        edge_type_multipliers = _as_float_map(overlay.get("edge_type_multipliers"))
        propagation_limits = _as_int_map(overlay.get("propagation_limits"))
        default_multiplier = _clamp(_as_float(overlay.get("default_multiplier"), 1.0), 0.1, 3.0)
        default_limit = max(1, min(int(_as_float(overlay.get("default_propagation_limit"), 3.0)), 8))

        dedup: dict[tuple[str, str, str], ExposureEdge] = {}

        for item in internal_objects:
            object_ref = str(item.get("id") or item.get("uio_id") or item.get("object_ref") or "").strip()
            if not object_ref:
                continue

            object_type = str(item.get("type") or item.get("uio_type") or "internal").strip().lower()
            entity_refs = self._collect_refs(item, ("entity_refs", "entities", "entity_id", "company_id", "account_id"))
            counterparty_refs = self._collect_refs(item, ("counterparty_refs", "counterparties"))
            asset_refs = self._collect_refs(item, ("asset_refs", "assets", "portfolio_refs"))
            dependency_refs = self._collect_refs(item, ("dependency_refs", "dependencies", "depends_on_refs"))

            anchor_refs = entity_refs or [object_ref]
            base_weight = self._derive_base_weight(item)

            # Internal object anchors to entity/counterparty/asset/dependency nodes.
            for target_ref, edge_type, edge_weight in self._derive_object_edges(
                object_ref=object_ref,
                entity_refs=entity_refs,
                counterparty_refs=counterparty_refs,
                asset_refs=asset_refs,
                dependency_refs=dependency_refs,
                base_weight=base_weight,
            ):
                self._upsert_edge(
                    dedup=dedup,
                    source_ref=object_ref,
                    target_ref=target_ref,
                    edge_type=edge_type,
                    edge_weight=edge_weight,
                    object_type=object_type,
                    default_limit=default_limit,
                    default_multiplier=default_multiplier,
                    entity_multipliers=entity_multipliers,
                    edge_type_multipliers=edge_type_multipliers,
                    propagation_limits=propagation_limits,
                )

            # Entity-level propagation links for second-order dependency spread.
            for source_ref in anchor_refs:
                for target_ref in counterparty_refs:
                    self._upsert_edge(
                        dedup=dedup,
                        source_ref=source_ref,
                        target_ref=target_ref,
                        edge_type="counterparty",
                        edge_weight=base_weight * 0.9,
                        object_type=object_type,
                        default_limit=default_limit,
                        default_multiplier=default_multiplier,
                        entity_multipliers=entity_multipliers,
                        edge_type_multipliers=edge_type_multipliers,
                        propagation_limits=propagation_limits,
                    )
                for target_ref in asset_refs:
                    self._upsert_edge(
                        dedup=dedup,
                        source_ref=source_ref,
                        target_ref=target_ref,
                        edge_type="asset",
                        edge_weight=base_weight * 0.85,
                        object_type=object_type,
                        default_limit=default_limit,
                        default_multiplier=default_multiplier,
                        entity_multipliers=entity_multipliers,
                        edge_type_multipliers=edge_type_multipliers,
                        propagation_limits=propagation_limits,
                    )
                for target_ref in dependency_refs:
                    self._upsert_edge(
                        dedup=dedup,
                        source_ref=source_ref,
                        target_ref=target_ref,
                        edge_type="dependency",
                        edge_weight=base_weight * 0.95,
                        object_type=object_type,
                        default_limit=default_limit,
                        default_multiplier=default_multiplier,
                        entity_multipliers=entity_multipliers,
                        edge_type_multipliers=edge_type_multipliers,
                        propagation_limits=propagation_limits,
                    )

            # Explicit custom exposure edges from source payloads (highest precedence).
            explicit_edges = item.get("exposure_edges")
            if isinstance(explicit_edges, list):
                for candidate in explicit_edges:
                    if not isinstance(candidate, Mapping):
                        continue
                    source_ref = str(candidate.get("source_ref") or object_ref).strip()
                    target_ref = str(candidate.get("target_ref") or "").strip()
                    if not source_ref or not target_ref:
                        continue
                    edge_type = str(candidate.get("edge_type") or "custom").strip().lower()
                    edge_weight = _clamp(_as_float(candidate.get("weight"), base_weight), 0.01, 1.0)
                    self._upsert_edge(
                        dedup=dedup,
                        source_ref=source_ref,
                        target_ref=target_ref,
                        edge_type=edge_type,
                        edge_weight=edge_weight,
                        object_type=object_type,
                        default_limit=max(1, min(int(_as_float(candidate.get("propagation_limit"), default_limit)), 8)),
                        default_multiplier=_clamp(
                            _as_float(candidate.get("risk_multiplier"), default_multiplier),
                            0.1,
                            3.0,
                        ),
                        entity_multipliers=entity_multipliers,
                        edge_type_multipliers=edge_type_multipliers,
                        propagation_limits=propagation_limits,
                    )

        edges = sorted(
            dedup.values(),
            key=lambda edge: (edge.source_ref, edge.target_ref, edge.edge_type),
        )
        adjacency: dict[str, list[ExposureEdge]] = {}
        reverse: dict[str, list[ExposureEdge]] = {}
        for edge in edges:
            adjacency.setdefault(edge.source_ref, []).append(edge)
            reverse.setdefault(edge.target_ref, []).append(edge)

        return ExposureGraph(
            edges=edges,
            adjacency=adjacency,
            reverse_adjacency=reverse,
        )

    def project_external_shock(
        self,
        *,
        graph: ExposureGraph,
        external_refs: list[str],
        max_depth: int = 4,
        decay: float = 0.72,
        min_score: float = 0.02,
    ) -> dict[str, float]:
        cache_key = self._projection_cache_key(
            graph=graph,
            external_refs=external_refs,
            max_depth=max_depth,
            decay=decay,
            min_score=min_score,
        )
        cached = self._projection_cache.get(cache_key)
        if cached is not None:
            return dict(cached)

        queue: deque[tuple[str, float, int]] = deque()
        visited: dict[tuple[str, int], float] = {}
        scores: dict[str, float] = {}

        for ref in external_refs:
            clean_ref = str(ref).strip()
            if not clean_ref:
                continue
            queue.append((clean_ref, 1.0, 0))

        while queue:
            current_ref, score, depth = queue.popleft()
            if depth >= max_depth:
                continue

            for edge in graph.reverse_adjacency.get(current_ref, []):
                if depth + 1 > edge.propagation_limit:
                    continue
                propagated = score * edge.weight * edge.risk_multiplier * (decay**depth)
                propagated = _clamp(propagated, 0.0, 1.0)
                if propagated < min_score:
                    continue

                previous_score = scores.get(edge.source_ref, 0.0)
                if propagated > previous_score:
                    scores[edge.source_ref] = propagated

                next_key = (edge.source_ref, depth + 1)
                if propagated <= visited.get(next_key, 0.0):
                    continue
                visited[next_key] = propagated
                queue.append((edge.source_ref, propagated, depth + 1))

        self._projection_cache[cache_key] = dict(scores)
        self._projection_cache_order.append(cache_key)
        while len(self._projection_cache_order) > self._projection_cache_size:
            stale_key = self._projection_cache_order.popleft()
            self._projection_cache.pop(stale_key, None)

        return scores

    def _derive_base_weight(self, item: Mapping[str, Any]) -> float:
        # Materiality / criticality / priority are normalized into one edge weight.
        materiality = _as_float(item.get("materiality"), 0.5)
        criticality = _as_float(item.get("criticality"), materiality)
        priority = _as_float(item.get("priority"), 5.0)
        priority_score = 1.0 - (_clamp(priority, 1.0, 10.0) - 1.0) / 9.0
        return _clamp((0.45 * materiality) + (0.35 * criticality) + (0.2 * priority_score), 0.05, 1.0)

    def _collect_refs(self, item: Mapping[str, Any], keys: tuple[str, ...]) -> list[str]:
        refs: list[str] = []
        for key in keys:
            value = item.get(key)
            refs.extend(_as_list(value))
        return sorted(set(refs))

    def _derive_object_edges(
        self,
        *,
        object_ref: str,
        entity_refs: list[str],
        counterparty_refs: list[str],
        asset_refs: list[str],
        dependency_refs: list[str],
        base_weight: float,
    ) -> list[tuple[str, str, float]]:
        edges: list[tuple[str, str, float]] = []
        for target_ref in entity_refs:
            edges.append((target_ref, "entity", base_weight))
        for target_ref in counterparty_refs:
            edges.append((target_ref, "counterparty", base_weight * 0.95))
        for target_ref in asset_refs:
            edges.append((target_ref, "asset", base_weight * 0.9))
        for target_ref in dependency_refs:
            edges.append((target_ref, "dependency", base_weight))
        if not edges:
            # Keep isolated objects reachable for risk appetite overlays.
            edges.append((object_ref, "self", max(base_weight, 0.2)))
        return edges

    def _upsert_edge(
        self,
        *,
        dedup: dict[tuple[str, str, str], ExposureEdge],
        source_ref: str,
        target_ref: str,
        edge_type: str,
        edge_weight: float,
        object_type: str,
        default_limit: int,
        default_multiplier: float,
        entity_multipliers: dict[str, float],
        edge_type_multipliers: dict[str, float],
        propagation_limits: dict[str, int],
    ) -> None:
        clean_source = str(source_ref).strip()
        clean_target = str(target_ref).strip()
        clean_type = str(edge_type).strip().lower()
        if not clean_source or not clean_target or not clean_type:
            return

        entity_multiplier = max(
            entity_multipliers.get(clean_source, 1.0),
            entity_multipliers.get(clean_target, 1.0),
        )
        edge_multiplier = edge_type_multipliers.get(clean_type, 1.0)
        risk_multiplier = _clamp(default_multiplier * entity_multiplier * edge_multiplier, 0.1, 3.0)

        key = (clean_source, clean_target, clean_type)
        candidate = ExposureEdge(
            source_ref=clean_source,
            target_ref=clean_target,
            edge_type=clean_type,
            weight=_clamp(edge_weight, 0.01, 1.0),
            propagation_limit=propagation_limits.get(clean_type, default_limit),
            risk_multiplier=risk_multiplier,
            metadata={"object_type": object_type},
        )

        existing = dedup.get(key)
        if existing is None:
            dedup[key] = candidate
            return

        if candidate.weight > existing.weight:
            existing.weight = candidate.weight
        if candidate.risk_multiplier > existing.risk_multiplier:
            existing.risk_multiplier = candidate.risk_multiplier
        if candidate.propagation_limit > existing.propagation_limit:
            existing.propagation_limit = candidate.propagation_limit
        existing.metadata.update(candidate.metadata)
