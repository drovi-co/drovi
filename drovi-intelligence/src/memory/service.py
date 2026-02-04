"""
Canonical Memory Service

Provides a single memory API backed by FalkorDB + Postgres.
This consolidates legacy memory paths (DroviMemory, Graphiti, LlamaIndex)
behind a single, consistent interface used by pipeline, GraphRAG, and UI.
"""

from __future__ import annotations

from dataclasses import dataclass
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from typing import Any, Literal

import structlog
from sqlalchemy import text

from src.config import get_settings
from src.db.client import get_db_session
from src.db.rls import set_rls_context
from src.graph.client import get_graph_client
from src.memory.drovi_memory import DroviMemory

logger = structlog.get_logger()


TimeSliceMode = Literal["truth", "knowledge", "both"]


def utc_now() -> datetime:
    """Get current UTC time as naive datetime (for Postgres)."""
    return datetime.now(timezone.utc).replace(tzinfo=None)


@dataclass
class TemporalSummary:
    current_count: int
    historical_count: int
    future_count: int
    last_superseded_at: datetime | None


class FalkorMemoryBackend:
    """
    FalkorDB-native memory backend.

    Uses DroviMemory for episode/entity operations and FalkorDB client
    for raw Cypher queries and fulltext search.
    """

    def __init__(self, organization_id: str) -> None:
        self.organization_id = organization_id
        self._graph = None
        self._memory = DroviMemory(organization_id)

    async def _get_graph(self):
        if self._graph is None:
            self._graph = await get_graph_client()
        return self._graph

    async def graph_query(self, cypher: str, params: dict[str, Any] | None = None) -> list[dict[str, Any]]:
        graph = await self._get_graph()
        return await graph.query(cypher, params or {})

    async def fulltext_search(
        self,
        label: str,
        query_text: str,
        organization_id: str,
        limit: int = 10,
    ) -> list[dict[str, Any]]:
        graph = await self._get_graph()
        return await graph.fulltext_search(
            label=label,
            query_text=query_text,
            organization_id=organization_id,
            limit=limit,
        )

    async def search(self, query: str, source_types: list[str] | None = None, limit: int = 50) -> list[dict[str, Any]]:
        return await self._memory.search(query=query, source_types=source_types, limit=limit)

    async def search_as_of(
        self,
        query: str,
        as_of_date: datetime,
        source_types: list[str] | None = None,
        limit: int = 50,
    ) -> list[dict[str, Any]]:
        return await self._memory.search_as_of(
            query=query,
            as_of_date=as_of_date,
            source_types=source_types,
            limit=limit,
        )

    async def search_across_sources(self, query: str, limit: int = 50) -> dict[str, list[dict[str, Any]]]:
        return await self._memory.search_across_sources(query=query, limit=limit)

    async def search_uios_as_of(
        self,
        query: str,
        as_of_date: datetime | None = None,
        uio_types: list[str] | None = None,
        limit: int = 50,
    ) -> list[dict[str, Any]]:
        return await self._memory.search_uios_as_of(
            query=query,
            as_of_date=as_of_date,
            uio_types=uio_types,
            limit=limit,
        )

    async def get_entity_timeline(self, entity_name: str, limit: int = 100) -> list[dict[str, Any]]:
        return await self._memory.get_entity_timeline(entity_name=entity_name, limit=limit)

    async def get_contact_timeline(
        self,
        contact_id: str,
        source_types: list[str] | None = None,
        limit: int = 100,
    ) -> list[dict[str, Any]]:
        return await self._memory.get_contact_timeline(
            contact_id=contact_id,
            source_types=source_types,
            limit=limit,
        )

    async def get_recent_episodes(self, limit: int = 50, source_types: list[str] | None = None) -> list[dict[str, Any]]:
        return await self._memory.get_recent_episodes(limit=limit, source_types=source_types)


