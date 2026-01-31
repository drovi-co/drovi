"""
Evidence API Route

Fetch source evidence with snippet vs full modes.
Evidence links UIOs back to their original source (email, slack, etc.).

Performance target: < 100ms p95 for snippet mode, < 200ms p95 for full mode
"""

import time
from datetime import datetime
from typing import Literal

import structlog
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from prometheus_client import Counter, Histogram

from src.auth.middleware import APIKeyContext, require_scope_with_rate_limit
from src.auth.scopes import Scope

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
    source_type: Literal["email", "slack", "calendar", "document", "manual"]
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

            # Build base response
            snippet = _truncate_snippet(row.quoted_text)

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
                    sent_at=row.source_timestamp,
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
                sent_at=row.source_timestamp,
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
