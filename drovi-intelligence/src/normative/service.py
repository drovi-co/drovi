"""Normative intelligence service: constraints, sentinel, timelines."""

from __future__ import annotations

from datetime import UTC, datetime
import hashlib
import json
from typing import Any, Mapping
from uuid import uuid4

from sqlalchemy import text

from src.db.client import get_db_session
from src.db.rls import set_rls_context
from src.events.publisher import get_event_publisher
from src.normative.adapters import parse_normative_source
from src.normative.dsl import decode_obligation_dsl
from src.normative.engine import NormativeConstraint, NormativeEngine, ViolationCandidate
from src.security.cognitive_payload_crypto import decrypt_payload_envelope, encrypt_payload_envelope


def _clamp(value: float, low: float, high: float) -> float:
    return max(low, min(high, value))


def _stable_hash(value: Any) -> str:
    payload = json.dumps(value, sort_keys=True, separators=(",", ":"), default=str)
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def _decode_violation_details(value: Any) -> dict[str, Any]:
    if not isinstance(value, dict):
        return {}
    decrypted = decrypt_payload_envelope(value)
    if isinstance(decrypted, dict):
        details = dict(decrypted)
    else:
        details = {}
    dedupe_key = value.get("dedupe_key")
    if dedupe_key and not details.get("dedupe_key"):
        details["dedupe_key"] = dedupe_key
    return details


