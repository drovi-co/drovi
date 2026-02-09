"""
Evidence API Route

Fetch source evidence with snippet vs full modes.
Evidence links UIOs back to their original source (email, slack, etc.).

Performance target: < 100ms p95 for snippet mode, < 200ms p95 for full mode
"""

import base64
import json
import time
from datetime import datetime, timedelta
from uuid import uuid4
from typing import Literal

import structlog
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from prometheus_client import Counter, Histogram

from src.auth.middleware import APIKeyContext, require_scope_with_rate_limit
from src.auth.scopes import Scope
from src.evidence.chain import compute_chain_entry
from src.evidence.storage import get_evidence_storage
from src.evidence.audit import record_evidence_audit
from src.ingestion.reality_events import persist_reality_event
from src.config import get_settings

logger = structlog.get_logger()

router = APIRouter(prefix="/evidence", tags=["evidence"])

# Prometheus metrics
EVIDENCE_LATENCY = Histogram(
    "drovi_evidence_latency_seconds",
    "Evidence endpoint latency",
    ["org_id", "mode"],
    buckets=[0.05, 0.1, 0.15, 0.2, 0.3, 0.5, 1.0],
)
EVIDENCE_REQUESTS = Counter(
    "drovi_evidence_requests_total",
    "Total evidence requests",
    ["org_id", "mode"],
)


# =============================================================================
# Response Models
# =============================================================================


class ContactInfo(BaseModel):
    """Contact information."""

    name: str | None = None
    email: str | None = None


class ThreadMessage(BaseModel):
    """Message in thread context."""

    sender: str
    snippet: str
    sent_at: datetime


class RelatedUIO(BaseModel):
    """Related UIO reference."""

    id: str
    type: str
    title: str


class EvidenceSnippetResponse(BaseModel):
    """Snippet mode response (< 1KB)."""

    id: str
    source_type: Literal[
        "email",
        "slack",
        "calendar",
        "meeting",
        "call",
        "recording",
        "document",
        "manual",
    ]
    source_id: str | None = None
    sender: ContactInfo | None = None
    recipients: list[ContactInfo] = Field(default_factory=list)
    subject: str | None = None
    sent_at: datetime | None = None
    snippet: str
    deep_link: str | None = None
    has_thread: bool = False
    thread_message_count: int = 0


class EvidenceFullResponse(EvidenceSnippetResponse):
    """Full mode response with thread context."""

    full_content: str | None = None
    thread_context: list[ThreadMessage] = Field(default_factory=list)
    related_uios: list[RelatedUIO] = Field(default_factory=list)


class EvidenceArtifactResponse(BaseModel):
    """Evidence artifact metadata + optional presigned URL."""

    id: str
    artifact_type: str
    mime_type: str | None = None
    storage_backend: str
    storage_path: str
    storage_uri: str | None = None
    byte_size: int | None = None
    sha256: str | None = None
    created_at: datetime
    chain_id: str | None = None
    chain_sequence: int | None = None
    chain_prev_hash: str | None = None
    chain_hash: str | None = None
    retention_until: datetime | None = None
    immutable: bool | None = None
    legal_hold: bool | None = None
    metadata: dict | None = None
    presigned_url: str | None = None


class EvidenceArtifactCreate(BaseModel):
    organization_id: str
    artifact_type: str
    mime_type: str | None = None
    content_base64: str
    source_type: str | None = None
    source_id: str | None = None
    session_id: str | None = None
    metadata: dict | None = None
    retention_days: int | None = None
    immutable: bool | None = None
    legal_hold: bool | None = None


class EvidenceArtifactIngest(EvidenceArtifactCreate):
    event_type: str
    content_text: str | None = None
    content_json: dict | list | None = None
    participants: list[dict] | None = None
    captured_at: datetime | None = None


# =============================================================================
# Helpers
# =============================================================================


def _validate_org_id(ctx: APIKeyContext, organization_id: str) -> None:
    """Validate organization_id matches auth context."""
    if ctx.organization_id != "internal" and organization_id != ctx.organization_id:
        raise HTTPException(
            status_code=403,
            detail="Organization ID mismatch with authenticated key",
        )


def _truncate_snippet(text: str | None, max_length: int = 200) -> str:
    """Truncate text to snippet length."""
    if not text:
        return ""
    if len(text) <= max_length:
        return text
    return text[:max_length - 3] + "..."


