"""Continuum runtime scheduler and execution engine."""

from __future__ import annotations

import asyncio
import json
from datetime import datetime, timedelta
from typing import Any

import structlog
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from sqlalchemy import text

from src.config import get_settings
from src.continuum.dsl import ContinuumDefinition
from src.continuum.manager import (
    compute_next_run_at,
    create_continuum_alert,
    fetch_active_version,
    fetch_continuum_definition,
    list_due_continuums,
    record_continuum_run,
    set_continuum_status,
)
from src.continuum.models import (
    ContinuumAlertType,
    ContinuumRunStatus,
    ContinuumStatus,
)
from src.db.client import get_db_session
from src.db.rls import rls_context
from src.guardrails.policy import PolicyContext, evaluate_policy
from src.notifications.reports import resolve_report_recipients
from src.notifications.resend import send_resend_email

logger = structlog.get_logger()


def _utc_now() -> datetime:
    return datetime.utcnow()


def _build_policy_context(raw: dict[str, Any] | None) -> PolicyContext:
    raw = raw or {}
    return PolicyContext(
        direction=raw.get("direction", "outbound"),
        channel=raw.get("channel"),
        pii_types=raw.get("pii_types", []),
        contradiction_severity=raw.get("contradiction_severity"),
        fraud_score=raw.get("fraud_score"),
    )


async def _send_escalation_email(
    *,
    organization_id: str,
    subject: str,
    summary: str,
    tags: dict[str, str] | None = None,
) -> None:
    recipients = await resolve_report_recipients(organization_id)
    if not recipients:
        return
    await send_resend_email(
        to_emails=recipients,
        subject=subject,
        html_body=f"<pre>{summary}</pre>",
        text_body=summary,
        tags=tags,
    )


