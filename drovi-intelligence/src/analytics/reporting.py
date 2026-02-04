"""
Weekly Reporting

Generates executive briefs and organizational blindspot reports.
"""

from __future__ import annotations

from collections import Counter
from datetime import datetime, timedelta, timezone

import structlog
from sqlalchemy import text

from src.analytics.blindspot_detection import get_blindspot_detection_service
from src.db.client import get_db_session
from src.notifications.reports import send_report_email
from src.uio.manager import UIOManager
from src.uio.schemas import (
    BriefAction,
    BriefDetailsCreate,
    BriefPriority,
    CreateBriefUIO,
    SourceContext,
    UIOCreate,
    UIOStatus,
    UIOType,
)

logger = structlog.get_logger()


async def _list_organizations(pilot_only: bool = True) -> list[dict]:
    async with get_db_session() as session:
        if pilot_only:
            result = await session.execute(
                text(
                    """
                    SELECT id, name
                    FROM organizations
                    WHERE pilot_status = 'active'
                    """
                )
            )
        else:
            result = await session.execute(
                text(
                    """
                    SELECT id, name
                    FROM organizations
                    """
                )
            )
        return [
            {"id": row.id, "name": row.name}
            for row in result.fetchall()
        ]


def _derive_priority_from_risks(risks: list[dict]) -> BriefPriority:
    severity_rank = {"critical": 4, "high": 3, "medium": 2, "low": 1}
    highest = 0
    for risk in risks:
        highest = max(highest, severity_rank.get(risk.get("severity", "low"), 1))
    if highest >= 4:
        return BriefPriority.URGENT
    if highest >= 3:
        return BriefPriority.HIGH
    if highest >= 2:
        return BriefPriority.MEDIUM
    return BriefPriority.LOW


def _format_bullets(label: str, items: list[str]) -> str:
    if not items:
        return ""
    return f"{label}:\n" + "\n".join([f"- {item}" for item in items])


def _format_people_activity(
    activities: dict[str, list[str]],
    max_people: int = 8,
    max_actions: int = 3,
) -> str:
    if not activities:
        return ""

    sorted_people = sorted(
        activities.items(),
        key=lambda item: (len(item[1]), item[0].lower()),
        reverse=True,
    )
    lines = []
    for person, actions in sorted_people[:max_people]:
        trimmed = actions[:max_actions]
        if not trimmed:
            continue
        lines.append(f"{person}: " + "; ".join(trimmed))
    return _format_bullets("People highlights", lines)


def _format_source_counts(source_counts: Counter[str]) -> str:
    if not source_counts:
        return ""
    lines = [
        f"{source or 'unknown'} ({count})"
        for source, count in source_counts.most_common(8)
    ]
    return _format_bullets("Sources", lines)


def _format_title_with_actor(title: str | None, actor: str | None) -> str | None:
    if not title:
        return None
    if actor:
        return f"{title} — {actor}"
    return title


async def _send_report_email_safe(
    *,
    organization_id: str,
    report_title: str,
    summary: str,
    report_type: str,
    organization_name: str | None,
) -> None:
    try:
        await send_report_email(
            organization_id=organization_id,
            report_title=report_title,
            summary=summary,
            report_type=report_type,
            organization_name=organization_name,
        )
    except Exception as exc:
        logger.warning(
            "Report email delivery failed",
            organization_id=organization_id,
            report_type=report_type,
            error=str(exc),
        )


