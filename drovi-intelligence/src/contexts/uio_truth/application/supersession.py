"""Supersession logic for bi-temporal UIO truth objects.

"Supersession" is the canonical way we handle "the same concept changed over time"
without deleting history. The old UIO is closed (valid_to/system_to set) and the
new UIO points back.
"""

from __future__ import annotations

from datetime import datetime

import structlog
from sqlalchemy import text

from src.contexts.uio_truth.application.persist_utils import (
    to_naive_utc,
    values_differ,
)
from src.contexts.uio_truth.application.timeline import create_timeline_event

logger = structlog.get_logger()


async def find_existing_uio(session, org_id: str, uio_type: str, title: str) -> str | None:
    """Find an existing active UIO by case-insensitive canonical title."""
    if not title:
        return None

    result = await session.execute(
        text(
            """
            SELECT id FROM unified_intelligence_object
            WHERE organization_id = :org_id
              AND type = :uio_type
              AND LOWER(TRIM(canonical_title)) = LOWER(TRIM(:title))
              AND status = 'active'
            LIMIT 1
            """
        ),
        {"org_id": org_id, "uio_type": uio_type, "title": title},
    )
    row = result.fetchone()
    return row[0] if row else None


async def should_supersede_commitment(session, existing_uio_id: str, commitment) -> bool:
    result = await session.execute(
        text(
            """
            SELECT u.canonical_description, u.due_date,
                   cd.direction, cd.priority
            FROM unified_intelligence_object u
            LEFT JOIN uio_commitment_details cd ON u.id = cd.uio_id
            WHERE u.id = :uio_id
            """
        ),
        {"uio_id": existing_uio_id},
    )
    row = result.fetchone()
    if not row:
        return False
    return any(
        [
            values_differ(row.canonical_description, commitment.description or ""),
            values_differ(row.due_date, to_naive_utc(commitment.due_date)),
            values_differ(row.direction, commitment.direction),
            values_differ(row.priority, commitment.priority),
        ]
    )


async def should_supersede_decision(session, existing_uio_id: str, decision) -> bool:
    result = await session.execute(
        text(
            """
            SELECT u.canonical_description,
                   dd.statement, dd.rationale, dd.status
            FROM unified_intelligence_object u
            LEFT JOIN uio_decision_details dd ON u.id = dd.uio_id
            WHERE u.id = :uio_id
            """
        ),
        {"uio_id": existing_uio_id},
    )
    row = result.fetchone()
    if not row:
        return False
    return any(
        [
            values_differ(row.statement, decision.statement),
            values_differ(row.rationale, decision.rationale or ""),
            values_differ(row.status, decision.status),
        ]
    )


async def should_supersede_task(session, existing_uio_id: str, task) -> bool:
    result = await session.execute(
        text(
            """
            SELECT u.canonical_description, u.due_date,
                   td.status, td.priority, td.project, td.tags
            FROM unified_intelligence_object u
            LEFT JOIN uio_task_details td ON u.id = td.uio_id
            WHERE u.id = :uio_id
            """
        ),
        {"uio_id": existing_uio_id},
    )
    row = result.fetchone()
    if not row:
        return False
    return any(
        [
            values_differ(row.canonical_description, task.description or ""),
            values_differ(row.due_date, to_naive_utc(task.due_date)),
            values_differ(row.status, task.status),
            values_differ(row.priority, task.priority),
            values_differ(row.project, getattr(task, "project", None)),
            values_differ(row.tags, getattr(task, "tags", None) or []),
        ]
    )


async def should_supersede_risk(session, existing_uio_id: str, risk) -> bool:
    result = await session.execute(
        text(
            """
            SELECT u.canonical_description,
                   rd.severity, rd.risk_type, rd.suggested_action
            FROM unified_intelligence_object u
            LEFT JOIN uio_risk_details rd ON u.id = rd.uio_id
            WHERE u.id = :uio_id
            """
        ),
        {"uio_id": existing_uio_id},
    )
    row = result.fetchone()
    if not row:
        return False
    return any(
        [
            values_differ(row.canonical_description, risk.description or ""),
            values_differ(row.severity, risk.severity),
            values_differ(row.risk_type, risk.type),
            values_differ(row.suggested_action, risk.suggested_action),
        ]
    )


async def apply_supersession(
    session,
    *,
    now: datetime,
    organization_id: str,
    existing_uio_id: str,
    new_uio_id: str,
    uio_type: str,
    evidence_id: str | None,
    source_type: str | None,
    conversation_id: str | None,
    message_id: str | None,
) -> None:
    """Close the existing UIO and link it to the new UIO."""
    detail_table = {
        "commitment": "uio_commitment_details",
        "decision": "uio_decision_details",
        "task": "uio_task_details",
        "risk": "uio_risk_details",
    }.get(uio_type)

    await session.execute(
        text(
            """
            UPDATE unified_intelligence_object
            SET valid_to = :now,
                system_to = :now,
                last_updated_at = :now,
                updated_at = :now
            WHERE id = :existing_id
            """
        ),
        {"now": now, "existing_id": existing_uio_id},
    )

    if detail_table:
        await session.execute(
            text(
                f"""
                UPDATE {detail_table}
                SET superseded_by_uio_id = :new_id
                WHERE uio_id = :existing_id
                """
            ),
            {"new_id": new_uio_id, "existing_id": existing_uio_id},
        )
        await session.execute(
            text(
                f"""
                UPDATE {detail_table}
                SET supersedes_uio_id = :existing_id
                WHERE uio_id = :new_id
                """
            ),
            {"existing_id": existing_uio_id, "new_id": new_uio_id},
        )

    await create_timeline_event(
        session=session,
        uio_id=existing_uio_id,
        event_type="superseded",
        event_description=f"Superseded by {uio_type} {new_uio_id}",
        source_type=source_type,
        source_id=conversation_id,
        quoted_text=None,
        evidence_id=evidence_id,
        new_value={"superseded_by": new_uio_id},
        confidence=None,
        triggered_by="system",
    )
    await create_timeline_event(
        session=session,
        uio_id=new_uio_id,
        event_type="supersedes",
        event_description=f"Supersedes {uio_type} {existing_uio_id}",
        source_type=source_type,
        source_id=conversation_id,
        quoted_text=None,
        evidence_id=evidence_id,
        new_value={"supersedes": existing_uio_id},
        confidence=None,
        triggered_by="system",
    )
