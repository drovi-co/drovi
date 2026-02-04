"""
Signal Candidate Processor

Processes fast extraction candidates into memory objects.
This is a lightweight worker loop stub to support async processing.
"""

from datetime import datetime, timezone
import json
import re

import structlog
from sqlalchemy import text

from src.db.client import get_db_session
from src.db.rls import rls_context
from src.ingestion.unified_event import build_segment_hash
from src.identity import get_identity_graph
from src.identity.types import IdentityType
from src.uio.manager import UIOManager
from src.monitoring import get_metrics
from src.uio.schemas import (
    ClaimDetailsCreate,
    CommitmentDetailsCreate,
    CreateClaimUIO,
    CreateCommitmentUIO,
    CreateDecisionUIO,
    CreateRiskUIO,
    CreateTaskUIO,
    DecisionDetailsCreate,
    RiskDetailsCreate,
    SourceContext,
    TaskDetailsCreate,
    UIOCreate,
    UIOStatus,
    UIOType,
    ClaimType,
    ClaimImportance,
    CommitmentDirection,
    CommitmentPriority,
    CommitmentStatus,
    DecisionStatus,
    TaskStatus,
    TaskPriority,
    RiskSeverity,
    RiskType,
)

logger = structlog.get_logger()


def _parse_datetime(value):
    if not value:
        return None
    if isinstance(value, datetime):
        return value
    try:
        return datetime.fromisoformat(value)
    except Exception:
        return None


def _normalize_text(value: str | None) -> str:
    if not value:
        return ""
    cleaned = value.strip().lower()
    cleaned = re.sub(r"\s+", " ", cleaned)
    cleaned = re.sub(r"[^\w\s\-]", "", cleaned)
    return cleaned


def _tokenize(value: str | None) -> set[str]:
    normalized = _normalize_text(value)
    if not normalized:
        return set()
    return set(normalized.split())


def _similarity(a_tokens: set[str], b_tokens: set[str]) -> float:
    if not a_tokens or not b_tokens:
        return 0.0
    return len(a_tokens & b_tokens) / max(len(a_tokens), len(b_tokens))


def _evidence_strength(candidate: dict) -> float:
    text = (candidate.get("evidence_text") or "").strip()
    if not text:
        return 0.0
    length_score = min(len(text) / 200.0, 1.0)
    return length_score


def _candidate_sort_key(candidate: dict) -> tuple[float, float, datetime]:
    return (
        _evidence_strength(candidate),
        candidate.get("confidence") or 0.0,
        candidate.get("created_at") or datetime.min,
    )


def _apply_cluster_confidence(primary: dict, cluster: list[dict]) -> None:
    base_confidence = primary.get("confidence") or 0.5
    evidence_count = sum(1 for item in cluster if _evidence_strength(item) > 0.0)
    boost = 0.05 * max(0, len(cluster) - 1) + 0.03 * max(0, evidence_count - 1)
    primary["confidence"] = min(1.0, base_confidence + boost)


async def _resolve_contact_id(org_id: str, email: str | None) -> str | None:
    if not email:
        return None
    identity_graph = await get_identity_graph()
    resolution = await identity_graph.resolve_identifier(
        identifier_type=IdentityType.EMAIL,
        identifier_value=email.lower(),
        organization_id=org_id,
        create_if_missing=True,
    )
    return resolution.contact_id if resolution else None


async def _build_source_context(candidate: dict) -> SourceContext:
    quoted_text = candidate.get("evidence_text")
    return SourceContext(
        source_type=candidate.get("source_type") or "api",
        source_account_id=None,
        conversation_id=candidate.get("conversation_id"),
        message_id=candidate.get("source_message_id"),
        quoted_text=quoted_text,
        segment_hash=build_segment_hash(quoted_text) if quoted_text else None,
        confidence=candidate.get("confidence") or 0.5,
    )


