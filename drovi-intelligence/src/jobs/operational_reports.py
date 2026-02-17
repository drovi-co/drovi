"""Operational report jobs used by system cron workflows."""

from __future__ import annotations

from datetime import datetime, timezone

import structlog
from sqlalchemy import text

from src.analytics.reporting import generate_weekly_reports
from src.db.client import get_db_session
from src.notifications.reports import send_report_email
from src.trust.products import generate_monthly_integrity_report

logger = structlog.get_logger()


async def _list_organizations(*, pilot_only: bool) -> list[dict[str, str]]:
    query = """
        SELECT id, name
        FROM organizations
        WHERE pilot_status = 'active'
        ORDER BY created_at DESC NULLS LAST
    """
    if not pilot_only:
        query = """
            SELECT id, name
            FROM organizations
            ORDER BY created_at DESC NULLS LAST
        """

    async with get_db_session() as session:
        result = await session.execute(text(query))
        return [{"id": str(row.id), "name": str(row.name)} for row in result.fetchall()]


async def run_weekly_operations_briefs(
    *,
    pilot_only: bool = True,
    brief_days: int = 7,
    blindspot_days: int = 30,
) -> dict[str, int]:
    """
    Generate the weekly operations brief package.

    This wraps the existing weekly reporting pipeline and gives it an explicit
    job type used by the admin operations schedule.
    """
    return await generate_weekly_reports(
        pilot_only=pilot_only,
        brief_days=brief_days,
        blindspot_days=blindspot_days,
    )


def _render_integrity_summary(report: dict[str, object]) -> str:
    report_payload = report.get("report")
    if not isinstance(report_payload, dict):
        return "Monthly integrity report generated."
    metrics = report_payload.get("metrics")
    continuity = report_payload.get("continuity_score")
    metric_map = metrics if isinstance(metrics, dict) else {}
    continuity_map = continuity if isinstance(continuity, dict) else {}

    return "\n".join(
        [
            f"Month: {report.get('month')}",
            f"Continuity score: {continuity_map.get('score', 'n/a')}",
            f"Evidence artifacts created: {metric_map.get('evidence_artifacts_created', 0)}",
            f"Audit events: {metric_map.get('audit_events', 0)}",
            f"Contradictions open: {metric_map.get('contradictions_open', 0)}",
            f"Custody roots generated: {metric_map.get('custody_roots_generated', 0)}",
        ]
    )


async def run_monthly_integrity_reports(
    *,
    pilot_only: bool = True,
    month: str | None = None,
) -> dict[str, int | str]:
    orgs = await _list_organizations(pilot_only=pilot_only)
    if not orgs:
        return {"organizations": 0, "reports_generated": 0, "emails_sent": 0}

    reports_generated = 0
    emails_sent = 0
    resolved_month = month

    for org in orgs:
        org_id = org["id"]
        org_name = org["name"]
        try:
            report = await generate_monthly_integrity_report(
                organization_id=org_id,
                month=month,
            )
            reports_generated += 1
            if not resolved_month:
                resolved_month = str(report.get("month") or "")
            emailed = await send_report_email(
                organization_id=org_id,
                report_title="Monthly Integrity Report",
                summary=_render_integrity_summary(report),
                report_type="monthly_integrity_report",
                organization_name=org_name,
            )
            if emailed:
                emails_sent += 1
        except Exception as exc:
            logger.error(
                "Monthly integrity report generation failed",
                organization_id=org_id,
                month=month,
                error=str(exc),
            )

    return {
        "organizations": len(orgs),
        "reports_generated": reports_generated,
        "emails_sent": emails_sent,
        "month": resolved_month
        or datetime.now(timezone.utc).strftime("%Y-%m"),
    }
