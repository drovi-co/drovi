"""Risk persistence (truth spine only).

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
from src.contexts.uio_truth.application.persist_envelope import PersistEnvelope
from src.contexts.uio_truth.application.persist_results import PersistResults
from src.contexts.uio_truth.application.persist_utils import (
    temporal_fields,
)
from src.contexts.uio_truth.application.supersession import (
    apply_supersession,
    find_existing_uio,
    should_supersede_risk,
)
from src.contexts.uio_truth.application.timeline import create_timeline_event
from src.contexts.uio_truth.application.uio_sources import insert_uio_source
from src.kernel.time import utc_now_naive as utc_now

logger = structlog.get_logger()


_RISK_TYPE_MAP: dict[str, str] = {
    "deadline": "deadline_risk",
    "deadline_risk": "deadline_risk",
    "commitment_conflict": "commitment_conflict",
    "unclear_ownership": "unclear_ownership",
    "missing_info": "missing_information",
    "missing_information": "missing_information",
    "escalation": "escalation_needed",
    "escalation_needed": "escalation_needed",
    "policy": "policy_violation",
    "policy_violation": "policy_violation",
    "financial": "financial_risk",
    "financial_risk": "financial_risk",
    "relationship": "relationship_risk",
    "relationship_risk": "relationship_risk",
    "sensitive": "sensitive_data",
    "sensitive_data": "sensitive_data",
    "contradiction": "contradiction",
    "fraud": "fraud_signal",
    "fraud_signal": "fraud_signal",
    "other": "other",
}

_SEVERITY_MAP: dict[str, str] = {
    "low": "low",
    "medium": "medium",
    "high": "high",
    "critical": "critical",
}


def _risk_type_value(raw_type: str | None) -> str:
    if not raw_type:
        return "other"
    return _RISK_TYPE_MAP.get(str(raw_type), "other")


def _risk_severity_value(raw_severity: str | None) -> str:
    if not raw_severity:
        return "medium"
    return _SEVERITY_MAP.get(str(raw_severity).lower(), "medium")


async def persist_risks(
    *,
    envelope: PersistEnvelope,
    risks: list[Any],
    merge_lookup: dict[str, Any],
    results: PersistResults,
    metrics: Any,
) -> None:
    from src.db.client import get_db_session

    async with get_db_session() as session:
        for risk in risks:
            has_quote_evidence = has_evidence(getattr(risk, "quoted_text", None))
            metrics.track_evidence_completeness(
                organization_id=envelope.organization_id,
                uio_type="risk",
                status="present" if has_quote_evidence else "missing",
            )
            if not has_quote_evidence:
                logger.info(
                    "Skipping risk without evidence",
                    title=getattr(risk, "title", None),
                    analysis_id=envelope.analysis_id,
                )
                continue

            message_id = getattr(risk, "source_message_id", None) or resolve_message_id(
                envelope.messages, getattr(risk, "quoted_text", None)
            )

            # Vector search deduplication candidate: use it as an "existing id hint"
            # but still run supersession checks so updates are not lost.
            merge_candidate = merge_lookup.get(getattr(risk, "id", ""))
            existing_uio_id = None
            if merge_candidate:
                existing_uio_id = str(getattr(merge_candidate, "existing_uio_id", "") or "") or None
            if not existing_uio_id:
                existing_uio_id = await find_existing_uio(
                    session,
                    envelope.organization_id,
                    "risk",
                    getattr(risk, "title", ""),
                )

            supersedes_uio_id = None
            if existing_uio_id:
                should_supersede = await should_supersede_risk(session, existing_uio_id, risk)
                if not should_supersede:
                    results.uios_merged.append(
                        {"sourceId": getattr(risk, "id", ""), "targetId": existing_uio_id}
                    )
                    logger.info(
                        "Skipping duplicate risk (PostgreSQL match)",
                        title=getattr(risk, "title", None),
                        existing_uio_id=existing_uio_id,
                    )

                    now = utc_now()
                    source_id = await insert_uio_source(
                        session=session,
                        envelope=envelope,
                        uio_id=existing_uio_id,
                        role="confirmation",
                        message_id=message_id,
                        quoted_text=getattr(risk, "quoted_text", None),
                        quoted_text_start=getattr(risk, "quoted_text_start", None),
                        quoted_text_end=getattr(risk, "quoted_text_end", None),
                        extracted_title=getattr(risk, "title", None),
                        extracted_due_date=None,
                        extracted_status=None,
                        confidence=getattr(risk, "confidence", None),
                        now=now,
                    )

                    await audit_uio_source(
                        organization_id=envelope.organization_id,
                        evidence_id=source_id,
                        uio_id=existing_uio_id,
                        uio_type="risk",
                        action="uio_source_added",
                        conversation_id=envelope.conversation_id,
                        message_id=message_id,
                    )

                    await create_timeline_event(
                        session=session,
                        uio_id=existing_uio_id,
                        event_type="source_added",
                        event_description=f"Risk confirmed from {envelope.source_type or 'email'}: {getattr(risk, 'title', '')}",
                        source_type=envelope.source_type or "email",
                        source_id=envelope.conversation_id,
                        quoted_text=getattr(risk, "quoted_text", None),
                        evidence_id=source_id,
                        new_value={
                            "title": getattr(risk, "title", None),
                            "severity": getattr(risk, "severity", None),
                            "source": envelope.source_type or "email",
                        },
                        confidence=getattr(risk, "confidence", None),
                        triggered_by="system",
                    )

                    await session.commit()
                    continue

                supersedes_uio_id = existing_uio_id

            uio_id = str(uuid4())
            now = utc_now()
            results.uios_created.append({"id": uio_id, "type": "risk"})

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
                        :id, :org_id, 'risk', 'active',
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
                    "title": getattr(risk, "title", None) or "",
                    "description": getattr(risk, "description", None) or "",
                    "confidence": getattr(risk, "confidence", None),
                    "now": now,
                    **temporal_fields(now),
                },
            )

            risk_details_id = str(uuid4())
            risk_type_value = _risk_type_value(getattr(risk, "type", None))
            risk_severity = _risk_severity_value(getattr(risk, "severity", None))
            findings = {
                "description": getattr(risk, "description", None),
                "evidence": [getattr(risk, "quoted_text", None)] if getattr(risk, "quoted_text", None) else [],
                "potentialImpact": getattr(risk, "reasoning", None),
            }
            extraction_context = {
                "reasoning": getattr(risk, "reasoning", None),
                "quotedText": getattr(risk, "quoted_text", None),
                "modelUsed": getattr(risk, "model_used", None),
                "modelTier": getattr(risk, "model_tier", None),
                "evidenceCount": 1 if getattr(risk, "quoted_text", None) else 0,
                "confidenceReasoning": getattr(risk, "confidence_reasoning", None),
            }

            await session.execute(
                text(
                    """
                    INSERT INTO uio_risk_details (
                        id, uio_id, risk_type, severity,
                        suggested_action, findings, extraction_context,
                        supersedes_uio_id, superseded_by_uio_id,
                        created_at, updated_at
                    ) VALUES (
                        :id, :uio_id, :risk_type, :severity,
                        :suggested_action, :findings, :extraction_context,
                        :supersedes_uio_id, :superseded_by_uio_id,
                        :now, :now
                    )
                    """
                ),
                {
                    "id": risk_details_id,
                    "uio_id": uio_id,
                    "risk_type": risk_type_value,
                    "severity": risk_severity,
                    "suggested_action": getattr(risk, "suggested_action", None),
                    "findings": json.dumps(findings),
                    "extraction_context": json.dumps(extraction_context),
                    "supersedes_uio_id": supersedes_uio_id,
                    "superseded_by_uio_id": None,
                    "now": now,
                },
            )

            source_id = await insert_uio_source(
                session=session,
                envelope=envelope,
                uio_id=uio_id,
                role="origin",
                message_id=message_id,
                quoted_text=getattr(risk, "quoted_text", None),
                quoted_text_start=getattr(risk, "quoted_text_start", None),
                quoted_text_end=getattr(risk, "quoted_text_end", None),
                extracted_title=getattr(risk, "title", None),
                extracted_due_date=None,
                extracted_status=None,
                confidence=getattr(risk, "confidence", None),
                now=now,
            )

            await audit_uio_source(
                organization_id=envelope.organization_id,
                evidence_id=source_id,
                uio_id=uio_id,
                uio_type="risk",
                action="uio_created",
                conversation_id=envelope.conversation_id,
                message_id=message_id,
            )

            extracted_id = getattr(risk, "id", None)
            if extracted_id:
                results.created_uio_by_extracted_id[str(extracted_id)] = {
                    "uio_id": uio_id,
                    "type": "risk",
                    "evidence_id": source_id,
                }

            await create_timeline_event(
                session=session,
                uio_id=uio_id,
                event_type="created",
                event_description=f"Risk detected from {envelope.source_type or 'email'}: {getattr(risk, 'title', '')}",
                source_type=envelope.source_type or "email",
                source_id=envelope.conversation_id,
                quoted_text=getattr(risk, "quoted_text", None),
                evidence_id=source_id,
                new_value={
                    "title": getattr(risk, "title", None),
                    "type": getattr(risk, "type", None),
                    "severity": getattr(risk, "severity", None),
                    "confidence": getattr(risk, "confidence", None),
                },
                confidence=getattr(risk, "confidence", None),
                triggered_by="system",
            )

            if supersedes_uio_id:
                await apply_supersession(
                    session,
                    now=now,
                    organization_id=envelope.organization_id,
                    existing_uio_id=supersedes_uio_id,
                    new_uio_id=uio_id,
                    uio_type="risk",
                    evidence_id=source_id,
                    source_type=envelope.source_type or "email",
                    conversation_id=envelope.conversation_id,
                    message_id=message_id,
                )

            await session.commit()

            logger.debug(
                "Created risk",
                uio_id=uio_id,
                title=getattr(risk, "title", None),
            )