async def _create_uio_from_candidate(candidate: dict) -> str | None:
    org_id = candidate["organization_id"]
    manager = UIOManager(org_id)
    payload = candidate.get("raw_payload") or {}
    if isinstance(payload, str):
        try:
            payload = json.loads(payload)
        except Exception:
            payload = {}
    candidate_type = candidate["candidate_type"]

    base = UIOCreate(
        organization_id=org_id,
        type=UIOType(candidate_type),
        canonical_title=candidate.get("title") or payload.get("title") or payload.get("content") or "Untitled",
        canonical_description=candidate.get("content"),
        due_date=_parse_datetime(payload.get("due_date")),
        due_date_confidence=payload.get("due_date_confidence"),
        owner_contact_id=None,
        participant_contact_ids=[],
        overall_confidence=candidate.get("confidence") or 0.5,
        is_user_verified=False,
        is_user_dismissed=False,
        status=UIOStatus.ACTIVE,
        first_seen_at=datetime.now(timezone.utc),
        last_updated_at=datetime.now(timezone.utc),
    )

    source = await _build_source_context(candidate)

    if candidate_type == "claim":
        claim_type = ClaimType(payload.get("type", "fact"))
        importance = ClaimImportance(payload.get("importance", "medium"))
        details = ClaimDetailsCreate(
            claim_type=claim_type,
            quoted_text=payload.get("quoted_text"),
            normalized_text=payload.get("content"),
            importance=importance,
            source_message_index=payload.get("source_message_id"),
        )
        return await manager.create_claim_uio(CreateClaimUIO(base=base, details=details, source=source))

    if candidate_type == "commitment":
        debtor_id = await _resolve_contact_id(org_id, payload.get("debtor_email"))
        creditor_id = await _resolve_contact_id(org_id, payload.get("creditor_email"))
        direction = CommitmentDirection(payload.get("direction", "owed_by_me"))
        priority = CommitmentPriority(payload.get("priority", "medium"))
        details = CommitmentDetailsCreate(
            direction=direction,
            debtor_contact_id=debtor_id,
            creditor_contact_id=creditor_id,
            due_date_source="explicit" if payload.get("due_date_is_explicit") else "inferred",
            due_date_original_text=payload.get("due_date_text"),
            priority=priority,
            status=CommitmentStatus.PENDING,
            is_conditional=payload.get("is_conditional", False),
            condition=payload.get("condition"),
            extraction_context=None,
        )
        return await manager.create_commitment_uio(CreateCommitmentUIO(base=base, details=details, source=source))

    if candidate_type == "decision":
        decision_maker_id = await _resolve_contact_id(org_id, payload.get("decision_maker_email"))
        details = DecisionDetailsCreate(
            statement=payload.get("statement") or payload.get("title") or "",
            rationale=payload.get("rationale"),
            alternatives=payload.get("alternatives") or [],
            decision_maker_contact_id=decision_maker_id,
            stakeholder_contact_ids=[],
            impact_areas=payload.get("implications") or [],
            status=DecisionStatus(payload.get("status", "made")),
            decided_at=_parse_datetime(payload.get("decided_at")),
            supersedes_uio_id=payload.get("supersedes_uio_id"),
            superseded_by_uio_id=payload.get("superseded_by_uio_id"),
            extraction_context=None,
        )
        return await manager.create_decision_uio(CreateDecisionUIO(base=base, details=details, source=source))

    if candidate_type == "task":
        assignee_id = await _resolve_contact_id(org_id, payload.get("assignee_email"))
        creator_id = await _resolve_contact_id(org_id, payload.get("created_by_email"))
        details = TaskDetailsCreate(
            status=TaskStatus(payload.get("status", "todo")),
            priority=TaskPriority(payload.get("priority", "medium")),
            assignee_contact_id=assignee_id,
            created_by_contact_id=creator_id,
            estimated_effort=payload.get("estimated_effort"),
            project=payload.get("project"),
            tags=payload.get("tags") or [],
        )
        return await manager.create_task_uio(CreateTaskUIO(base=base, details=details, source=source))

    if candidate_type == "risk":
        severity = RiskSeverity(payload.get("severity", "medium"))
        risk_type = RiskType(payload.get("type", "other"))
        details = RiskDetailsCreate(
            risk_type=risk_type,
            severity=severity,
            suggested_action=payload.get("suggested_action"),
            findings=None,
            extraction_context=None,
        )
        return await manager.create_risk_uio(CreateRiskUIO(base=base, details=details, source=source))

    return None


