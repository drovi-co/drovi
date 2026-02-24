"""Institutional world-twin materialization and snapshot diffs."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, Mapping

from src.kernel.time import utc_now


def _clamp(value: float, low: float, high: float) -> float:
    return max(low, min(high, value))


def _as_float(value: Any, default: float) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def _as_list(value: Any) -> list[str]:
    if isinstance(value, list):
        return [str(item) for item in value if str(item).strip()]
    if isinstance(value, tuple):
        return [str(item) for item in value if str(item).strip()]
    if isinstance(value, str) and value.strip():
        return [value]
    return []


@dataclass(slots=True)
class WorldEvent:
    event_id: str
    source: str
    observed_at: datetime
    domain: str = "general"
    reliability: float = 0.5
    entity_refs: list[str] = field(default_factory=list)
    payload: dict[str, Any] = field(default_factory=dict)

    @classmethod
    def from_dict(cls, payload: Mapping[str, Any]) -> "WorldEvent":
        observed_at = payload.get("observed_at")
        if not isinstance(observed_at, datetime):
            observed_at = utc_now()

        reliability = _clamp(_as_float(payload.get("reliability"), 0.5), 0.0, 1.0)

        return cls(
            event_id=str(payload.get("event_id") or payload.get("id") or "unknown_event"),
            source=str(payload.get("source") or payload.get("source_type") or "unknown"),
            observed_at=observed_at,
            domain=str(payload.get("domain") or "general").lower(),
            reliability=reliability,
            entity_refs=_as_list(payload.get("entity_refs") or payload.get("entities")),
            payload=dict(payload),
        )


@dataclass(slots=True)
class EntityTwinState:
    entity_id: str
    internal_refs: list[str] = field(default_factory=list)
    external_refs: list[str] = field(default_factory=list)
    pressure_score: float = 0.0
    tags: list[str] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return {
            "entity_id": self.entity_id,
            "internal_refs": sorted(set(self.internal_refs)),
            "external_refs": sorted(set(self.external_refs)),
            "pressure_score": round(self.pressure_score, 4),
            "tags": sorted(set(self.tags)),
        }


@dataclass(slots=True)
class WorldTwinSnapshot:
    organization_id: str
    snapshot_at: datetime
    entity_states: dict[str, EntityTwinState]
    domain_pressure: dict[str, float]
    internal_object_count: int
    external_event_count: int

    def to_dict(self) -> dict[str, Any]:
        return {
            "organization_id": self.organization_id,
            "snapshot_at": self.snapshot_at.isoformat(),
            "entity_states": {
                entity_id: state.to_dict()
                for entity_id, state in sorted(self.entity_states.items(), key=lambda item: item[0])
            },
            "domain_pressure": {
                domain: round(score, 4)
                for domain, score in sorted(self.domain_pressure.items(), key=lambda item: item[0])
            },
            "internal_object_count": self.internal_object_count,
            "external_event_count": self.external_event_count,
        }


@dataclass(slots=True)
class WorldDelta:
    delta_type: str
    ref: str
    before: float
    after: float

    @property
    def magnitude(self) -> float:
        return self.after - self.before

    def to_dict(self) -> dict[str, Any]:
        return {
            "delta_type": self.delta_type,
            "ref": self.ref,
            "before": round(self.before, 4),
            "after": round(self.after, 4),
            "magnitude": round(self.magnitude, 4),
        }


class WorldTwinMaterializer:
    """Builds tenant-scoped world snapshots from internal and external signals."""

    @staticmethod
    def _collect_internal_entities(item: Mapping[str, Any]) -> list[str]:
        refs: list[str] = []
        for key in ("entity_refs", "entities"):
            refs.extend(_as_list(item.get(key)))

        for key in ("entity_id", "target_ref", "account_id", "company_id", "subject_entity_id"):
            value = item.get(key)
            if isinstance(value, str) and value.strip():
                refs.append(value)

        return sorted(set(refs))

    @staticmethod
    def _collect_tags(item: Mapping[str, Any]) -> list[str]:
        tags = _as_list(item.get("tags"))
        item_type = item.get("type")
        if isinstance(item_type, str) and item_type.strip():
            tags.append(item_type.lower())
        return sorted(set(tags))

    def materialize(
        self,
        *,
        organization_id: str,
        internal_objects: list[Mapping[str, Any]],
        external_events: list[WorldEvent | Mapping[str, Any]],
        as_of: datetime | None = None,
    ) -> WorldTwinSnapshot:
        snapshot_at = as_of or utc_now()
        entity_states: dict[str, EntityTwinState] = {}
        domain_pressure: dict[str, float] = {}

        for item in internal_objects:
            object_id = str(item.get("id") or item.get("uio_id") or "internal_unknown")
            tags = self._collect_tags(item)
            for entity_id in self._collect_internal_entities(item):
                state = entity_states.setdefault(entity_id, EntityTwinState(entity_id=entity_id))
                state.internal_refs.append(object_id)
                state.tags.extend(tags)

        normalized_events = [
            event if isinstance(event, WorldEvent) else WorldEvent.from_dict(event)
            for event in external_events
        ]

        for event in normalized_events:
            domain_pressure[event.domain] = domain_pressure.get(event.domain, 0.0) + event.reliability
            pressure_boost = event.reliability * (1.0 + (0.15 * min(len(event.entity_refs), 4)))
            for entity_id in event.entity_refs:
                state = entity_states.setdefault(entity_id, EntityTwinState(entity_id=entity_id))
                state.external_refs.append(event.event_id)
                state.tags.append(event.domain)
                state.pressure_score += pressure_boost

        for state in entity_states.values():
            state.pressure_score = _clamp(state.pressure_score, 0.0, 10.0)

        return WorldTwinSnapshot(
            organization_id=organization_id,
            snapshot_at=snapshot_at,
            entity_states=entity_states,
            domain_pressure=domain_pressure,
            internal_object_count=len(internal_objects),
            external_event_count=len(normalized_events),
        )

    def compute_deltas(
        self,
        previous: WorldTwinSnapshot,
        current: WorldTwinSnapshot,
    ) -> list[WorldDelta]:
        deltas: list[WorldDelta] = []

        domains = set(previous.domain_pressure) | set(current.domain_pressure)
        for domain in domains:
            before = previous.domain_pressure.get(domain, 0.0)
            after = current.domain_pressure.get(domain, 0.0)
            if abs(after - before) > 1e-9:
                deltas.append(WorldDelta(delta_type="domain_pressure", ref=domain, before=before, after=after))

        entities = set(previous.entity_states) | set(current.entity_states)
        for entity_id in entities:
            before = previous.entity_states.get(entity_id, EntityTwinState(entity_id)).pressure_score
            after = current.entity_states.get(entity_id, EntityTwinState(entity_id)).pressure_score
            if abs(after - before) > 1e-9:
                deltas.append(WorldDelta(delta_type="entity_pressure", ref=entity_id, before=before, after=after))

        deltas.sort(key=lambda delta: abs(delta.magnitude), reverse=True)
        return deltas

    def summarize(self, snapshot: WorldTwinSnapshot) -> dict[str, Any]:
        hot_entities = sorted(
            (
                {
                    "entity_id": state.entity_id,
                    "pressure_score": round(state.pressure_score, 4),
                    "external_refs": len(state.external_refs),
                }
                for state in snapshot.entity_states.values()
            ),
            key=lambda item: item["pressure_score"],
            reverse=True,
        )

        return {
            "organization_id": snapshot.organization_id,
            "snapshot_at": snapshot.snapshot_at.isoformat(),
            "entity_count": len(snapshot.entity_states),
            "top_entities": hot_entities[:10],
            "domain_pressure": snapshot.to_dict()["domain_pressure"],
        }
