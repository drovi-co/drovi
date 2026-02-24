"""Exposure/impact persistence service for Phase 8 intelligence workflows."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import Any, Mapping
from uuid import uuid4

from sqlalchemy import text

from src.db.client import get_db_session
from src.db.rls import set_rls_context
from src.events.publisher import get_event_publisher
from src.world_model.impact import ImpactBridgeCandidate, ImpactEngineV2


def _clamp(value: float, low: float, high: float) -> float:
    return max(low, min(high, value))


class ImpactIntelligenceService:
    """Computes, deduplicates, throttles, and persists impact edges."""

    def __init__(self, organization_id: str) -> None:
        self.organization_id = organization_id
        self._engine = ImpactEngineV2()

    async def preview_impacts(
        self,
        *,
        internal_objects: list[Mapping[str, Any]],
        external_events: list[Mapping[str, Any]],
        risk_overlay: Mapping[str, Any] | None = None,
        causal_strength_by_ref: Mapping[str, float] | None = None,
        min_score: float = 0.35,
        max_per_internal: int = 3,
        max_total: int = 30,
    ) -> dict[str, Any]:
        candidates = self._engine.compute_bridges(
            internal_objects=internal_objects,
            external_events=external_events,
            risk_overlay=risk_overlay,
            causal_strength_by_ref=causal_strength_by_ref,
            min_score=min_score,
            max_per_internal=max_per_internal,
            max_total=max_total,
        )
        return {
            "organization_id": self.organization_id,
            "candidate_count": len(candidates),
            "items": [candidate.to_dict() for candidate in candidates],
        }

    async def compute_and_persist_impacts(
        self,
        *,
        internal_objects: list[Mapping[str, Any]],
        external_events: list[Mapping[str, Any]],
        risk_overlay: Mapping[str, Any] | None = None,
        causal_strength_by_ref: Mapping[str, float] | None = None,
        min_score: float = 0.35,
        max_per_internal: int = 3,
        max_total: int = 30,
        dedupe_window_minutes: int = 240,
        publish_events: bool = True,
    ) -> dict[str, Any]:
        candidates = self._engine.compute_bridges(
            internal_objects=internal_objects,
            external_events=external_events,
            risk_overlay=risk_overlay,
            causal_strength_by_ref=causal_strength_by_ref,
            min_score=min_score,
            max_per_internal=max_per_internal,
            max_total=max_total,
        )

        persisted: list[dict[str, Any]] = []
        skipped_duplicates = 0
        for candidate in candidates:
            if await self._has_recent_duplicate(
                dedupe_key=candidate.dedupe_key,
                dedupe_window_minutes=dedupe_window_minutes,
            ):
                skipped_duplicates += 1
                continue

            record = await self._persist_impact_edge(candidate)
            persisted.append(record)
            if publish_events:
                await self._publish_impact_event(record)

        severity_counts: dict[str, int] = {}
        for item in persisted:
            severity = str(item.get("severity") or "medium")
            severity_counts[severity] = severity_counts.get(severity, 0) + 1

        return {
            "organization_id": self.organization_id,
            "candidates_evaluated": len(candidates),
            "persisted_count": len(persisted),
            "skipped_duplicates": skipped_duplicates,
            "severity_counts": severity_counts,
            "items": persisted,
        }

    async def list_impacts(
        self,
        *,
        severity: str | None = None,
        impact_type: str | None = None,
        internal_object_ref: str | None = None,
        limit: int = 100,
        offset: int = 0,
    ) -> list[dict[str, Any]]:
        params: dict[str, Any] = {
            "organization_id": self.organization_id,
            "limit": max(1, min(int(limit), 500)),
            "offset": max(0, int(offset)),
        }
        clauses = ["organization_id = :organization_id"]
        if severity:
            clauses.append("severity = :severity")
            params["severity"] = str(severity).strip().lower()
        if impact_type:
            clauses.append("impact_type = :impact_type")
            params["impact_type"] = str(impact_type).strip().lower()
        if internal_object_ref:
            clauses.append("internal_object_ref = :internal_object_ref")
            params["internal_object_ref"] = str(internal_object_ref).strip()

        where_clause = " AND ".join(clauses)
        set_rls_context(self.organization_id, is_internal=True)
        try:
            async with get_db_session() as session:
                rows = (
                    await session.execute(
                        text(
                            f"""
                            SELECT id, external_object_ref, internal_object_ref, impact_type,
                                   severity, confidence, impact_hash, evidence_link_ids, created_at
                            FROM impact_edge
                            WHERE {where_clause}
                            ORDER BY created_at DESC
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
            items.append(
                {
                    "id": row.id,
                    "external_object_ref": row.external_object_ref,
                    "internal_object_ref": row.internal_object_ref,
                    "impact_type": row.impact_type,
                    "severity": row.severity,
                    "confidence": _clamp(float(row.confidence or 0.0), 0.0, 1.0),
                    "dedupe_key": row.impact_hash,
                    "evidence_link_ids": list(row.evidence_link_ids or []),
                    "created_at": row.created_at.isoformat() if row.created_at else None,
                }
            )
        return items

    async def get_impact_summary(self, *, hours: int = 24) -> dict[str, Any]:
        horizon_hours = max(1, min(int(hours), 24 * 30))
        since = datetime.now(UTC) - timedelta(hours=horizon_hours)

        set_rls_context(self.organization_id, is_internal=True)
        try:
            async with get_db_session() as session:
                aggregate = (
                    await session.execute(
                        text(
                            """
                            SELECT COUNT(*) AS total,
                                   SUM(CASE WHEN severity = 'critical' THEN 1 ELSE 0 END) AS critical_count,
                                   SUM(CASE WHEN severity = 'high' THEN 1 ELSE 0 END) AS high_count,
                                   SUM(CASE WHEN severity = 'medium' THEN 1 ELSE 0 END) AS medium_count,
                                   SUM(CASE WHEN severity = 'low' THEN 1 ELSE 0 END) AS low_count
                            FROM impact_edge
                            WHERE organization_id = :organization_id
                              AND created_at >= :since
                            """
                        ),
                        {"organization_id": self.organization_id, "since": since},
                    )
                ).fetchone()

                top_rows = (
                    await session.execute(
                        text(
                            """
                            SELECT internal_object_ref, COUNT(*) AS impact_count
                            FROM impact_edge
                            WHERE organization_id = :organization_id
                              AND created_at >= :since
                            GROUP BY internal_object_ref
                            ORDER BY impact_count DESC
                            LIMIT 10
                            """
                        ),
                        {"organization_id": self.organization_id, "since": since},
                    )
                ).fetchall()
        finally:
            set_rls_context(None, is_internal=False)

        return {
            "organization_id": self.organization_id,
            "hours": horizon_hours,
            "since": since.isoformat(),
            "totals": {
                "total": int((aggregate.total or 0) if aggregate else 0),
                "critical": int((aggregate.critical_count or 0) if aggregate else 0),
                "high": int((aggregate.high_count or 0) if aggregate else 0),
                "medium": int((aggregate.medium_count or 0) if aggregate else 0),
                "low": int((aggregate.low_count or 0) if aggregate else 0),
            },
            "top_internal_objects": [
                {
                    "internal_object_ref": row.internal_object_ref,
                    "impact_count": int(row.impact_count or 0),
                }
                for row in top_rows
            ],
        }

    async def _has_recent_duplicate(self, *, dedupe_key: str, dedupe_window_minutes: int) -> bool:
        dedupe_key = str(dedupe_key or "").strip()
        if not dedupe_key:
            return False
        window = max(1, min(int(dedupe_window_minutes), 24 * 60))
        since = datetime.now(UTC) - timedelta(minutes=window)

        set_rls_context(self.organization_id, is_internal=True)
        try:
            async with get_db_session() as session:
                row = (
                    await session.execute(
                        text(
                            """
                            SELECT id
                            FROM impact_edge
                            WHERE organization_id = :organization_id
                              AND impact_hash = :impact_hash
                              AND created_at >= :since
                            LIMIT 1
                            """
                        ),
                        {
                            "organization_id": self.organization_id,
                            "impact_hash": dedupe_key,
                            "since": since,
                        },
                    )
                ).fetchone()
        finally:
            set_rls_context(None, is_internal=False)
        return row is not None

    async def _persist_impact_edge(self, candidate: ImpactBridgeCandidate) -> dict[str, Any]:
        now = datetime.now(UTC)
        impact_edge_id = str(uuid4())

        set_rls_context(self.organization_id, is_internal=True)
        try:
            async with get_db_session() as session:
                await session.execute(
                    text(
                        """
                        INSERT INTO impact_edge (
                            id,
                            organization_id,
                            external_object_ref,
                            internal_object_ref,
                            impact_type,
                            severity,
                            confidence,
                            impact_hash,
                            evidence_link_ids,
                            created_at
                        ) VALUES (
                            :id,
                            :organization_id,
                            :external_object_ref,
                            :internal_object_ref,
                            :impact_type,
                            :severity,
                            :confidence,
                            :impact_hash,
                            :evidence_link_ids,
                            :created_at
                        )
                        """
                    ),
                    {
                        "id": impact_edge_id,
                        "organization_id": self.organization_id,
                        "external_object_ref": candidate.external_object_ref,
                        "internal_object_ref": candidate.internal_object_ref,
                        "impact_type": candidate.impact_type,
                        "severity": candidate.severity,
                        "confidence": _clamp(float(candidate.confidence), 0.0, 1.0),
                        "impact_hash": candidate.dedupe_key,
                        "evidence_link_ids": list(candidate.evidence_link_ids),
                        "created_at": now,
                    },
                )
        finally:
            set_rls_context(None, is_internal=False)

        return {
            "id": impact_edge_id,
            "external_object_ref": candidate.external_object_ref,
            "internal_object_ref": candidate.internal_object_ref,
            "impact_type": candidate.impact_type,
            "severity": candidate.severity,
            "confidence": _clamp(float(candidate.confidence), 0.0, 1.0),
            "impact_score": _clamp(float(candidate.impact_score), 0.0, 1.0),
            "exposure_score": _clamp(float(candidate.exposure_score), 0.0, 1.0),
            "materiality_score": _clamp(float(candidate.materiality_score), 0.0, 1.0),
            "causal_strength": _clamp(float(candidate.causal_strength), 0.0, 1.0),
            "uncertainty": _clamp(float(candidate.uncertainty), 0.0, 1.0),
            "dedupe_key": candidate.dedupe_key,
            "affected_entities": list(candidate.affected_entities),
            "evidence_link_ids": list(candidate.evidence_link_ids),
            "metadata": dict(candidate.metadata),
            "created_at": now.isoformat(),
        }

    async def _publish_impact_event(self, record: dict[str, Any]) -> None:
        publisher = await get_event_publisher()
        now = datetime.now(UTC)
        await publisher.publish_world_brain_contract_event(
            {
                "schema_version": "1.0",
                "organization_id": self.organization_id,
                "event_id": str(uuid4()),
                "occurred_at": now,
                "producer": "drovi-intelligence",
                "event_type": "impact.edge.computed.v1",
                "payload": {
                    "impact_edge_id": record["id"],
                    "external_object_ref": record["external_object_ref"],
                    "internal_object_ref": record["internal_object_ref"],
                    "impact_type": record["impact_type"],
                    "severity": record["severity"],
                    "confidence": record["confidence"],
                    "computed_at": now,
                    "evidence_link_ids": list(record.get("evidence_link_ids") or []),
                },
            }
        )


_services: dict[str, ImpactIntelligenceService] = {}


async def get_impact_intelligence_service(organization_id: str) -> ImpactIntelligenceService:
    if organization_id not in _services:
        _services[organization_id] = ImpactIntelligenceService(organization_id=organization_id)
    return _services[organization_id]