async def process_signal_candidates(limit: int = 200) -> dict[str, int]:
    """Process new signal candidates into UIOs."""
    processed = 0
    failed = 0
    merged = 0
    metrics = get_metrics()

    with rls_context(None, True):
        async with get_db_session() as session:
            result = await session.execute(
                text(
                    """
                    SELECT id, organization_id, candidate_type, title, content,
                           evidence_text, confidence, conversation_id, source_type,
                           source_id, source_message_id, raw_payload, created_at
                    FROM signal_candidate
                    WHERE status = 'new'
                    ORDER BY created_at ASC
                    LIMIT :limit
                    FOR UPDATE SKIP LOCKED
                    """
                ),
                {"limit": limit},
            )
            rows = result.fetchall()

            if not rows:
                return {"processed": 0, "failed": 0}

            now = datetime.now(timezone.utc)
            ids = [row.id for row in rows]
            await session.execute(
                text(
                    """
                    UPDATE signal_candidate
                    SET status = 'processing',
                        processing_started_at = :now,
                        updated_at = :now
                    WHERE id = ANY(:ids)
                    """
                ),
                {"now": now, "ids": ids},
            )

    buckets: dict[tuple[str, str, str], list[dict]] = {}
    for row in rows:
        candidate = dict(row._mapping)
        conv_key = candidate.get("conversation_id") or ""
        bucket_key = (candidate["organization_id"], candidate["candidate_type"], conv_key)
        buckets.setdefault(bucket_key, []).append(candidate)

    clusters: list[list[dict]] = []
    for bucket in buckets.values():
        bucket_clusters: list[dict] = []
        for candidate in bucket:
            tokens = _tokenize(candidate.get("title")) | _tokenize(candidate.get("content")) | _tokenize(candidate.get("evidence_text"))
            assigned = False
            for cluster in bucket_clusters:
                similarity = _similarity(tokens, cluster["tokens"])
                time_ok = True
                if candidate.get("created_at") and cluster.get("last_seen"):
                    delta = abs((candidate["created_at"] - cluster["last_seen"]).total_seconds())
                    time_ok = delta <= 24 * 3600
                if similarity >= 0.7 and time_ok:
                    cluster["candidates"].append(candidate)
                    cluster["tokens"] = cluster["tokens"] | tokens
                    if candidate.get("created_at"):
                        cluster["last_seen"] = max(cluster["last_seen"], candidate["created_at"])
                    assigned = True
                    break
            if not assigned:
                bucket_clusters.append(
                    {
                        "tokens": tokens,
                        "candidates": [candidate],
                        "last_seen": candidate.get("created_at") or datetime.min,
                    }
                )
        clusters.extend([c["candidates"] for c in bucket_clusters])

    for cluster in clusters:
        cluster_sorted = sorted(cluster, key=_candidate_sort_key, reverse=True)
        primary = cluster_sorted[0]
        if len(cluster_sorted) > 1:
            _apply_cluster_confidence(primary, cluster_sorted)
        org_id = primary["organization_id"]

        try:
            with rls_context(org_id, False):
                created_id = await _create_uio_from_candidate(primary)

            processed_at = datetime.now(timezone.utc)
            with rls_context(None, True):
                async with get_db_session() as session:
                    await session.execute(
                        text(
                            """
                            UPDATE signal_candidate
                            SET status = :status,
                                processed_at = :processed_at,
                                updated_at = :updated_at,
                                processing_error = NULL,
                                uio_id = :uio_id
                            WHERE id = :id
                            """
                        ),
                        {
                            "status": "processed" if created_id else "skipped",
                            "processed_at": processed_at,
                            "updated_at": processed_at,
                            "uio_id": created_id,
                            "id": primary["id"],
                        },
                    )

                    merged_count = 0
                    if created_id and len(cluster_sorted) > 1:
                        merged_ids = [c["id"] for c in cluster_sorted[1:]]
                        await session.execute(
                            text(
                                """
                                UPDATE signal_candidate
                                SET status = 'merged',
                                    processed_at = :processed_at,
                                    updated_at = :updated_at,
                                    processing_error = NULL,
                                    uio_id = :uio_id
                                WHERE id = ANY(:ids)
                                """
                            ),
                            {
                                "processed_at": processed_at,
                                "updated_at": processed_at,
                                "uio_id": created_id,
                                "ids": merged_ids,
                            },
                        )
                        merged_count = len(merged_ids)
                        merged += merged_count

            if created_id:
                processed += 1
                if metrics.enabled:
                    metrics.uem_events_total.labels(
                        organization_id=org_id,
                        source_type="candidate",
                        event_type="candidate_processed",
                        status="processed",
                    ).inc()
                    if merged_count:
                        metrics.uem_events_total.labels(
                            organization_id=org_id,
                            source_type="candidate",
                            event_type="candidate_processed",
                            status="merged",
                        ).inc(merged_count)
        except Exception as exc:
            failed += 1
            logger.error("Candidate processing failed", error=str(exc), candidate_id=primary["id"])
            with rls_context(None, True):
                async with get_db_session() as session:
                    await session.execute(
                        text(
                            """
                            UPDATE signal_candidate
                            SET status = 'failed',
                                processed_at = :processed_at,
                                updated_at = :updated_at,
                                processing_error = :error
                            WHERE id = :id
                            """
                        ),
                        {
                            "processed_at": datetime.now(timezone.utc),
                            "updated_at": datetime.now(timezone.utc),
                            "error": str(exc),
                            "id": primary["id"],
                        },
                    )
            if metrics.enabled:
                metrics.uem_events_total.labels(
                    organization_id=org_id,
                    source_type="candidate",
                    event_type="candidate_processed",
                    status="failed",
                ).inc()

    logger.info(
        "Processed signal candidates",
        processed=processed,
        merged=merged,
        failed=failed,
    )
    return {"processed": processed, "merged": merged, "failed": failed}