async def generate_executive_brief(
    organization_id: str,
    days: int = 7,
    organization_name: str | None = None,
) -> str | None:
    """Generate and persist an executive weekly memory brief."""
    now = datetime.now(timezone.utc)
    since = now - timedelta(days=days)

    async with get_db_session() as session:
        decision_rows = await session.execute(
            text(
                """
                SELECT id, canonical_title, canonical_description, created_at
                FROM unified_intelligence_object
                WHERE organization_id = :org_id
                  AND type = 'decision'
                  AND created_at >= :since
                ORDER BY created_at DESC
                LIMIT 10
                """
            ),
            {"org_id": organization_id, "since": since},
        )
        decisions = [
            {
                "id": row.id,
                "title": row.canonical_title,
                "description": row.canonical_description,
                "created_at": row.created_at,
            }
            for row in decision_rows.fetchall()
        ]

        risk_rows = await session.execute(
            text(
                """
                SELECT u.id, u.canonical_title, rd.severity, rd.suggested_action, u.created_at
                FROM unified_intelligence_object u
                JOIN uio_risk_details rd ON rd.uio_id = u.id
                WHERE u.organization_id = :org_id
                  AND u.type = 'risk'
                  AND u.created_at >= :since
                ORDER BY rd.severity DESC, u.created_at DESC
                LIMIT 10
                """
            ),
            {"org_id": organization_id, "since": since},
        )
        risks = [
            {
                "id": row.id,
                "title": row.canonical_title,
                "severity": row.severity,
                "suggested_action": row.suggested_action,
                "created_at": row.created_at,
            }
            for row in risk_rows.fetchall()
        ]

        commitment_rows = await session.execute(
            text(
                """
                SELECT COUNT(*) as count
                FROM unified_intelligence_object
                WHERE organization_id = :org_id
                  AND type = 'commitment'
                  AND status IN ('active', 'in_progress')
                """
            ),
            {"org_id": organization_id},
        )
        commitment_count = commitment_rows.fetchone().count

        overdue_rows = await session.execute(
            text(
                """
                SELECT COUNT(*) as count
                FROM unified_intelligence_object
                WHERE organization_id = :org_id
                  AND type = 'commitment'
                  AND status IN ('active', 'in_progress')
                  AND due_date < :now
                """
            ),
            {"org_id": organization_id, "now": now},
        )
        overdue_count = overdue_rows.fetchone().count

    decision_lines = [
        f"{d['title']}" for d in decisions if d.get("title")
    ]
    risk_lines = [
        f"{r['title']} ({r['severity']})" for r in risks if r.get("title")
    ]

    summary_parts = [
        f"Weekly executive brief ({since.date()} → {now.date()}).",
        f"Decisions made: {len(decisions)}. Risks detected: {len(risks)}.",
        f"Open commitments: {commitment_count}. Overdue commitments: {overdue_count}.",
    ]
    if organization_name:
        summary_parts.insert(0, f"Organization: {organization_name}.")

    summary = "\n".join([p for p in summary_parts if p])
    summary += "\n\n" + _format_bullets("Key decisions", decision_lines)
    summary += "\n\n" + _format_bullets("Top risks", risk_lines)

    summary = summary.strip()

    priority = _derive_priority_from_risks(risks)
    suggested_action = BriefAction.REVIEW if priority != BriefPriority.LOW else BriefAction.NONE

    manager = UIOManager(organization_id)
    brief_request = CreateBriefUIO(
        base=UIOCreate(
            organization_id=organization_id,
            type=UIOType.BRIEF,
            canonical_title="Executive Weekly Memory Brief",
            canonical_description=summary,
            status=UIOStatus.ACTIVE,
            overall_confidence=0.75,
            first_seen_at=now,
            last_updated_at=now,
        ),
        details=BriefDetailsCreate(
            summary=summary,
            why_this_matters="Keep executives aligned on decisions, risks, and commitments.",
            what_changed=f"New decisions: {len(decisions)}. New risks: {len(risks)}.",
            suggested_action=suggested_action,
            action_reasoning="Review key changes and address high-severity risks.",
            priority_tier=priority,
            urgency_score=0.6,
            importance_score=0.7,
            sentiment_score=0.0,
            intent_classification="executive_brief",
        ),
        source=SourceContext(
            source_type="api",
            conversation_id=None,
            message_id=None,
            quoted_text=None,
            confidence=0.7,
        ),
    )

    brief_id = await manager.create_brief_uio(brief_request)
    logger.info("Executive brief generated", organization_id=organization_id, brief_id=brief_id)
    await _send_report_email_safe(
        organization_id=organization_id,
        report_title="Executive Weekly Memory Brief",
        summary=summary,
        report_type="weekly_brief",
        organization_name=organization_name,
    )
    return brief_id


