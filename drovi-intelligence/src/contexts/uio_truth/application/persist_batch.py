"""Persist an extraction batch (application use-case).

This module centralizes *orchestration* for persisting extracted signals into the
UIO truth spine. The LangGraph node should be a thin adapter that:
- builds a PersistEnvelope from the orchestration input
- invokes this use-case
- maps results back to the orchestrator state/output

Notes:
- The hot path writes only canonical truth (Postgres).
- Derived indexes (graph/vector) are built asynchronously via the outbox drain.
- Inputs are deliberately typed as `Any` to avoid coupling this context to
  orchestrator Pydantic models. Persistence functions use attribute access.
"""

from __future__ import annotations

import hashlib
from typing import Any, Iterable, Sequence

import structlog

from src.contexts.uio_truth.application.persist_brief import (
    persist_brief_uio,
    update_conversation_with_brief,
)
from src.contexts.uio_truth.application.persist_claims import persist_claims
from src.contexts.uio_truth.application.persist_commitments import persist_commitments
from src.contexts.uio_truth.application.persist_contacts import persist_contacts
from src.contexts.uio_truth.application.persist_contradictions import persist_contradictions
from src.contexts.uio_truth.application.persist_decisions import persist_decisions
from src.contexts.uio_truth.application.persist_envelope import PersistEnvelope
from src.contexts.uio_truth.application.persist_results import PersistResults
from src.contexts.uio_truth.application.persist_risks import persist_risks
from src.contexts.uio_truth.application.persist_tasks import persist_tasks
from src.graph.types import get_confidence_tier

logger = structlog.get_logger()


def _apply_pattern_boost(items: Iterable[Any], boost: float) -> None:
    if boost <= 0:
        return
    for item in items:
        try:
            current = getattr(item, "confidence", None) or 0.0
            setattr(item, "confidence", min(1.0, current + boost))
            if hasattr(item, "confidence_reasoning"):
                existing = getattr(item, "confidence_reasoning") or ""
                note = f"Pattern boost +{boost:.2f}"
                setattr(item, "confidence_reasoning", f"{existing} {note}".strip() if existing else note)
        except Exception:
            continue


def _dedupe_by_title(items: list[Any], item_type: str) -> list[Any]:
    """Deduplicate items by title, keeping highest confidence version."""
    seen_titles: dict[str, int] = {}  # title -> index in result list
    result: list[Any] = []
    duplicates_merged = 0

    for item in items:
        title = (getattr(item, "title", "") or "").lower().strip()
        if not title:
            result.append(item)
            continue

        if title in seen_titles:
            existing_idx = seen_titles[title]
            existing_item = result[existing_idx]
            if (getattr(item, "confidence", 0.0) or 0.0) > (getattr(existing_item, "confidence", 0.0) or 0.0):
                result[existing_idx] = item
            duplicates_merged += 1
        else:
            seen_titles[title] = len(result)
            result.append(item)

    if duplicates_merged > 0:
        logger.info(
            "Intra-batch deduplication merged duplicates",
            item_type=item_type,
            duplicates_merged=duplicates_merged,
            original_count=len(items),
            deduplicated_count=len(result),
        )

    return result


def _assign_confidence_tier(items: list[Any], kind: str, tier_stats: dict[str, dict[str, int]]) -> list[Any]:
    out: list[Any] = []
    for item in items:
        confidence = getattr(item, "confidence", 0.0) or 0.0
        tier = get_confidence_tier(confidence)
        tier_stats.setdefault(kind, {}).setdefault(tier.value, 0)
        tier_stats[kind][tier.value] += 1
        # Attach tier for persistence (stored in extraction_context).
        try:
            setattr(item, "_confidence_tier", tier.value)
        except Exception:
            pass
        out.append(item)
    return out


def _build_merge_lookup(merge_candidates: Sequence[Any]) -> dict[str, Any]:
    lookup: dict[str, Any] = {}
    for mc in merge_candidates:
        try:
            if getattr(mc, "should_merge", False):
                lookup[getattr(mc, "new_item_id")] = mc
        except Exception:
            continue
    return lookup


