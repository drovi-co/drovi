"""Impact engine v2 built on exposure topology and uncertainty-aware scoring."""

from __future__ import annotations

from dataclasses import dataclass, field
import hashlib
import json
from typing import Any, Mapping

from src.world_model.exposure import ExposureTopologyEngine


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


def _stable_hash(payload: Mapping[str, Any]) -> str:
    content = json.dumps(dict(payload), sort_keys=True, separators=(",", ":"), default=str)
    return hashlib.sha256(content.encode("utf-8")).hexdigest()


@dataclass(slots=True)
class ImpactBridgeCandidate:
    external_object_ref: str
    internal_object_ref: str
    impact_type: str
    impact_score: float
    severity: str
    confidence: float
    exposure_score: float
    materiality_score: float
    causal_strength: float
    uncertainty: float
    dedupe_key: str
    affected_entities: list[str] = field(default_factory=list)
    evidence_link_ids: list[str] = field(default_factory=list)
    metadata: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return {
            "external_object_ref": self.external_object_ref,
            "internal_object_ref": self.internal_object_ref,
            "impact_type": self.impact_type,
            "impact_score": round(self.impact_score, 4),
            "severity": self.severity,
            "confidence": round(self.confidence, 4),
            "exposure_score": round(self.exposure_score, 4),
            "materiality_score": round(self.materiality_score, 4),
            "causal_strength": round(self.causal_strength, 4),
            "uncertainty": round(self.uncertainty, 4),
            "dedupe_key": self.dedupe_key,
            "affected_entities": list(self.affected_entities),
            "evidence_link_ids": list(self.evidence_link_ids),
            "metadata": dict(self.metadata),
        }


