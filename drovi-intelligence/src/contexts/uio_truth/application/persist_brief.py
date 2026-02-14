"""Brief UIO persistence and conversation brief projection.

Briefs are a product-facing summary for a conversation. We store them as UIOs for
auditability and update the `conversation` row for fast UI access.
"""

from __future__ import annotations

import json
from typing import Any
from uuid import uuid4

import structlog
from sqlalchemy import text

from src.contexts.evidence.application.quotes import resolve_message_id
from src.contexts.evidence.application.uio_source_audit import audit_uio_source
from src.contexts.uio_truth.application.persist_envelope import PersistEnvelope
from src.contexts.uio_truth.application.persist_results import PersistResults
from src.contexts.uio_truth.application.persist_utils import temporal_fields
from src.contexts.uio_truth.application.uio_sources import insert_uio_source
from src.kernel.time import utc_now_naive as utc_now

logger = structlog.get_logger()


def _map_brief_action(raw: str | None) -> str:
    action_map = {
        "respond": "respond",
        "review": "review",
        "delegate": "delegate",
        "schedule": "schedule",
        "wait": "wait",
        "waiting": "wait",
        "escalate": "escalate",
        "archive": "archive",
        "follow_up": "follow_up",
        "followup": "follow_up",
        "none": "none",
    }
    key = (raw or "none").lower().strip()
    return action_map.get(key, "none")


def _map_brief_priority(raw: str | None) -> str:
    priority_map = {
        "urgent": "urgent",
        "high": "high",
        "medium": "medium",
        "low": "low",
    }
    key = (raw or "medium").lower().strip()
    return priority_map.get(key, "medium")


def _open_loops_payload(open_loops: Any) -> list[dict[str, Any]]:
    payload: list[dict[str, Any]] = []
    if not open_loops:
        return payload
    for loop in open_loops:
        if isinstance(loop, str):
            payload.append({"description": loop})
            continue
        if hasattr(loop, "description"):
            payload.append(
                {
                    "description": getattr(loop, "description", None),
                    "owner": getattr(loop, "owner", None),
                    "isBlocking": getattr(loop, "is_blocking", False),
                }
            )
    return payload


async def persist_brief_uio(
    *,
    envelope: PersistEnvelope,
    brief: Any,
    classification: Any,
    results: PersistResults,
) -> str | None:
    """Persist the brief as a UIO and return its id when created."""
    brief_summary = getattr(brief, "brief_summary", None)
    if not brief_summary:
        return None

    from src.db.client import get_db_session

    async with get_db_session() as session:
        brief_uio_id = str(uuid4())
        brief_details_id = str(uuid4())
        now = utc_now()

        title_text = f"Brief: {brief_summary}"
        if len(brief_summary) > 100:
            title_text = f"Brief: {brief_summary[:100]}..."

        await session.execute(
            text(
                """
                INSERT INTO unified_intelligence_object (
                    id, organization_id, type, status,
                    canonical_title, canonical_description,
                    overall_confidence, first_seen_at, last_updated_at,
                    valid_from, valid_to, system_from, system_to,
                    created_at, updated_at
                ) VALUES (
                    :id, :org_id, 'brief', 'active',
                    :title, :description,
                    :confidence, :now, :now,
                    :valid_from, :valid_to, :system_from, :system_to,
                    :now, :now
                )
                """
            ),
            {
                "id": brief_uio_id,
                "org_id": envelope.organization_id,
                "title": title_text,
                "description": brief_summary,
                "confidence": 0.9,
                "now": now,
                **temporal_fields(now),
            },
        )

        open_loops = _open_loops_payload(getattr(brief, "open_loops", None))
        brief_action = _map_brief_action(getattr(brief, "suggested_action", None))
        brief_priority = _map_brief_priority(getattr(brief, "priority_tier", None))

        await session.execute(
            text(
                """
                INSERT INTO uio_brief_details (
                    id, uio_id, summary,
                    why_this_matters, what_changed,
                    suggested_action, action_reasoning,
                    open_loops, priority_tier,
                    urgency_score, importance_score, sentiment_score,
                    intent_classification, conversation_id,
                    created_at, updated_at
                ) VALUES (
                    :id, :uio_id, :summary,
                    :why_this_matters, :what_changed,
                    :suggested_action, :action_reasoning,
                    :open_loops, :priority_tier,
                    :urgency_score, :importance_score, :sentiment_score,
                    :intent_classification, :conversation_id,
                    :now, :now
                )
                """
            ),
            {
                "id": brief_details_id,
                "uio_id": brief_uio_id,
                "summary": brief_summary,
                "why_this_matters": getattr(brief, "why_this_matters", None),
                "what_changed": getattr(brief, "what_changed", None),
                "suggested_action": brief_action,
                "action_reasoning": getattr(brief, "suggested_action_reason", None),
                "open_loops": json.dumps(open_loops),
                "priority_tier": brief_priority,
                "urgency_score": getattr(classification, "urgency", None),
                "importance_score": getattr(classification, "importance", None),
                "sentiment_score": getattr(classification, "sentiment", None),
                "intent_classification": getattr(classification, "intent", None),
                "conversation_id": envelope.conversation_id,
                "now": now,
            },
        )

        brief_source_id = await insert_uio_source(
            session=session,
            envelope=envelope,
            uio_id=brief_uio_id,
            role="origin",
            message_id=resolve_message_id(envelope.messages, None),
            quoted_text=(envelope.input_content or "")[:500] or None,
            quoted_text_start=None,
            quoted_text_end=None,
            extracted_title=(brief_summary[:200] if brief_summary else None),
            extracted_due_date=None,
            extracted_status=None,
            confidence=0.9,
            now=now,
        )

        await audit_uio_source(
            organization_id=envelope.organization_id,
            evidence_id=brief_source_id,
            uio_id=brief_uio_id,
            uio_type="brief",
            action="uio_created",
            conversation_id=envelope.conversation_id,
            message_id=resolve_message_id(envelope.messages, None),
        )

        await session.commit()

        results.uios_created.append({"id": brief_uio_id, "type": "brief"})
        logger.debug("Created brief UIO", uio_id=brief_uio_id, priority_tier=getattr(brief, "priority_tier", None))
        return brief_uio_id