async def _fetch_unified_event(
    session,
    organization_id: str,
    conversation_id: str | None,
    message_id: str | None,
):
    """Fetch a unified event row for fallback evidence lookup."""
    if not conversation_id:
        return None

    from sqlalchemy import text

    query = """
        SELECT content_text, content_json, metadata, captured_at, received_at
        FROM unified_event
        WHERE organization_id = :org_id
          AND conversation_id = :conversation_id
    """
    params = {"org_id": organization_id, "conversation_id": conversation_id}
    if message_id:
        query += " AND message_id = :message_id"
        params["message_id"] = message_id
    query += " ORDER BY received_at DESC LIMIT 1"

    result = await session.execute(text(query), params)
    return result.fetchone()


# =============================================================================
# Endpoints
# =============================================================================


@router.get("/{evidence_id}")
async def get_evidence(
    evidence_id: str,
    organization_id: str,
    mode: Literal["snippet", "full"] = Query(default="snippet"),
    ctx: APIKeyContext = Depends(require_scope_with_rate_limit(Scope.READ)),
):
    """
    Get source evidence by ID.

    Args:
        evidence_id: Evidence ID (unified_object_source.id)
        organization_id: Organization ID
        mode: Response mode
            - snippet: Fast, minimal response (< 1KB)
            - full: Full content with thread context

    Returns:
        EvidenceSnippetResponse or EvidenceFullResponse

    Requires `read` scope.
    """
    start_time = time.time()

    _validate_org_id(ctx, organization_id)

    # Track metrics
    EVIDENCE_REQUESTS.labels(org_id=organization_id, mode=mode).inc()

    from src.db.client import get_db_session
    from sqlalchemy import text

    try:
        async with get_db_session() as session:
            # Get evidence record
            result = await session.execute(
                text("""
                    SELECT
                        s.id,
                        s.source_type,
                        s.source_account_id,
                        s.conversation_id,
                        s.message_id,
                        s.quoted_text,
                        s.source_timestamp,
                        s.unified_object_id,
                        u.organization_id
                    FROM unified_object_source s
                    JOIN unified_intelligence_object u ON u.id = s.unified_object_id
                    WHERE s.id = :evidence_id
                """),
                {"evidence_id": evidence_id},
            )
            row = result.fetchone()

            if not row:
                raise HTTPException(status_code=404, detail="Evidence not found")

            # Validate org access
            if row.organization_id != organization_id:
                raise HTTPException(status_code=403, detail="Access denied")

            # Enforce private-source visibility boundaries.
            from src.auth.private_sources import require_uio_visible

            await require_uio_visible(
                organization_id=organization_id,
                uio_id=str(row.unified_object_id),
                ctx=ctx,
                not_found_as_404=True,
            )

            # Build base response
            snippet = _truncate_snippet(row.quoted_text)
            sent_at = row.source_timestamp

            # Try to get additional source info (message content, sender, etc.)
            # This would vary by source type
            sender = None
            recipients: list[ContactInfo] = []
            subject = None
            deep_link = None
            has_thread = False
            thread_message_count = 0
            full_content = None
            thread_context: list[ThreadMessage] = []
            related_uios: list[RelatedUIO] = []

            # Try to get message info for email/slack
            if row.source_type == "email" and row.message_id:
                # Query message table if exists
                try:
                    msg_result = await session.execute(
                        text("""
                            SELECT
                                m.subject,
                                m.from_email,
                                m.from_name,
                                m.to_emails,
                                m.body_text,
                                m.sent_at,
                                m.thread_id,
                                a.email as account_email
                            FROM messages m
                            LEFT JOIN source_accounts a ON a.id = m.source_account_id
                            WHERE m.id = :message_id
                        """),
                        {"message_id": row.message_id},
                    )
                    msg_row = msg_result.fetchone()

                    if msg_row:
                        sender = ContactInfo(
                            name=msg_row.from_name,
                            email=msg_row.from_email,
                        )
                        subject = msg_row.subject
                        full_content = msg_row.body_text

                        # Parse recipients
                        if msg_row.to_emails:
                            for email in msg_row.to_emails[:5]:  # Limit to 5
                                recipients.append(ContactInfo(email=email))

                        # Build deep link for Gmail
                        if msg_row.account_email:
                            deep_link = f"https://mail.google.com/mail/u/0/#inbox/{row.message_id}"

                        # Check thread
                        if msg_row.thread_id:
                            has_thread = True
                            # Count thread messages
                            thread_count_result = await session.execute(
                                text("""
                                    SELECT COUNT(*) as count
                                    FROM messages
                                    WHERE thread_id = :thread_id
                                """),
                                {"thread_id": msg_row.thread_id},
                            )
                            thread_count_row = thread_count_result.fetchone()
                            thread_message_count = thread_count_row.count if thread_count_row else 1

                            # Get thread context for full mode
                            if mode == "full":
                                thread_result = await session.execute(
                                    text("""
                                        SELECT
                                            from_name,
                                            body_text,
                                            sent_at
                                        FROM messages
                                        WHERE thread_id = :thread_id
                                        ORDER BY sent_at ASC
                                        LIMIT 10
                                    """),
                                    {"thread_id": msg_row.thread_id},
                                )
                                for t_row in thread_result.fetchall():
                                    thread_context.append(
                                        ThreadMessage(
                                            sender=t_row.from_name or "Unknown",
                                            snippet=_truncate_snippet(t_row.body_text, 150),
                                            sent_at=t_row.sent_at,
                                        )
                                    )

                except Exception as e:
                    logger.debug("Could not fetch message details", error=str(e))

            elif row.source_type == "slack" and row.message_id:
                # Query slack messages if exists
                try:
                    msg_result = await session.execute(
                        text("""
                            SELECT
                                sm.text,
                                sm.user_name,
                                sm.channel_name,
                                sm.ts,
                                sm.thread_ts
                            FROM slack_messages sm
                            WHERE sm.id = :message_id
                        """),
                        {"message_id": row.message_id},
                    )
                    msg_row = msg_result.fetchone()

                    if msg_row:
                        sender = ContactInfo(name=msg_row.user_name)
                        subject = f"#{msg_row.channel_name}"
                        full_content = msg_row.text

                        # Check thread
                        if msg_row.thread_ts:
                            has_thread = True

                except Exception as e:
                    logger.debug("Could not fetch slack message details", error=str(e))

            # Fallback to unified_event when source tables are missing
            if full_content is None:
                uem_row = await _fetch_unified_event(
                    session,
                    organization_id,
                    row.conversation_id,
                    row.message_id,
                )
                if uem_row:
                    content_json = uem_row.content_json or {}
                    metadata = uem_row.metadata or {}
                    if not sender:
                        sender = ContactInfo(
                            name=content_json.get("sender_name"),
                            email=content_json.get("sender_email"),
                        )
                    if not subject:
                        subject = metadata.get("subject") or content_json.get("subject")
                    if mode == "full":
                        full_content = uem_row.content_text
                    if not snippet:
                        snippet = _truncate_snippet(uem_row.content_text)
                    if not sent_at:
                        sent_at = uem_row.captured_at or uem_row.received_at

            # Get related UIOs for full mode
            if mode == "full":
                try:
                    related_result = await session.execute(
                        text("""
                            SELECT
                                u.id,
                                u.type,
                                u.canonical_title
                            FROM unified_intelligence_object u
                            JOIN unified_object_source s ON s.unified_object_id = u.id
                            WHERE s.conversation_id = :conversation_id
                            AND u.organization_id = :org_id
                            AND u.id != :current_uio_id
                            LIMIT 5
                        """),
                        {
                            "conversation_id": row.conversation_id,
                            "org_id": organization_id,
                            "current_uio_id": row.unified_object_id,
                        },
                    )
                    for rel_row in related_result.fetchall():
                        related_uios.append(
                            RelatedUIO(
                                id=rel_row.id,
                                type=rel_row.type,
                                title=rel_row.canonical_title or "Untitled",
                            )
                        )
                except Exception as e:
                    logger.debug("Could not fetch related UIOs", error=str(e))

            # Record latency
            latency = time.time() - start_time
            EVIDENCE_LATENCY.labels(org_id=organization_id, mode=mode).observe(latency)

            logger.info(
                "Evidence fetched",
                evidence_id=evidence_id,
                mode=mode,
                source_type=row.source_type,
                latency_ms=latency * 1000,
            )

            # Return appropriate response
            if mode == "full":
                return EvidenceFullResponse(
                    id=row.id,
                    source_type=row.source_type,
                    source_id=row.message_id,
                    sender=sender,
                    recipients=recipients,
                    subject=subject,
                    sent_at=sent_at,
                    snippet=snippet or row.quoted_text or "",
                    deep_link=deep_link,
                    has_thread=has_thread,
                    thread_message_count=thread_message_count,
                    full_content=full_content,
                    thread_context=thread_context,
                    related_uios=related_uios,
                )

            return EvidenceSnippetResponse(
                id=row.id,
                source_type=row.source_type,
                source_id=row.message_id,
                sender=sender,
                recipients=recipients,
                subject=subject,
                sent_at=sent_at,
                snippet=snippet or row.quoted_text or "",
                deep_link=deep_link,
                has_thread=has_thread,
                thread_message_count=thread_message_count,
            )

    except HTTPException:
        raise
    except Exception as e:
        logger.error(
            "Failed to fetch evidence",
            evidence_id=evidence_id,
            error=str(e),
        )
        raise HTTPException(status_code=500, detail="Failed to fetch evidence")


