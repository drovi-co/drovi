"""Observation intelligence query service for World Brain APIs."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import Any

from sqlalchemy import text

from src.db.client import get_db_session
from src.db.rls import set_rls_context


def _as_iso(value: datetime | None) -> str | None:
    if value is None:
        return None
    if value.tzinfo is None:
        return value.replace(tzinfo=UTC).isoformat()
    return value.astimezone(UTC).isoformat()


def _as_mapping(value: Any) -> dict[str, Any]:
    if isinstance(value, dict):
        return value
    return {}


class ObservationIntelligenceService:
    """Read-only query surface for observation objects and evidence links."""

    def __init__(self, organization_id: str) -> None:
        self.organization_id = organization_id

    async def list_observations(
        self,
        *,
        observation_type: str | None = None,
        source_type: str | None = None,
        hours: int = 24 * 7,
        limit: int = 100,
        offset: int = 0,
    ) -> list[dict[str, Any]]:
        safe_hours = max(1, min(int(hours), 24 * 180))
        since = datetime.now(UTC) - timedelta(hours=safe_hours)
        params: dict[str, Any] = {
            "org_id": self.organization_id,
            "since": since,
            "limit": max(1, min(int(limit), 500)),
            "offset": max(0, int(offset)),
        }
        clauses = [
            "o.organization_id = :org_id",
            "o.observed_at >= :since",
        ]
        if observation_type:
            clauses.append("o.observation_type = :observation_type")
            params["observation_type"] = observation_type.strip().lower()
        if source_type:
            clauses.append("o.source_type = :source_type")
            params["source_type"] = source_type.strip().lower()

        where_clause = " AND ".join(clauses)
        set_rls_context(self.organization_id, is_internal=True)
        try:
            async with get_db_session() as session:
                rows = (
                    await session.execute(
                        text(
                            f"""
                            SELECT
                                o.id,
                                o.source_type,
                                o.source_ref,
                                o.observation_type,
                                o.title,
                                o.content,
                                o.observation_hash,
                                o.observed_at,
                                o.created_at,
                                o.updated_at,
                                COUNT(oel.id)::int AS evidence_count,
                                srp.reliability_score,
                                srp.corroboration_rate,
                                srp.false_positive_rate,
                                srp.last_evaluated_at AS reliability_last_evaluated_at
                            FROM observation o
                            LEFT JOIN observation_evidence_link oel
                              ON oel.organization_id = o.organization_id
                             AND oel.observation_id = o.id
                            LEFT JOIN source_reliability_profile srp
                              ON srp.organization_id = o.organization_id
                             AND srp.source_key = o.source_type
                            WHERE {where_clause}
                            GROUP BY
                                o.id, o.source_type, o.source_ref, o.observation_type,
                                o.title, o.content, o.observation_hash, o.observed_at,
                                o.created_at, o.updated_at,
                                srp.reliability_score, srp.corroboration_rate,
                                srp.false_positive_rate, srp.last_evaluated_at
                            ORDER BY o.observed_at DESC, o.created_at DESC
                            LIMIT :limit OFFSET :offset
                            """
                        ),
                        params,
                    )
                ).fetchall()
        finally:
            set_rls_context(None, is_internal=False)

        items: list[dict[str, Any]] = []
        for row in rows:
            content = _as_mapping(row.content)
            metadata = _as_mapping(content.get("metadata"))
            world = _as_mapping(metadata.get("world_canonical"))
            entities = [str(item) for item in list(world.get("entities") or []) if item]
            text_value = str(content.get("text") or "")
            items.append(
                {
                    "id": row.id,
                    "source_type": row.source_type,
                    "source_ref": row.source_ref,
                    "observation_type": row.observation_type,
                    "title": row.title,
                    "text_preview": text_value[:240],
                    "entity_refs": entities,
                    "observation_hash": row.observation_hash,
                    "evidence_count": int(row.evidence_count or 0),
                    "source_reliability_score": (
                        float(row.reliability_score) if row.reliability_score is not None else None
                    ),
                    "source_reliability": (
                        {
                            "score": float(row.reliability_score),
                            "corroboration_rate": float(row.corroboration_rate or 0.0),
                            "false_positive_rate": float(row.false_positive_rate or 0.0),
                            "last_evaluated_at": _as_iso(row.reliability_last_evaluated_at),
                        }
                        if row.reliability_score is not None
                        else None
                    ),
                    "observed_at": _as_iso(row.observed_at),
                    "created_at": _as_iso(row.created_at),
                    "updated_at": _as_iso(row.updated_at),
                }
            )
        return items

    async def get_observation(self, observation_id: str) -> dict[str, Any] | None:
        set_rls_context(self.organization_id, is_internal=True)
        try:
            async with get_db_session() as session:
                row = (
                    await session.execute(
                        text(
                            """
                            SELECT
                                o.id,
                                o.source_type,
                                o.source_ref,
                                o.observation_type,
                                o.title,
                                o.content,
                                o.observation_hash,
                                o.observed_at,
                                o.valid_from,
                                o.valid_to,
                                o.believed_from,
                                o.believed_to,
                                o.created_at,
                                o.updated_at,
                                srp.reliability_score,
                                srp.corroboration_rate,
                                srp.false_positive_rate,
                                srp.last_evaluated_at AS reliability_last_evaluated_at,
                                (
                                    SELECT COUNT(1)::int
                                    FROM observation_evidence_link oel
                                    WHERE oel.organization_id = o.organization_id
                                      AND oel.observation_id = o.id
                                ) AS evidence_count
                            FROM observation o
                            LEFT JOIN source_reliability_profile srp
                              ON srp.organization_id = o.organization_id
                             AND srp.source_key = o.source_type
                            WHERE o.organization_id = :org_id
                              AND o.id = :observation_id
                            LIMIT 1
                            """
                        ),
                        {"org_id": self.organization_id, "observation_id": observation_id},
                    )
                ).fetchone()
        finally:
            set_rls_context(None, is_internal=False)

        if not row:
            return None

        content = _as_mapping(row.content)
        metadata = _as_mapping(content.get("metadata"))
        world = _as_mapping(metadata.get("world_canonical"))
        entities = [str(item) for item in list(world.get("entities") or []) if item]
        return {
            "id": row.id,
            "source_type": row.source_type,
            "source_ref": row.source_ref,
            "observation_type": row.observation_type,
            "title": row.title,
            "content": content,
            "entity_refs": entities,
            "observation_hash": row.observation_hash,
            "evidence_count": int(row.evidence_count or 0),
            "source_reliability_score": (
                float(row.reliability_score) if row.reliability_score is not None else None
            ),
            "source_reliability": (
                {
                    "score": float(row.reliability_score),
                    "corroboration_rate": float(row.corroboration_rate or 0.0),
                    "false_positive_rate": float(row.false_positive_rate or 0.0),
                    "last_evaluated_at": _as_iso(row.reliability_last_evaluated_at),
                }
                if row.reliability_score is not None
                else None
            ),
            "observed_at": _as_iso(row.observed_at),
            "valid_from": _as_iso(row.valid_from),
            "valid_to": _as_iso(row.valid_to),
            "believed_from": _as_iso(row.believed_from),
            "believed_to": _as_iso(row.believed_to),
            "created_at": _as_iso(row.created_at),
            "updated_at": _as_iso(row.updated_at),
        }

    async def get_observation_evidence(
        self,
        *,
        observation_id: str,
        limit: int = 100,
    ) -> list[dict[str, Any]]:
        set_rls_context(self.organization_id, is_internal=True)
        try:
            async with get_db_session() as session:
                rows = (
                    await session.execute(
                        text(
                            """
                            SELECT
                                id,
                                evidence_artifact_id,
                                unified_event_id,
                                link_type,
                                quote,
                                confidence,
                                metadata,
                                created_at
                            FROM observation_evidence_link
                            WHERE organization_id = :org_id
                              AND observation_id = :observation_id
                            ORDER BY created_at DESC
                            LIMIT :limit
                            """
                        ),
                        {
                            "org_id": self.organization_id,
                            "observation_id": observation_id,
                            "limit": max(1, min(int(limit), 1000)),
                        },
                    )
                ).fetchall()
        finally:
            set_rls_context(None, is_internal=False)

        return [
            {
                "id": row.id,
                "evidence_artifact_id": row.evidence_artifact_id,
                "unified_event_id": row.unified_event_id,
                "link_type": row.link_type,
                "quote": row.quote,
                "confidence": float(row.confidence) if row.confidence is not None else None,
                "metadata": _as_mapping(row.metadata),
                "created_at": _as_iso(row.created_at),
            }
            for row in rows
        ]


_services: dict[str, ObservationIntelligenceService] = {}


async def get_observation_intelligence_service(organization_id: str) -> ObservationIntelligenceService:
    if organization_id not in _services:
        _services[organization_id] = ObservationIntelligenceService(organization_id=organization_id)
    return _services[organization_id]