class ImpactEngineV2:
    """Computes external->internal impact bridges with anti-noise controls."""

    def __init__(self, topology: ExposureTopologyEngine | None = None) -> None:
        self._topology = topology or ExposureTopologyEngine()

    def compute_bridges(
        self,
        *,
        internal_objects: list[Mapping[str, Any]],
        external_events: list[Mapping[str, Any]],
        risk_overlay: Mapping[str, Any] | None = None,
        causal_strength_by_ref: Mapping[str, float] | None = None,
        min_score: float = 0.35,
        max_per_internal: int = 3,
        max_total: int = 30,
    ) -> list[ImpactBridgeCandidate]:
        graph = self._topology.build_graph(
            internal_objects=internal_objects,
            risk_overlay=risk_overlay,
        )
        causal_scores = {str(key): _clamp(_as_float(value, 0.5), 0.0, 1.0) for key, value in dict(causal_strength_by_ref or {}).items()}
        overlay = dict(risk_overlay or {})
        object_type_multiplier = self._coerce_multiplier_map(overlay.get("object_type_multipliers"))
        default_multiplier = _clamp(_as_float(overlay.get("default_multiplier"), 1.0), 0.1, 3.0)

        objects_index = {
            str(item.get("id") or item.get("uio_id") or item.get("object_ref") or ""): item
            for item in internal_objects
            if str(item.get("id") or item.get("uio_id") or item.get("object_ref") or "").strip()
        }

        raw_candidates: list[ImpactBridgeCandidate] = []
        for event in external_events:
            event_ref = self._event_ref(event)
            if not event_ref:
                continue
            entity_refs = self._event_entities(event)
            if not entity_refs:
                continue

            projected = self._topology.project_external_shock(
                graph=graph,
                external_refs=entity_refs,
                max_depth=max(1, min(int(_as_float(event.get("max_depth"), 4.0)), 6)),
            )

            event_reliability = _clamp(_as_float(event.get("reliability"), _as_float(event.get("confidence"), 0.55)), 0.0, 1.0)
            uncertainty = 1.0 - event_reliability
            event_materiality = self._event_materiality(event)
            event_domain = str(event.get("domain") or event.get("topic") or "general").strip().lower()
            evidence_link_ids = _as_list(event.get("evidence_link_ids"))
            if not evidence_link_ids and event.get("artifact_id"):
                evidence_link_ids = [str(event.get("artifact_id"))]

            for object_ref, item in objects_index.items():
                object_entities = self._object_entities(item)
                shared_entities = sorted(set(entity_refs) & set(object_entities))
                exposure = _clamp(_as_float(projected.get(object_ref), 0.0), 0.0, 1.0)
                if exposure <= 0.0 and shared_entities:
                    exposure = _clamp(0.25 + (0.15 * min(len(shared_entities), 3)), 0.0, 1.0)
                if exposure <= 0.0:
                    continue

                materiality = _clamp((event_materiality + self._object_materiality(item)) / 2.0, 0.0, 1.0)
                causal_strength = self._causal_strength(item, causal_scores)
                risk_multiplier = self._risk_multiplier(
                    item=item,
                    object_type_multiplier=object_type_multiplier,
                    default_multiplier=default_multiplier,
                )

                impact_score = self.compute_impact_score(
                    exposure=exposure,
                    materiality=materiality,
                    causal_strength=causal_strength,
                    uncertainty=uncertainty,
                    risk_multiplier=risk_multiplier,
                )
                if impact_score < min_score:
                    continue

                confidence = self._confidence_from_components(
                    exposure=exposure,
                    reliability=event_reliability,
                    causal_strength=causal_strength,
                )
                impact_type = self._impact_type(event_domain, item)
                dedupe_key = self._dedupe_key(event_ref=event_ref, object_ref=object_ref, impact_type=impact_type)

                raw_candidates.append(
                    ImpactBridgeCandidate(
                        external_object_ref=event_ref,
                        internal_object_ref=object_ref,
                        impact_type=impact_type,
                        impact_score=impact_score,
                        severity=self.classify_severity(impact_score=impact_score, confidence=confidence),
                        confidence=confidence,
                        exposure_score=exposure,
                        materiality_score=materiality,
                        causal_strength=causal_strength,
                        uncertainty=uncertainty,
                        dedupe_key=dedupe_key,
                        affected_entities=shared_entities or object_entities,
                        evidence_link_ids=evidence_link_ids,
                        metadata={
                            "event_domain": event_domain,
                            "risk_multiplier": round(risk_multiplier, 4),
                            "event_reliability": round(event_reliability, 4),
                        },
                    )
                )

        deduped = self.dedupe_candidates(raw_candidates)
        throttled = self.throttle_candidates(
            deduped,
            max_per_internal=max_per_internal,
            max_total=max_total,
        )
        return throttled

    def compute_impact_score(
        self,
        *,
        exposure: float,
        materiality: float,
        causal_strength: float,
        uncertainty: float,
        risk_multiplier: float,
    ) -> float:
        raw_score = (
            (0.40 * _clamp(exposure, 0.0, 1.0))
            + (0.25 * _clamp(materiality, 0.0, 1.0))
            + (0.20 * _clamp(causal_strength, 0.0, 1.0))
            + (0.15 * _clamp(1.0 - uncertainty, 0.0, 1.0))
        )
        return _clamp(raw_score * _clamp(risk_multiplier, 0.1, 3.0), 0.0, 1.0)

    def classify_severity(self, *, impact_score: float, confidence: float) -> str:
        weighted = _clamp((0.7 * impact_score) + (0.3 * confidence), 0.0, 1.0)
        if weighted >= 0.85:
            return "critical"
        if weighted >= 0.65:
            return "high"
        if weighted >= 0.45:
            return "medium"
        return "low"

    def dedupe_candidates(self, candidates: list[ImpactBridgeCandidate]) -> list[ImpactBridgeCandidate]:
        best_by_key: dict[str, ImpactBridgeCandidate] = {}
        for item in candidates:
            existing = best_by_key.get(item.dedupe_key)
            if existing is None or item.impact_score > existing.impact_score:
                best_by_key[item.dedupe_key] = item
        return sorted(best_by_key.values(), key=lambda item: item.impact_score, reverse=True)

    def throttle_candidates(
        self,
        candidates: list[ImpactBridgeCandidate],
        *,
        max_per_internal: int,
        max_total: int,
    ) -> list[ImpactBridgeCandidate]:
        if max_total <= 0:
            return []

        limits = max(1, int(max_per_internal))
        budget = max(1, int(max_total))
        usage: dict[str, int] = {}
        selected: list[ImpactBridgeCandidate] = []

        for item in sorted(candidates, key=lambda candidate: candidate.impact_score, reverse=True):
            internal_ref = item.internal_object_ref
            if usage.get(internal_ref, 0) >= limits:
                continue
            usage[internal_ref] = usage.get(internal_ref, 0) + 1
            selected.append(item)
            if len(selected) >= budget:
                break

        return selected

    def _impact_type(self, event_domain: str, item: Mapping[str, Any]) -> str:
        object_type = str(item.get("type") or item.get("uio_type") or "internal").strip().lower()
        if event_domain in {"legal", "regulatory", "compliance"}:
            if object_type in {"commitment", "task", "policy"}:
                return "requires_update"
            return "compliance_risk"
        if event_domain in {"finance", "market", "macro"}:
            return "risk_drift"
        if event_domain in {"research", "medical", "science"}:
            return "assumption_drift"
        return "material_change"

    def _event_ref(self, event: Mapping[str, Any]) -> str:
        return str(event.get("event_id") or event.get("id") or event.get("external_object_ref") or "").strip()

    def _event_entities(self, event: Mapping[str, Any]) -> list[str]:
        refs = _as_list(event.get("entity_refs"))
        refs.extend(_as_list(event.get("entities")))
        refs.extend(_as_list(event.get("linked_entities")))
        return sorted(set(refs))

    def _event_materiality(self, event: Mapping[str, Any]) -> float:
        explicit = event.get("materiality")
        if explicit is not None:
            return _clamp(_as_float(explicit, 0.5), 0.0, 1.0)

        severity = str(event.get("severity") or "").strip().lower()
        if severity in {"critical", "sev0"}:
            return 0.95
        if severity in {"high", "sev1"}:
            return 0.8
        if severity in {"medium", "sev2"}:
            return 0.6
        if severity in {"low", "sev3"}:
            return 0.4
        return _clamp(_as_float(event.get("priority"), 0.55) / 10.0, 0.35, 0.75)

    def _object_entities(self, item: Mapping[str, Any]) -> list[str]:
        refs = _as_list(item.get("entity_refs"))
        refs.extend(_as_list(item.get("entities")))
        refs.extend(_as_list(item.get("counterparty_refs")))
        refs.extend(_as_list(item.get("asset_refs")))
        for key in ("entity_id", "company_id", "account_id"):
            if item.get(key):
                refs.append(str(item[key]).strip())
        return sorted(set(refs))

    def _object_materiality(self, item: Mapping[str, Any]) -> float:
        explicit = item.get("materiality")
        if explicit is not None:
            return _clamp(_as_float(explicit, 0.55), 0.0, 1.0)

        criticality = _as_float(item.get("criticality"), 0.55)
        priority = _as_float(item.get("priority"), 5.0)
        priority_score = 1.0 - (_clamp(priority, 1.0, 10.0) - 1.0) / 9.0
        return _clamp((0.65 * criticality) + (0.35 * priority_score), 0.0, 1.0)

    def _causal_strength(self, item: Mapping[str, Any], causal_scores: Mapping[str, float]) -> float:
        object_ref = str(item.get("id") or item.get("uio_id") or item.get("object_ref") or "").strip()
        if object_ref and object_ref in causal_scores:
            return causal_scores[object_ref]
        for entity_ref in self._object_entities(item):
            if entity_ref in causal_scores:
                return causal_scores[entity_ref]
        return _clamp(_as_float(item.get("causal_strength"), 0.5), 0.0, 1.0)

    def _confidence_from_components(self, *, exposure: float, reliability: float, causal_strength: float) -> float:
        return _clamp((0.45 * reliability) + (0.3 * exposure) + (0.25 * causal_strength), 0.0, 1.0)

    def _risk_multiplier(
        self,
        *,
        item: Mapping[str, Any],
        object_type_multiplier: Mapping[str, float],
        default_multiplier: float,
    ) -> float:
        object_type = str(item.get("type") or item.get("uio_type") or "internal").strip().lower()
        explicit = item.get("risk_multiplier")
        if explicit is not None:
            return _clamp(_as_float(explicit, default_multiplier), 0.1, 3.0)
        return _clamp(default_multiplier * object_type_multiplier.get(object_type, 1.0), 0.1, 3.0)

    def _dedupe_key(self, *, event_ref: str, object_ref: str, impact_type: str) -> str:
        return _stable_hash(
            {
                "external_object_ref": event_ref,
                "internal_object_ref": object_ref,
                "impact_type": impact_type,
            }
        )

    def _coerce_multiplier_map(self, payload: Any) -> dict[str, float]:
        if not isinstance(payload, Mapping):
            return {}
        result: dict[str, float] = {}
        for key, value in payload.items():
            name = str(key).strip().lower()
            if not name:
                continue
            result[name] = _clamp(_as_float(value, 1.0), 0.1, 3.0)
        return result