async def generate_blindspot_report(
    organization_id: str,
    days: int = 30,
    organization_name: str | None = None,
) -> str | None:
    """Generate and persist a blindspot report as a brief UIO."""
    service = await get_blindspot_detection_service()
    profile = await service.analyze_organization(organization_id=organization_id, days=days)

    blindspots = profile.blindspots or []
    top_blindspots = blindspots[:10]
    lines = [
        f"{b.title} ({b.severity.value})"
        for b in top_blindspots
    ]

    summary_parts = [
        f"Blindspot report ({days} days).",
        f"Health score: {profile.organizational_health_score:.2f}.",
        f"Blindspots detected: {len(blindspots)}.",
    ]
    if organization_name:
        summary_parts.insert(0, f"Organization: {organization_name}.")

    summary = "\n".join([p for p in summary_parts if p])
    summary += "\n\n" + _format_bullets("Top blindspots", lines)
    summary = summary.strip()

    highest_severity = max(
        (b.severity for b in blindspots),
        default=None,
        key=lambda s: {"critical": 4, "high": 3, "medium": 2, "low": 1}.get(s.value, 1),
    )
    priority = BriefPriority.HIGH if highest_severity and highest_severity.value in {"high", "critical"} else BriefPriority.MEDIUM
    suggested_action = BriefAction.REVIEW if priority != BriefPriority.LOW else BriefAction.NONE

    manager = UIOManager(organization_id)
    brief_request = CreateBriefUIO(
        base=UIOCreate(
            organization_id=organization_id,
            type=UIOType.BRIEF,
            canonical_title="Organizational Blindspot Report",
            canonical_description=summary,
            status=UIOStatus.ACTIVE,
            overall_confidence=0.75,
            first_seen_at=profile.generated_at,
            last_updated_at=profile.generated_at,
        ),
        details=BriefDetailsCreate(
            summary=summary,
            why_this_matters="Blindspots highlight areas where decisions or ownership are missing.",
            what_changed="New blindspots detected and prioritized for review.",
            suggested_action=suggested_action,
            action_reasoning="Review blindspots and assign owners to close gaps.",
            priority_tier=priority,
            urgency_score=0.5,
            importance_score=0.7,
            sentiment_score=0.0,
            intent_classification="blindspot_report",
        ),
        source=SourceContext(
            source_type="api",
            conversation_id=None,
            message_id=None,
            quoted_text=None,
            confidence=0.7,
        ),
    )

    brief_id = await manager.create_brief_uio(brief_request)
    logger.info("Blindspot report generated", organization_id=organization_id, brief_id=brief_id)
    await _send_report_email_safe(
        organization_id=organization_id,
        report_title="Organizational Blindspot Report",
        summary=summary,
        report_type="blindspot_report",
        organization_name=organization_name,
    )
    return brief_id