class ContinuumRuntime:
    """Scheduler and execution runtime for Continuums."""

    def __init__(self) -> None:
        self._scheduler = AsyncIOScheduler()
        self._lock = asyncio.Lock()

    async def start(self) -> None:
        if not self._scheduler.running:
            self._scheduler.start()
            interval_seconds = get_settings().continuum_scheduler_interval_seconds
            monitor_seconds = get_settings().continuum_monitor_interval_seconds
            self._scheduler.add_job(self.run_due_continuums, "interval", seconds=interval_seconds)
            self._scheduler.add_job(self.monitor_continuums, "interval", seconds=monitor_seconds)
            logger.info("Continuum scheduler started", interval_seconds=interval_seconds)

    async def shutdown(self) -> None:
        if self._scheduler.running:
            self._scheduler.shutdown(wait=False)
            logger.info("Continuum scheduler stopped")

    async def run_due_continuums(self) -> None:
        async with self._lock:
            due = await list_due_continuums()
            if not due:
                return
            for item in due:
                await self.execute_continuum(
                    continuum_id=item["id"],
                    organization_id=item["organization_id"],
                    triggered_by="scheduler",
                    version=item.get("active_version"),
                )

    async def execute_continuum(
        self,
        *,
        continuum_id: str,
        organization_id: str,
        triggered_by: str,
        version: int | None = None,
    ) -> dict[str, Any]:
        with rls_context(organization_id, is_internal=False):
            active_version = version or await fetch_active_version(
                continuum_id=continuum_id,
                organization_id=organization_id,
            )
            definition = await fetch_continuum_definition(
                continuum_id=continuum_id,
                organization_id=organization_id,
                version=active_version,
            )
            now = _utc_now()
            run_metadata = {
                "triggered_by": triggered_by,
                "schedule_type": definition.schedule.type,
            }

            run_id = await record_continuum_run(
                continuum_id=continuum_id,
                organization_id=organization_id,
                version=active_version,
                status=ContinuumRunStatus.RUNNING,
                run_metadata=run_metadata,
                step_results=[],
                started_at=now,
            )

            step_results: list[dict[str, Any]] = []
            status = ContinuumRunStatus.COMPLETED
            error_message: str | None = None

            try:
                for step in definition.steps:
                    step_start = _utc_now()
                    step_result: dict[str, Any] = {
                        "step_id": step.id,
                        "name": step.name,
                        "action": step.action,
                        "started_at": step_start.isoformat(),
                    }

                    if definition.escalation.policy_checks and step.policy_context:
                        policy_context = _build_policy_context(step.policy_context)
                        decisions = evaluate_policy(policy_context)
                        step_result["policy_decisions"] = [d.model_dump() for d in decisions]
                        if any(decision.action in ("block", "require_approval") for decision in decisions):
                            status = ContinuumRunStatus.ESCALATED
                            error_message = "Policy escalation required"
                            await create_continuum_alert(
                                continuum_id=continuum_id,
                                organization_id=organization_id,
                                alert_type=ContinuumAlertType.ESCALATION,
                                severity="high",
                                title="Continuum escalation required",
                                description=f"Policy escalation triggered for step {step.name}",
                                details={"step_id": step.id, "decisions": step_result["policy_decisions"]},
                            )
                            if definition.escalation.notify_on_escalation:
                                await _send_escalation_email(
                                    organization_id=organization_id,
                                    subject="Drovi Continuum Escalation",
                                    summary=f"Continuum {definition.name} escalated at step {step.name}.",
                                    tags={"continuum_id": continuum_id, "type": "escalation"},
                                )
                            if definition.escalation.require_manual_override:
                                await set_continuum_status(
                                    continuum_id=continuum_id,
                                    organization_id=organization_id,
                                    status=ContinuumStatus.ESCALATED,
                                    next_run_at=None,
                                )
                                step_result["status"] = "escalated"
                                step_result["completed_at"] = _utc_now().isoformat()
                                step_results.append(step_result)
                                raise RuntimeError("Escalation requires manual override")

                    # Execute the step
                    if step.action.startswith("workflow:"):
                        from src.agents.langgraph_workflows import get_workflows

                        workflows = await get_workflows(organization_id)
                        action = step.action.split("workflow:", 1)[1]
                        if action == "customer_research":
                            output = await workflows.run_customer_research(**step.inputs)
                        elif action == "risk_analysis":
                            output = await workflows.run_risk_analysis(**step.inputs)
                        elif action == "intelligence_brief":
                            output = await workflows.run_intelligence_brief(**step.inputs)
                        else:
                            output = {"status": "skipped", "reason": f"Unknown workflow: {action}"}
                    else:
                        output = {"status": "noop", "detail": "No-op step executed"}

                    step_result["output"] = output
                    step_result["status"] = "completed"
                    step_result["completed_at"] = _utc_now().isoformat()
                    step_results.append(step_result)

            except Exception as exc:
                if status != ContinuumRunStatus.ESCALATED:
                    status = ContinuumRunStatus.FAILED
                error_message = error_message or str(exc)
                logger.warning("Continuum run failed", continuum_id=continuum_id, error=str(exc))

                if definition.escalation.on_failure:
                    await create_continuum_alert(
                        continuum_id=continuum_id,
                        organization_id=organization_id,
                        alert_type=ContinuumAlertType.FAILURE,
                        severity="medium",
                        title="Continuum execution failed",
                        description=error_message or "Continuum failed",
                        details={"run_id": run_id},
                    )
                    if definition.escalation.notify_on_failure:
                        await _send_escalation_email(
                            organization_id=organization_id,
                            subject="Drovi Continuum Failure",
                            summary=f"Continuum {definition.name} failed. Error: {error_message}",
                            tags={"continuum_id": continuum_id, "type": "failure"},
                        )

            completed_at = _utc_now()
            await _finalize_run(
                continuum_id=continuum_id,
                organization_id=organization_id,
                definition=definition,
                status=status,
                run_id=run_id,
                step_results=step_results,
                error_message=error_message,
                completed_at=completed_at,
            )

            if status == ContinuumRunStatus.FAILED and definition.escalation.on_failure:
                failures = await _count_recent_failures(
                    continuum_id=continuum_id,
                    organization_id=organization_id,
                    window_minutes=get_settings().continuum_degraded_window_minutes,
                )
                if failures >= definition.escalation.max_retries:
                    await set_continuum_status(
                        continuum_id=continuum_id,
                        organization_id=organization_id,
                        status=ContinuumStatus.ESCALATED,
                        next_run_at=None,
                    )
                    await create_continuum_alert(
                        continuum_id=continuum_id,
                        organization_id=organization_id,
                        alert_type=ContinuumAlertType.ESCALATION,
                        severity="high",
                        title="Continuum escalation: retry limit reached",
                        description=f"{failures} failures exceeded retry limit",
                        details={"failures": failures},
                    )

            return {
                "run_id": run_id,
                "status": status.value,
                "completed_at": completed_at.isoformat(),
            }

    async def monitor_continuums(self) -> None:
        settings = get_settings()
        now = _utc_now()
        stuck_threshold = now - timedelta(minutes=settings.continuum_stuck_minutes)
        degraded_window = now - timedelta(minutes=settings.continuum_degraded_window_minutes)

        with rls_context(None, is_internal=True):
            async with get_db_session() as session:
                stuck_runs = await session.execute(
                    text(
                        """
                        SELECT r.id, r.continuum_id, r.organization_id
                        FROM continuum_run r
                        WHERE r.status = :status
                          AND r.started_at < :threshold
                        """
                    ),
                    {"status": ContinuumRunStatus.RUNNING.value, "threshold": stuck_threshold},
                )
                for row in stuck_runs.fetchall():
                    await create_continuum_alert(
                        continuum_id=row.continuum_id,
                        organization_id=row.organization_id,
                        alert_type=ContinuumAlertType.STUCK,
                        severity="high",
                        title="Continuum run stuck",
                        description=f"Run {row.id} exceeded threshold",
                        details={"run_id": row.id},
                    )

                degraded = await session.execute(
                    text(
                        """
                        SELECT continuum_id, organization_id, COUNT(*) AS failures
                        FROM continuum_run
                        WHERE status = :status
                          AND started_at >= :window_start
                        GROUP BY continuum_id, organization_id
                        HAVING COUNT(*) >= :threshold
                        """
                    ),
                    {
                        "status": ContinuumRunStatus.FAILED.value,
                        "window_start": degraded_window,
                        "threshold": settings.continuum_degraded_failure_threshold,
                    },
                )
                for row in degraded.fetchall():
                    await create_continuum_alert(
                        continuum_id=row.continuum_id,
                        organization_id=row.organization_id,
                        alert_type=ContinuumAlertType.DEGRADED,
                        severity="medium",
                        title="Continuum degraded",
                        description=f"{row.failures} failures within window",
                        details={"failure_count": row.failures},
                    )


