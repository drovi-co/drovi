"""Commitment persistence (truth spine only).

All derived indexes (graph/vector) must be built asynchronously from canonical
truth via the outbox drain path (Phase 6). This keeps the hot path resilient:
if FalkorDB or embeddings are down, we still persist the canonical truth spine.
"""

from __future__ import annotations

import json
from typing import Any
from uuid import uuid4

import structlog
from sqlalchemy import text

from src.contexts.evidence.application.quotes import has_evidence, resolve_message_id
from src.contexts.evidence.application.uio_source_audit import audit_uio_source
from src.contexts.uio_truth.application.contacts import resolve_contact_id_by_email
from src.contexts.uio_truth.application.persist_envelope import PersistEnvelope
from src.contexts.uio_truth.application.persist_results import PersistResults
from src.contexts.uio_truth.application.persist_utils import (
    temporal_fields,
    to_naive_utc,
)
from src.contexts.uio_truth.application.supersession import (
    apply_supersession,
    find_existing_uio,
    should_supersede_commitment,
)
from src.contexts.uio_truth.application.timeline import create_timeline_event
from src.contexts.uio_truth.application.uio_sources import (
    insert_uio_source,
    insert_uio_sources_batch,
)
from src.kernel.time import utc_now_naive as utc_now

logger = structlog.get_logger()