async def persist_extraction_batch(
    *,
    envelope: PersistEnvelope,
    commitments: list[Any],
    decisions: list[Any],
    risks: list[Any],
    tasks: list[Any],
    claims: list[Any],
    contacts: list[Any],
    merge_candidates: Sequence[Any],
    candidates_persisted: bool,
    pattern_confidence_boost: float,
    brief: Any | None,
    classification: Any | None,
    contradiction_pairs: Any | None,
    sender_email: str | None,
    metrics: Any,
) -> tuple[PersistResults, list[str]]:
    """Persist the extracted batch into canonical truth (Postgres)."""
    errors: list[str] = []

    extracted_any = bool(commitments or decisions or risks or tasks or claims)
    if extracted_any and not candidates_persisted:
        errors.append("persist: candidates_not_persisted")
        return PersistResults(), errors

    # Apply pattern confidence boost (fast-path precision).
    boost = pattern_confidence_boost or 0.0
    if boost > 0:
        _apply_pattern_boost(commitments, boost)
        _apply_pattern_boost(decisions, boost)
        _apply_pattern_boost(claims, boost)
        _apply_pattern_boost(tasks, boost)
        _apply_pattern_boost(risks, boost)

    tier_stats: dict[str, dict[str, int]] = {
        "commitments": {"high": 0, "medium": 0, "low": 0, "speculative": 0},
        "decisions": {"high": 0, "medium": 0, "low": 0, "speculative": 0},
        "claims": {"high": 0, "medium": 0, "low": 0, "speculative": 0},
    }

    commitments_to_persist = _assign_confidence_tier(commitments, "commitments", tier_stats)
    decisions_to_persist = _assign_confidence_tier(decisions, "decisions", tier_stats)
    claims_to_persist = _assign_confidence_tier(claims, "claims", tier_stats)

    commitments_to_persist = _dedupe_by_title(commitments_to_persist, "commitment")
    decisions_to_persist = _dedupe_by_title(decisions_to_persist, "decision")
    risks_to_persist = _dedupe_by_title(risks, "risk")

    merge_lookup = _build_merge_lookup(merge_candidates)

    results = PersistResults()

    # Contacts first so per-UIO persisters can resolve contact IDs by email.
    try:
        await persist_contacts(
            envelope=envelope,
            contacts=contacts,
            results=results,
        )
    except Exception as exc:
        logger.error("persist_contacts failed", error=str(exc), analysis_id=envelope.analysis_id)
        errors.append(f"persist_contacts: {str(exc)}")

    try:
        await persist_commitments(
            envelope=envelope,
            commitments=commitments_to_persist,
            merge_lookup=merge_lookup,
            results=results,
            metrics=metrics,
        )
    except Exception as exc:
        logger.error("persist_commitments failed", error=str(exc), analysis_id=envelope.analysis_id)
        errors.append(f"persist_commitments: {str(exc)}")

    try:
        await persist_decisions(
            envelope=envelope,
            decisions=decisions_to_persist,
            merge_lookup=merge_lookup,
            results=results,
            metrics=metrics,
        )
    except Exception as exc:
        logger.error("persist_decisions failed", error=str(exc), analysis_id=envelope.analysis_id)
        errors.append(f"persist_decisions: {str(exc)}")

    try:
        await persist_risks(
            envelope=envelope,
            risks=risks_to_persist,
            merge_lookup=merge_lookup,
            results=results,
            metrics=metrics,
        )
    except Exception as exc:
        logger.error("persist_risks failed", error=str(exc), analysis_id=envelope.analysis_id)
        errors.append(f"persist_risks: {str(exc)}")

    try:
        await persist_tasks(
            envelope=envelope,
            tasks=tasks,
            commitments=commitments,
            decisions=decisions,
            merge_lookup=merge_lookup,
            results=results,
            metrics=metrics,
        )
    except Exception as exc:
        logger.error("persist_tasks failed", error=str(exc), analysis_id=envelope.analysis_id)
        errors.append(f"persist_tasks: {str(exc)}")

    try:
        await persist_claims(
            envelope=envelope,
            claims=claims_to_persist,
            merge_lookup=merge_lookup,
            results=results,
            metrics=metrics,
        )
    except Exception as exc:
        logger.error("persist_claims failed", error=str(exc), analysis_id=envelope.analysis_id)
        errors.append(f"persist_claims: {str(exc)}")

    if brief is not None:
        try:
            await persist_brief_uio(
                envelope=envelope,
                brief=brief,
                classification=classification,
                results=results,
            )
        except Exception as exc:
            logger.error("persist_brief_uio failed", error=str(exc), analysis_id=envelope.analysis_id)
            errors.append(f"persist_brief_uio: {str(exc)}")

        try:
            commitment_count = len([u for u in results.uios_created if u.get("type") == "commitment"])
            decision_count = len([u for u in results.uios_created if u.get("type") == "decision"])
            claim_count = len(results.claims_created)

            await update_conversation_with_brief(
                envelope=envelope,
                brief=brief,
                classification=classification,
                commitment_count=commitment_count,
                decision_count=decision_count,
                claim_count=claim_count,
                has_risk_warning=len(risks) > 0,
                risk_level=getattr(risks[0], "severity", None) if risks else None,
            )
        except Exception as exc:
            logger.error("update_conversation_with_brief failed", error=str(exc), analysis_id=envelope.analysis_id)
            errors.append(f"persist_brief: {str(exc)}")

    if contradiction_pairs is not None:
        try:
            await persist_contradictions(
                envelope=envelope,
                contradiction_pairs=contradiction_pairs,
                created_uio_by_extracted_id=results.created_uio_by_extracted_id,
            )
        except Exception as exc:
            logger.warning("persist_contradictions failed", error=str(exc), analysis_id=envelope.analysis_id)
            errors.append(f"persist_contradictions: {str(exc)}")

    # Emit a derived-index outbox event so the async indexers can replay/rebuild.
    if (
        results.uios_created
        or results.uios_merged
        or results.tasks_created
        or results.claims_created
        or results.contacts_created
    ):
        try:
            from src.jobs.outbox import EnqueueOutboxEventRequest, enqueue_outbox_event

            material = f"derived-index-batch:{envelope.organization_id}:{envelope.analysis_id}"
            idempotency_key = hashlib.sha256(material.encode("utf-8")).hexdigest()
            await enqueue_outbox_event(
                EnqueueOutboxEventRequest(
                    organization_id=envelope.organization_id,
                    event_type="indexes.derived.batch",
                    payload={
                        "organization_id": envelope.organization_id,
                        "analysis_id": envelope.analysis_id,
                        "source_type": envelope.source_type,
                        "source_id": envelope.source_id,
                        "conversation_id": envelope.conversation_id,
                        "sender_email": sender_email,
                        "uios_created": list(results.uios_created),
                        "uios_merged": list(results.uios_merged),
                        "tasks_created": list(results.tasks_created),
                        "claims_created": list(results.claims_created),
                        "contacts_created": list(results.contacts_created),
                        "contacts": list(results.contacts_created),
                    },
                    idempotency_key=idempotency_key,
                    payload_version=1,
                    priority=0,
                    max_attempts=10,
                )
            )
        except Exception as exc:
            logger.warning("Failed to enqueue derived-index outbox event", error=str(exc), analysis_id=envelope.analysis_id)
            errors.append(f"outbox: {str(exc)}")

    return results, errors