@router.get("/artifacts/{artifact_id}", response_model=EvidenceArtifactResponse)
async def get_evidence_artifact(
    artifact_id: str,
    organization_id: str,
    include_url: bool = Query(default=True),
    ctx: APIKeyContext = Depends(require_scope_with_rate_limit(Scope.READ)),
):
    """Fetch evidence artifact metadata and optional presigned URL."""
    _validate_org_id(ctx, organization_id)

    from src.db.client import get_db_session
    from sqlalchemy import text

    async with get_db_session() as session:
        result = await session.execute(
            text(
                """
                SELECT id, artifact_type, mime_type,
                       storage_backend, storage_path, byte_size, sha256,
                       metadata, created_at, retention_until, immutable, legal_hold
                FROM evidence_artifact
                WHERE id = :artifact_id AND organization_id = :org_id
                """
            ),
            {"artifact_id": artifact_id, "org_id": organization_id},
        )
        row = result.fetchone()

        if not row:
            raise HTTPException(status_code=404, detail="Evidence artifact not found")

        metadata = row.metadata or {}
        storage_uri = metadata.get("storage_uri")
        if not storage_uri:
            if row.storage_backend == "s3":
                settings = get_settings()
                bucket = settings.evidence_s3_bucket or ""
                storage_uri = f"s3://{bucket}/{row.storage_path}" if bucket else f"s3://{row.storage_path}"
            else:
                storage_uri = f"file://{row.storage_path}"

        presigned_url = None
        if include_url:
            storage = get_evidence_storage()
            presigned_url = await storage.create_presigned_url(row.storage_path)
            if presigned_url:
                await record_evidence_audit(
                    artifact_id=artifact_id,
                    organization_id=organization_id,
                    action="presigned_url",
                    actor_type="system",
                )

        return EvidenceArtifactResponse(
            id=row.id,
            artifact_type=row.artifact_type,
            mime_type=row.mime_type,
            storage_backend=row.storage_backend,
            storage_path=row.storage_path,
            storage_uri=storage_uri,
            byte_size=row.byte_size,
            sha256=row.sha256,
            created_at=row.created_at,
            chain_id=getattr(row, "chain_id", None),
            chain_sequence=getattr(row, "chain_sequence", None),
            chain_prev_hash=getattr(row, "chain_prev_hash", None),
            chain_hash=getattr(row, "chain_hash", None),
            retention_until=row.retention_until,
            immutable=row.immutable,
            legal_hold=row.legal_hold,
            metadata=metadata,
            presigned_url=presigned_url,
        )