async def update_conversation_with_brief(
    *,
    envelope: PersistEnvelope,
    brief: Any,
    classification: Any,
    commitment_count: int,
    decision_count: int,
    claim_count: int,
    has_risk_warning: bool,
    risk_level: str | None,
) -> None:
    """Project brief fields onto the conversation row for fast UI reads."""
    if not envelope.conversation_id:
        return
    if not getattr(brief, "brief_summary", None):
        return

    from src.db.client import get_db_session

    async with get_db_session() as session:
        now = utc_now()
        await session.execute(
            text(
                """
                UPDATE conversation SET
                    brief_summary = :brief_summary,
                    suggested_action = :suggested_action,
                    suggested_action_reason = :suggested_action_reason,
                    has_open_loops = :has_open_loops,
                    open_loop_count = :open_loop_count,
                    priority_tier = :priority_tier,
                    intent_classification = :intent,
                    urgency_score = :urgency,
                    importance_score = :importance,
                    sentiment_score = :sentiment,
                    commitment_count = :commitment_count,
                    decision_count = :decision_count,
                    claim_count = :claim_count,
                    has_risk_warning = :has_risk_warning,
                    risk_level = :risk_level,
                    last_analyzed_at = :now,
                    updated_at = :now
                WHERE id = :conversation_id
                """
            ),
            {
                "conversation_id": envelope.conversation_id,
                "brief_summary": getattr(brief, "brief_summary", None),
                "suggested_action": getattr(brief, "suggested_action", None),
                "suggested_action_reason": getattr(brief, "suggested_action_reason", None),
                "has_open_loops": getattr(brief, "has_open_loops", None),
                "open_loop_count": getattr(brief, "open_loop_count", None),
                "priority_tier": getattr(brief, "priority_tier", None),
                "intent": getattr(classification, "intent", None),
                "urgency": getattr(classification, "urgency", None),
                "importance": getattr(classification, "importance", None),
                "sentiment": getattr(classification, "sentiment", None),
                "commitment_count": commitment_count,
                "decision_count": decision_count,
                "claim_count": claim_count,
                "has_risk_warning": has_risk_warning,
                "risk_level": risk_level,
                "now": now,
            },
        )
        await session.commit()
        logger.info(
            "Updated conversation with brief",
            conversation_id=envelope.conversation_id,
            priority_tier=getattr(brief, "priority_tier", None),
            has_open_loops=getattr(brief, "has_open_loops", None),
        )

