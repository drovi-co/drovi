"""World twin materialization service with persistence, drift, and role views."""

from __future__ import annotations

from dataclasses import asdict
from datetime import UTC, datetime, timedelta
from time import perf_counter
from typing import Any, Mapping
from uuid import uuid4

from sqlalchemy import text

from src.config import get_settings
from src.db.client import get_db_session
from src.db.rls import set_rls_context
from src.lakehouse.control_plane import get_checkpoint, upsert_checkpoint
from src.world_model.twin import EntityTwinState, WorldDelta, WorldEvent, WorldTwinMaterializer, WorldTwinSnapshot


def _as_utc(value: str | datetime | None) -> datetime:
    if isinstance(value, datetime):
        if value.tzinfo is None:
            return value.replace(tzinfo=UTC)
        return value.astimezone(UTC)
    if isinstance(value, str) and value.strip():
        normalized = value.strip().replace("Z", "+00:00")
        parsed = datetime.fromisoformat(normalized)
        if parsed.tzinfo is None:
            return parsed.replace(tzinfo=UTC)
        return parsed.astimezone(UTC)
    return datetime.now(UTC)


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


class WorldTwinService:
    """Lifecycle operations for world twin snapshots and drift introspection."""

    CURRENT_CHECKPOINT_KEY = "world_twin.current.v1"
    SNAPSHOT_EVENT_TYPE = "world_twin.snapshot.v1"
    DRIFT_EVENT_TYPE = "world_twin.drift.v1"

    def __init__(self, organization_id: str) -> None:
        self.organization_id = organization_id
        self._materializer = WorldTwinMaterializer()
        self._hot_query_cache: dict[str, tuple[float, dict[str, Any]]] = {}

    def _cache_get(self, key: str) -> dict[str, Any] | None:
        settings = get_settings()
        if not bool(settings.world_twin_hot_cache_enabled):
            return None
        entry = self._hot_query_cache.get(key)
        if entry is None:
            return None
        ttl_seconds = max(1, int(settings.world_twin_hot_cache_ttl_seconds))
        created, payload = entry
        now = perf_counter()
        if now - created > float(ttl_seconds):
            self._hot_query_cache.pop(key, None)
            return None
        return dict(payload)

    def _cache_set(self, key: str, payload: dict[str, Any]) -> None:
        settings = get_settings()
        if not bool(settings.world_twin_hot_cache_enabled):
            return
        self._hot_query_cache[key] = (perf_counter(), dict(payload))

    async def build_snapshot(
        self,
        *,
        lookback_hours: int = 24 * 7,
        role: str = "exec",
        persist: bool = True,
        as_of: datetime | None = None,
        internal_objects: list[Mapping[str, Any]] | None = None,
        external_events: list[Mapping[str, Any]] | None = None,
    ) -> dict[str, Any]:
        started = perf_counter()
        snapshot_at = as_of or datetime.now(UTC)
        horizon_hours = max(1, min(int(lookback_hours), 24 * 90))

        previous = await self._load_latest_snapshot()
        internal = list(internal_objects) if internal_objects is not None else await self._load_internal_objects(lookback_hours=horizon_hours)
        external = list(external_events) if external_events is not None else await self._load_external_events(lookback_hours=horizon_hours)

        snapshot = self._materializer.materialize(
            organization_id=self.organization_id,
            internal_objects=internal,
            external_events=external,
            as_of=snapshot_at,
        )
        deltas = self._materializer.compute_deltas(previous, snapshot) if previous else []
        drift = self._drift_metrics(previous=previous, current=snapshot, deltas=deltas)
        pressure_map = self._pressure_map(snapshot=snapshot, limit=20)
        belief_drift_radar = await self._belief_drift_radar(lookback_hours=horizon_hours)
        role_view = self._role_view(snapshot=snapshot, role=role)
        latency_ms = int((perf_counter() - started) * 1000)

        snapshot_id = str(uuid4())
        payload = {
            "snapshot_id": snapshot_id,
            "organization_id": self.organization_id,
            "snapshot_at": snapshot.snapshot_at.isoformat(),
            "lookback_hours": horizon_hours,
            "snapshot": snapshot.to_dict(),
            "deltas": [item.to_dict() for item in deltas[:200]],
            "drift_metrics": drift,
            "pressure_map": pressure_map,
            "belief_drift_radar": belief_drift_radar,
            "role_view": role_view,
            "materialization_latency_ms": latency_ms,
        }
        self._cache_set(f"latest:{role}", payload)

        if persist:
            await self._persist_snapshot(payload)
            if deltas:
                await self._persist_drift_event(
                    snapshot_id=snapshot_id,
                    snapshot_at=snapshot.snapshot_at,
                    drift_metrics=drift,
                    deltas=deltas,
                )

        return payload

    async def apply_stream_event(
        self,
        *,
        event: Mapping[str, Any],
        persist: bool = True,
    ) -> dict[str, Any]:
        previous = await self._load_latest_snapshot()
        if previous is None:
            previous = self._materializer.materialize(
                organization_id=self.organization_id,
                internal_objects=[],
                external_events=[],
            )

        world_event = event if isinstance(event, WorldEvent) else WorldEvent.from_dict(event)
        updated = self._apply_event(previous, world_event)
        deltas = self._materializer.compute_deltas(previous, updated)
        drift = self._drift_metrics(previous=previous, current=updated, deltas=deltas)
        snapshot_id = str(uuid4())

        payload = {
            "snapshot_id": snapshot_id,
            "organization_id": self.organization_id,
            "snapshot_at": updated.snapshot_at.isoformat(),
            "stream_event": asdict(world_event),
            "snapshot": updated.to_dict(),
            "deltas": [item.to_dict() for item in deltas[:200]],
            "drift_metrics": drift,
            "pressure_map": self._pressure_map(snapshot=updated, limit=20),
            "role_view": self._role_view(snapshot=updated, role="exec"),
            "materialization_latency_ms": 0,
        }

        if persist:
            await self._persist_snapshot(payload)
            if deltas:
                await self._persist_drift_event(
                    snapshot_id=snapshot_id,
                    snapshot_at=updated.snapshot_at,
                    drift_metrics=drift,
                    deltas=deltas,
                )

        return payload

    async def get_latest_snapshot(self, *, role: str = "exec") -> dict[str, Any] | None:
        cached = self._cache_get(f"latest:{role}")
        if cached is not None:
            return cached
        checkpoint = await get_checkpoint(
            organization_id=self.organization_id,
            checkpoint_key=self.CURRENT_CHECKPOINT_KEY,
        )
        metadata = dict((checkpoint or {}).get("metadata") or {})
        snapshot_payload = metadata.get("payload")
        if not isinstance(snapshot_payload, dict):
            return None

        # Role view is generated on demand to avoid stale role-specific payloads.
        snapshot = self._snapshot_from_dict(snapshot_payload.get("snapshot") or {})
        if snapshot is None:
            return None
        payload = dict(snapshot_payload)
        payload["role_view"] = self._role_view(snapshot=snapshot, role=role)
        payload["pressure_map"] = self._pressure_map(snapshot=snapshot, limit=20)
        self._cache_set(f"latest:{role}", payload)
        return payload

    async def pre_materialize_hot_queries(
        self,
        *,
        roles: list[str] | None = None,
        lookback_hours: list[int] | None = None,
    ) -> dict[str, Any]:
        settings = get_settings()
        role_list = roles or list(settings.world_twin_prematerialize_roles)
        horizon_list = lookback_hours or [int(item) for item in settings.world_twin_prematerialize_lookbacks]
        built = 0
        for role in role_list:
            for horizon in horizon_list:
                result = await self.build_snapshot(
                    lookback_hours=max(1, int(horizon)),
                    role=str(role),
                    persist=False,
                )
                self._cache_set(f"latest:{role}", result)
                built += 1
        return {
            "organization_id": self.organization_id,
            "built_snapshots": built,
            "roles": [str(item) for item in role_list],
            "lookback_hours": [int(item) for item in horizon_list],
        }

    async def get_snapshot_history(self, *, limit: int = 20) -> list[dict[str, Any]]:
        safe_limit = max(1, min(int(limit), 200))
        set_rls_context(self.organization_id, is_internal=True)
        try:
            async with get_db_session() as session:
                rows = (
                    await session.execute(
                        text(
                            """
                            SELECT id, payload, created_at
                            FROM event_records
                            WHERE organization_id = :org_id
                              AND event_type = :event_type
                            ORDER BY created_at DESC
                            LIMIT :limit
                            """
                        ),
                        {
                            "org_id": self.organization_id,
                            "event_type": self.SNAPSHOT_EVENT_TYPE,
                            "limit": safe_limit,
                        },
                    )
                ).fetchall()
        finally:
            set_rls_context(None, is_internal=False)

        items: list[dict[str, Any]] = []
        for row in rows:
            payload = dict(row.payload or {})
            items.append(
                {
                    "snapshot_id": payload.get("snapshot_id") or row.id,
                    "snapshot_at": payload.get("snapshot_at"),
                    "drift_metrics": payload.get("drift_metrics") or {},
                    "materialization_latency_ms": payload.get("materialization_latency_ms"),
                    "created_at": row.created_at.isoformat() if row.created_at else None,
                }
            )
        return items

    async def diff(
        self,
        *,
        from_snapshot_id: str | None = None,
        to_snapshot_id: str | None = None,
        from_time: datetime | None = None,
        to_time: datetime | None = None,
    ) -> dict[str, Any]:
        if from_snapshot_id:
            previous_payload = await self._load_snapshot_by_id(from_snapshot_id)
        elif from_time:
            previous_payload = await self._load_snapshot_by_time(from_time)
        else:
            history = await self.get_snapshot_history(limit=2)
            previous_payload = await self._load_snapshot_by_id(str(history[1]["snapshot_id"])) if len(history) > 1 else None

        if to_snapshot_id:
            current_payload = await self._load_snapshot_by_id(to_snapshot_id)
        elif to_time:
            current_payload = await self._load_snapshot_by_time(to_time)
        else:
            latest = await self.get_latest_snapshot(role="exec")
            current_payload = latest if latest else None

        if not previous_payload or not current_payload:
            return {
                "organization_id": self.organization_id,
                "from_snapshot_id": from_snapshot_id,
                "to_snapshot_id": to_snapshot_id,
                "deltas": [],
                "drift_metrics": {
                    "drift_index": 0.0,
                    "entity_drift_count": 0,
                    "domain_drift_count": 0,
                },
            }

        previous_snapshot = self._snapshot_from_dict(previous_payload.get("snapshot") or {})
        current_snapshot = self._snapshot_from_dict(current_payload.get("snapshot") or {})
        if previous_snapshot is None or current_snapshot is None:
            return {
                "organization_id": self.organization_id,
                "from_snapshot_id": from_snapshot_id,
                "to_snapshot_id": to_snapshot_id,
                "deltas": [],
                "drift_metrics": {
                    "drift_index": 0.0,
                    "entity_drift_count": 0,
                    "domain_drift_count": 0,
                },
            }

        deltas = self._materializer.compute_deltas(previous_snapshot, current_snapshot)
        drift = self._drift_metrics(
            previous=previous_snapshot,
            current=current_snapshot,
            deltas=deltas,
        )
        return {
            "organization_id": self.organization_id,
            "from_snapshot_id": previous_payload.get("snapshot_id"),
            "to_snapshot_id": current_payload.get("snapshot_id"),
            "from_snapshot_at": previous_payload.get("snapshot_at"),
            "to_snapshot_at": current_payload.get("snapshot_at"),
            "deltas": [item.to_dict() for item in deltas[:500]],
            "drift_metrics": drift,
        }

    async def get_pressure_map(self, *, role: str = "exec", limit: int = 20) -> dict[str, Any] | None:
        latest = await self.get_latest_snapshot(role=role)
        if not latest:
            return None
        snapshot = self._snapshot_from_dict(latest.get("snapshot") or {})
        if snapshot is None:
            return None
        return self._pressure_map(snapshot=snapshot, limit=limit)

    async def get_belief_drift_radar(self, *, lookback_hours: int = 24 * 7) -> dict[str, Any]:
        return await self._belief_drift_radar(lookback_hours=max(1, int(lookback_hours)))

    async def explain(
        self,
        *,
        entity_id: str | None = None,
        domain: str | None = None,
        role: str = "exec",
    ) -> dict[str, Any] | None:
        latest = await self.get_latest_snapshot(role=role)
        if not latest:
            return None
        snapshot = self._snapshot_from_dict(latest.get("snapshot") or {})
        if snapshot is None:
            return None

        entity = str(entity_id or "").strip()
        domain_name = str(domain or "").strip().lower()
        if entity:
            state = snapshot.entity_states.get(entity)
            if state is None:
                return {
                    "organization_id": self.organization_id,
                    "entity_id": entity,
                    "found": False,
                }
            related_internal = await self._load_internal_refs(state.internal_refs)
            return {
                "organization_id": self.organization_id,
                "entity_id": entity,
                "found": True,
                "state": state.to_dict(),
                "related_internal_objects": related_internal,
            }

        if domain_name:
            pressure = _as_float(snapshot.domain_pressure.get(domain_name), 0.0)
            tagged_entities = [
                state.to_dict()
                for state in snapshot.entity_states.values()
                if domain_name in {str(tag).lower() for tag in state.tags}
            ]
            tagged_entities.sort(key=lambda item: _as_float(item.get("pressure_score"), 0.0), reverse=True)
            return {
                "organization_id": self.organization_id,
                "domain": domain_name,
                "domain_pressure": round(pressure, 4),
                "tagged_entities": tagged_entities[:20],
            }

        return {
            "organization_id": self.organization_id,
            "pressure_map": self._pressure_map(snapshot=snapshot, limit=20),
            "role_view": self._role_view(snapshot=snapshot, role=role),
        }

    async def _load_internal_objects(self, *, lookback_hours: int) -> list[dict[str, Any]]:
        since = datetime.now(UTC) - timedelta(hours=max(1, int(lookback_hours)))
        set_rls_context(self.organization_id, is_internal=True)
        try:
            async with get_db_session() as session:
                rows = (
                    await session.execute(
                        text(
                            """
                            SELECT
                                u.id,
                                u.type,
                                u.status,
                                u.canonical_title,
                                u.canonical_description,
                                u.owner_contact_id,
                                u.participant_contact_ids,
                                u.actionability_score,
                                u.deviation_score,
                                u.contradicts_existing,
                                u.high_centrality_involved,
                                u.last_updated_at,
                                u.last_activity_source_type
                            FROM unified_intelligence_object u
                            WHERE u.organization_id = :org_id
                              AND u.last_updated_at >= :since
                              AND (u.merged_into_id IS NULL)
                            ORDER BY u.last_updated_at DESC
                            LIMIT 2000
                            """
                        ),
                        {"org_id": self.organization_id, "since": since},
                    )
                ).fetchall()
        finally:
            set_rls_context(None, is_internal=False)

        internal: list[dict[str, Any]] = []
        for row in rows:
            participants = _as_list(row.participant_contact_ids)
            entity_refs = sorted(
                set(
                    [str(row.owner_contact_id)] if row.owner_contact_id else []
                )
                | set(participants)
            )
            if not entity_refs:
                # Fallback keeps object reachable in twin materialization.
                entity_refs = [str(row.id)]
            materiality = max(
                0.1,
                min(
                    1.0,
                    (_as_float(row.actionability_score, 0.5) + _as_float(row.deviation_score, 0.5)) / 2.0,
                ),
            )
            internal.append(
                {
                    "id": str(row.id),
                    "type": str(row.type),
                    "status": str(row.status),
                    "title": row.canonical_title,
                    "description": row.canonical_description,
                    "entity_refs": entity_refs,
                    "materiality": materiality,
                    "tags": [str(row.type).lower()],
                    "source_type": row.last_activity_source_type,
                }
            )
        return internal

    async def _load_external_events(self, *, lookback_hours: int) -> list[dict[str, Any]]:
        since = datetime.now(UTC) - timedelta(hours=max(1, int(lookback_hours)))
        set_rls_context(self.organization_id, is_internal=True)
        try:
            async with get_db_session() as session:
                rows = (
                    await session.execute(
                        text(
                            """
                            SELECT
                                id,
                                source_type,
                                source_ref,
                                observed_at,
                                content
                            FROM observation
                            WHERE organization_id = :org_id
                              AND observed_at >= :since
                            ORDER BY observed_at DESC
                            LIMIT 4000
                            """
                        ),
                        {"org_id": self.organization_id, "since": since},
                    )
                ).fetchall()
        finally:
            set_rls_context(None, is_internal=False)

        events: list[dict[str, Any]] = []
        for row in rows:
            content = dict(row.content or {})
            metadata = dict(content.get("metadata") or {})
            canonical = dict(metadata.get("world_canonical") or {})
            ingest = dict(content.get("ingest") or {})
            domain = str(canonical.get("family") or row.source_type or "general").lower().strip()
            entities = _as_list(canonical.get("entities"))
            reliability = _as_float(ingest.get("source_reliability"), _as_float(canonical.get("reliability"), 0.5))
            events.append(
                {
                    "event_id": str(row.id),
                    "source": str(row.source_type or "observation"),
                    "source_ref": row.source_ref,
                    "observed_at": _as_utc(row.observed_at),
                    "domain": domain,
                    "reliability": max(0.0, min(reliability, 1.0)),
                    "entity_refs": entities,
                    "title": content.get("text"),
                    "payload": {"metadata": metadata, "source_ref": row.source_ref},
                }
            )
        return events

    async def _belief_drift_radar(self, *, lookback_hours: int) -> dict[str, Any]:
        since = datetime.now(UTC) - timedelta(hours=max(1, int(lookback_hours)))
        set_rls_context(self.organization_id, is_internal=True)
        try:
            async with get_db_session() as session:
                transition_rows = (
                    await session.execute(
                        text(
                            """
                            SELECT previous_state, next_state, COUNT(*) AS transition_count
                            FROM belief_revision
                            WHERE organization_id = :org_id
                              AND revised_at >= :since
                            GROUP BY previous_state, next_state
                            ORDER BY transition_count DESC
                            """
                        ),
                        {"org_id": self.organization_id, "since": since},
                    )
                ).fetchall()

                aggregate = (
                    await session.execute(
                        text(
                            """
                            SELECT
                                COUNT(*) AS revision_count,
                                AVG(ABS(COALESCE(next_probability, 0) - COALESCE(previous_probability, 0))) AS avg_delta,
                                MAX(ABS(COALESCE(next_probability, 0) - COALESCE(previous_probability, 0))) AS max_delta
                            FROM belief_revision
                            WHERE organization_id = :org_id
                              AND revised_at >= :since
                            """
                        ),
                        {"org_id": self.organization_id, "since": since},
                    )
                ).fetchone()

                top_beliefs = (
                    await session.execute(
                        text(
                            """
                            SELECT
                                br.belief_id,
                                MAX(ABS(COALESCE(br.next_probability, 0) - COALESCE(br.previous_probability, 0))) AS max_delta,
                                COUNT(*) AS revision_count
                            FROM belief_revision br
                            WHERE br.organization_id = :org_id
                              AND br.revised_at >= :since
                            GROUP BY br.belief_id
                            ORDER BY max_delta DESC, revision_count DESC
                            LIMIT 10
                            """
                        ),
                        {"org_id": self.organization_id, "since": since},
                    )
                ).fetchall()
        finally:
            set_rls_context(None, is_internal=False)

        transitions = [
            {
                "from": row.previous_state,
                "to": row.next_state,
                "count": int(row.transition_count or 0),
            }
            for row in transition_rows
        ]

        return {
            "organization_id": self.organization_id,
            "lookback_hours": lookback_hours,
            "revision_count": int((aggregate.revision_count or 0) if aggregate else 0),
            "avg_probability_delta": round(float((aggregate.avg_delta or 0.0) if aggregate else 0.0), 4),
            "max_probability_delta": round(float((aggregate.max_delta or 0.0) if aggregate else 0.0), 4),
            "transitions": transitions,
            "top_drifting_beliefs": [
                {
                    "belief_id": row.belief_id,
                    "max_delta": round(float(row.max_delta or 0.0), 4),
                    "revision_count": int(row.revision_count or 0),
                }
                for row in top_beliefs
            ],
        }

    def _drift_metrics(
        self,
        *,
        previous: WorldTwinSnapshot | None,
        current: WorldTwinSnapshot,
        deltas: list[WorldDelta],
    ) -> dict[str, Any]:
        if previous is None:
            return {
                "drift_index": 0.0,
                "entity_drift_count": 0,
                "domain_drift_count": 0,
                "max_entity_shift": 0.0,
                "max_domain_shift": 0.0,
            }

        entity_deltas = [item for item in deltas if item.delta_type == "entity_pressure"]
        domain_deltas = [item for item in deltas if item.delta_type == "domain_pressure"]
        denom = max(
            1,
            len(current.entity_states) + len(current.domain_pressure),
        )
        drift_index = sum(abs(item.magnitude) for item in deltas) / float(denom)
        return {
            "drift_index": round(drift_index, 4),
            "entity_drift_count": len(entity_deltas),
            "domain_drift_count": len(domain_deltas),
            "max_entity_shift": round(max((abs(item.magnitude) for item in entity_deltas), default=0.0), 4),
            "max_domain_shift": round(max((abs(item.magnitude) for item in domain_deltas), default=0.0), 4),
        }

    def _pressure_map(self, *, snapshot: WorldTwinSnapshot, limit: int) -> dict[str, Any]:
        safe_limit = max(1, min(int(limit), 100))
        top_entities = sorted(
            (
                {
                    "entity_id": state.entity_id,
                    "pressure_score": round(state.pressure_score, 4),
                    "internal_refs": len(state.internal_refs),
                    "external_refs": len(state.external_refs),
                    "tags": sorted(set(state.tags)),
                }
                for state in snapshot.entity_states.values()
            ),
            key=lambda item: item["pressure_score"],
            reverse=True,
        )[:safe_limit]

        top_domains = sorted(
            (
                {"domain": domain, "pressure": round(value, 4)}
                for domain, value in snapshot.domain_pressure.items()
            ),
            key=lambda item: item["pressure"],
            reverse=True,
        )[:safe_limit]

        return {
            "organization_id": self.organization_id,
            "snapshot_at": snapshot.snapshot_at.isoformat(),
            "entity_count": len(snapshot.entity_states),
            "domain_count": len(snapshot.domain_pressure),
            "top_entities": top_entities,
            "top_domains": top_domains,
        }

    def _role_view(self, *, snapshot: WorldTwinSnapshot, role: str) -> dict[str, Any]:
        role_name = str(role or "exec").strip().lower()
        domain_map = {
            "exec": None,
            "legal": {"legal", "regulatory", "compliance", "policy"},
            "finance": {"finance", "market", "macro", "economic"},
            "product": {"product", "research", "technology", "engineering", "security", "medical"},
        }
        allowed_domains = domain_map.get(role_name, None)

        domains = {
            domain: value
            for domain, value in snapshot.domain_pressure.items()
            if not allowed_domains or domain in allowed_domains
        }
        entities = [
            state
            for state in snapshot.entity_states.values()
            if not allowed_domains
            or any(str(tag).lower() in allowed_domains for tag in state.tags)
        ]
        entities_sorted = sorted(entities, key=lambda item: item.pressure_score, reverse=True)

        return {
            "role": role_name,
            "domain_pressure": {
                key: round(value, 4)
                for key, value in sorted(domains.items(), key=lambda item: item[1], reverse=True)
            },
            "top_entities": [item.to_dict() for item in entities_sorted[:15]],
            "total_entities_considered": len(entities),
        }

    def _apply_event(self, snapshot: WorldTwinSnapshot, event: WorldEvent) -> WorldTwinSnapshot:
        entity_states = {
            entity_id: EntityTwinState(
                entity_id=state.entity_id,
                internal_refs=list(state.internal_refs),
                external_refs=list(state.external_refs),
                pressure_score=state.pressure_score,
                tags=list(state.tags),
            )
            for entity_id, state in snapshot.entity_states.items()
        }
        domain_pressure = dict(snapshot.domain_pressure)
        domain_pressure[event.domain] = domain_pressure.get(event.domain, 0.0) + event.reliability
        pressure_boost = event.reliability * (1.0 + (0.15 * min(len(event.entity_refs), 4)))

        for entity_id in event.entity_refs:
            state = entity_states.setdefault(entity_id, EntityTwinState(entity_id=entity_id))
            state.external_refs.append(event.event_id)
            state.tags.append(event.domain)
            state.pressure_score = min(10.0, max(0.0, state.pressure_score + pressure_boost))

        return WorldTwinSnapshot(
            organization_id=snapshot.organization_id,
            snapshot_at=event.observed_at,
            entity_states=entity_states,
            domain_pressure=domain_pressure,
            internal_object_count=snapshot.internal_object_count,
            external_event_count=snapshot.external_event_count + 1,
        )

    async def _persist_snapshot(self, payload: Mapping[str, Any]) -> None:
        snapshot_id = str(payload.get("snapshot_id") or uuid4())
        created_at = _as_utc(payload.get("snapshot_at"))

        set_rls_context(self.organization_id, is_internal=True)
        try:
            async with get_db_session() as session:
                await session.execute(
                    text(
                        """
                        INSERT INTO event_records (
                            id,
                            organization_id,
                            event_type,
                            payload,
                            correlation_id,
                            source,
                            created_at
                        ) VALUES (
                            :id,
                            :organization_id,
                            :event_type,
                            :payload,
                            :correlation_id,
                            :source,
                            :created_at
                        )
                        """
                    ),
                    {
                        "id": snapshot_id,
                        "organization_id": self.organization_id,
                        "event_type": self.SNAPSHOT_EVENT_TYPE,
                        "payload": dict(payload),
                        "correlation_id": None,
                        "source": "world_twin",
                        "created_at": created_at,
                    },
                )
        finally:
            set_rls_context(None, is_internal=False)

        await upsert_checkpoint(
            organization_id=self.organization_id,
            checkpoint_key=self.CURRENT_CHECKPOINT_KEY,
            cursor={
                "snapshot_id": snapshot_id,
                "snapshot_at": str(payload.get("snapshot_at") or created_at.isoformat()),
            },
            metadata={"payload": dict(payload)},
        )

    async def _persist_drift_event(
        self,
        *,
        snapshot_id: str,
        snapshot_at: datetime,
        drift_metrics: Mapping[str, Any],
        deltas: list[WorldDelta],
    ) -> None:
        event_id = str(uuid4())
        payload = {
            "snapshot_id": snapshot_id,
            "snapshot_at": snapshot_at.isoformat(),
            "drift_metrics": dict(drift_metrics),
            "top_deltas": [item.to_dict() for item in deltas[:50]],
        }

        set_rls_context(self.organization_id, is_internal=True)
        try:
            async with get_db_session() as session:
                await session.execute(
                    text(
                        """
                        INSERT INTO event_records (
                            id,
                            organization_id,
                            event_type,
                            payload,
                            correlation_id,
                            source,
                            created_at
                        ) VALUES (
                            :id,
                            :organization_id,
                            :event_type,
                            :payload,
                            :correlation_id,
                            :source,
                            :created_at
                        )
                        """
                    ),
                    {
                        "id": event_id,
                        "organization_id": self.organization_id,
                        "event_type": self.DRIFT_EVENT_TYPE,
                        "payload": payload,
                        "correlation_id": snapshot_id,
                        "source": "world_twin",
                        "created_at": snapshot_at,
                    },
                )
        finally:
            set_rls_context(None, is_internal=False)

    async def _load_latest_snapshot(self) -> WorldTwinSnapshot | None:
        checkpoint = await get_checkpoint(
            organization_id=self.organization_id,
            checkpoint_key=self.CURRENT_CHECKPOINT_KEY,
        )
        metadata = dict((checkpoint or {}).get("metadata") or {})
        payload = metadata.get("payload")
        if not isinstance(payload, dict):
            return None
        return self._snapshot_from_dict(payload.get("snapshot") or {})

    async def _load_snapshot_by_id(self, snapshot_id: str) -> dict[str, Any] | None:
        set_rls_context(self.organization_id, is_internal=True)
        try:
            async with get_db_session() as session:
                row = (
                    await session.execute(
                        text(
                            """
                            SELECT payload
                            FROM event_records
                            WHERE organization_id = :org_id
                              AND event_type = :event_type
                              AND id = :snapshot_id
                            LIMIT 1
                            """
                        ),
                        {
                            "org_id": self.organization_id,
                            "event_type": self.SNAPSHOT_EVENT_TYPE,
                            "snapshot_id": snapshot_id,
                        },
                    )
                ).fetchone()
        finally:
            set_rls_context(None, is_internal=False)
        return dict(row.payload or {}) if row else None

    async def _load_snapshot_by_time(self, as_of: datetime) -> dict[str, Any] | None:
        timestamp = _as_utc(as_of)
        set_rls_context(self.organization_id, is_internal=True)
        try:
            async with get_db_session() as session:
                row = (
                    await session.execute(
                        text(
                            """
                            SELECT payload
                            FROM event_records
                            WHERE organization_id = :org_id
                              AND event_type = :event_type
                              AND created_at <= :as_of
                            ORDER BY created_at DESC
                            LIMIT 1
                            """
                        ),
                        {
                            "org_id": self.organization_id,
                            "event_type": self.SNAPSHOT_EVENT_TYPE,
                            "as_of": timestamp,
                        },
                    )
                ).fetchone()
        finally:
            set_rls_context(None, is_internal=False)
        return dict(row.payload or {}) if row else None

    async def _load_internal_refs(self, refs: list[str]) -> list[dict[str, Any]]:
        ids = [str(item).strip() for item in refs if str(item).strip()]
        if not ids:
            return []
        set_rls_context(self.organization_id, is_internal=True)
        try:
            async with get_db_session() as session:
                rows = (
                    await session.execute(
                        text(
                            """
                            SELECT id, type, status, canonical_title, canonical_description, last_updated_at
                            FROM unified_intelligence_object
                            WHERE organization_id = :org_id
                              AND id = ANY(:ids)
                            ORDER BY last_updated_at DESC
                            """
                        ),
                        {"org_id": self.organization_id, "ids": ids},
                    )
                ).fetchall()
        finally:
            set_rls_context(None, is_internal=False)

        return [
            {
                "id": row.id,
                "type": row.type,
                "status": row.status,
                "title": row.canonical_title,
                "description": row.canonical_description,
                "last_updated_at": row.last_updated_at.isoformat() if row.last_updated_at else None,
            }
            for row in rows
        ]

    def _snapshot_from_dict(self, payload: Mapping[str, Any]) -> WorldTwinSnapshot | None:
        if not isinstance(payload, Mapping):
            return None
        organization_id = str(payload.get("organization_id") or self.organization_id)
        snapshot_at = _as_utc(payload.get("snapshot_at"))
        raw_entities = payload.get("entity_states")
        if not isinstance(raw_entities, Mapping):
            raw_entities = {}

        entity_states: dict[str, EntityTwinState] = {}
        for entity_id, state_payload in raw_entities.items():
            if not isinstance(state_payload, Mapping):
                continue
            entity_states[str(entity_id)] = EntityTwinState(
                entity_id=str(state_payload.get("entity_id") or entity_id),
                internal_refs=_as_list(state_payload.get("internal_refs")),
                external_refs=_as_list(state_payload.get("external_refs")),
                pressure_score=max(0.0, min(_as_float(state_payload.get("pressure_score"), 0.0), 10.0)),
                tags=_as_list(state_payload.get("tags")),
            )

        raw_domains = payload.get("domain_pressure")
        domain_pressure: dict[str, float] = {}
        if isinstance(raw_domains, Mapping):
            for key, value in raw_domains.items():
                domain_pressure[str(key)] = max(0.0, _as_float(value, 0.0))

        return WorldTwinSnapshot(
            organization_id=organization_id,
            snapshot_at=snapshot_at,
            entity_states=entity_states,
            domain_pressure=domain_pressure,
            internal_object_count=int(_as_float(payload.get("internal_object_count"), 0.0)),
            external_event_count=int(_as_float(payload.get("external_event_count"), 0.0)),
        )