async def persist_commitments(
    *,
    envelope: PersistEnvelope,
    commitments: list[Any],
    merge_lookup: dict[str, Any],
    results: PersistResults,
    metrics: Any,
) -> None:
    """Persist extracted commitments to Postgres truth tables and (for now) FalkorDB."""
    from src.db.client import get_db_session

    async with get_db_session() as session:
        for commitment in commitments:
            has_quote_evidence = has_evidence(getattr(commitment, "quoted_text", None))
            metrics.track_evidence_completeness(
                organization_id=envelope.organization_id,
                uio_type="commitment",
                status="present" if has_quote_evidence else "missing",
            )
            if not has_quote_evidence:
                logger.info(
                    "Skipping commitment without evidence",
                    title=getattr(commitment, "title", None),
                    analysis_id=envelope.analysis_id,
                )
                continue

            message_id = getattr(commitment, "source_message_id", None) or resolve_message_id(
                envelope.messages, getattr(commitment, "quoted_text", None)
            )

            # Vector search deduplication candidate: use it as an "existing id hint"
            # but still run supersession checks so updates are not lost.
            merge_candidate = merge_lookup.get(getattr(commitment, "id", ""))
            existing_uio_id = None
            if merge_candidate:
                existing_uio_id = str(getattr(merge_candidate, "existing_uio_id", "") or "") or None
            if not existing_uio_id:
                existing_uio_id = await find_existing_uio(
                    session,
                    envelope.organization_id,
                    "commitment",
                    getattr(commitment, "title", ""),
                )

            supersedes_uio_id = None
            if existing_uio_id:
                should_supersede = await should_supersede_commitment(session, existing_uio_id, commitment)
                if not should_supersede:
                    # Found existing UIO: add as additional source, do not create duplicate.
                    results.uios_merged.append({"sourceId": commitment.id, "targetId": existing_uio_id})
                    logger.info(
                        "Skipping duplicate commitment (PostgreSQL match)",
                        title=commitment.title,
                        existing_uio_id=existing_uio_id,
                    )

                    now = utc_now()
                    source_id = await insert_uio_source(
                        session=session,
                        envelope=envelope,
                        uio_id=existing_uio_id,
                        role="confirmation",
                        message_id=message_id,
                        quoted_text=getattr(commitment, "quoted_text", None),
                        quoted_text_start=getattr(commitment, "quoted_text_start", None),
                        quoted_text_end=getattr(commitment, "quoted_text_end", None),
                        extracted_title=commitment.title,
                        extracted_due_date=to_naive_utc(getattr(commitment, "due_date", None)),
                        extracted_status=None,
                        confidence=commitment.confidence,
                        now=now,
                    )

                    supporting_inserts: list[dict[str, object]] = []
                    for span in getattr(commitment, "supporting_evidence", []) or []:
                        supporting_inserts.append(
                            {
                                "role": "supporting",
                                "message_id": getattr(span, "source_message_id", None),
                                "quoted_text": getattr(span, "quoted_text", None),
                                "quoted_text_start": getattr(span, "quoted_text_start", None),
                                "quoted_text_end": getattr(span, "quoted_text_end", None),
                                "extracted_title": commitment.title,
                                "extracted_due_date": to_naive_utc(getattr(commitment, "due_date", None)),
                                "extracted_status": None,
                                "confidence": commitment.confidence,
                            }
                        )
                    await insert_uio_sources_batch(
                        session=session,
                        envelope=envelope,
                        uio_id=existing_uio_id,
                        inserts=supporting_inserts,
                        now=now,
                    )

                    # Evidence audit
                    await audit_uio_source(
                        organization_id=envelope.organization_id,
                        evidence_id=source_id,
                        uio_id=existing_uio_id,
                        uio_type="commitment",
                        action="uio_source_added",
                        conversation_id=envelope.conversation_id,
                        message_id=message_id,
                    )

                    await create_timeline_event(
                        session=session,
                        uio_id=existing_uio_id,
                        event_type="source_added",
                        event_description=f"Commitment confirmed from {envelope.source_type or 'email'}: {commitment.title}",
                        source_type=envelope.source_type or "email",
                        source_id=envelope.conversation_id,
                        quoted_text=getattr(commitment, "quoted_text", None),
                        evidence_id=source_id,
                        new_value={
                            "title": commitment.title,
                            "confidence": commitment.confidence,
                            "source": envelope.source_type or "email",
                        },
                        confidence=commitment.confidence,
                        triggered_by="system",
                    )

                    await session.commit()
                    continue

                supersedes_uio_id = existing_uio_id

            # Create new UIO
            uio_id = str(uuid4())
            now = utc_now()

            results.uios_created.append({"id": uio_id, "type": "commitment"})

            await session.execute(
                text(
                    """
                    INSERT INTO unified_intelligence_object (
                        id, organization_id, type, status,
                        canonical_title, canonical_description,
                        due_date, due_date_confidence,
                        overall_confidence, first_seen_at, last_updated_at,
                        valid_from, valid_to, system_from, system_to,
                        created_at, updated_at
                    ) VALUES (
                        :id, :org_id, 'commitment', 'active',
                        :title, :description,
                        :due_date, :due_date_confidence,
                        :confidence, :now, :now,
                        :valid_from, :valid_to, :system_from, :system_to,
                        :now, :now
                    )
                    """
                ),
                {
                    "id": uio_id,
                    "org_id": envelope.organization_id,
                    "title": commitment.title,
                    "description": getattr(commitment, "description", None) or "",
                    "due_date": to_naive_utc(getattr(commitment, "due_date", None)),
                    "due_date_confidence": commitment.confidence if getattr(commitment, "due_date", None) else None,
                    "confidence": commitment.confidence,
                    "now": now,
                    **temporal_fields(now),
                },
            )

            commitment_details_id = str(uuid4())
            confidence_tier = getattr(commitment, "_confidence_tier", "medium")
            extraction_context = {
                "reasoning": getattr(commitment, "reasoning", None),
                "quotedText": getattr(commitment, "quoted_text", None),
                "commitmentType": getattr(commitment, "commitment_type", None),
                "modelUsed": getattr(commitment, "model_used", None),
                "modelTier": getattr(commitment, "model_tier", None),
                "evidenceCount": 1 + len(getattr(commitment, "supporting_evidence", []) or []),
                "confidenceReasoning": getattr(commitment, "confidence_reasoning", None),
                "confidenceTier": confidence_tier,
            }

            debtor_contact_id = await resolve_contact_id_by_email(
                session, envelope.organization_id, getattr(commitment, "debtor_email", None)
            )
            creditor_contact_id = await resolve_contact_id_by_email(
                session, envelope.organization_id, getattr(commitment, "creditor_email", None)
            )

            await session.execute(
                text(
                    """
                    INSERT INTO uio_commitment_details (
                        id, uio_id, direction,
                        debtor_contact_id, creditor_contact_id,
                        due_date_source, due_date_original_text,
                        priority, status,
                        is_conditional, condition,
                        supersedes_uio_id, superseded_by_uio_id,
                        extraction_context,
                        created_at, updated_at
                    ) VALUES (
                        :id, :uio_id, :direction,
                        :debtor_contact_id, :creditor_contact_id,
                        :due_date_source, :due_date_text,
                        :priority, 'pending',
                        :is_conditional, :condition,
                        :supersedes_uio_id, :superseded_by_uio_id,
                        :extraction_context,
                        :now, :now
                    )
                    """
                ),
                {
                    "id": commitment_details_id,
                    "uio_id": uio_id,
                    "direction": getattr(commitment, "direction", None) or "owed_to_me",
                    "debtor_contact_id": debtor_contact_id,
                    "creditor_contact_id": creditor_contact_id,
                    "due_date_source": "explicit" if getattr(commitment, "due_date", None) else "inferred",
                    "due_date_text": getattr(commitment, "due_date_text", None),
                    "priority": getattr(commitment, "priority", None) or "medium",
                    "is_conditional": getattr(commitment, "is_conditional", False),
                    "condition": getattr(commitment, "condition", None),
                    "supersedes_uio_id": supersedes_uio_id,
                    "superseded_by_uio_id": None,
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
                quoted_text=getattr(commitment, "quoted_text", None),
                quoted_text_start=getattr(commitment, "quoted_text_start", None),
                quoted_text_end=getattr(commitment, "quoted_text_end", None),
                extracted_title=commitment.title,
                extracted_due_date=to_naive_utc(getattr(commitment, "due_date", None)),
                extracted_status=None,
                confidence=commitment.confidence,
                now=now,
            )

            supporting_inserts: list[dict[str, object]] = []
            for span in getattr(commitment, "supporting_evidence", []) or []:
                supporting_inserts.append(
                    {
                        "role": "supporting",
                        "message_id": getattr(span, "source_message_id", None),
                        "quoted_text": getattr(span, "quoted_text", None),
                        "quoted_text_start": getattr(span, "quoted_text_start", None),
                        "quoted_text_end": getattr(span, "quoted_text_end", None),
                        "extracted_title": commitment.title,
                        "extracted_due_date": to_naive_utc(getattr(commitment, "due_date", None)),
                        "extracted_status": None,
                        "confidence": commitment.confidence,
                    }
                )
            await insert_uio_sources_batch(
                session=session,
                envelope=envelope,
                uio_id=uio_id,
                inserts=supporting_inserts,
                now=now,
            )

            await audit_uio_source(
                organization_id=envelope.organization_id,
                evidence_id=source_id,
                uio_id=uio_id,
                uio_type="commitment",
                action="uio_created",
                conversation_id=envelope.conversation_id,
                message_id=message_id,
            )

            results.created_uio_by_extracted_id[getattr(commitment, "id", "")] = {
                "uio_id": uio_id,
                "type": "commitment",
                "evidence_id": source_id,
            }

            await create_timeline_event(
                session=session,
                uio_id=uio_id,
                event_type="created",
                event_description=f"Commitment extracted from {envelope.source_type or 'email'}: {commitment.title}",
                source_type=envelope.source_type or "email",
                source_id=envelope.conversation_id,
                quoted_text=getattr(commitment, "quoted_text", None),
                evidence_id=source_id,
                new_value={
                    "title": commitment.title,
                    "description": getattr(commitment, "description", None),
                    "direction": getattr(commitment, "direction", None),
                    "priority": getattr(commitment, "priority", None),
                    "dueDate": commitment.due_date.isoformat() if getattr(commitment, "due_date", None) else None,
                    "confidence": commitment.confidence,
                },
                confidence=commitment.confidence,
                triggered_by="system",
            )

            if supersedes_uio_id:
                await apply_supersession(
                    session,
                    now=now,
                    organization_id=envelope.organization_id,
                    existing_uio_id=supersedes_uio_id,
                    new_uio_id=uio_id,
                    uio_type="commitment",
                    evidence_id=source_id,
                    source_type=envelope.source_type or "email",
                    conversation_id=envelope.conversation_id,
                    message_id=message_id,
                )

            await session.commit()

            logger.debug(
                "Created commitment",
                uio_id=uio_id,
                title=commitment.title,
            )