async def generate_daily_brief(
    organization_id: str,
    days: int = 1,
    organization_name: str | None = None,
) -> str | None:
    """Generate and persist an executive daily brief."""
    now = datetime.now(timezone.utc)
    since = now - timedelta(days=days)

    source_counts: Counter[str] = Counter()
    people_activity: dict[str, list[str]] = {}

    def add_activity(actor: str | None, action: str) -> None:
        name = actor or "Unassigned"
        people_activity.setdefault(name, []).append(action)

    async with get_db_session() as session:
        decision_rows = await session.execute(
            text(
                """
                SELECT u.id, u.canonical_title, u.created_at, u.last_activity_source_type as source_type,
                       COALESCE(dm.display_name, dm.primary_email, ow.display_name, ow.primary_email) as actor_name
                FROM unified_intelligence_object u
                LEFT JOIN uio_decision_details d ON d.uio_id = u.id
                LEFT JOIN contact dm ON dm.id = d.decision_maker_contact_id
                LEFT JOIN contact ow ON ow.id = u.owner_contact_id
                WHERE u.organization_id = :org_id
                  AND u.type = 'decision'
                  AND u.created_at >= :since
                ORDER BY u.created_at DESC
                LIMIT 20
                """
            ),
            {"org_id": organization_id, "since": since},
        )
        decisions = [
            {
                "id": row.id,
                "title": row.canonical_title,
                "actor": row.actor_name,
                "source_type": row.source_type,
            }
            for row in decision_rows.fetchall()
        ]

        commitment_rows = await session.execute(
            text(
                """
                SELECT u.id, u.canonical_title, u.created_at, u.last_activity_source_type as source_type,
                       COALESCE(debtor.display_name, debtor.primary_email, ow.display_name, ow.primary_email) as actor_name
                FROM unified_intelligence_object u
                LEFT JOIN uio_commitment_details cd ON cd.uio_id = u.id
                LEFT JOIN contact debtor ON debtor.id = cd.debtor_contact_id
                LEFT JOIN contact ow ON ow.id = u.owner_contact_id
                WHERE u.organization_id = :org_id
                  AND u.type = 'commitment'
                  AND u.created_at >= :since
                ORDER BY u.created_at DESC
                LIMIT 20
                """
            ),
            {"org_id": organization_id, "since": since},
        )
        commitments_created = [
            {
                "id": row.id,
                "title": row.canonical_title,
                "actor": row.actor_name,
                "source_type": row.source_type,
            }
            for row in commitment_rows.fetchall()
        ]

        commitment_completed_rows = await session.execute(
            text(
                """
                SELECT u.id, u.canonical_title, cd.completed_at, u.last_activity_source_type as source_type,
                       COALESCE(debtor.display_name, debtor.primary_email, ow.display_name, ow.primary_email) as actor_name
                FROM unified_intelligence_object u
                JOIN uio_commitment_details cd ON cd.uio_id = u.id
                LEFT JOIN contact debtor ON debtor.id = cd.debtor_contact_id
                LEFT JOIN contact ow ON ow.id = u.owner_contact_id
                WHERE u.organization_id = :org_id
                  AND u.type = 'commitment'
                  AND cd.completed_at >= :since
                ORDER BY cd.completed_at DESC
                LIMIT 20
                """
            ),
            {"org_id": organization_id, "since": since},
        )
        commitments_completed = [
            {
                "id": row.id,
                "title": row.canonical_title,
                "actor": row.actor_name,
                "source_type": row.source_type,
            }
            for row in commitment_completed_rows.fetchall()
        ]

        task_completed_rows = await session.execute(
            text(
                """
                SELECT u.id, u.canonical_title, td.completed_at, u.last_activity_source_type as source_type,
                       COALESCE(assignee.display_name, assignee.primary_email, ow.display_name, ow.primary_email) as actor_name
                FROM unified_intelligence_object u
                JOIN uio_task_details td ON td.uio_id = u.id
                LEFT JOIN contact assignee ON assignee.id = td.assignee_contact_id
                LEFT JOIN contact ow ON ow.id = u.owner_contact_id
                WHERE u.organization_id = :org_id
                  AND u.type = 'task'
                  AND td.completed_at >= :since
                ORDER BY td.completed_at DESC
                LIMIT 20
                """
            ),
            {"org_id": organization_id, "since": since},
        )
        tasks_completed = [
            {
                "id": row.id,
                "title": row.canonical_title,
                "actor": row.actor_name,
                "source_type": row.source_type,
            }
            for row in task_completed_rows.fetchall()
        ]

        risk_rows = await session.execute(
            text(
                """
                SELECT u.id, u.canonical_title, rd.severity, u.created_at, u.last_activity_source_type as source_type,
                       COALESCE(ow.display_name, ow.primary_email) as actor_name
                FROM unified_intelligence_object u
                LEFT JOIN uio_risk_details rd ON rd.uio_id = u.id
                LEFT JOIN contact ow ON ow.id = u.owner_contact_id
                WHERE u.organization_id = :org_id
                  AND u.type = 'risk'
                  AND u.created_at >= :since
                ORDER BY u.created_at DESC
                LIMIT 20
                """
            ),
            {"org_id": organization_id, "since": since},
        )
        risks = [
            {
                "id": row.id,
                "title": row.canonical_title,
                "severity": row.severity,
                "actor": row.actor_name,
                "source_type": row.source_type,
            }
            for row in risk_rows.fetchall()
        ]

    for item in decisions:
        if item.get("source_type"):
            source_counts[item["source_type"]] += 1
        if item.get("title"):
            add_activity(item.get("actor"), f"Decision: {item['title']}")

    for item in commitments_created:
        if item.get("source_type"):
            source_counts[item["source_type"]] += 1
        if item.get("title"):
            add_activity(item.get("actor"), f"Commitment: {item['title']}")

    for item in commitments_completed:
        if item.get("source_type"):
            source_counts[item["source_type"]] += 1
        if item.get("title"):
            add_activity(item.get("actor"), f"Commitment completed: {item['title']}")

    for item in tasks_completed:
        if item.get("source_type"):
            source_counts[item["source_type"]] += 1
        if item.get("title"):
            add_activity(item.get("actor"), f"Task done: {item['title']}")

    for item in risks:
        if item.get("source_type"):
            source_counts[item["source_type"]] += 1

    decision_lines = [
        _format_title_with_actor(d.get("title"), d.get("actor"))
        for d in decisions
    ]
    decision_lines = [line for line in decision_lines if line]

    commitment_lines = [
        _format_title_with_actor(c.get("title"), c.get("actor"))
        for c in commitments_created
    ]
    commitment_lines = [line for line in commitment_lines if line]

    commitment_completed_lines = [
        _format_title_with_actor(c.get("title"), c.get("actor"))
        for c in commitments_completed
    ]
    commitment_completed_lines = [line for line in commitment_completed_lines if line]

    task_completed_lines = [
        _format_title_with_actor(t.get("title"), t.get("actor"))
        for t in tasks_completed
    ]
    task_completed_lines = [line for line in task_completed_lines if line]

    risk_lines = [
        f"{r['title']} ({r['severity']})" for r in risks if r.get("title")
    ]

    summary_parts = [
        f"Daily executive brief ({since.date()} → {now.date()}).",
        f"Decisions made: {len(decisions)}. New commitments: {len(commitments_created)}.",
        f"Commitments completed: {len(commitments_completed)}. Tasks completed: {len(tasks_completed)}.",
        f"Risks flagged: {len(risks)}.",
    ]
    if organization_name:
        summary_parts.insert(0, f"Organization: {organization_name}.")

    sections = ["\n".join([p for p in summary_parts if p])]
    for section in [
        _format_bullets("Key decisions", decision_lines),
        _format_bullets("New commitments", commitment_lines),
        _format_bullets("Commitments completed", commitment_completed_lines),
        _format_bullets("Tasks completed", task_completed_lines),
        _format_bullets("Risks flagged", risk_lines),
        _format_people_activity(people_activity),
        _format_source_counts(source_counts),
    ]:
        if section:
            sections.append(section)

    summary = "\n\n".join(sections).strip()

    priority = _derive_priority_from_risks(risks)
    suggested_action = BriefAction.REVIEW if (decisions or risks) else BriefAction.NONE

    manager = UIOManager(organization_id)
    brief_request = CreateBriefUIO(
        base=UIOCreate(
            organization_id=organization_id,
            type=UIOType.BRIEF,
            canonical_title="Executive Daily Brief",
            canonical_description=summary,
            status=UIOStatus.ACTIVE,
            overall_confidence=0.7,
            first_seen_at=now,
            last_updated_at=now,
        ),
        details=BriefDetailsCreate(
            summary=summary,
            why_this_matters="Daily alignment on decisions, commitments, and risks.",
            what_changed=(
                f"Decisions: {len(decisions)}. Commitments: {len(commitments_created)}. "
                f"Completed: {len(commitments_completed) + len(tasks_completed)}."
            ),
            suggested_action=suggested_action,
            action_reasoning="Scan for key changes and follow up on risks or blockers.",
            priority_tier=priority,
            urgency_score=0.5,
            importance_score=0.6,
            sentiment_score=0.0,
            intent_classification="executive_daily_brief",
        ),
        source=SourceContext(
            source_type="api",
            conversation_id=None,
            message_id=None,
            quoted_text=None,
            confidence=0.7,
        ),
    )

    brief_id = await manager.create_brief_uio(brief_request)
    logger.info("Daily brief generated", organization_id=organization_id, brief_id=brief_id)
    await _send_report_email_safe(
        organization_id=organization_id,
        report_title="Executive Daily Brief",
        summary=summary,
        report_type="daily_brief",
        organization_name=organization_name,
    )
    return brief_id


