"""Client-facing trust products: certificates, continuity score, integrity report, bundles."""

from __future__ import annotations

import hashlib
import hmac
import json
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from typing import Any

from sqlalchemy import text

from src.config import get_settings
from src.db.client import get_db_session
from src.db.rls import set_rls_context
from src.evidence.audit import record_evidence_audit
from src.evidence.storage import get_evidence_storage


def _row_to_dict(row: Any) -> dict[str, Any]:
    if row is None:
        return {}
    if isinstance(row, dict):
        return row
    if hasattr(row, "_mapping"):
        return dict(row._mapping)
    return dict(row.__dict__)


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _safe_ratio(numerator: float, denominator: float, default: float = 1.0) -> float:
    if denominator <= 0:
        return default
    return max(0.0, min(float(numerator) / float(denominator), 1.0))


def _resolve_signing_secret() -> tuple[str, str | None]:
    settings = get_settings()
    secret = (
        settings.custody_signing_secret
        or settings.internal_jwt_secret
        or settings.api_key_salt
        or "drovi-dev-custody-secret"
    )
    return secret, settings.custody_signing_key_id


def _sign_export(
    *,
    export_type: str,
    organization_id: str,
    generated_at: datetime,
    payload: dict[str, Any],
) -> tuple[str, str, str, str | None]:
    secret, key_id = _resolve_signing_secret()
    canonical = json.dumps(payload, sort_keys=True, separators=(",", ":"), default=str)
    payload_hash = hashlib.sha256(canonical.encode("utf-8")).hexdigest()
    signature_seed = f"{export_type}:{organization_id}:{generated_at.isoformat()}:{payload_hash}"
    signature = hmac.new(
        secret.encode("utf-8"),
        signature_seed.encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()
    return payload_hash, signature, "hmac-sha256", key_id


def _parse_month(month: str | None) -> tuple[date, date, str]:
    now = _utc_now()
    if month:
        try:
            start = datetime.strptime(month, "%Y-%m").date().replace(day=1)  # noqa: DTZ007
        except ValueError as exc:
            raise ValueError("Invalid month format, expected YYYY-MM") from exc
    else:
        current_month_start = now.date().replace(day=1)
        start = (current_month_start - timedelta(days=1)).replace(day=1)

    if start.month == 12:
        end_exclusive = date(start.year + 1, 1, 1)
    else:
        end_exclusive = date(start.year, start.month + 1, 1)
    month_key = f"{start.year:04d}-{start.month:02d}"
    return start, end_exclusive, month_key


@dataclass(frozen=True)
class ContinuityMetrics:
    total_recent: int
    evidence_backed_recent: int
    fresh_recent: int
    open_commitments: int
    overdue_commitments: int
    open_contradictions: int
    custody_roots_last_week: int


def _score_continuity(metrics: ContinuityMetrics) -> dict[str, Any]:
    evidence_coverage = _safe_ratio(
        metrics.evidence_backed_recent, metrics.total_recent, default=1.0
    )
    freshness = _safe_ratio(metrics.fresh_recent, metrics.total_recent, default=1.0)
    contradiction_hygiene = max(
        0.0,
        1.0 - _safe_ratio(metrics.open_contradictions, max(metrics.total_recent, 1), default=0.0),
    )
    commitment_reliability = max(
        0.0,
        1.0 - _safe_ratio(metrics.overdue_commitments, max(metrics.open_commitments, 1), default=0.0),
    )
    custody_coverage = _safe_ratio(metrics.custody_roots_last_week, 7, default=0.0)

    factors = [
        {
            "id": "evidence_coverage",
            "label": "Evidence-backed record coverage",
            "weight": 0.30,
            "value": round(evidence_coverage, 4),
            "contribution": round(evidence_coverage * 0.30, 4),
            "details": {
                "evidence_backed_recent": metrics.evidence_backed_recent,
                "total_recent": metrics.total_recent,
            },
        },
        {
            "id": "freshness",
            "label": "Record freshness",
            "weight": 0.25,
            "value": round(freshness, 4),
            "contribution": round(freshness * 0.25, 4),
            "details": {
                "fresh_recent": metrics.fresh_recent,
                "total_recent": metrics.total_recent,
            },
        },
        {
            "id": "contradiction_hygiene",
            "label": "Contradiction hygiene",
            "weight": 0.20,
            "value": round(contradiction_hygiene, 4),
            "contribution": round(contradiction_hygiene * 0.20, 4),
            "details": {"open_contradictions": metrics.open_contradictions},
        },
        {
            "id": "commitment_reliability",
            "label": "Commitment reliability",
            "weight": 0.15,
            "value": round(commitment_reliability, 4),
            "contribution": round(commitment_reliability * 0.15, 4),
            "details": {
                "open_commitments": metrics.open_commitments,
                "overdue_commitments": metrics.overdue_commitments,
            },
        },
        {
            "id": "custody_coverage",
            "label": "Custody root coverage (last 7 days)",
            "weight": 0.10,
            "value": round(custody_coverage, 4),
            "contribution": round(custody_coverage * 0.10, 4),
            "details": {"roots_last_week": metrics.custody_roots_last_week},
        },
    ]
    score_raw = sum(item["contribution"] for item in factors)
    score = max(0.0, min(score_raw, 1.0))
    return {
        "score": round(score * 100, 2),
        "score_normalized": round(score, 4),
        "factors": factors,
    }


async def compute_continuity_score(
    *,
    organization_id: str,
    lookback_days: int = 30,
    as_of: datetime | None = None,
) -> dict[str, Any]:
    reference_time = as_of or _utc_now()
    recent_since = reference_time - timedelta(days=max(int(lookback_days), 1))
    freshness_since = reference_time - timedelta(days=30)
    roots_since = reference_time.date() - timedelta(days=6)

    set_rls_context(organization_id, is_internal=True)
    try:
        async with get_db_session() as session:
            summary_result = await session.execute(
                text(
                    """
                    SELECT
                        COUNT(*) FILTER (
                            WHERE u.created_at >= :recent_since
                        ) AS total_recent,
                        COUNT(*) FILTER (
                            WHERE u.created_at >= :recent_since
                              AND EXISTS (
                                  SELECT 1
                                  FROM unified_object_source uos
                                  WHERE uos.unified_object_id = u.id
                              )
                        ) AS evidence_backed_recent,
                        COUNT(*) FILTER (
                            WHERE u.created_at >= :recent_since
                              AND COALESCE(u.last_updated_at, u.updated_at, u.created_at) >= :freshness_since
                        ) AS fresh_recent,
                        COUNT(*) FILTER (
                            WHERE u.type = 'commitment'
                              AND u.status IN ('draft', 'active', 'in_progress')
                        ) AS open_commitments,
                        COUNT(*) FILTER (
                            WHERE u.type = 'commitment'
                              AND u.status IN ('draft', 'active', 'in_progress')
                              AND u.due_date IS NOT NULL
                              AND u.due_date < :as_of
                        ) AS overdue_commitments
                    FROM unified_intelligence_object u
                    WHERE u.organization_id = :org_id
                    """
                ),
                {
                    "org_id": organization_id,
                    "recent_since": recent_since,
                    "freshness_since": freshness_since,
                    "as_of": reference_time,
                },
            )
            summary_row = summary_result.fetchone()

            contradiction_result = await session.execute(
                text(
                    """
                    SELECT COUNT(*) AS open_contradictions
                    FROM uio_contradiction
                    WHERE organization_id = :org_id
                      AND status = 'open'
                    """
                ),
                {"org_id": organization_id},
            )
            contradiction_row = contradiction_result.fetchone()

            custody_result = await session.execute(
                text(
                    """
                    SELECT COUNT(*) AS roots_last_week
                    FROM custody_daily_root
                    WHERE organization_id = :org_id
                      AND root_date >= :roots_since
                      AND root_date <= :as_of_date
                    """
                ),
                {
                    "org_id": organization_id,
                    "roots_since": roots_since,
                    "as_of_date": reference_time.date(),
                },
            )
            custody_row = custody_result.fetchone()
    finally:
        set_rls_context(None, is_internal=False)

    metrics = ContinuityMetrics(
        total_recent=int(getattr(summary_row, "total_recent", 0) or 0),
        evidence_backed_recent=int(getattr(summary_row, "evidence_backed_recent", 0) or 0),
        fresh_recent=int(getattr(summary_row, "fresh_recent", 0) or 0),
        open_commitments=int(getattr(summary_row, "open_commitments", 0) or 0),
        overdue_commitments=int(getattr(summary_row, "overdue_commitments", 0) or 0),
        open_contradictions=int(getattr(contradiction_row, "open_contradictions", 0) or 0),
        custody_roots_last_week=int(getattr(custody_row, "roots_last_week", 0) or 0),
    )

    scored = _score_continuity(metrics)
    return {
        "organization_id": organization_id,
        "as_of": reference_time.isoformat(),
        "lookback_days": int(lookback_days),
        "score": scored["score"],
        "score_normalized": scored["score_normalized"],
        "factors": scored["factors"],
        "metrics": {
            "total_recent": metrics.total_recent,
            "evidence_backed_recent": metrics.evidence_backed_recent,
            "fresh_recent": metrics.fresh_recent,
            "open_commitments": metrics.open_commitments,
            "overdue_commitments": metrics.overdue_commitments,
            "open_contradictions": metrics.open_contradictions,
            "custody_roots_last_week": metrics.custody_roots_last_week,
        },
    }


async def generate_record_certificate(
    *,
    organization_id: str,
    uio_id: str,
    evidence_limit: int = 10,
) -> dict[str, Any]:
    generated_at = _utc_now()

    set_rls_context(organization_id, is_internal=True)
    try:
        async with get_db_session() as session:
            uio_result = await session.execute(
                text(
                    """
                    SELECT
                        id, type, canonical_title, canonical_description, status,
                        overall_confidence, belief_state, truth_state,
                        last_update_reason, created_at, updated_at, last_updated_at
                    FROM unified_intelligence_object
                    WHERE organization_id = :org_id
                      AND id = :uio_id
                    LIMIT 1
                    """
                ),
                {"org_id": organization_id, "uio_id": uio_id},
            )
            uio_row = uio_result.fetchone()
            if not uio_row:
                raise ValueError("Record not found")

            evidence_result = await session.execute(
                text(
                    """
                    SELECT
                        id, source_type, source_account_id, conversation_id, message_id,
                        role, quoted_text, quoted_text_start, quoted_text_end,
                        source_timestamp, confidence, segment_hash, added_at
                    FROM unified_object_source
                    WHERE unified_object_id = :uio_id
                    ORDER BY source_timestamp DESC NULLS LAST, added_at DESC
                    LIMIT :evidence_limit
                    """
                ),
                {"uio_id": uio_id, "evidence_limit": max(int(evidence_limit), 1)},
            )
            evidence_rows = [_row_to_dict(row) for row in evidence_result.fetchall()]

            timeline_result = await session.execute(
                text(
                    """
                    SELECT
                        event_type, event_description, event_reason,
                        source_type, source_id, confidence, event_at
                    FROM unified_object_timeline
                    WHERE unified_object_id = :uio_id
                    ORDER BY event_at DESC
                    LIMIT 12
                    """
                ),
                {"uio_id": uio_id},
            )
            timeline_rows = [_row_to_dict(row) for row in timeline_result.fetchall()]

            custody_result = await session.execute(
                text(
                    """
                    SELECT root_date, merkle_root, signed_root, signature_alg, signature_key_id
                    FROM custody_daily_root
                    WHERE organization_id = :org_id
                    ORDER BY root_date DESC
                    LIMIT 1
                    """
                ),
                {"org_id": organization_id},
            )
            custody_row = custody_result.fetchone()
    finally:
        set_rls_context(None, is_internal=False)

    uio_data = _row_to_dict(uio_row)
    certificate_payload = {
        "organization_id": organization_id,
        "issued_at": generated_at.isoformat(),
        "record": {
            "id": str(uio_data.get("id")),
            "type": uio_data.get("type"),
            "title": uio_data.get("canonical_title"),
            "description": uio_data.get("canonical_description"),
            "status": uio_data.get("status"),
            "overall_confidence": float(uio_data.get("overall_confidence") or 0.0),
            "belief_state": uio_data.get("belief_state"),
            "truth_state": uio_data.get("truth_state"),
            "last_update_reason": uio_data.get("last_update_reason"),
            "created_at": (
                uio_data.get("created_at").isoformat()
                if isinstance(uio_data.get("created_at"), datetime)
                else uio_data.get("created_at")
            ),
            "updated_at": (
                (uio_data.get("last_updated_at") or uio_data.get("updated_at")).isoformat()
                if isinstance((uio_data.get("last_updated_at") or uio_data.get("updated_at")), datetime)
                else (uio_data.get("last_updated_at") or uio_data.get("updated_at"))
            ),
        },
        "evidence": [
            {
                "id": row.get("id"),
                "source_type": row.get("source_type"),
                "role": row.get("role"),
                "source_timestamp": (
                    row.get("source_timestamp").isoformat()
                    if isinstance(row.get("source_timestamp"), datetime)
                    else row.get("source_timestamp")
                ),
                "quoted_text": row.get("quoted_text"),
                "quote_span": {
                    "start": row.get("quoted_text_start"),
                    "end": row.get("quoted_text_end"),
                    "segment_hash": row.get("segment_hash"),
                },
                "conversation_id": row.get("conversation_id"),
                "message_id": row.get("message_id"),
                "confidence": float(row.get("confidence") or 0.0),
            }
            for row in evidence_rows
        ],
        "timeline": [
            {
                "event_type": row.get("event_type"),
                "event_description": row.get("event_description"),
                "event_reason": row.get("event_reason"),
                "source_type": row.get("source_type"),
                "source_id": row.get("source_id"),
                "confidence": float(row.get("confidence") or 0.0),
                "event_at": (
                    row.get("event_at").isoformat()
                    if isinstance(row.get("event_at"), datetime)
                    else row.get("event_at")
                ),
            }
            for row in timeline_rows
        ],
        "custody_anchor": (
            {
                "root_date": custody_row.root_date.isoformat() if custody_row and custody_row.root_date else None,
                "merkle_root": custody_row.merkle_root if custody_row else None,
                "signed_root": custody_row.signed_root if custody_row else None,
                "signature_alg": custody_row.signature_alg if custody_row else None,
                "signature_key_id": custody_row.signature_key_id if custody_row else None,
            }
            if custody_row
            else None
        ),
        "proof_statement": (
            "This certificate is an auditable snapshot of the record and linked evidence at issue time."
        ),
    }
    payload_hash, signature, signature_alg, signature_key_id = _sign_export(
        export_type="record_certificate",
        organization_id=organization_id,
        generated_at=generated_at,
        payload=certificate_payload,
    )

    certificate_id = f"cert_{payload_hash[:24]}"
    return {
        "certificate_id": certificate_id,
        "organization_id": organization_id,
        "uio_id": uio_id,
        "issued_at": generated_at.isoformat(),
        "payload_hash": payload_hash,
        "signature": signature,
        "signature_alg": signature_alg,
        "signature_key_id": signature_key_id,
        "certificate": certificate_payload,
        "export_json": json.dumps(certificate_payload, sort_keys=True),
    }


async def generate_monthly_integrity_report(
    *,
    organization_id: str,
    month: str | None,
) -> dict[str, Any]:
    month_start, month_end_exclusive, month_key = _parse_month(month)
    generated_at = _utc_now()

    set_rls_context(organization_id, is_internal=True)
    try:
        async with get_db_session() as session:
            uio_result = await session.execute(
                text(
                    """
                    SELECT type, COUNT(*) AS count
                    FROM unified_intelligence_object
                    WHERE organization_id = :org_id
                      AND created_at >= :month_start
                      AND created_at < :month_end
                    GROUP BY type
                    ORDER BY type
                    """
                ),
                {
                    "org_id": organization_id,
                    "month_start": month_start,
                    "month_end": month_end_exclusive,
                },
            )
            uio_counts = {
                str(row.type): int(row.count or 0)
                for row in uio_result.fetchall()
            }

            evidence_result = await session.execute(
                text(
                    """
                    SELECT
                        COUNT(*) AS total_artifacts,
                        COUNT(*) FILTER (WHERE legal_hold = true) AS legal_hold_count
                    FROM evidence_artifact
                    WHERE organization_id = :org_id
                      AND created_at >= :month_start
                      AND created_at < :month_end
                    """
                ),
                {
                    "org_id": organization_id,
                    "month_start": month_start,
                    "month_end": month_end_exclusive,
                },
            )
            evidence_row = evidence_result.fetchone()

            audit_result = await session.execute(
                text(
                    """
                    SELECT
                        COUNT(*) AS audit_events,
                        COUNT(*) FILTER (WHERE reason_code IS NOT NULL) AS reason_coded_events
                    FROM evidence_audit_log
                    WHERE organization_id = :org_id
                      AND created_at >= :month_start
                      AND created_at < :month_end
                    """
                ),
                {
                    "org_id": organization_id,
                    "month_start": month_start,
                    "month_end": month_end_exclusive,
                },
            )
            audit_row = audit_result.fetchone()

            contradiction_result = await session.execute(
                text(
                    """
                    SELECT
                        COUNT(*) FILTER (
                            WHERE detected_at >= :month_start AND detected_at < :month_end
                        ) AS detected_count,
                        COUNT(*) FILTER (
                            WHERE resolved_at IS NOT NULL
                              AND resolved_at >= :month_start
                              AND resolved_at < :month_end
                        ) AS resolved_count,
                        COUNT(*) FILTER (WHERE status = 'open') AS open_count
                    FROM uio_contradiction
                    WHERE organization_id = :org_id
                    """
                ),
                {
                    "org_id": organization_id,
                    "month_start": month_start,
                    "month_end": month_end_exclusive,
                },
            )
            contradiction_row = contradiction_result.fetchone()

            roots_result = await session.execute(
                text(
                    """
                    SELECT root_date, merkle_root, signed_root, signature_key_id, artifact_count, event_count
                    FROM custody_daily_root
                    WHERE organization_id = :org_id
                      AND root_date >= :month_start
                      AND root_date < :month_end
                    ORDER BY root_date ASC
                    """
                ),
                {
                    "org_id": organization_id,
                    "month_start": month_start,
                    "month_end": month_end_exclusive,
                },
            )
            roots = [
                {
                    "root_date": row.root_date.isoformat() if row.root_date else None,
                    "merkle_root": row.merkle_root,
                    "signed_root": row.signed_root,
                    "signature_key_id": row.signature_key_id,
                    "artifact_count": int(row.artifact_count or 0),
                    "event_count": int(row.event_count or 0),
                }
                for row in roots_result.fetchall()
            ]
    finally:
        set_rls_context(None, is_internal=False)

    continuity = await compute_continuity_score(
        organization_id=organization_id,
        lookback_days=30,
        as_of=datetime.combine(
            month_end_exclusive - timedelta(days=1),
            datetime.min.time(),
            tzinfo=timezone.utc,
        ),
    )
    calendar_days = max((month_end_exclusive - month_start).days, 1)
    root_coverage = _safe_ratio(len(roots), calendar_days, default=0.0)

    report_payload = {
        "organization_id": organization_id,
        "month": month_key,
        "generated_at": generated_at.isoformat(),
        "metrics": {
            "uio_created_by_type": uio_counts,
            "evidence_artifacts_created": int(getattr(evidence_row, "total_artifacts", 0) or 0),
            "evidence_artifacts_legal_hold": int(getattr(evidence_row, "legal_hold_count", 0) or 0),
            "audit_events": int(getattr(audit_row, "audit_events", 0) or 0),
            "audit_events_with_reason_code": int(getattr(audit_row, "reason_coded_events", 0) or 0),
            "contradictions_detected": int(getattr(contradiction_row, "detected_count", 0) or 0),
            "contradictions_resolved": int(getattr(contradiction_row, "resolved_count", 0) or 0),
            "contradictions_open": int(getattr(contradiction_row, "open_count", 0) or 0),
            "custody_roots_generated": len(roots),
            "custody_root_coverage": round(root_coverage, 4),
            "calendar_days": calendar_days,
        },
        "continuity_score": {
            "score": continuity["score"],
            "score_normalized": continuity["score_normalized"],
            "factors": continuity["factors"],
        },
        "custody_daily_roots": roots,
        "conclusion": (
            "Integrity posture remains auditable with explicit custody anchoring and evidence traceability."
        ),
    }
    payload_hash, signature, signature_alg, signature_key_id = _sign_export(
        export_type="monthly_integrity_report",
        organization_id=organization_id,
        generated_at=generated_at,
        payload=report_payload,
    )

    report_id = f"ir_{month_key.replace('-', '')}_{payload_hash[:16]}"
    return {
        "report_id": report_id,
        "organization_id": organization_id,
        "month": month_key,
        "generated_at": generated_at.isoformat(),
        "payload_hash": payload_hash,
        "signature": signature,
        "signature_alg": signature_alg,
        "signature_key_id": signature_key_id,
        "report": report_payload,
        "export_json": json.dumps(report_payload, sort_keys=True),
    }


async def export_evidence_bundle(
    *,
    organization_id: str,
    uio_ids: list[str],
    evidence_ids: list[str],
    include_presigned_urls: bool = False,
) -> dict[str, Any]:
    if not uio_ids and not evidence_ids:
        raise ValueError("At least one uio_id or evidence_id is required")

    generated_at = _utc_now()
    storage = get_evidence_storage()

    set_rls_context(organization_id, is_internal=True)
    try:
        async with get_db_session() as session:
            source_rows: list[dict[str, Any]] = []
            source_refs: set[str] = set()
            if uio_ids:
                uos_result = await session.execute(
                    text(
                        """
                        SELECT
                            unified_object_id, source_type, conversation_id, message_id,
                            quoted_text, quoted_text_start, quoted_text_end, segment_hash, confidence
                        FROM unified_object_source
                        WHERE unified_object_id = ANY(:uio_ids)
                        ORDER BY added_at DESC
                        """
                    ),
                    {"uio_ids": list(dict.fromkeys(uio_ids))},
                )
                source_rows = [_row_to_dict(row) for row in uos_result.fetchall()]
                for row in source_rows:
                    for key in ("message_id", "conversation_id"):
                        value = str(row.get(key) or "").strip()
                        if value:
                            source_refs.add(value)

            artifact_map: dict[str, dict[str, Any]] = {}
            if evidence_ids:
                direct_result = await session.execute(
                    text(
                        """
                        SELECT
                            id, source_type, source_id, artifact_type, mime_type,
                            storage_backend, storage_path, byte_size, sha256,
                            retention_until, immutable, legal_hold, metadata, created_at
                        FROM evidence_artifact
                        WHERE organization_id = :org_id
                          AND id = ANY(:evidence_ids)
                        """
                    ),
                    {"org_id": organization_id, "evidence_ids": list(dict.fromkeys(evidence_ids))},
                )
                for row in direct_result.fetchall():
                    artifact_row = _row_to_dict(row)
                    artifact_map[str(artifact_row["id"])] = artifact_row

            if source_refs:
                source_result = await session.execute(
                    text(
                        """
                        SELECT
                            id, source_type, source_id, artifact_type, mime_type,
                            storage_backend, storage_path, byte_size, sha256,
                            retention_until, immutable, legal_hold, metadata, created_at
                        FROM evidence_artifact
                        WHERE organization_id = :org_id
                          AND source_id = ANY(:source_ids)
                        """
                    ),
                    {"org_id": organization_id, "source_ids": sorted(source_refs)},
                )
                for row in source_result.fetchall():
                    artifact_row = _row_to_dict(row)
                    artifact_map[str(artifact_row["id"])] = artifact_row

            custody_result = await session.execute(
                text(
                    """
                    SELECT root_date, merkle_root, signed_root, signature_alg, signature_key_id
                    FROM custody_daily_root
                    WHERE organization_id = :org_id
                    ORDER BY root_date DESC
                    LIMIT 1
                    """
                ),
                {"org_id": organization_id},
            )
            custody_row = custody_result.fetchone()
    finally:
        set_rls_context(None, is_internal=False)

    artifacts: list[dict[str, Any]] = []
    for row in sorted(artifact_map.values(), key=lambda item: str(item.get("created_at") or ""), reverse=True):
        artifact = {
            "id": row.get("id"),
            "source_type": row.get("source_type"),
            "source_id": row.get("source_id"),
            "artifact_type": row.get("artifact_type"),
            "mime_type": row.get("mime_type"),
            "storage_backend": row.get("storage_backend"),
            "storage_path": row.get("storage_path"),
            "byte_size": int(row.get("byte_size") or 0),
            "sha256": row.get("sha256"),
            "retention_until": (
                row.get("retention_until").isoformat()
                if isinstance(row.get("retention_until"), datetime)
                else row.get("retention_until")
            ),
            "immutable": bool(row.get("immutable")) if row.get("immutable") is not None else None,
            "legal_hold": bool(row.get("legal_hold")) if row.get("legal_hold") is not None else None,
            "metadata": row.get("metadata") if isinstance(row.get("metadata"), dict) else {},
            "created_at": (
                row.get("created_at").isoformat()
                if isinstance(row.get("created_at"), datetime)
                else row.get("created_at")
            ),
        }
        if include_presigned_urls:
            artifact["presigned_url"] = await storage.create_presigned_url(str(row.get("storage_path")))
        artifacts.append(artifact)

    bundle_payload = {
        "organization_id": organization_id,
        "generated_at": generated_at.isoformat(),
        "uio_ids": list(dict.fromkeys(uio_ids)),
        "requested_evidence_ids": list(dict.fromkeys(evidence_ids)),
        "artifact_count": len(artifacts),
        "artifacts": artifacts,
        "quoted_evidence": [
            {
                "unified_object_id": row.get("unified_object_id"),
                "source_type": row.get("source_type"),
                "conversation_id": row.get("conversation_id"),
                "message_id": row.get("message_id"),
                "quoted_text": row.get("quoted_text"),
                "quote_span": {
                    "start": row.get("quoted_text_start"),
                    "end": row.get("quoted_text_end"),
                    "segment_hash": row.get("segment_hash"),
                },
                "confidence": float(row.get("confidence") or 0.0),
            }
            for row in source_rows
        ],
        "custody_anchor": (
            {
                "root_date": custody_row.root_date.isoformat() if custody_row and custody_row.root_date else None,
                "merkle_root": custody_row.merkle_root if custody_row else None,
                "signed_root": custody_row.signed_root if custody_row else None,
                "signature_alg": custody_row.signature_alg if custody_row else None,
                "signature_key_id": custody_row.signature_key_id if custody_row else None,
            }
            if custody_row
            else None
        ),
    }
    payload_hash, signature, signature_alg, signature_key_id = _sign_export(
        export_type="evidence_bundle",
        organization_id=organization_id,
        generated_at=generated_at,
        payload=bundle_payload,
    )

    bundle_id = f"bundle_{payload_hash[:24]}"
    return {
        "bundle_id": bundle_id,
        "organization_id": organization_id,
        "generated_at": generated_at.isoformat(),
        "payload_hash": payload_hash,
        "signature": signature,
        "signature_alg": signature_alg,
        "signature_key_id": signature_key_id,
        "bundle": bundle_payload,
        "export_json": json.dumps(bundle_payload, sort_keys=True),
    }


def _extract_retention_metadata(metadata: dict[str, Any] | None) -> dict[str, Any]:
    metadata_map = metadata if isinstance(metadata, dict) else {}
    profile = metadata_map.get("trust_retention_profile")
    if not isinstance(profile, dict):
        profile = {}
    return {
        "default_legal_hold": bool(profile.get("default_legal_hold", False)),
        "require_legal_hold_reason": bool(profile.get("require_legal_hold_reason", True)),
    }


async def get_retention_profile(*, organization_id: str) -> dict[str, Any]:
    set_rls_context(organization_id, is_internal=True)
    try:
        async with get_db_session() as session:
            result = await session.execute(
                text(
                    """
                    SELECT
                        data_retention_days,
                        evidence_retention_days,
                        metadata,
                        updated_by_user_id,
                        updated_at
                    FROM agent_org_governance_policy
                    WHERE organization_id = :org_id
                    """
                ),
                {"org_id": organization_id},
            )
            row = result.fetchone()
    finally:
        set_rls_context(None, is_internal=False)

    if row is None:
        metadata = _extract_retention_metadata({})
        return {
            "organization_id": organization_id,
            "data_retention_days": 365,
            "evidence_retention_days": 3650,
            "default_legal_hold": metadata["default_legal_hold"],
            "require_legal_hold_reason": metadata["require_legal_hold_reason"],
            "updated_at": None,
            "updated_by_user_id": None,
        }

    row_dict = _row_to_dict(row)
    metadata = _extract_retention_metadata(row_dict.get("metadata"))
    return {
        "organization_id": organization_id,
        "data_retention_days": int(row_dict.get("data_retention_days") or 365),
        "evidence_retention_days": int(row_dict.get("evidence_retention_days") or 3650),
        "default_legal_hold": metadata["default_legal_hold"],
        "require_legal_hold_reason": metadata["require_legal_hold_reason"],
        "updated_at": (
            row_dict.get("updated_at").isoformat()
            if isinstance(row_dict.get("updated_at"), datetime)
            else row_dict.get("updated_at")
        ),
        "updated_by_user_id": row_dict.get("updated_by_user_id"),
    }


async def upsert_retention_profile(
    *,
    organization_id: str,
    data_retention_days: int,
    evidence_retention_days: int,
    default_legal_hold: bool,
    require_legal_hold_reason: bool,
    updated_by_user_id: str | None,
) -> dict[str, Any]:
    profile_metadata = {
        "default_legal_hold": bool(default_legal_hold),
        "require_legal_hold_reason": bool(require_legal_hold_reason),
    }
    now = _utc_now()

    set_rls_context(organization_id, is_internal=True)
    try:
        async with get_db_session() as session:
            existing_result = await session.execute(
                text(
                    """
                    SELECT metadata
                    FROM agent_org_governance_policy
                    WHERE organization_id = :org_id
                    """
                ),
                {"org_id": organization_id},
            )
            existing_row = existing_result.fetchone()
            existing_metadata = (
                _row_to_dict(existing_row).get("metadata") if existing_row else {}
            )
            metadata = existing_metadata if isinstance(existing_metadata, dict) else {}
            metadata["trust_retention_profile"] = profile_metadata

            await session.execute(
                text(
                    """
                    INSERT INTO agent_org_governance_policy (
                        organization_id,
                        data_retention_days,
                        evidence_retention_days,
                        metadata,
                        updated_by_user_id,
                        created_at,
                        updated_at
                    ) VALUES (
                        :org_id,
                        :data_retention_days,
                        :evidence_retention_days,
                        CAST(:metadata AS jsonb),
                        :updated_by_user_id,
                        :created_at,
                        :updated_at
                    )
                    ON CONFLICT (organization_id)
                    DO UPDATE SET
                        data_retention_days = EXCLUDED.data_retention_days,
                        evidence_retention_days = EXCLUDED.evidence_retention_days,
                        metadata = EXCLUDED.metadata,
                        updated_by_user_id = EXCLUDED.updated_by_user_id,
                        updated_at = EXCLUDED.updated_at
                    """
                ),
                {
                    "org_id": organization_id,
                    "data_retention_days": int(data_retention_days),
                    "evidence_retention_days": int(evidence_retention_days),
                    "metadata": json.dumps(metadata),
                    "updated_by_user_id": updated_by_user_id,
                    "created_at": now,
                    "updated_at": now,
                },
            )
            await session.commit()
    finally:
        set_rls_context(None, is_internal=False)

    return await get_retention_profile(organization_id=organization_id)


async def update_evidence_legal_hold(
    *,
    organization_id: str,
    evidence_artifact_ids: list[str],
    legal_hold: bool,
    reason: str | None,
    actor_id: str | None,
    retention_until: datetime | None = None,
) -> dict[str, Any]:
    artifact_ids = [item.strip() for item in evidence_artifact_ids if str(item).strip()]
    artifact_ids = list(dict.fromkeys(artifact_ids))
    if not artifact_ids:
        raise ValueError("No evidence artifact IDs provided")

    profile = await get_retention_profile(organization_id=organization_id)
    if legal_hold and profile.get("require_legal_hold_reason", True):
        if not reason or len(reason.strip()) < 8:
            raise ValueError("A reason of at least 8 characters is required for legal hold")

    set_rls_context(organization_id, is_internal=True)
    try:
        async with get_db_session() as session:
            current_result = await session.execute(
                text(
                    """
                    SELECT id, legal_hold, retention_until
                    FROM evidence_artifact
                    WHERE organization_id = :org_id
                      AND id = ANY(:artifact_ids)
                    """
                ),
                {"org_id": organization_id, "artifact_ids": artifact_ids},
            )
            current_rows = [_row_to_dict(row) for row in current_result.fetchall()]
            found_ids = [str(row.get("id")) for row in current_rows]

            await session.execute(
                text(
                    """
                    UPDATE evidence_artifact
                    SET legal_hold = :legal_hold,
                        retention_until = COALESCE(:retention_until, retention_until)
                    WHERE organization_id = :org_id
                      AND id = ANY(:artifact_ids)
                    """
                ),
                {
                    "org_id": organization_id,
                    "artifact_ids": found_ids,
                    "legal_hold": legal_hold,
                    "retention_until": retention_until,
                },
            )
            await session.commit()
    finally:
        set_rls_context(None, is_internal=False)

    action = "legal_hold_enabled" if legal_hold else "legal_hold_released"
    reason_code = "legal_hold_manual"
    for artifact_id in found_ids:
        await record_evidence_audit(
            artifact_id=artifact_id,
            organization_id=organization_id,
            action=action,
            reason_code=reason_code,
            actor_type="user",
            actor_id=actor_id,
            metadata={
                "reason": reason,
                "retention_until": retention_until.isoformat() if retention_until else None,
            },
        )

    missing_ids = sorted(set(artifact_ids) - set(found_ids))
    return {
        "organization_id": organization_id,
        "legal_hold": legal_hold,
        "updated_count": len(found_ids),
        "updated_artifact_ids": found_ids,
        "missing_artifact_ids": missing_ids,
        "reason": reason,
        "retention_until": retention_until.isoformat() if retention_until else None,
    }
