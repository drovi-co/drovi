"""Ledger Tape service for World Brain high-signal delta surfaces."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import Any

from sqlalchemy import text

from src.db.client import get_db_session
from src.db.rls import set_rls_context
from src.world_model import get_world_twin_service


def _to_iso(value: datetime | None) -> str | None:
    if value is None:
        return None
    if value.tzinfo is None:
        return value.replace(tzinfo=UTC).isoformat()
    return value.astimezone(UTC).isoformat()


def _safe_dict(value: Any) -> dict[str, Any]:
    return value if isinstance(value, dict) else {}


def _safe_list(value: Any) -> list[Any]:
    return value if isinstance(value, list) else []


def _severity_rank(value: str | None) -> int:
    levels = {"critical": 4, "high": 3, "medium": 2, "low": 1}
    return levels.get(str(value or "medium").lower(), 2)


class TapeService:
    """Materializes cognition deltas for the Ledger Tape and proof bundles."""

    def __init__(self, organization_id: str) -> None:
        self.organization_id = organization_id

    async def list_events(
        self,
        *,
        hours: int = 24 * 7,
        limit: int = 200,
        lane: str | None = None,
        delta_domain: str | None = None,
        min_confidence: float = 0.0,
    ) -> list[dict[str, Any]]:
        safe_hours = max(1, min(int(hours), 24 * 180))
        safe_limit = max(1, min(int(limit), 500))
        since = datetime.now(UTC) - timedelta(hours=safe_hours)

        events: list[dict[str, Any]] = []
        events.extend(await self._belief_deltas(since=since, limit=safe_limit))
        events.extend(await self._hypothesis_deltas(since=since, limit=safe_limit))
        events.extend(await self._constraint_deltas(since=since, limit=safe_limit))
        events.extend(await self._causal_deltas(since=since, limit=safe_limit))
        events.extend(await self._impact_bridge_deltas(since=since, limit=safe_limit))
        events.extend(await self._intervention_deltas(since=since, limit=safe_limit))

        filtered: list[dict[str, Any]] = []
        seen: set[str] = set()
        for event in events:
            event_id = str(event.get("event_id") or "")
            if not event_id or event_id in seen:
                continue
            seen.add(event_id)
            if lane and str(event.get("lane") or "").lower() != lane.lower():
                continue
            if delta_domain and str(event.get("delta_domain") or "").lower() != delta_domain.lower():
                continue
            confidence = float(event.get("confidence") or 0.0)
            if confidence < min_confidence:
                continue
            filtered.append(event)

        filtered.sort(
            key=lambda item: (
                _to_iso_value(item.get("occurred_at")),
                _severity_rank(item.get("severity")),
            ),
            reverse=True,
        )
        return filtered[:safe_limit]

    async def get_event(self, *, event_id: str) -> dict[str, Any] | None:
        events = await self.list_events(hours=24 * 180, limit=500)
        for event in events:
            if str(event.get("event_id")) == event_id:
                return event
        return None

    async def build_live_contract(
        self,
        *,
        role: str = "exec",
        limit: int = 20,
    ) -> dict[str, Any]:
        safe_limit = max(1, min(int(limit), 200))
        recent_events = await self.list_events(hours=24 * 3, limit=safe_limit * 4)
        internal_lane = [item for item in recent_events if item.get("lane") == "internal"][:safe_limit]
        external_lane = [item for item in recent_events if item.get("lane") == "external"][:safe_limit]
        bridge_lane = [item for item in recent_events if item.get("lane") == "bridge"][:safe_limit]

        pressure_map: dict[str, Any] = {"top_entities": []}
        try:
            twin_service = await get_world_twin_service(self.organization_id)
            pressure_map = await twin_service.get_pressure_map(role=role, limit=safe_limit)
        except Exception:
            pressure_map = {"top_entities": []}

        pressure_lane = [
            {
                "entity_id": str(item.get("entity_id") or ""),
                "pressure_score": float(item.get("pressure_score") or 0.0),
                "tier": str(item.get("tier") or "unknown"),
            }
            for item in list(_safe_dict(pressure_map).get("top_entities") or [])
        ]

        bridge_edges = [
            {
                "event_id": item.get("event_id"),
                "source_ref": _safe_dict(item.get("impact_bridge")).get("external_ref"),
                "target_ref": _safe_dict(item.get("impact_bridge")).get("internal_ref"),
                "severity": item.get("severity"),
                "confidence": item.get("confidence"),
            }
            for item in bridge_lane
            if _safe_dict(item.get("impact_bridge"))
        ]

        return {
            "organization_id": self.organization_id,
            "lanes": {
                "internal": internal_lane,
                "external": external_lane,
                "world_pressure": pressure_lane,
                "bridge": bridge_lane,
            },
            "visualization_contract": {
                "world_pressure_lane": {
                    "metric": "pressure_score",
                    "scale": {"min": 0.0, "max": 10.0},
                    "encoding": {"low": "green", "medium": "amber", "high": "red"},
                },
                "bridge_visualization": {
                    "edge_type": "impact_bridge",
                    "edges": bridge_edges[:safe_limit],
                    "encoding": {
                        "thickness_by": "confidence",
                        "color_by": "severity",
                    },
                },
            },
            "filters": {
                "lane": ["internal", "external", "world_pressure", "bridge"],
                "delta_domain": ["belief", "hypothesis", "constraint", "causal", "impact", "intervention"],
            },
        }

    async def _belief_deltas(self, *, since: datetime, limit: int) -> list[dict[str, Any]]:
        set_rls_context(self.organization_id, is_internal=True)
        try:
            async with get_db_session() as session:
                rows = (
                    await session.execute(
                        text(
                            """
                            SELECT
                                br.id,
                                br.belief_id,
                                br.previous_state,
                                br.next_state,
                                br.next_probability,
                                br.evidence_link_ids,
                                br.reason,
                                br.revised_at,
                                b.proposition
                            FROM belief_revision br
                            JOIN belief b
                              ON b.organization_id = br.organization_id
                             AND b.id = br.belief_id
                            WHERE br.organization_id = :org_id
                              AND br.revised_at >= :since
                            ORDER BY br.revised_at DESC
                            LIMIT :limit
                            """
                        ),
                        {"org_id": self.organization_id, "since": since, "limit": limit},
                    )
                ).fetchall()
        finally:
            set_rls_context(None, is_internal=False)

        events: list[dict[str, Any]] = []
        for row in rows:
            next_state = str(row.next_state or "").lower()
            severity = "medium"
            if next_state in {"degraded", "retracted"}:
                severity = "high"
            elif next_state in {"contested"}:
                severity = "medium"
            else:
                severity = "low"
            citations = [
                {
                    "kind": "evidence_link",
                    "ref_id": str(link_id),
                }
                for link_id in list(row.evidence_link_ids or [])
                if link_id
            ]
            events.append(
                {
                    "event_id": f"tape:belief:{row.id}",
                    "lane": "internal",
                    "delta_domain": "belief",
                    "severity": severity,
                    "confidence": float(row.next_probability or 0.0),
                    "title": "Belief state transition",
                    "summary": (
                        f"{row.proposition}: {row.previous_state} -> {row.next_state}"
                    ),
                    "entity_refs": [str(row.belief_id)],
                    "occurred_at": _to_iso(row.revised_at),
                    "proof_bundle": {
                        "bundle_id": f"proof:belief:{row.id}",
                        "citations": citations,
                        "timeline": [
                            {
                                "event": "belief_revision",
                                "at": _to_iso(row.revised_at),
                                "from_state": row.previous_state,
                                "to_state": row.next_state,
                            }
                        ],
                        "confidence_reasoning": _safe_dict(row.reason),
                    },
                    "tags": ["belief", "epistemic", next_state],
                }
            )
        return events

    async def _hypothesis_deltas(self, *, since: datetime, limit: int) -> list[dict[str, Any]]:
        set_rls_context(self.organization_id, is_internal=True)
        try:
            async with get_db_session() as session:
                rows = (
                    await session.execute(
                        text(
                            """
                            SELECT
                                h.id,
                                h.hypothesis_text,
                                h.status,
                                h.posterior_probability,
                                h.related_belief_id,
                                h.updated_at,
                                score.score_value AS overall_score,
                                score.metadata AS score_metadata
                            FROM hypothesis h
                            LEFT JOIN LATERAL (
                                SELECT hs.score_value, hs.metadata
                                FROM hypothesis_score hs
                                WHERE hs.organization_id = h.organization_id
                                  AND hs.hypothesis_id = h.id
                                  AND hs.score_type IN ('overall_score', 'overall_score_rescore')
                                ORDER BY hs.scored_at DESC
                                LIMIT 1
                            ) score ON TRUE
                            WHERE h.organization_id = :org_id
                              AND h.updated_at >= :since
                            ORDER BY h.updated_at DESC
                            LIMIT :limit
                            """
                        ),
                        {"org_id": self.organization_id, "since": since, "limit": limit},
                    )
                ).fetchall()
        finally:
            set_rls_context(None, is_internal=False)

        events: list[dict[str, Any]] = []
        for row in rows:
            status = str(row.status or "active").lower()
            score = float(row.overall_score if row.overall_score is not None else row.posterior_probability or 0.0)
            severity = "low" if status in {"accepted", "active"} else "medium"
            metadata = _safe_dict(row.score_metadata)
            evidence_link_ids = _safe_list(metadata.get("evidence_link_ids"))
            events.append(
                {
                    "event_id": f"tape:hypothesis:{row.id}:{int(_to_iso_value(_to_iso(row.updated_at)).timestamp())}",
                    "lane": "internal",
                    "delta_domain": "hypothesis",
                    "severity": severity,
                    "confidence": score,
                    "title": "Hypothesis scoring update",
                    "summary": f"{row.hypothesis_text} [{status}]",
                    "entity_refs": [str(row.related_belief_id)] if row.related_belief_id else [],
                    "occurred_at": _to_iso(row.updated_at),
                    "proof_bundle": {
                        "bundle_id": f"proof:hypothesis:{row.id}",
                        "citations": [
                            {"kind": "evidence_link", "ref_id": str(item)}
                            for item in evidence_link_ids
                            if item
                        ],
                        "timeline": [
                            {
                                "event": "hypothesis_update",
                                "at": _to_iso(row.updated_at),
                                "status": status,
                            }
                        ],
                        "confidence_reasoning": {
                            "score": score,
                            "posterior_probability": float(row.posterior_probability or 0.0),
                        },
                    },
                    "tags": ["hypothesis", status],
                }
            )
        return events

    async def _constraint_deltas(self, *, since: datetime, limit: int) -> list[dict[str, Any]]:
        set_rls_context(self.organization_id, is_internal=True)
        try:
            async with get_db_session() as session:
                rows = (
                    await session.execute(
                        text(
                            """
                            SELECT
                                v.id,
                                v.constraint_id,
                                c.title AS constraint_title,
                                v.subject_entity_id,
                                v.status,
                                v.severity,
                                v.confidence,
                                v.details,
                                v.detected_at
                            FROM constraint_violation_candidate v
                            JOIN cognitive_constraint c
                              ON c.organization_id = v.organization_id
                             AND c.id = v.constraint_id
                            WHERE v.organization_id = :org_id
                              AND v.detected_at >= :since
                            ORDER BY v.detected_at DESC
                            LIMIT :limit
                            """
                        ),
                        {"org_id": self.organization_id, "since": since, "limit": limit},
                    )
                ).fetchall()
        finally:
            set_rls_context(None, is_internal=False)

        events: list[dict[str, Any]] = []
        for row in rows:
            details = _safe_dict(row.details)
            evidence_link_ids = _safe_list(details.get("evidence_link_ids"))
            events.append(
                {
                    "event_id": f"tape:constraint:{row.id}",
                    "lane": "internal",
                    "delta_domain": "constraint",
                    "severity": str(row.severity or "medium").lower(),
                    "confidence": float(row.confidence or 0.0),
                    "title": "Obligation sentinel signal",
                    "summary": f"{row.constraint_title} [{row.status}]",
                    "entity_refs": [str(row.subject_entity_id)] if row.subject_entity_id else [],
                    "occurred_at": _to_iso(row.detected_at),
                    "proof_bundle": {
                        "bundle_id": f"proof:constraint:{row.id}",
                        "citations": [
                            {"kind": "evidence_link", "ref_id": str(item)}
                            for item in evidence_link_ids
                            if item
                        ],
                        "timeline": [
                            {
                                "event": "constraint_violation_candidate",
                                "at": _to_iso(row.detected_at),
                                "status": row.status,
                                "severity": row.severity,
                            }
                        ],
                        "confidence_reasoning": details,
                    },
                    "tags": ["constraint", str(row.status or "open").lower()],
                }
            )
        return events

    async def _causal_deltas(self, *, since: datetime, limit: int) -> list[dict[str, Any]]:
        set_rls_context(self.organization_id, is_internal=True)
        try:
            async with get_db_session() as session:
                rows = (
                    await session.execute(
                        text(
                            """
                            SELECT id, scenario_name, output_payload, created_at
                            FROM simulation_run
                            WHERE organization_id = :org_id
                              AND created_at >= :since
                            ORDER BY created_at DESC
                            LIMIT :limit
                            """
                        ),
                        {"org_id": self.organization_id, "since": since, "limit": limit},
                    )
                ).fetchall()
        finally:
            set_rls_context(None, is_internal=False)

        events: list[dict[str, Any]] = []
        for row in rows:
            payload = _safe_dict(row.output_payload)
            causal_projection = _safe_list(payload.get("causal_projection"))
            if not causal_projection:
                continue
            top = _safe_dict(causal_projection[0])
            expected_delta = abs(float(top.get("expected_delta") or 0.0))
            severity = "low"
            if expected_delta >= 0.5:
                severity = "high"
            elif expected_delta >= 0.2:
                severity = "medium"
            events.append(
                {
                    "event_id": f"tape:causal:{row.id}",
                    "lane": "external",
                    "delta_domain": "causal",
                    "severity": severity,
                    "confidence": float(top.get("confidence") or 0.0),
                    "title": "Causal projection delta",
                    "summary": (
                        f"{top.get('source_ref')} -> {top.get('target_ref')} "
                        f"(delta {float(top.get('expected_delta') or 0.0):.3f})"
                    ),
                    "entity_refs": [
                        str(top.get("source_ref") or ""),
                        str(top.get("target_ref") or ""),
                    ],
                    "occurred_at": _to_iso(row.created_at),
                    "impact_bridge": {
                        "external_ref": str(top.get("source_ref") or ""),
                        "internal_ref": str(top.get("target_ref") or ""),
                        "impact_type": "causal_projection",
                        "severity": severity,
                        "confidence": float(top.get("confidence") or 0.0),
                    },
                    "proof_bundle": {
                        "bundle_id": f"proof:causal:{row.id}",
                        "citations": [
                            {"kind": "graph_evidence", "ref_id": str(item)}
                            for item in _safe_list(top.get("evidence_refs"))
                            if item
                        ],
                        "timeline": [
                            {
                                "event": "simulation_completed",
                                "at": _to_iso(row.created_at),
                                "scenario_name": row.scenario_name,
                            }
                        ],
                        "confidence_reasoning": {
                            "causal_replay_hash": payload.get("causal_replay_hash"),
                            "scenario_replay_hash": payload.get("scenario_replay_hash"),
                        },
                    },
                    "tags": ["causal", "simulation"],
                }
            )
        return events

    async def _impact_bridge_deltas(self, *, since: datetime, limit: int) -> list[dict[str, Any]]:
        set_rls_context(self.organization_id, is_internal=True)
        try:
            async with get_db_session() as session:
                rows = (
                    await session.execute(
                        text(
                            """
                            SELECT
                                id,
                                external_object_ref,
                                internal_object_ref,
                                impact_type,
                                severity,
                                confidence,
                                evidence_link_ids,
                                created_at
                            FROM impact_edge
                            WHERE organization_id = :org_id
                              AND created_at >= :since
                            ORDER BY created_at DESC
                            LIMIT :limit
                            """
                        ),
                        {"org_id": self.organization_id, "since": since, "limit": limit},
                    )
                ).fetchall()
        finally:
            set_rls_context(None, is_internal=False)

        events: list[dict[str, Any]] = []
        for row in rows:
            events.append(
                {
                    "event_id": f"tape:impact:{row.id}",
                    "lane": "bridge",
                    "delta_domain": "impact",
                    "severity": str(row.severity or "medium").lower(),
                    "confidence": float(row.confidence or 0.0),
                    "title": "External-to-internal impact bridge",
                    "summary": (
                        f"{row.external_object_ref} -> {row.internal_object_ref} [{row.impact_type}]"
                    ),
                    "entity_refs": [str(row.external_object_ref), str(row.internal_object_ref)],
                    "occurred_at": _to_iso(row.created_at),
                    "impact_bridge": {
                        "external_ref": str(row.external_object_ref),
                        "internal_ref": str(row.internal_object_ref),
                        "impact_type": str(row.impact_type),
                        "severity": str(row.severity or "medium").lower(),
                        "confidence": float(row.confidence or 0.0),
                    },
                    "proof_bundle": {
                        "bundle_id": f"proof:impact:{row.id}",
                        "citations": [
                            {"kind": "evidence_link", "ref_id": str(item)}
                            for item in list(row.evidence_link_ids or [])
                            if item
                        ],
                        "timeline": [
                            {
                                "event": "impact_edge_computed",
                                "at": _to_iso(row.created_at),
                            }
                        ],
                        "confidence_reasoning": {
                            "impact_type": row.impact_type,
                        },
                    },
                    "tags": ["impact", str(row.impact_type or "unknown")],
                }
            )
        return events

    async def _intervention_deltas(self, *, since: datetime, limit: int) -> list[dict[str, Any]]:
        set_rls_context(self.organization_id, is_internal=True)
        try:
            async with get_db_session() as session:
                rows = (
                    await session.execute(
                        text(
                            """
                            SELECT
                                id,
                                target_ref,
                                policy_class,
                                status,
                                expected_utility_delta,
                                downside_risk_estimate,
                                created_at
                            FROM intervention_plan
                            WHERE organization_id = :org_id
                              AND created_at >= :since
                            ORDER BY created_at DESC
                            LIMIT :limit
                            """
                        ),
                        {"org_id": self.organization_id, "since": since, "limit": limit},
                    )
                ).fetchall()
        finally:
            set_rls_context(None, is_internal=False)

        events: list[dict[str, Any]] = []
        for row in rows:
            expected_utility = float(row.expected_utility_delta or 0.0)
            confidence = max(0.0, min(1.0, 0.5 + (expected_utility / 2.0)))
            severity = "low"
            if row.policy_class in {"p0_freeze", "p1_human_approval"}:
                severity = "high"
            elif row.policy_class == "p2_guardrailed":
                severity = "medium"
            events.append(
                {
                    "event_id": f"tape:intervention:{row.id}",
                    "lane": "internal",
                    "delta_domain": "intervention",
                    "severity": severity,
                    "confidence": confidence,
                    "title": "Intervention plan lifecycle update",
                    "summary": f"{row.target_ref} [{row.status}] policy={row.policy_class}",
                    "entity_refs": [str(row.target_ref)],
                    "occurred_at": _to_iso(row.created_at),
                    "proof_bundle": {
                        "bundle_id": f"proof:intervention:{row.id}",
                        "citations": [],
                        "timeline": [
                            {
                                "event": "intervention_plan",
                                "at": _to_iso(row.created_at),
                                "status": row.status,
                            }
                        ],
                        "confidence_reasoning": {
                            "expected_utility_delta": expected_utility,
                            "downside_risk_estimate": float(row.downside_risk_estimate or 0.0),
                        },
                    },
                    "tags": ["intervention", str(row.status or "proposed").lower()],
                }
            )
        return events


def _to_iso_value(value: Any) -> datetime:
    if isinstance(value, datetime):
        if value.tzinfo is None:
            return value.replace(tzinfo=UTC)
        return value.astimezone(UTC)
    if isinstance(value, str):
        normalized = value.replace("Z", "+00:00")
        parsed = datetime.fromisoformat(normalized)
        if parsed.tzinfo is None:
            return parsed.replace(tzinfo=UTC)
        return parsed.astimezone(UTC)
    return datetime.fromtimestamp(0, tz=UTC)


_services: dict[str, TapeService] = {}


async def get_tape_service(organization_id: str) -> TapeService:
    if organization_id not in _services:
        _services[organization_id] = TapeService(organization_id=organization_id)
    return _services[organization_id]
