"""Claim persistence (truth spine only).

Claims are stored as UIOs but exposed separately in the orchestration output.
We require evidence quotes for claims (proof-first).

All derived indexes (graph/vector) are built asynchronously from canonical truth
via the outbox drain path (Phase 6).
"""

from __future__ import annotations

import json
from typing import Any
from uuid import uuid4

import structlog
from sqlalchemy import text

from src.contexts.evidence.application.quotes import has_evidence, resolve_message_id
from src.contexts.evidence.application.uio_source_audit import audit_uio_source
from src.contexts.uio_truth.application.persist_envelope import PersistEnvelope
from src.contexts.uio_truth.application.persist_results import PersistResults
from src.contexts.uio_truth.application.persist_utils import (
    temporal_fields,
)
from src.contexts.uio_truth.application.supersession import find_existing_uio
from src.contexts.uio_truth.application.timeline import create_timeline_event
from src.contexts.uio_truth.application.uio_sources import insert_uio_source
from src.kernel.time import utc_now_naive as utc_now

logger = structlog.get_logger()


def _dedupe_claims_by_content(claims: list[Any]) -> list[Any]:
    """Deduplicate claims by normalized content prefix, keeping highest confidence."""
    seen_content: dict[str, int] = {}
    result: list[Any] = []
    duplicates_merged = 0

    for claim in claims:
        content = (getattr(claim, "content", None) or "").lower().strip()[:100]
        if not content:
            result.append(claim)
            continue

        if content in seen_content:
            existing_idx = seen_content[content]
            existing_item = result[existing_idx]
            if getattr(claim, "confidence", 0.0) > getattr(existing_item, "confidence", 0.0):
                result[existing_idx] = claim
            duplicates_merged += 1
        else:
            seen_content[content] = len(result)
            result.append(claim)

    if duplicates_merged > 0:
        logger.info(
            "Intra-batch deduplication: merged duplicate claims",
            original_count=len(claims),
            deduplicated_count=len(result),
            duplicates_merged=duplicates_merged,
        )
    return result


