"""Decision persistence (truth spine only).

All derived indexes (graph/vector) are built asynchronously from canonical truth
via the outbox drain path (Phase 6). This keeps the hot path resilient: if
FalkorDB or embeddings are down, we still persist the canonical truth spine.
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
)
from src.contexts.uio_truth.application.supersession import (
    apply_supersession,
    find_existing_uio,
    should_supersede_decision,
)
from src.contexts.uio_truth.application.timeline import create_timeline_event
from src.contexts.uio_truth.application.uio_sources import (
    insert_uio_source,
    insert_uio_sources_batch,
)
from src.kernel.time import utc_now_naive as utc_now

logger = structlog.get_logger()


async def persist_decisions(
    *,
    envelope: PersistEnvelope,
    decisions: list[Any],
    merge_lookup: dict[str, Any],
    results: PersistResults,
    metrics: Any,
) -> None:
    from src.db.client import get_db_session

    async with get_db_session() as session:
        for decision in decisions:
            has_quote_evidence = has_evidence(getattr(decision, "quoted_text", None))
            metrics.track_evidence_completeness(
                organization_id=envelope.organization_id,
                uio_type="decision",
                status="present" if has_quote_evidence else "missing",
            )
            if not has_quote_evidence:
                logger.info(
                    "Skipping decision without evidence",
                    title=getattr(decision, "title", None),
                    analysis_id=envelope.analysis_id,
                )
                continue

            message_id = getattr(decision, "source_message_id", None) or resolve_message_id(
                envelope.messages, getattr(decision, "quoted_text", None)
            )

            # Vector search deduplication candidate: use it as an "existing id hint"
            # but still run supersession checks so updates are not lost.
            merge_candidate = merge_lookup.get(getattr(decision, "id", ""))
            existing_uio_id = None
            if merge_candidate:
                existing_uio_id = str(getattr(merge_candidate, "existing_uio_id", "") or "") or None
            if not existing_uio_id:
                existing_uio_id = await find_existing_uio(
                    session,
                    envelope.organization_id,
                    "decision",
                    getattr(decision, "title", ""),
                )

            supersedes_uio_id = None
            if existing_uio_id:
                should_supersede = await should_supersede_decision(session, existing_uio_id, decision)
                if not should_supersede:
                    results.uios_merged.append({"sourceId": decision.id, "targetId": existing_uio_id})
                    logger.info(
                        "Skipping duplicate decision (PostgreSQL match)",
                        title=decision.title,
                        existing_uio_id=existing_uio_id,
                    )

                    now = utc_now()
                    source_id = await insert_uio_source(
                        session=session,
                        envelope=envelope,
                        uio_id=existing_uio_id,
                        role="confirmation",
                        message_id=message_id,
                        quoted_text=getattr(decision, "quoted_text", None),
                        quoted_text_start=getattr(decision, "quoted_text_start", None),
                        quoted_text_end=getattr(decision, "quoted_text_end", None),
                        confidence=decision.confidence,
                        now=now,
                        extracted_title=decision.title,
                    )

                    supporting_inserts: list[dict[str, object]] = []
                    for span in getattr(decision, "supporting_evidence", []) or []:
                        supporting_inserts.append(
                            {
                                "role": "supporting",
                                "message_id": getattr(span, "source_message_id", None),
                                "quoted_text": getattr(span, "quoted_text", None),
                                "quoted_text_start": getattr(span, "quoted_text_start", None),
                                "quoted_text_end": getattr(span, "quoted_text_end", None),
                                "extracted_title": decision.title,
                                "extracted_due_date": None,
                                "extracted_status": None,
                                "confidence": decision.confidence,
                            }
                        )
                    await insert_uio_sources_batch(
                        session=session,
                        envelope=envelope,
                        uio_id=existing_uio_id,
                        inserts=supporting_inserts,
                        now=now,
                    )

                    await create_timeline_event(
                        session=session,
                        uio_id=existing_uio_id,
                        event_type="source_added",
                        event_description=f"Decision confirmed from {envelope.source_type or 'email'}: {decision.title}",
                        source_type=envelope.source_type or "email",
                        source_id=envelope.conversation_id,
                        quoted_text=getattr(decision, "quoted_text", None),
                        evidence_id=source_id,
                        new_value={
                            "title": decision.title,
                            "confidence": decision.confidence,
                            "source": envelope.source_type or "email",
                        },
                        confidence=decision.confidence,
                        triggered_by="system",
                    )

                    await session.commit()
                    continue

                supersedes_uio_id = existing_uio_id

            uio_id = str(uuid4())
            now = utc_now()
            results.uios_created.append({"id": uio_id, "type": "decision"})

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
                        :id, :org_id, 'decision', 'active',
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
                    "title": decision.title,
                    "description": f"{getattr(decision, 'statement', '')}\n\nRationale: {getattr(decision, 'rationale', None) or 'N/A'}",
                    "confidence": decision.confidence,
                    "now": now,
                    **temporal_fields(now),
                },
            )

            decision_details_id = str(uuid4())
            confidence_tier = getattr(decision, "_confidence_tier", "medium")
            extraction_context = {
                "reasoning": getattr(decision, "reasoning", None),
                "quotedText": getattr(decision, "quoted_text", None),
                "modelUsed": getattr(decision, "model_used", None),
                "modelTier": getattr(decision, "model_tier", None),
                "evidenceCount": 1 + len(getattr(decision, "supporting_evidence", []) or []),
                "confidenceReasoning": getattr(decision, "confidence_reasoning", None),
                "confidenceTier": confidence_tier,
            }

            decision_maker_contact_id = await resolve_contact_id_by_email(
                session, envelope.organization_id, getattr(decision, "decision_maker_email", None)
            )

            await session.execute(
                text(
                    """
                    INSERT INTO uio_decision_details (
                        id, uio_id, statement, rationale,
                        decision_maker_contact_id,
                        alternatives, stakeholder_contact_ids, impact_areas,
                        status, decided_at,
                        supersedes_uio_id, superseded_by_uio_id,
                        extraction_context,
                        created_at, updated_at
                    ) VALUES (
                        :id, :uio_id, :statement, :rationale,
                        :decision_maker_contact_id,
                        :alternatives, :stakeholders, :impact_areas,
                        'made', :decided_at,
                        :supersedes_uio_id, :superseded_by_uio_id,
                        :extraction_context,
                        :now, :now
                    )
                    """
                ),
                {
                    "id": decision_details_id,
                    "uio_id": uio_id,
                    "statement": getattr(decision, "statement", None),
                    "rationale": getattr(decision, "rationale", None) or "",
                    "decision_maker_contact_id": decision_maker_contact_id,
                    "alternatives": json.dumps(getattr(decision, "alternatives", []) or []),
                    "stakeholders": getattr(decision, "stakeholders", []) or [],
                    "impact_areas": getattr(decision, "implications", []) or [],
                    "decided_at": now,
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
                quoted_text=getattr(decision, "quoted_text", None),
                quoted_text_start=getattr(decision, "quoted_text_start", None),
                quoted_text_end=getattr(decision, "quoted_text_end", None),
                confidence=decision.confidence,
                now=now,
                extracted_title=decision.title,
            )

            supporting_inserts: list[dict[str, object]] = []
            for span in getattr(decision, "supporting_evidence", []) or []:
                supporting_inserts.append(
                    {
                        "role": "supporting",
                        "message_id": getattr(span, "source_message_id", None),
                        "quoted_text": getattr(span, "quoted_text", None),
                        "quoted_text_start": getattr(span, "quoted_text_start", None),
                        "quoted_text_end": getattr(span, "quoted_text_end", None),
                        "extracted_title": decision.title,
                        "extracted_due_date": None,
                        "extracted_status": None,
                        "confidence": decision.confidence,
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
                uio_type="decision",
                action="uio_created",
                conversation_id=envelope.conversation_id,
                message_id=message_id,
            )

            results.created_uio_by_extracted_id[getattr(decision, "id", "")] = {
                "uio_id": uio_id,
                "type": "decision",
                "evidence_id": source_id,
            }

            await create_timeline_event(
                session=session,
                uio_id=uio_id,
                event_type="created",
                event_description=f"Decision extracted from {envelope.source_type or 'email'}: {decision.title}",
                source_type=envelope.source_type or "email",
                source_id=envelope.conversation_id,
                quoted_text=getattr(decision, "quoted_text", None),
                evidence_id=source_id,
                new_value={
                    "title": decision.title,
                    "statement": getattr(decision, "statement", None),
                    "rationale": getattr(decision, "rationale", None),
                    "confidence": decision.confidence,
                },
                confidence=decision.confidence,
                triggered_by="system",
            )

            if supersedes_uio_id:
                await apply_supersession(
                    session,
                    now=now,
                    organization_id=envelope.organization_id,
                    existing_uio_id=supersedes_uio_id,
                    new_uio_id=uio_id,
                    uio_type="decision",
                    evidence_id=source_id,
                    source_type=envelope.source_type or "email",
                    conversation_id=envelope.conversation_id,
                    message_id=message_id,
                )

            await session.commit()

            logger.debug(
                "Created decision",
                uio_id=uio_id,
                title=decision.title,
            )