@router.post("/artifacts", response_model=EvidenceArtifactResponse)
async def create_evidence_artifact(
    payload: EvidenceArtifactCreate,
    ctx: APIKeyContext = Depends(require_scope_with_rate_limit(Scope.WRITE)),
):
    """Create evidence artifact from base64 payload."""
    _validate_org_id(ctx, payload.organization_id)
    settings = get_settings()

    try:
        raw_bytes = base64.b64decode(payload.content_base64)
    except Exception as exc:
        raise HTTPException(status_code=400, detail="Invalid base64 payload") from exc

    artifact_id = f"evd_{uuid4().hex}"
    retention_days = payload.retention_days or settings.evidence_default_retention_days
    retention_until = None
    if retention_days:
        retention_until = datetime.utcnow() + timedelta(days=retention_days)

    immutable = payload.immutable if payload.immutable is not None else settings.evidence_immutable_by_default
    legal_hold = payload.legal_hold if payload.legal_hold is not None else settings.evidence_legal_hold_by_default

    storage = get_evidence_storage()
    stored = await storage.write_bytes(
        artifact_id=artifact_id,
        data=raw_bytes,
        extension="",
        organization_id=payload.organization_id,
        retention_until=retention_until,
        immutable=immutable,
    )

    from src.db.client import get_db_session
    from sqlalchemy import text

    created_at = datetime.utcnow()
    metadata = payload.metadata or {}
    metadata.setdefault("storage_backend", stored.storage_backend)
    metadata.setdefault("storage_path", stored.storage_path)
    metadata.setdefault("sha256", stored.sha256)
    metadata.setdefault("created_at", created_at.isoformat())

    async with get_db_session() as session:
        chain = await compute_chain_entry(
            session=session,
            organization_id=payload.organization_id,
            artifact_id=artifact_id,
            artifact_sha256=stored.sha256,
            created_at=created_at,
            metadata=metadata,
        )
        chain.pop("metadata_json", None)

        await session.execute(
            text(
                """
                INSERT INTO evidence_artifact (
                    id, organization_id, session_id, source_type, source_id,
                    artifact_type, mime_type, storage_backend, storage_path,
                    byte_size, sha256, metadata, created_at,
                    retention_until, immutable, legal_hold,
                    chain_id, chain_sequence, chain_prev_hash, chain_hash
                ) VALUES (
                    :id, :org_id, :session_id, :source_type, :source_id,
                    :artifact_type, :mime_type, :storage_backend, :storage_path,
                    :byte_size, :sha256, CAST(:metadata AS jsonb), :created_at,
                    :retention_until, :immutable, :legal_hold,
                    :chain_id, :chain_sequence, :chain_prev_hash, :chain_hash
                )
                """
            ),
            {
                "id": artifact_id,
                "org_id": payload.organization_id,
                "session_id": payload.session_id,
                "source_type": payload.source_type,
                "source_id": payload.source_id,
                "artifact_type": payload.artifact_type,
                "mime_type": payload.mime_type,
                "storage_backend": stored.storage_backend,
                "storage_path": stored.storage_path,
                "byte_size": stored.byte_size,
                "sha256": stored.sha256,
                # evidence_artifact.metadata is JSONB. Serialize explicitly for raw SQL.
                "metadata": json.dumps(metadata),
                "created_at": created_at,
                "retention_until": retention_until,
                "immutable": immutable,
                "legal_hold": legal_hold,
                "chain_id": chain["chain_id"],
                "chain_sequence": chain["chain_sequence"],
                "chain_prev_hash": chain["chain_prev_hash"],
                "chain_hash": chain["chain_hash"],
            },
        )

    await record_evidence_audit(
        artifact_id=artifact_id,
        organization_id=payload.organization_id,
        action="created",
        actor_type="api",
        actor_id=ctx.api_key_id,
        metadata={"artifact_type": payload.artifact_type},
    )

    return EvidenceArtifactResponse(
        id=artifact_id,
        artifact_type=payload.artifact_type,
        mime_type=payload.mime_type,
        storage_backend=stored.storage_backend,
        storage_path=stored.storage_path,
        storage_uri=None,
        byte_size=stored.byte_size,
        sha256=stored.sha256,
        created_at=created_at,
        chain_id=chain["chain_id"],
        chain_sequence=chain["chain_sequence"],
        chain_prev_hash=chain["chain_prev_hash"],
        chain_hash=chain["chain_hash"],
        retention_until=retention_until,
        immutable=immutable,
        legal_hold=legal_hold,
        metadata=metadata,
        presigned_url=None,
    )