class MemoryService:
    """
    Canonical memory service.

    Provides a single API for memory operations:
    - Graph queries (Cypher, fulltext)
    - Episode/entity search
    - UIO time-slice queries (bi-temporal)
    - Decision/commitment trails
    """

    def __init__(self, organization_id: str, backend: FalkorMemoryBackend) -> None:
        self.organization_id = organization_id
        self._backend = backend

    # ---------------------------------------------------------------------
    # Graph access (used by GraphRAG + other services)
    # ---------------------------------------------------------------------

    async def graph_query(self, cypher: str, params: dict[str, Any] | None = None) -> list[dict[str, Any]]:
        return await self._backend.graph_query(cypher, params)

    async def fulltext_search(
        self,
        label: str,
        query_text: str,
        limit: int = 10,
    ) -> list[dict[str, Any]]:
        return await self._backend.fulltext_search(
            label=label,
            query_text=query_text,
            organization_id=self.organization_id,
            limit=limit,
        )

    # ---------------------------------------------------------------------
    # Memory search APIs (episodes/entities/UIOs)
    # ---------------------------------------------------------------------

    async def search(self, query: str, source_types: list[str] | None = None, limit: int = 50) -> list[dict[str, Any]]:
        return await self._backend.search(query=query, source_types=source_types, limit=limit)

    async def search_as_of(
        self,
        query: str,
        as_of_date: datetime,
        source_types: list[str] | None = None,
        limit: int = 50,
    ) -> list[dict[str, Any]]:
        return await self._backend.search_as_of(
            query=query,
            as_of_date=as_of_date,
            source_types=source_types,
            limit=limit,
        )

    async def search_across_sources(self, query: str, limit: int = 50) -> dict[str, list[dict[str, Any]]]:
        return await self._backend.search_across_sources(query=query, limit=limit)

    async def search_uios_as_of(
        self,
        query: str,
        as_of_date: datetime | None = None,
        uio_types: list[str] | None = None,
        limit: int = 50,
    ) -> list[dict[str, Any]]:
        return await self._backend.search_uios_as_of(
            query=query,
            as_of_date=as_of_date,
            uio_types=uio_types,
            limit=limit,
        )

    async def get_entity_timeline(self, entity_name: str, limit: int = 100) -> list[dict[str, Any]]:
        return await self._backend.get_entity_timeline(entity_name=entity_name, limit=limit)

    async def get_contact_timeline(
        self,
        contact_id: str,
        source_types: list[str] | None = None,
        limit: int = 100,
    ) -> list[dict[str, Any]]:
        return await self._backend.get_contact_timeline(
            contact_id=contact_id,
            source_types=source_types,
            limit=limit,
        )

    async def get_recent_episodes(self, limit: int = 50, source_types: list[str] | None = None) -> list[dict[str, Any]]:
        return await self._backend.get_recent_episodes(limit=limit, source_types=source_types)

    # ---------------------------------------------------------------------
    # UIO-centric memory APIs (bi-temporal + trails)
    # ---------------------------------------------------------------------

    async def get_recent_uios(self, limit: int = 10, days: int = 90) -> list[dict[str, Any]]:
        cutoff = utc_now() - timedelta(days=days)
        return await self._query_uios(
            where_clause="AND last_updated_at >= :cutoff",
            params={"cutoff": cutoff},
            limit=limit,
        )

    async def get_conversation_uios(self, conversation_id: str, limit: int = 10) -> list[dict[str, Any]]:
        set_rls_context(self.organization_id, is_internal=True)
        try:
            async with get_db_session() as session:
                result = await session.execute(
                    text(
                        """
                        SELECT u.id, u.type, u.status, u.canonical_title, u.canonical_description,
                               u.last_updated_at, u.valid_from, u.valid_to, u.system_from, u.system_to
                        FROM unified_intelligence_object u
                        JOIN unified_object_source s ON s.unified_object_id = u.id
                        WHERE u.organization_id = :org_id
                          AND s.conversation_id = :conversation_id
                        ORDER BY u.last_updated_at DESC
                        LIMIT :limit
                        """
                    ),
                    {
                        "org_id": self.organization_id,
                        "conversation_id": conversation_id,
                        "limit": limit,
                    },
                )
                rows = result.fetchall()
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
                "valid_from": row.valid_from.isoformat() if row.valid_from else None,
                "valid_to": row.valid_to.isoformat() if row.valid_to else None,
                "system_from": row.system_from.isoformat() if row.system_from else None,
                "system_to": row.system_to.isoformat() if row.system_to else None,
            }
            for row in rows
        ]

    async def time_slice_uios(
        self,
        as_of: datetime,
        mode: TimeSliceMode = "truth",
        uio_types: list[str] | None = None,
        status: str | None = None,
        limit: int = 100,
    ) -> list[dict[str, Any]]:
        """
        Return UIOs valid at a specific time.

        mode:
        - truth: filters by valid_from/valid_to
        - knowledge: filters by system_from/system_to
        - both: applies both filters
        """
        conditions = []
        params: dict[str, Any] = {
            "org_id": self.organization_id,
            "as_of": as_of,
            "limit": limit,
        }

        if uio_types:
            conditions.append("type = ANY(:uio_types)")
            params["uio_types"] = uio_types
        if status:
            conditions.append("status = :status")
            params["status"] = status

        if mode in ("truth", "both"):
            conditions.append("valid_from <= :as_of")
            conditions.append("(valid_to IS NULL OR valid_to > :as_of)")
        if mode in ("knowledge", "both"):
            conditions.append("system_from <= :as_of")
            conditions.append("(system_to IS NULL OR system_to > :as_of)")

        where_clause = ""
        if conditions:
            where_clause = "AND " + " AND ".join(conditions)

        return await self._query_uios(where_clause=where_clause, params=params, limit=limit)

    async def diff_uios(
        self,
        start: datetime,
        end: datetime,
        mode: TimeSliceMode = "truth",
        uio_types: list[str] | None = None,
        status: str | None = None,
        limit: int = 1000,
    ) -> dict[str, Any]:
        """Return a diff summary between two time slices."""
        before = await self.time_slice_uios(
            as_of=start,
            mode=mode,
            uio_types=uio_types,
            status=status,
            limit=limit,
        )
        after = await self.time_slice_uios(
            as_of=end,
            mode=mode,
            uio_types=uio_types,
            status=status,
            limit=limit,
        )
        return self._diff_time_slices(before, after)

    async def export_reality_graph(
        self,
        as_of: datetime | None = None,
        limit: int = 5000,
        include_relationships: bool = True,
    ) -> dict[str, Any]:
        """Export a snapshot of the reality graph for audit/compliance."""
        graph = await self._backend._get_graph()

        params: dict[str, Any] = {
            "org_id": self.organization_id,
            "limit": limit,
        }
        node_filters = ["n.organizationId = $org_id"]
        if as_of:
            params["as_of"] = as_of.isoformat()
            node_filters.append("(n.validFrom IS NULL OR n.validFrom <= $as_of)")
            node_filters.append("(n.validTo IS NULL OR n.validTo = '' OR n.validTo > $as_of)")

        node_where = " AND ".join(node_filters)
        nodes = await graph.query(
            f"""
            MATCH (n)
            WHERE {node_where}
            RETURN labels(n) as labels, properties(n) as props
            LIMIT $limit
            """,
            params,
        )

        relationships: list[dict[str, Any]] = []
        if include_relationships:
            rel_filters = ["a.organizationId = $org_id"]
            if as_of:
                rel_filters.append("(r.validFrom IS NULL OR r.validFrom <= $as_of)")
                rel_filters.append("(r.validTo IS NULL OR r.validTo = '' OR r.validTo > $as_of)")
            rel_where = " AND ".join(rel_filters)
            relationships = await graph.query(
                f"""
                MATCH (a)-[r]->(b)
                WHERE {rel_where}
                RETURN type(r) as type,
                       properties(r) as props,
                       a.id as source_id,
                       b.id as target_id
                LIMIT $limit
                """,
                params,
            )

        return {
            "organization_id": self.organization_id,
            "as_of": as_of.isoformat() if as_of else None,
            "node_count": len(nodes),
            "relationship_count": len(relationships),
            "nodes": nodes,
            "relationships": relationships,
        }

    @staticmethod
    def _diff_time_slices(
        before: list[dict[str, Any]],
        after: list[dict[str, Any]],
    ) -> dict[str, Any]:
        """Compute added/removed/updated UIOs between two time slices."""
        before_map = {item["id"]: item for item in before}
        after_map = {item["id"]: item for item in after}

        added_ids = sorted(set(after_map.keys()) - set(before_map.keys()))
        removed_ids = sorted(set(before_map.keys()) - set(after_map.keys()))
        shared_ids = set(before_map.keys()) & set(after_map.keys())

        fields_to_compare = [
            "status",
            "title",
            "description",
            "valid_from",
            "valid_to",
            "system_from",
            "system_to",
            "belief_state",
            "truth_state",
            "last_update_reason",
        ]

        updated = []
        for uio_id in shared_ids:
            before_item = before_map[uio_id]
            after_item = after_map[uio_id]
            changes = {}
            for field in fields_to_compare:
                if before_item.get(field) != after_item.get(field):
                    changes[field] = {
                        "before": before_item.get(field),
                        "after": after_item.get(field),
                    }
            if changes:
                updated.append(
                    {
                        "id": uio_id,
                        "type": after_item.get("type"),
                        "changes": changes,
                    }
                )

        return {
            "summary": {
                "added": len(added_ids),
                "removed": len(removed_ids),
                "updated": len(updated),
            },
            "added": [after_map[uio_id] for uio_id in added_ids],
            "removed": [before_map[uio_id] for uio_id in removed_ids],
            "updated": updated,
        }

    async def get_uio_trail(self, uio_id: str) -> dict[str, Any]:
        """Return a unified decision/commitment trail from the timeline table."""
        set_rls_context(self.organization_id, is_internal=True)
        try:
            async with get_db_session() as session:
                uio_row = await session.execute(
                    text(
                        """
                        SELECT id, type, status, canonical_title, canonical_description,
                               valid_from, valid_to, system_from, system_to
                        FROM unified_intelligence_object
                        WHERE id = :uio_id AND organization_id = :org_id
                        """
                    ),
                    {"uio_id": uio_id, "org_id": self.organization_id},
                )
                uio = uio_row.fetchone()
                if not uio:
                    return {}

                timeline = await session.execute(
                    text(
                        """
                        SELECT event_type, event_description, previous_value, new_value,
                               source_type, source_id, source_name, message_id, quoted_text,
                               triggered_by, confidence, event_at
                        FROM unified_object_timeline
                        WHERE unified_object_id = :uio_id
                        ORDER BY event_at ASC
                        """
                    ),
                    {"uio_id": uio_id},
                )
                events = timeline.fetchall()
        finally:
            set_rls_context(None, is_internal=False)

        return {
            "uio_id": uio.id,
            "uio_type": uio.type,
            "status": uio.status,
            "title": uio.canonical_title,
            "description": uio.canonical_description,
            "valid_from": uio.valid_from.isoformat() if uio.valid_from else None,
            "valid_to": uio.valid_to.isoformat() if uio.valid_to else None,
            "system_from": uio.system_from.isoformat() if uio.system_from else None,
            "system_to": uio.system_to.isoformat() if uio.system_to else None,
            "events": [
                {
                    "event_type": row.event_type,
                    "event_description": row.event_description,
                    "previous_value": row.previous_value,
                    "new_value": row.new_value,
                    "source_type": row.source_type,
                    "source_id": row.source_id,
                    "source_name": row.source_name,
                    "message_id": row.message_id,
                    "quoted_text": row.quoted_text,
                    "triggered_by": row.triggered_by,
                    "confidence": row.confidence,
                    "event_at": row.event_at.isoformat() if row.event_at else None,
                }
                for row in events
            ],
        }

    async def get_decision_trail(self, decision_id: str) -> dict[str, Any]:
        trail = await self.get_uio_trail(decision_id)
        if trail and trail.get("uio_type") != "decision":
            logger.warning("Decision trail requested for non-decision UIO", uio_id=decision_id)
        return trail

    async def get_commitment_trail(self, commitment_id: str) -> dict[str, Any]:
        trail = await self.get_uio_trail(commitment_id)
        if trail and trail.get("uio_type") != "commitment":
            logger.warning("Commitment trail requested for non-commitment UIO", uio_id=commitment_id)
        return trail

    async def get_uio_evidence(
        self,
        uio_ids: list[str],
        limit_per_uio: int = 3,
    ) -> dict[str, list[dict[str, Any]]]:
        """Return evidence rows for the given UIO IDs (most recent first)."""
        if not uio_ids:
            return {}

        set_rls_context(self.organization_id, is_internal=True)
        try:
            async with get_db_session() as session:
                result = await session.execute(
                    text(
                        """
                        SELECT
                            s.id AS evidence_id,
                            s.unified_object_id AS uio_id,
                            s.source_type,
                            s.source_account_id,
                            s.conversation_id,
                            s.message_id,
                            s.quoted_text,
                            s.source_timestamp,
                            ts.start_ms,
                            ts.end_ms,
                            ts.speaker_label,
                            ts.speaker_contact_id,
                            ls.started_at AS session_started_at,
                            CASE
                                WHEN s.source_type = 'transcript'
                                 AND ls.started_at IS NOT NULL
                                 AND ts.start_ms IS NOT NULL
                                THEN ls.started_at + (ts.start_ms || ' milliseconds')::interval
                                ELSE s.source_timestamp
                            END AS evidence_timestamp
                        FROM unified_object_source s
                        LEFT JOIN transcript_segment ts ON ts.id = s.message_id
                        LEFT JOIN live_session ls ON ls.id = s.conversation_id
                        WHERE s.unified_object_id = ANY(:uio_ids)
                        ORDER BY s.unified_object_id, s.source_timestamp DESC NULLS LAST
                        """
                    ),
                    {"uio_ids": uio_ids},
                )
                rows = result.fetchall()
        finally:
            set_rls_context(None, is_internal=False)

        grouped: dict[str, list[dict[str, Any]]] = defaultdict(list)
        for row in rows:
            if len(grouped[row.uio_id]) >= limit_per_uio:
                continue
            evidence_timestamp = getattr(row, "evidence_timestamp", None) or row.source_timestamp
            grouped[row.uio_id].append(
                {
                    "evidence_id": row.evidence_id,
                    "source_type": row.source_type,
                    "source_account_id": row.source_account_id,
                    "conversation_id": row.conversation_id,
                    "message_id": row.message_id,
                    "quoted_text": row.quoted_text,
                    "source_timestamp": evidence_timestamp.isoformat() if evidence_timestamp else None,
                    "start_ms": getattr(row, "start_ms", None),
                    "end_ms": getattr(row, "end_ms", None),
                    "speaker_label": getattr(row, "speaker_label", None),
                    "speaker_contact_id": getattr(row, "speaker_contact_id", None),
                }
            )

        return grouped

    # ---------------------------------------------------------------------
    # Temporal decay utilities
    # ---------------------------------------------------------------------

    @staticmethod
    def apply_temporal_decay(
        results: list[dict[str, Any]],
        half_life_days: int = 30,
        now: datetime | None = None,
    ) -> list[dict[str, Any]]:
        """
        Apply a simple exponential decay based on recency.

        Stale items are deprioritized while preserving result fields.
        """
        if not results:
            return results
        now = now or utc_now()
        half_life_seconds = float(half_life_days * 24 * 3600)

        def _pick_time(item: dict[str, Any]) -> datetime | None:
            for key in ("updated_at", "updatedAt", "created_at", "createdAt", "referenceTime", "valid_from", "validFrom"):
                value = item.get(key)
                if isinstance(value, datetime):
                    return value
                if isinstance(value, str):
                    try:
                        return datetime.fromisoformat(value.replace("Z", "+00:00")).replace(tzinfo=None)
                    except ValueError:
                        continue
            return None

        for item in results:
            timestamp = _pick_time(item)
            if not timestamp:
                item["decay_score"] = 1.0
                continue
            age_seconds = max((now - timestamp).total_seconds(), 0.0)
            item["decay_score"] = 0.5 ** (age_seconds / half_life_seconds) if half_life_seconds > 0 else 1.0

        return sorted(results, key=lambda r: r.get("decay_score", 1.0), reverse=True)

    # ---------------------------------------------------------------------
    # Internal helpers
    # ---------------------------------------------------------------------

    async def _query_uios(
        self,
        where_clause: str,
        params: dict[str, Any],
        limit: int,
    ) -> list[dict[str, Any]]:
        set_rls_context(self.organization_id, is_internal=True)
        try:
            async with get_db_session() as session:
                result = await session.execute(
                    text(
                        f"""
                        SELECT id, type, status, canonical_title, canonical_description,
                               last_updated_at, valid_from, valid_to, system_from, system_to,
                               belief_state, truth_state, last_update_reason
                        FROM unified_intelligence_object
                        WHERE organization_id = :org_id
                        {where_clause}
                        ORDER BY last_updated_at DESC
                        LIMIT :limit
                        """
                    ),
                    params,
                )
                rows = result.fetchall()
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
                "valid_from": row.valid_from.isoformat() if row.valid_from else None,
                "valid_to": row.valid_to.isoformat() if row.valid_to else None,
                "system_from": row.system_from.isoformat() if row.system_from else None,
                "system_to": row.system_to.isoformat() if row.system_to else None,
                "belief_state": row.belief_state,
                "truth_state": row.truth_state,
                "last_update_reason": row.last_update_reason,
            }
            for row in rows
        ]


_memory_services: dict[str, MemoryService] = {}


async def get_memory_service(organization_id: str) -> MemoryService:
    """
    Get the canonical MemoryService for an organization.

    This is the single entry point for memory operations across the system.
    """
    global _memory_services

    if organization_id in _memory_services:
        return _memory_services[organization_id]

    settings = get_settings()
    backend = FalkorMemoryBackend(organization_id)
    if settings.memory_backend != "falkordb":
        logger.warning(
            "Unsupported memory_backend configured; falling back to FalkorDB",
            memory_backend=settings.memory_backend,
        )

    service = MemoryService(organization_id=organization_id, backend=backend)
    _memory_services[organization_id] = service
    return service