async def generate_weekly_reports(
    pilot_only: bool = True,
    brief_days: int = 7,
    blindspot_days: int = 30,
) -> dict[str, int]:
    """Generate weekly executive briefs and blindspot reports for all orgs."""
    orgs = await _list_organizations(pilot_only=pilot_only)
    if not orgs:
        return {"organizations": 0, "executive_briefs": 0, "blindspot_reports": 0}

    exec_count = 0
    blindspot_count = 0
    for org in orgs:
        org_id = org["id"]
        name = org.get("name")
        try:
            if await generate_executive_brief(org_id, days=brief_days, organization_name=name):
                exec_count += 1
            if await generate_blindspot_report(org_id, days=blindspot_days, organization_name=name):
                blindspot_count += 1
        except Exception as exc:
            logger.error("Weekly report generation failed", organization_id=org_id, error=str(exc))

    return {
        "organizations": len(orgs),
        "executive_briefs": exec_count,
        "blindspot_reports": blindspot_count,
    }


async def generate_daily_reports(
    pilot_only: bool = True,
    brief_days: int = 1,
) -> dict[str, int]:
    """Generate daily executive briefs for all orgs."""
    orgs = await _list_organizations(pilot_only=pilot_only)
    if not orgs:
        return {"organizations": 0, "daily_briefs": 0}

    daily_count = 0
    for org in orgs:
        org_id = org["id"]
        name = org.get("name")
        try:
            if await generate_daily_brief(org_id, days=brief_days, organization_name=name):
                daily_count += 1
        except Exception as exc:
            logger.error("Daily brief generation failed", organization_id=org_id, error=str(exc))

    return {"organizations": len(orgs), "daily_briefs": daily_count}