def run_twin_diff_benchmark() -> dict[str, Any]:
    materializer = WorldTwinMaterializer()
    previous = materializer.materialize(
        organization_id="benchmark_org",
        internal_objects=[{"id": "u1", "type": "decision", "entity_refs": ["acme"]}],
        external_events=[
            {
                "event_id": "ev_1",
                "source": "worldnews",
                "domain": "legal",
                "reliability": 0.2,
                "entity_refs": ["acme"],
            }
        ],
    )
    current = materializer.materialize(
        organization_id="benchmark_org",
        internal_objects=[{"id": "u1", "type": "decision", "entity_refs": ["acme"]}],
        external_events=[
            {
                "event_id": "ev_2",
                "source": "worldnews",
                "domain": "legal",
                "reliability": 0.9,
                "entity_refs": ["acme"],
            }
        ],
    )
    deltas = materializer.compute_deltas(previous, current)
    expected_delta_refs = {"legal", "acme"}
    actual_refs = {delta.ref for delta in deltas}
    accuracy = len(expected_delta_refs & actual_refs) / len(expected_delta_refs)
    return {
        "benchmark": "world-twin-diff-v1",
        "expected_refs": sorted(expected_delta_refs),
        "actual_refs": sorted(actual_refs),
        "accuracy": round(accuracy, 4),
        "passed": accuracy >= 1.0,
    }