@router.post("/artifacts/ingest")
async def ingest_evidence_artifact(
    payload: EvidenceArtifactIngest,
    ctx: APIKeyContext = Depends(require_scope_with_rate_limit(Scope.WRITE)),
):
    """
    Upload an evidence artifact and create a linked Unified Event.

    This is the end‑to‑end ingestion path for audio, slides, and images.
    """
    artifact_response = await create_evidence_artifact(payload, ctx)

    event_id, created = await persist_reality_event(
        organization_id=payload.organization_id,
        source_type=payload.source_type or "evidence",
        event_type=payload.event_type,
        content_text=payload.content_text,
        content_json=payload.content_json,
        participants=payload.participants,
        metadata=payload.metadata,
        source_id=payload.source_id,
        captured_at=payload.captured_at,
        evidence_artifact_id=artifact_response.id,
    )

    return {
        "artifact_id": artifact_response.id,
        "event_id": event_id,
        "created": created,
    }


@router.get("/{evidence_id}/timeline")
async def get_evidence_timeline(
    evidence_id: str,
    organization_id: str,
    ctx: APIKeyContext = Depends(require_scope_with_rate_limit(Scope.READ)),
):
    """
    Get timeline of related messages for an evidence item.

    Returns chronological list of messages in the thread/conversation
    with their associated UIOs.

    Args:
        evidence_id: Evidence ID
        organization_id: Organization ID

    Returns:
        Timeline with messages and associated UIOs

    Requires `read` scope.
    """
    start_time = time.time()

    _validate_org_id(ctx, organization_id)

    from src.db.client import get_db_session
    from sqlalchemy import text

    try:
        async with get_db_session() as session:
            # Get evidence and its conversation
            result = await session.execute(
                text("""
                    SELECT
                        s.conversation_id,
                        s.source_type,
                        u.organization_id
                    FROM unified_object_source s
                    JOIN unified_intelligence_object u ON u.id = s.unified_object_id
                    WHERE s.id = :evidence_id
                """),
                {"evidence_id": evidence_id},
            )
            row = result.fetchone()

            if not row:
                raise HTTPException(status_code=404, detail="Evidence not found")

            if row.organization_id != organization_id:
                raise HTTPException(status_code=403, detail="Access denied")

            if not row.conversation_id:
                return {"timeline": [], "source_evidence_id": evidence_id}

            # Get all messages in conversation
            timeline = []

            if row.source_type == "email":
                msg_result = await session.execute(
                    text("""
                        SELECT
                            m.id,
                            m.from_name,
                            m.from_email,
                            m.subject,
                            m.body_text,
                            m.sent_at,
                            s.id as evidence_id,
                            u.id as uio_id,
                            u.type as uio_type,
                            u.canonical_title as uio_title
                        FROM messages m
                        LEFT JOIN unified_object_source s ON s.message_id = m.id
                        LEFT JOIN unified_intelligence_object u ON u.id = s.unified_object_id
                            AND u.organization_id = :org_id
                        WHERE m.thread_id = :conversation_id
                        ORDER BY m.sent_at ASC
                        LIMIT 20
                    """),
                    {"conversation_id": row.conversation_id, "org_id": organization_id},
                )

                for msg_row in msg_result.fetchall():
                    entry = {
                        "timestamp": msg_row.sent_at.isoformat() if msg_row.sent_at else None,
                        "type": "email",
                        "sender": msg_row.from_name or msg_row.from_email or "Unknown",
                        "snippet": _truncate_snippet(msg_row.body_text, 150),
                        "message_id": msg_row.id,
                        "evidence_id": msg_row.evidence_id,
                        "is_source": msg_row.evidence_id == evidence_id,
                    }

                    if msg_row.uio_id:
                        entry["uio"] = {
                            "id": msg_row.uio_id,
                            "type": msg_row.uio_type,
                            "title": msg_row.uio_title,
                        }

                    timeline.append(entry)

            # Record latency
            latency = time.time() - start_time

            logger.info(
                "Evidence timeline fetched",
                evidence_id=evidence_id,
                timeline_count=len(timeline),
                latency_ms=latency * 1000,
            )

            return {
                "source_evidence_id": evidence_id,
                "conversation_id": row.conversation_id,
                "timeline": timeline,
            }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(
            "Failed to fetch evidence timeline",
            evidence_id=evidence_id,
            error=str(e),
        )
        raise HTTPException(status_code=500, detail="Failed to fetch evidence timeline")