async def _finalize_run(
    *,
    continuum_id: str,
    organization_id: str,
    definition: ContinuumDefinition,
    status: ContinuumRunStatus,
    run_id: str,
    step_results: list[dict[str, Any]],
    error_message: str | None,
    completed_at: datetime,
) -> None:
    next_run_at = None
    if status == ContinuumRunStatus.COMPLETED:
        next_run_at = compute_next_run_at(definition, completed_at)
    elif status == ContinuumRunStatus.FAILED:
        next_run_at = compute_next_run_at(definition, completed_at)

    async with get_db_session() as session:
        await session.execute(
            text(
                """
                UPDATE continuum_run
                SET status = :status,
                    completed_at = :completed_at,
                    error_message = :error_message,
                    step_results = :step_results
                WHERE id = :run_id
                """
            ),
            {
                "status": status.value,
                "completed_at": completed_at,
                "error_message": error_message,
                "step_results": json.dumps(step_results),
                "run_id": run_id,
            },
        )

        await session.execute(
            text(
                """
                UPDATE continuum
                SET last_run_at = :completed_at,
                    next_run_at = :next_run_at,
                    updated_at = :updated_at
                WHERE id = :continuum_id AND organization_id = :org_id
                """
            ),
            {
                "completed_at": completed_at,
                "next_run_at": next_run_at,
                "updated_at": _utc_now(),
                "continuum_id": continuum_id,
                "org_id": organization_id,
            },
        )


async def _count_recent_failures(
    *,
    continuum_id: str,
    organization_id: str,
    window_minutes: int,
) -> int:
    window_start = _utc_now() - timedelta(minutes=window_minutes)
    async with get_db_session() as session:
        result = await session.execute(
            text(
                """
                SELECT COUNT(*) AS failures
                FROM continuum_run
                WHERE continuum_id = :continuum_id
                  AND organization_id = :org_id
                  AND status = :status
                  AND started_at >= :window_start
                """
            ),
            {
                "continuum_id": continuum_id,
                "org_id": organization_id,
                "status": ContinuumRunStatus.FAILED.value,
                "window_start": window_start,
            },
        )
        return int(result.scalar() or 0)


_runtime: ContinuumRuntime | None = None


async def init_continuum_scheduler() -> None:
    global _runtime
    if _runtime is None:
        _runtime = ContinuumRuntime()
    await _runtime.start()


async def shutdown_continuum_scheduler() -> None:
    if _runtime:
        await _runtime.shutdown()


async def trigger_continuum_run(
    *,
    continuum_id: str,
    organization_id: str,
    triggered_by: str,
    version: int | None = None,
) -> dict[str, Any]:
    if _runtime is None:
        runtime = ContinuumRuntime()
        return await runtime.execute_continuum(
            continuum_id=continuum_id,
            organization_id=organization_id,
            triggered_by=triggered_by,
            version=version,
        )
    return await _runtime.execute_continuum(
        continuum_id=continuum_id,
        organization_id=organization_id,
        triggered_by=triggered_by,
        version=version,
    )