def run_twin_refresh_benchmark(*, target_latency_ms: int = 1000) -> dict[str, Any]:
    materializer = WorldTwinMaterializer()
    internal_objects = [
        {"id": f"u{i}", "type": "commitment", "entity_refs": [f"entity_{i % 50}"]}
        for i in range(300)
    ]
    external_events = [
        {
            "event_id": f"ev_{i}",
            "source": "worldnews",
            "domain": "legal" if i % 2 == 0 else "finance",
            "reliability": 0.6 + ((i % 4) * 0.1),
            "entity_refs": [f"entity_{i % 50}"],
        }
        for i in range(400)
    ]

    started = perf_counter()
    snapshot = materializer.materialize(
        organization_id="benchmark_org",
        internal_objects=internal_objects,
        external_events=external_events,
    )
    latency_ms = int((perf_counter() - started) * 1000)

    return {
        "benchmark": "world-twin-refresh-latency-v1",
        "target_latency_ms": int(target_latency_ms),
        "latency_ms": latency_ms,
        "entity_count": len(snapshot.entity_states),
        "domain_count": len(snapshot.domain_pressure),
        "passed": latency_ms <= int(target_latency_ms),
    }


_services: dict[str, WorldTwinService] = {}


async def get_world_twin_service(organization_id: str) -> WorldTwinService:
    if organization_id not in _services:
        _services[organization_id] = WorldTwinService(organization_id=organization_id)
    return _services[organization_id]