async def persist_claims(
    *,
    envelope: PersistEnvelope,
    claims: list[Any],
    merge_lookup: dict[str, Any],
    results: PersistResults,
    metrics: Any,
) -> None:
    from src.db.client import get_db_session

    claims_to_persist = _dedupe_claims_by_content(claims)

    async with get_db_session() as session:
        for claim in claims_to_persist:
            has_quote_evidence = has_evidence(getattr(claim, "quoted_text", None))
            metrics.track_evidence_completeness(
                organization_id=envelope.organization_id,
                uio_type="claim",
                status="present" if has_quote_evidence else "missing",
            )
            if not has_quote_evidence:
                logger.info(
                    "Skipping claim without evidence",
                    content=(getattr(claim, "content", None) or "")[:50] or None,
                    analysis_id=envelope.analysis_id,
                )
                continue

            message_id = getattr(claim, "source_message_id", None) or resolve_message_id(
                envelope.messages, getattr(claim, "quoted_text", None)
            )

            title = (getattr(claim, "content", None) or "")[:200]
            merge_candidate = merge_lookup.get(getattr(claim, "id", ""))
            existing_uio_id = None
            if merge_candidate:
                existing_uio_id = str(getattr(merge_candidate, "existing_uio_id", "") or "") or None
            if not existing_uio_id:
                existing_uio_id = await find_existing_uio(session, envelope.organization_id, "claim", title)

            if existing_uio_id:
                results.uios_merged.append(
                    {"sourceId": getattr(claim, "id", ""), "targetId": existing_uio_id}
                )
                now = utc_now()
                source_id = await insert_uio_source(
                    session=session,
                    envelope=envelope,
                    uio_id=existing_uio_id,
                    role="confirmation",
                    message_id=message_id,
                    quoted_text=getattr(claim, "quoted_text", None)
                    or ((getattr(claim, "content", None) or "")[:500] or None),
                    quoted_text_start=getattr(claim, "quoted_text_start", None),
                    quoted_text_end=getattr(claim, "quoted_text_end", None),
                    extracted_title=title or None,
                    extracted_due_date=None,
                    extracted_status=None,
                    confidence=getattr(claim, "confidence", None),
                    now=now,
                )

                await audit_uio_source(
                    organization_id=envelope.organization_id,
                    evidence_id=source_id,
                    uio_id=existing_uio_id,
                    uio_type="claim",
                    action="uio_source_added",
                    conversation_id=envelope.conversation_id,
                    message_id=message_id,
                )

                await create_timeline_event(
                    session=session,
                    uio_id=existing_uio_id,
                    event_type="source_added",
                    event_description=f"Claim confirmed from {envelope.source_type or 'email'}: {title[:50]}...",
                    source_type=envelope.source_type or "email",
                    source_id=envelope.conversation_id,
                    quoted_text=getattr(claim, "quoted_text", None),
                    evidence_id=source_id,
                    new_value={
                        "content": (getattr(claim, "content", None) or "")[:100] or None,
                        "confidence": getattr(claim, "confidence", None),
                        "source": envelope.source_type or "email",
                    },
                    confidence=getattr(claim, "confidence", None),
                    triggered_by="system",
                )

                await session.commit()
                logger.info(
                    "Skipping duplicate claim (PostgreSQL match)",
                    existing_uio_id=existing_uio_id,
                )
                continue

            uio_id = str(uuid4())
            now = utc_now()
            results.uios_created.append({"id": uio_id, "type": "claim"})

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
                        :id, :org_id, 'claim', 'active',
                        :title, :description,
                        :confidence, :now, :now,
                        :valid_from, :valid_to, :system_from, :system_to,
                        :now, :now
                    )
                    """
                ),
                {
                    "id": uio_id,
                    "org_id": envelope.organization_id,
                    "title": title or "Unnamed claim",
                    "description": getattr(claim, "content", None) or "",
                    "confidence": getattr(claim, "confidence", None),
                    "now": now,
                    **temporal_fields(now),
                },
            )

            claim_details_id = str(uuid4())
            confidence_tier = getattr(claim, "_confidence_tier", "medium")
            extraction_context = {
                "entities": getattr(claim, "entities", []) or [],
                "temporalReferences": getattr(claim, "temporal_references", []) or [],
                "modelUsed": getattr(claim, "model_used", None),
                "modelTier": getattr(claim, "model_tier", None),
                "evidenceCount": 1 if getattr(claim, "quoted_text", None) else 0,
                "confidenceReasoning": getattr(claim, "confidence_reasoning", None),
                "confidenceTier": confidence_tier,
            }

            await session.execute(
                text(
                    """
                    INSERT INTO uio_claim_details (
                        id, uio_id, claim_type,
                        quoted_text, normalized_text,
                        importance, extraction_context,
                        created_at, updated_at
                    ) VALUES (
                        :id, :uio_id, :claim_type,
                        :quoted_text, :normalized_text,
                        :importance, :extraction_context,
                        :now, :now
                    )
                    """
                ),
                {
                    "id": claim_details_id,
                    "uio_id": uio_id,
                    "claim_type": getattr(claim, "type", None) or "fact",
                    "quoted_text": getattr(claim, "quoted_text", None) or getattr(claim, "content", None),
                    "normalized_text": getattr(claim, "content", None),
                    "importance": getattr(claim, "importance", None) or "medium",
                    "extraction_context": json.dumps(extraction_context),
                    "now": now,
                },
            )

            source_id = await insert_uio_source(
                session=session,
                envelope=envelope,
                uio_id=uio_id,
                role="origin",
                message_id=message_id,
                quoted_text=getattr(claim, "quoted_text", None)
                or ((getattr(claim, "content", None) or "")[:500] or None),
                quoted_text_start=getattr(claim, "quoted_text_start", None),
                quoted_text_end=getattr(claim, "quoted_text_end", None),
                extracted_title=title or None,
                extracted_due_date=None,
                extracted_status=None,
                confidence=getattr(claim, "confidence", None),
                now=now,
            )

            await audit_uio_source(
                organization_id=envelope.organization_id,
                evidence_id=source_id,
                uio_id=uio_id,
                uio_type="claim",
                action="uio_created",
                conversation_id=envelope.conversation_id,
                message_id=message_id,
            )

            extracted_id = getattr(claim, "id", None)
            if extracted_id:
                results.created_uio_by_extracted_id[str(extracted_id)] = {
                    "uio_id": uio_id,
                    "type": "claim",
                    "evidence_id": source_id,
                }

            await create_timeline_event(
                session=session,
                uio_id=uio_id,
                event_type="created",
                event_description=f"Claim extracted from {envelope.source_type or 'email'}: {title[:50] if title else 'N/A'}...",
                source_type=envelope.source_type or "email",
                source_id=envelope.conversation_id,
                quoted_text=getattr(claim, "quoted_text", None),
                evidence_id=source_id,
                new_value={
                    "type": getattr(claim, "type", None),
                    "content": (getattr(claim, "content", None) or "")[:100] or None,
                    "confidence": getattr(claim, "confidence", None),
                },
                confidence=getattr(claim, "confidence", None),
                triggered_by="system",
            )

            results.claims_created.append({"id": uio_id, "type": getattr(claim, "type", None)})
            logger.debug(
                "Created claim",
                uio_id=uio_id,
                claim_type=getattr(claim, "type", None),
            )

        await session.commit()