async def process_signal_candidate_by_id(
    candidate_id: str,
    organization_id: str | None = None,
    confirmed_by: str | None = None,
) -> dict[str, str | None]:
    """Process a single signal candidate by ID (e.g., decision radar confirmation)."""
    metrics = get_metrics()

    with rls_context(None, True):
        async with get_db_session() as session:
            result = await session.execute(
                text(
                    """
                    SELECT id, organization_id, candidate_type, title, content,
                           evidence_text, confidence, conversation_id, source_type,
                           source_id, source_message_id, raw_payload, created_at, status, uio_id
                    FROM signal_candidate
                    WHERE id = :id
                    """
                ),
                {"id": candidate_id},
            )
            row = result.fetchone()
            if not row:
                return {"status": "not_found", "uio_id": None}
            if organization_id and row.organization_id != organization_id:
                return {"status": "forbidden", "uio_id": None}
            if row.status in {"processed", "merged"}:
                return {"status": row.status, "uio_id": row.uio_id}

            now = datetime.now(timezone.utc)
            confirmation_meta = {}
            if confirmed_by:
                confirmation_meta = {
                    "confirmed_by": confirmed_by,
                    "confirmed_at": now.isoformat(),
                }

            await session.execute(
                text(
                    """
                    UPDATE signal_candidate
                    SET status = 'processing',
                        processing_started_at = :now,
                        updated_at = :now,
                        raw_payload = raw_payload || :meta::jsonb
                    WHERE id = :id
                    """
                ),
                {"now": now, "id": candidate_id, "meta": json.dumps(confirmation_meta)},
            )

    candidate = dict(row._mapping)

    try:
        with rls_context(candidate["organization_id"], False):
            created_id = await _create_uio_from_candidate(candidate)

        processed_at = datetime.now(timezone.utc)
        with rls_context(None, True):
            async with get_db_session() as session:
                await session.execute(
                    text(
                        """
                        UPDATE signal_candidate
                        SET status = :status,
                            processed_at = :processed_at,
                            updated_at = :updated_at,
                            processing_error = NULL,
                            uio_id = :uio_id
                        WHERE id = :id
                        """
                    ),
                    {
                        "status": "processed" if created_id else "skipped",
                        "processed_at": processed_at,
                        "updated_at": processed_at,
                        "uio_id": created_id,
                        "id": candidate_id,
                    },
                )

        if created_id and metrics.enabled:
            metrics.uem_events_total.labels(
                organization_id=candidate["organization_id"],
                source_type="candidate",
                event_type="candidate_processed",
                status="processed",
            ).inc()

        return {"status": "processed" if created_id else "skipped", "uio_id": created_id}
    except Exception as exc:
        with rls_context(None, True):
            async with get_db_session() as session:
                await session.execute(
                    text(
                        """
                        UPDATE signal_candidate
                        SET status = 'failed',
                            processed_at = :processed_at,
                            updated_at = :updated_at,
                            processing_error = :error
                        WHERE id = :id
                        """
                    ),
                    {
                        "processed_at": datetime.now(timezone.utc),
                        "updated_at": datetime.now(timezone.utc),
                        "error": str(exc),
                        "id": candidate_id,
                    },
                )
        logger.error("Candidate processing failed", error=str(exc), candidate_id=candidate_id)
        return {"status": "failed", "uio_id": None}
