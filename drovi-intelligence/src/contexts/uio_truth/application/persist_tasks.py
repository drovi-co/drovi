"""Task persistence (truth spine only).

Tasks are tricky because they overlap with commitments/decisions. We keep the
deduplication rules explicit here:
- If a task is explicitly marked ("Task:", "TODO:"), persist it even if similar.
- Otherwise, skip tasks that duplicate a commitment/decision.

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
    should_supersede_task,
)
from src.contexts.uio_truth.application.timeline import create_timeline_event
from src.contexts.uio_truth.application.uio_sources import insert_uio_source
from src.kernel.time import utc_now_naive as utc_now

logger = structlog.get_logger()


def _dedupe_by_title(items: list[Any], item_type: str) -> list[Any]:
    """Deduplicate items by title, keeping the highest-confidence version."""
    seen_titles: dict[str, int] = {}
    result: list[Any] = []
    duplicates_merged = 0

    for item in items:
        title = (getattr(item, "title", None) or "").lower().strip()
        if not title:
            result.append(item)
            continue

        if title in seen_titles:
            existing_idx = seen_titles[title]
            existing_item = result[existing_idx]
            if getattr(item, "confidence", 0.0) > getattr(existing_item, "confidence", 0.0):
                result[existing_idx] = item
            duplicates_merged += 1
        else:
            seen_titles[title] = len(result)
            result.append(item)

    if duplicates_merged > 0:
        logger.info(
            "Intra-batch deduplication: merged duplicate tasks",
            item_type=item_type,
            original_count=len(items),
            deduplicated_count=len(result),
            duplicates_merged=duplicates_merged,
        )
    return result


def _has_explicit_task_marker(task: Any) -> bool:
    quoted = (getattr(task, "quoted_text", None) or "").strip().lower()
    return quoted.startswith(("task:", "todo:", "action:", "action item:", "follow up:"))


def _build_dedupe_sets(commitments: list[Any], decisions: list[Any]) -> tuple[set[str], set[str]]:
    commitment_titles = {
        (getattr(c, "title", None) or "").lower().strip()
        for c in commitments
        if getattr(c, "title", None)
    }
    decision_titles = {
        (getattr(d, "title", None) or "").lower().strip()
        for d in decisions
        if getattr(d, "title", None)
    }
    decision_statements = {
        (getattr(d, "statement", None) or "").lower().strip()
        for d in decisions
        if getattr(d, "statement", None)
    }
    return commitment_titles, (decision_titles | decision_statements)


def _is_duplicate_task(task_title: str | None, task: Any, *, commitment_titles: set[str], decision_texts: set[str]) -> bool:
    if not task_title:
        return False
    if _has_explicit_task_marker(task):
        return False

    title_lower = task_title.lower().strip()

    if title_lower in commitment_titles:
        return True
    if title_lower in decision_texts:
        return True

    # Fuzzy match: skip near-duplicates when overlap is significant (>70%).
    title_words = set(title_lower.split())
    for ct in commitment_titles:
        if title_lower in ct or ct in title_lower:
            ct_words = set(ct.split())
            max_words = max(len(title_words), len(ct_words))
            overlap = len(title_words & ct_words)
            if max_words > 0 and overlap / max_words > 0.7:
                return True

    for dt in decision_texts:
        if title_lower in dt or dt in title_lower:
            dt_words = set(dt.split())
            max_words = max(len(title_words), len(dt_words))
            overlap = len(title_words & dt_words)
            if max_words > 0 and overlap / max_words > 0.7:
                return True

    return False


async def persist_tasks(
    *,
    envelope: PersistEnvelope,
    tasks: list[Any],
    commitments: list[Any],
    decisions: list[Any],
    merge_lookup: dict[str, Any],
    results: PersistResults,
    metrics: Any,
) -> None:
    from src.db.client import get_db_session

    tasks_to_persist = _dedupe_by_title(tasks, "task")
    commitment_titles, decision_texts = _build_dedupe_sets(commitments, decisions)

    async with get_db_session() as session:
        for task in tasks_to_persist:
            if _is_duplicate_task(
                getattr(task, "title", None),
                task,
                commitment_titles=commitment_titles,
                decision_texts=decision_texts,
            ):
                logger.debug(
                    "Skipping duplicate task",
                    task_title=getattr(task, "title", None),
                    reason="duplicates commitment or decision",
                )
                continue

            has_quote_evidence = has_evidence(getattr(task, "quoted_text", None))
            metrics.track_evidence_completeness(
                organization_id=envelope.organization_id,
                uio_type="task",
                status="present" if has_quote_evidence else "missing",
            )
            if not has_quote_evidence:
                logger.info(
                    "Skipping task without evidence",
                    title=getattr(task, "title", None),
                    analysis_id=envelope.analysis_id,
                )
                continue

            message_id = getattr(task, "source_message_id", None) or resolve_message_id(
                envelope.messages, getattr(task, "quoted_text", None)
            )

            # Vector search deduplication candidate: use it as an "existing id hint"
            # but still run supersession checks so updates are not lost.
            merge_candidate = merge_lookup.get(getattr(task, "id", ""))
            existing_uio_id = None
            if merge_candidate:
                existing_uio_id = str(getattr(merge_candidate, "existing_uio_id", "") or "") or None
            if not existing_uio_id:
                existing_uio_id = await find_existing_uio(
                    session,
                    envelope.organization_id,
                    "task",
                    getattr(task, "title", ""),
                )

            supersedes_uio_id = None
            if existing_uio_id:
                should_supersede = await should_supersede_task(session, existing_uio_id, task)
                if not should_supersede:
                    results.uios_merged.append(
                        {"sourceId": getattr(task, "id", ""), "targetId": existing_uio_id}
                    )
                    logger.info(
                        "Skipping duplicate task (PostgreSQL match)",
                        title=getattr(task, "title", None),
                        existing_uio_id=existing_uio_id,
                    )

                    now = utc_now()
                    source_id = await insert_uio_source(
                        session=session,
                        envelope=envelope,
                        uio_id=existing_uio_id,
                        role="confirmation",
                        message_id=message_id,
                        quoted_text=getattr(task, "quoted_text", None),
                        quoted_text_start=getattr(task, "quoted_text_start", None),
                        quoted_text_end=getattr(task, "quoted_text_end", None),
                        extracted_title=getattr(task, "title", None),
                        extracted_due_date=to_naive_utc(getattr(task, "due_date", None)),
                        extracted_status=getattr(task, "status", None),
                        confidence=getattr(task, "confidence", 0.9),
                        now=now,
                    )

                    await audit_uio_source(
                        organization_id=envelope.organization_id,
                        evidence_id=source_id,
                        uio_id=existing_uio_id,
                        uio_type="task",
                        action="uio_source_added",
                        conversation_id=envelope.conversation_id,
                        message_id=message_id,
                    )

                    await create_timeline_event(
                        session=session,
                        uio_id=existing_uio_id,
                        event_type="source_added",
                        event_description=f"Task confirmed from {envelope.source_type or 'email'}: {getattr(task, 'title', '')}",
                        source_type=envelope.source_type or "email",
                        source_id=envelope.conversation_id,
                        quoted_text=getattr(task, "quoted_text", None),
                        evidence_id=source_id,
                        new_value={
                            "title": getattr(task, "title", None),
                            "status": getattr(task, "status", None),
                            "source": envelope.source_type or "email",
                        },
                        confidence=getattr(task, "confidence", 0.9),
                        triggered_by="system",
                    )

                    await session.commit()
                    continue

                supersedes_uio_id = existing_uio_id

            uio_id = str(uuid4())
            now = utc_now()
            results.uios_created.append({"id": uio_id, "type": "task"})

            await session.execute(
                text(
                    """
                    INSERT INTO unified_intelligence_object (
                        id, organization_id, type, status,
                        canonical_title, canonical_description,
                        due_date, overall_confidence,
                        first_seen_at, last_updated_at,
                        valid_from, valid_to, system_from, system_to,
                        created_at, updated_at
                    ) VALUES (
                        :id, :org_id, 'task', 'active',
                        :title, :description,
                        :due_date, :overall_confidence,
                        :now, :now,
                        :valid_from, :valid_to, :system_from, :system_to,
                        :now, :now
                    )
                    """
                ),
                {
                    "id": uio_id,
                    "org_id": envelope.organization_id,
                    "title": getattr(task, "title", None) or "",
                    "description": getattr(task, "description", None) or "",
                    "due_date": to_naive_utc(getattr(task, "due_date", None)),
                    "overall_confidence": 0.9,
                    "now": now,
                    **temporal_fields(now),
                },
            )

            status_map = {
                "todo": "todo",
                "backlog": "backlog",
                "in_progress": "in_progress",
                "in_review": "in_review",
                "done": "done",
                "cancelled": "cancelled",
                "completed": "done",
                "pending": "backlog",
            }
            task_status = (
                status_map.get(getattr(task, "status", None), "backlog")
                if getattr(task, "status", None)
                else "backlog"
            )

            priority_map = {
                "no_priority": "no_priority",
                "low": "low",
                "medium": "medium",
                "high": "high",
                "urgent": "urgent",
            }
            task_priority = (
                priority_map.get(getattr(task, "priority", None), "no_priority")
                if getattr(task, "priority", None)
                else "no_priority"
            )

            completed_at = None
            if task_status == "done" and getattr(task, "completed_at", None):
                completed_at = to_naive_utc(getattr(task, "completed_at", None))

            extraction_context = {
                "reasoning": getattr(task, "reasoning", None),
                "quotedText": getattr(task, "quoted_text", None),
                "modelUsed": getattr(task, "model_used", None),
                "modelTier": getattr(task, "model_tier", None),
                "evidenceCount": 1 if getattr(task, "quoted_text", None) else 0,
                "confidenceReasoning": getattr(task, "confidence_reasoning", None),
            }

            assignee_contact_id = await resolve_contact_id_by_email(
                session, envelope.organization_id, getattr(task, "assignee_email", None)
            )
            created_by_contact_id = await resolve_contact_id_by_email(
                session, envelope.organization_id, getattr(task, "created_by_email", None)
            )

            task_details_id = str(uuid4())
            await session.execute(
                text(
                    """
                    INSERT INTO uio_task_details (
                        id, uio_id, status, priority,
                        assignee_contact_id, created_by_contact_id,
                        estimated_effort, completed_at,
                        project, tags,
                        extraction_context,
                        supersedes_uio_id, superseded_by_uio_id,
                        created_at, updated_at
                    ) VALUES (
                        :id, :uio_id, :status, :priority,
                        :assignee_contact_id, :created_by_contact_id,
                        :estimated_effort, :completed_at,
                        :project, :tags,
                        :extraction_context,
                        :supersedes_uio_id, :superseded_by_uio_id,
                        :now, :now
                    )
                    """
                ),
                {
                    "id": task_details_id,
                    "uio_id": uio_id,
                    "status": task_status,
                    "priority": task_priority,
                    "assignee_contact_id": assignee_contact_id,
                    "created_by_contact_id": created_by_contact_id,
                    "estimated_effort": getattr(task, "estimated_effort", None),
                    "completed_at": completed_at,
                    "project": getattr(task, "project", None),
                    "tags": getattr(task, "tags", []) or [],
                    "extraction_context": json.dumps(extraction_context),
                    "supersedes_uio_id": supersedes_uio_id,
                    "superseded_by_uio_id": None,
                    "now": now,
                },
            )

            task_source_id = await insert_uio_source(
                session=session,
                envelope=envelope,
                uio_id=uio_id,
                role="origin",
                message_id=message_id,
                quoted_text=getattr(task, "quoted_text", None),
                quoted_text_start=getattr(task, "quoted_text_start", None),
                quoted_text_end=getattr(task, "quoted_text_end", None),
                extracted_title=getattr(task, "title", None),
                extracted_due_date=to_naive_utc(getattr(task, "due_date", None)),
                extracted_status=task_status,
                confidence=getattr(task, "confidence", None),
                now=now,
            )

            await audit_uio_source(
                organization_id=envelope.organization_id,
                evidence_id=task_source_id,
                uio_id=uio_id,
                uio_type="task",
                action="uio_created",
                conversation_id=envelope.conversation_id,
                message_id=message_id,
            )

            extracted_id = getattr(task, "id", None)
            if extracted_id:
                results.created_uio_by_extracted_id[str(extracted_id)] = {
                    "uio_id": uio_id,
                    "type": "task",
                    "evidence_id": task_source_id,
                }

            await create_timeline_event(
                session=session,
                uio_id=uio_id,
                event_type="created",
                event_description=f"Task extracted from {envelope.source_type or 'email'}: {getattr(task, 'title', '')}",
                source_type=envelope.source_type or "email",
                source_id=envelope.conversation_id,
                quoted_text=getattr(task, "quoted_text", None),
                evidence_id=task_source_id,
                new_value={
                    "title": getattr(task, "title", None),
                    "status": task_status,
                    "priority": task_priority,
                    "dueDate": getattr(task, "due_date", None).isoformat() if getattr(task, "due_date", None) else None,
                },
                confidence=getattr(task, "confidence", None),
                triggered_by="system",
            )

            if supersedes_uio_id:
                await apply_supersession(
                    session,
                    now=now,
                    organization_id=envelope.organization_id,
                    existing_uio_id=supersedes_uio_id,
                    new_uio_id=uio_id,
                    uio_type="task",
                    evidence_id=task_source_id,
                    source_type=envelope.source_type or "email",
                    conversation_id=envelope.conversation_id,
                    message_id=message_id,
                )

            results.tasks_created.append({"id": uio_id, "title": getattr(task, "title", None)})

        await session.commit()