class NormativeIntelligenceService:
    """Lifecycle and sentinel operations for normative obligations."""

    def __init__(self, organization_id: str) -> None:
        self.organization_id = organization_id
        self._engine = NormativeEngine()

    async def upsert_constraint_from_source(self, payload: dict[str, Any]) -> dict[str, Any]:
        constraint = parse_normative_source(payload)
        return await self.upsert_constraint(constraint)

    async def upsert_constraint(self, constraint: NormativeConstraint) -> dict[str, Any]:
        now = datetime.now(UTC)
        constraint_id = str(constraint.constraint_id or f"constraint_{uuid4().hex[:16]}")
        scope_payload = {
            "scope_entities": list(constraint.scope_entities),
            "scope_actions": list(constraint.scope_actions),
            "pre_breach_threshold": constraint.pre_breach_threshold,
            "evidence_refs": list(constraint.evidence_refs),
            "source_class": constraint.source_class,
            "obligation_type": constraint.obligation_type,
        }
        metadata_suffix = f" #meta:{json.dumps(scope_payload, sort_keys=True, separators=(',', ':'))}"
        machine_rule = str(constraint.machine_rule or "").strip()
        if "#meta:" not in machine_rule:
            machine_rule = f"{machine_rule}{metadata_suffix}"

        constraint_hash = _stable_hash(
            {
                "machine_rule": machine_rule,
                "severity": constraint.severity_on_breach,
                "jurisdiction": constraint.jurisdiction,
                "active": constraint.is_active,
            }
        )

        set_rls_context(self.organization_id, is_internal=True)
        try:
            async with get_db_session() as session:
                await session.execute(
                    text(
                        """
                        INSERT INTO cognitive_constraint (
                            id,
                            organization_id,
                            origin_type,
                            title,
                            machine_rule,
                            jurisdiction,
                            severity_on_breach,
                            is_active,
                            constraint_hash,
                            valid_from,
                            valid_to,
                            created_at,
                            updated_at
                        )
                        VALUES (
                            :id,
                            :organization_id,
                            :origin_type,
                            :title,
                            :machine_rule,
                            :jurisdiction,
                            :severity_on_breach,
                            :is_active,
                            :constraint_hash,
                            :valid_from,
                            :valid_to,
                            :created_at,
                            :updated_at
                        )
                        ON CONFLICT (id) DO UPDATE SET
                            origin_type = EXCLUDED.origin_type,
                            title = EXCLUDED.title,
                            machine_rule = EXCLUDED.machine_rule,
                            jurisdiction = EXCLUDED.jurisdiction,
                            severity_on_breach = EXCLUDED.severity_on_breach,
                            is_active = EXCLUDED.is_active,
                            constraint_hash = EXCLUDED.constraint_hash,
                            valid_from = EXCLUDED.valid_from,
                            valid_to = EXCLUDED.valid_to,
                            updated_at = EXCLUDED.updated_at
                        """
                    ),
                    {
                        "id": constraint_id,
                        "organization_id": self.organization_id,
                        "origin_type": constraint.source_class,
                        "title": constraint.title,
                        "machine_rule": machine_rule,
                        "jurisdiction": constraint.jurisdiction,
                        "severity_on_breach": str(constraint.severity_on_breach or "medium").lower(),
                        "is_active": bool(constraint.is_active),
                        "constraint_hash": constraint_hash,
                        "valid_from": now,
                        "valid_to": None,
                        "created_at": now,
                        "updated_at": now,
                    },
                )
        finally:
            set_rls_context(None, is_internal=False)

        return {
            "id": constraint_id,
            "organization_id": self.organization_id,
            "title": constraint.title,
            "origin_type": constraint.source_class,
            "severity_on_breach": str(constraint.severity_on_breach or "medium").lower(),
            "is_active": bool(constraint.is_active),
        }

    async def list_constraints(
        self,
        *,
        is_active: bool | None,
        origin_type: str | None,
        limit: int,
        offset: int,
    ) -> list[dict[str, Any]]:
        conditions = ["organization_id = :organization_id"]
        params: dict[str, Any] = {
            "organization_id": self.organization_id,
            "limit": max(1, min(int(limit), 500)),
            "offset": max(0, int(offset)),
        }
        if is_active is not None:
            conditions.append("is_active = :is_active")
            params["is_active"] = bool(is_active)
        if origin_type:
            conditions.append("origin_type = :origin_type")
            params["origin_type"] = str(origin_type).lower().strip()
        where_clause = " AND ".join(conditions)

        set_rls_context(self.organization_id, is_internal=True)
        try:
            async with get_db_session() as session:
                rows = (
                    await session.execute(
                        text(
                            f"""
                            SELECT id, origin_type, title, machine_rule, jurisdiction,
                                   severity_on_breach, is_active, valid_from, valid_to,
                                   created_at, updated_at
                            FROM cognitive_constraint
                            WHERE {where_clause}
                            ORDER BY updated_at DESC
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
            rule, meta = _split_meta_suffix(str(row.machine_rule or ""))
            dsl = decode_obligation_dsl(rule)
            items.append(
                {
                    "id": row.id,
                    "origin_type": row.origin_type,
                    "title": row.title,
                    "machine_rule": rule,
                    "dsl": dsl,
                    "meta": meta,
                    "jurisdiction": row.jurisdiction,
                    "severity_on_breach": row.severity_on_breach,
                    "is_active": bool(row.is_active),
                    "valid_from": row.valid_from.isoformat() if row.valid_from else None,
                    "valid_to": row.valid_to.isoformat() if row.valid_to else None,
                    "created_at": row.created_at.isoformat() if row.created_at else None,
                    "updated_at": row.updated_at.isoformat() if row.updated_at else None,
                }
            )
        return items

    async def list_violations(
        self,
        *,
        status: str | None,
        severity: str | None,
        constraint_id: str | None,
        limit: int,
        offset: int,
    ) -> list[dict[str, Any]]:
        conditions = ["v.organization_id = :organization_id"]
        params: dict[str, Any] = {
            "organization_id": self.organization_id,
            "limit": max(1, min(int(limit), 500)),
            "offset": max(0, int(offset)),
        }
        if status:
            conditions.append("v.status = :status")
            params["status"] = str(status).lower().strip()
        if severity:
            conditions.append("v.severity = :severity")
            params["severity"] = str(severity).lower().strip()
        if constraint_id:
            conditions.append("v.constraint_id = :constraint_id")
            params["constraint_id"] = constraint_id
        where_clause = " AND ".join(conditions)

        set_rls_context(self.organization_id, is_internal=True)
        try:
            async with get_db_session() as session:
                rows = (
                    await session.execute(
                        text(
                            f"""
                            SELECT v.id, v.constraint_id, c.title AS constraint_title,
                                   v.subject_entity_id, v.status, v.severity,
                                   v.confidence, v.details, v.detected_at,
                                   v.resolved_at, v.created_at
                            FROM constraint_violation_candidate v
                            JOIN cognitive_constraint c
                              ON c.organization_id = v.organization_id
                             AND c.id = v.constraint_id
                            WHERE {where_clause}
                            ORDER BY v.detected_at DESC
                            LIMIT :limit OFFSET :offset
                            """
                        ),
                        params,
                    )
                ).fetchall()
        finally:
            set_rls_context(None, is_internal=False)

        return [
            {
                "id": row.id,
                "constraint_id": row.constraint_id,
                "constraint_title": row.constraint_title,
                "subject_entity_id": row.subject_entity_id,
                "status": row.status,
                "severity": row.severity,
                "confidence": float(row.confidence),
                "details": _decode_violation_details(row.details),
                "detected_at": row.detected_at.isoformat() if row.detected_at else None,
                "resolved_at": row.resolved_at.isoformat() if row.resolved_at else None,
                "created_at": row.created_at.isoformat() if row.created_at else None,
            }
            for row in rows
        ]

    async def get_obligation_timeline(
        self,
        *,
        constraint_id: str,
        limit: int = 200,
    ) -> dict[str, Any] | None:
        set_rls_context(self.organization_id, is_internal=True)
        try:
            async with get_db_session() as session:
                constraint = (
                    await session.execute(
                        text(
                            """
                            SELECT id, title, origin_type, machine_rule, jurisdiction,
                                   severity_on_breach, is_active, valid_from, valid_to, updated_at
                            FROM cognitive_constraint
                            WHERE organization_id = :organization_id
                              AND id = :constraint_id
                            """
                        ),
                        {
                            "organization_id": self.organization_id,
                            "constraint_id": constraint_id,
                        },
                    )
                ).fetchone()
                if not constraint:
                    return None

                violation_rows = (
                    await session.execute(
                        text(
                            """
                            SELECT id, subject_entity_id, status, severity, confidence,
                                   details, detected_at, resolved_at
                            FROM constraint_violation_candidate
                            WHERE organization_id = :organization_id
                              AND constraint_id = :constraint_id
                            ORDER BY detected_at DESC
                            LIMIT :limit
                            """
                        ),
                        {
                            "organization_id": self.organization_id,
                            "constraint_id": constraint_id,
                            "limit": max(1, min(int(limit), 1000)),
                        },
                    )
                ).fetchall()
        finally:
            set_rls_context(None, is_internal=False)

        events = []
        for row in violation_rows:
            details = _decode_violation_details(row.details)
            events.append(
                {
                    "event_type": "violation.detected" if row.status == "open" else "violation.warning",
                    "violation_id": row.id,
                    "subject_entity_id": row.subject_entity_id,
                    "status": row.status,
                    "severity": row.severity,
                    "confidence": float(row.confidence),
                    "evidence_refs": list(details.get("evidence_refs") or []),
                    "recommended_actions": list(details.get("recommended_actions") or []),
                    "detected_at": row.detected_at.isoformat() if row.detected_at else None,
                    "resolved_at": row.resolved_at.isoformat() if row.resolved_at else None,
                }
            )

        rule, meta = _split_meta_suffix(str(constraint.machine_rule or ""))
        return {
            "constraint": {
                "id": constraint.id,
                "title": constraint.title,
                "origin_type": constraint.origin_type,
                "machine_rule": rule,
                "dsl": decode_obligation_dsl(rule),
                "meta": meta,
                "jurisdiction": constraint.jurisdiction,
                "severity_on_breach": constraint.severity_on_breach,
                "is_active": bool(constraint.is_active),
                "valid_from": constraint.valid_from.isoformat() if constraint.valid_from else None,
                "valid_to": constraint.valid_to.isoformat() if constraint.valid_to else None,
                "updated_at": constraint.updated_at.isoformat() if constraint.updated_at else None,
            },
            "timeline": events,
        }

    async def run_violation_sentinel(
        self,
        *,
        facts: Mapping[str, Any] | None = None,
        include_warnings: bool = True,
        publish_events: bool = True,
        max_constraints: int = 1000,
    ) -> dict[str, Any]:
        constraints = await self._load_active_constraints(limit=max_constraints)
        base_facts = await self._build_fact_snapshot()
        merged_facts = dict(base_facts)
        if isinstance(facts, Mapping):
            merged_facts = _deep_merge(merged_facts, facts)

        detected = self._engine.evaluate(constraints=constraints, facts=merged_facts)
        if not include_warnings:
            detected = [item for item in detected if item.status == "open"]

        persisted = []
        for candidate in detected:
            persisted_candidate = await self._persist_violation_candidate(candidate)
            if persisted_candidate is None:
                continue
            persisted.append(persisted_candidate)
            if publish_events:
                await self._publish_violation_event(candidate)

        return {
            "organization_id": self.organization_id,
            "constraints_evaluated": len(constraints),
            "signals_detected": len(detected),
            "signals_persisted": len(persisted),
            "breaches": sum(1 for item in persisted if item["status"] == "open"),
            "warnings": sum(1 for item in persisted if item["status"] == "warning"),
            "items": persisted,
            "facts": merged_facts,
        }

    async def _load_active_constraints(self, *, limit: int) -> list[NormativeConstraint]:
        set_rls_context(self.organization_id, is_internal=True)
        try:
            async with get_db_session() as session:
                rows = (
                    await session.execute(
                        text(
                            """
                            SELECT id, title, machine_rule, jurisdiction, severity_on_breach,
                                   is_active, origin_type
                            FROM cognitive_constraint
                            WHERE organization_id = :organization_id
                              AND is_active = true
                              AND (valid_to IS NULL OR valid_to >= NOW())
                            ORDER BY updated_at DESC
                            LIMIT :limit
                            """
                        ),
                        {
                            "organization_id": self.organization_id,
                            "limit": max(1, min(int(limit), 5000)),
                        },
                    )
                ).fetchall()
        finally:
            set_rls_context(None, is_internal=False)

        constraints: list[NormativeConstraint] = []
        for row in rows:
            rule, meta = _split_meta_suffix(str(row.machine_rule or ""))
            constraints.append(
                NormativeConstraint(
                    constraint_id=row.id,
                    title=row.title,
                    machine_rule=rule,
                    severity_on_breach=row.severity_on_breach,
                    jurisdiction=row.jurisdiction,
                    is_active=bool(row.is_active),
                    source_class=str(row.origin_type or "policy"),
                    obligation_type=str(meta.get("obligation_type") or "must"),
                    scope_entities=[str(item) for item in list(meta.get("scope_entities") or []) if item],
                    scope_actions=[str(item) for item in list(meta.get("scope_actions") or []) if item],
                    pre_breach_threshold=(
                        float(meta.get("pre_breach_threshold"))
                        if meta.get("pre_breach_threshold") is not None
                        else None
                    ),
                    evidence_refs=[str(item) for item in list(meta.get("evidence_refs") or []) if item],
                )
            )
        return constraints

    async def _build_fact_snapshot(self) -> dict[str, Any]:
        set_rls_context(self.organization_id, is_internal=True)
        try:
            async with get_db_session() as session:
                uio_aggregate = (
                    await session.execute(
                        text(
                            """
                            SELECT
                                SUM(CASE
                                        WHEN type = 'commitment'
                                         AND status NOT IN ('completed', 'cancelled', 'archived')
                                        THEN 1 ELSE 0
                                    END) AS open_commitments,
                                SUM(CASE
                                        WHEN type = 'commitment'
                                         AND status NOT IN ('completed', 'cancelled', 'archived')
                                         AND due_date < NOW()
                                        THEN 1 ELSE 0
                                    END) AS overdue_commitments,
                                SUM(CASE
                                        WHEN type = 'risk'
                                         AND status NOT IN ('resolved', 'closed', 'archived')
                                        THEN 1 ELSE 0
                                    END) AS open_risks
                            FROM unified_intelligence_object
                            WHERE organization_id = :organization_id
                            """
                        ),
                        {"organization_id": self.organization_id},
                    )
                ).fetchone()

                impact_aggregate = (
                    await session.execute(
                        text(
                            """
                            SELECT
                                SUM(CASE WHEN severity IN ('high', 'critical') THEN 1 ELSE 0 END) AS high_impact_edges,
                                MAX(confidence) AS max_impact_confidence
                            FROM impact_edge
                            WHERE organization_id = :organization_id
                            """
                        ),
                        {"organization_id": self.organization_id},
                    )
                ).fetchone()
        finally:
            set_rls_context(None, is_internal=False)

        return {
            "internal": {
                "open_commitments": int((uio_aggregate.open_commitments or 0) if uio_aggregate else 0),
                "overdue_commitments": int((uio_aggregate.overdue_commitments or 0) if uio_aggregate else 0),
                "open_risks": int((uio_aggregate.open_risks or 0) if uio_aggregate else 0),
            },
            "external": {
                "high_impact_edges": int((impact_aggregate.high_impact_edges or 0) if impact_aggregate else 0),
                "max_impact_confidence": float((impact_aggregate.max_impact_confidence or 0.0) if impact_aggregate else 0.0),
            },
        }

    async def _persist_violation_candidate(self, candidate: ViolationCandidate) -> dict[str, Any] | None:
        details = dict(candidate.details or {})
        dedupe_key = details.get("dedupe_key")
        if not dedupe_key:
            dedupe_key = _stable_hash(
                {
                    "constraint_id": candidate.constraint_id,
                    "status": candidate.status,
                    "subject_entity_id": candidate.subject_entity_id,
                    "details": details,
                }
            )[:16]
            details["dedupe_key"] = dedupe_key
        encrypted_details = {
            "dedupe_key": str(dedupe_key),
            **encrypt_payload_envelope(details),
        }

        set_rls_context(self.organization_id, is_internal=True)
        try:
            async with get_db_session() as session:
                existing = (
                    await session.execute(
                        text(
                            """
                            SELECT id, status, severity, confidence, details, detected_at
                            FROM constraint_violation_candidate
                            WHERE organization_id = :organization_id
                              AND constraint_id = :constraint_id
                              AND status = :status
                              AND (
                                (subject_entity_id = :subject_entity_id)
                                OR (subject_entity_id IS NULL AND :subject_entity_id IS NULL)
                              )
                              AND details->>'dedupe_key' = :dedupe_key
                            ORDER BY detected_at DESC
                            LIMIT 1
                            """
                        ),
                        {
                            "organization_id": self.organization_id,
                        "constraint_id": candidate.constraint_id,
                        "status": candidate.status,
                        "subject_entity_id": candidate.subject_entity_id,
                        "dedupe_key": str(dedupe_key),
                    },
                    )
                ).fetchone()
                if existing:
                    return None

                violation_id = str(candidate.violation_id or f"viol_{uuid4().hex[:12]}")
                now = datetime.now(UTC)
                await session.execute(
                    text(
                        """
                        INSERT INTO constraint_violation_candidate (
                            id,
                            organization_id,
                            constraint_id,
                            subject_entity_id,
                            status,
                            severity,
                            confidence,
                            details,
                            detected_at,
                            resolved_at,
                            created_at
                        )
                        VALUES (
                            :id,
                            :organization_id,
                            :constraint_id,
                            :subject_entity_id,
                            :status,
                            :severity,
                            :confidence,
                            :details,
                            :detected_at,
                            :resolved_at,
                            :created_at
                        )
                        """
                    ),
                    {
                        "id": violation_id,
                        "organization_id": self.organization_id,
                        "constraint_id": candidate.constraint_id,
                        "subject_entity_id": candidate.subject_entity_id,
                        "status": candidate.status,
                        "severity": candidate.severity,
                        "confidence": _clamp(float(candidate.confidence), 0.0, 1.0),
                        "details": encrypted_details,
                        "detected_at": candidate.detected_at,
                        "resolved_at": None,
                        "created_at": now,
                    },
                )
        finally:
            set_rls_context(None, is_internal=False)

        return {
            "id": violation_id,
            "constraint_id": candidate.constraint_id,
            "subject_entity_id": candidate.subject_entity_id,
            "status": candidate.status,
            "severity": candidate.severity,
            "confidence": _clamp(float(candidate.confidence), 0.0, 1.0),
            "details": details,
            "detected_at": candidate.detected_at.isoformat(),
        }

    async def _publish_violation_event(self, candidate: ViolationCandidate) -> None:
        publisher = await get_event_publisher()
        now = datetime.now(UTC)
        await publisher.publish_world_brain_contract_event(
            {
                "schema_version": "1.0",
                "organization_id": self.organization_id,
                "event_id": str(uuid4()),
                "occurred_at": now,
                "producer": "drovi-intelligence",
                "event_type": "constraint.violation.candidate.v1",
                "payload": {
                    "violation_id": candidate.violation_id,
                    "constraint_id": candidate.constraint_id,
                    "subject_entity_id": candidate.subject_entity_id,
                    "status": candidate.status,
                    "severity": candidate.severity,
                    "confidence": _clamp(float(candidate.confidence), 0.0, 1.0),
                    "detected_at": candidate.detected_at,
                    "details": dict(candidate.details or {}),
                },
            }
        )


def _split_meta_suffix(machine_rule: str) -> tuple[str, dict[str, Any]]:
    text = str(machine_rule or "").strip()
    marker = " #meta:"
    index = text.rfind(marker)
    if index < 0:
        return text, {}
    rule = text[:index].strip()
    suffix = text[index + len(marker):].strip()
    if not suffix:
        return rule, {}
    try:
        meta = json.loads(suffix)
    except json.JSONDecodeError:
        meta = {}
    return rule, meta if isinstance(meta, dict) else {}


def _deep_merge(left: dict[str, Any], right: Mapping[str, Any]) -> dict[str, Any]:
    merged = dict(left)
    for key, value in right.items():
        if (
            key in merged
            and isinstance(merged[key], dict)
            and isinstance(value, Mapping)
        ):
            merged[key] = _deep_merge(dict(merged[key]), value)
        else:
            merged[key] = value
    return merged


_services: dict[str, NormativeIntelligenceService] = {}


async def get_normative_intelligence_service(organization_id: str) -> NormativeIntelligenceService:
    if organization_id not in _services:
        _services[organization_id] = NormativeIntelligenceService(organization_id=organization_id)
    return _services[organization_id]
