from __future__ import annotations

from datetime import timedelta
from typing import Any

from temporalio import workflow


def _minute_bucket() -> int:
    return int(workflow.now().timestamp()) // 60


@workflow.defn(name="cron.webhook_outbox_flush")
class WebhookOutboxFlushCronWorkflow:
    @workflow.run
    async def run(self, req: dict[str, Any]) -> dict[str, Any]:
        limit = int(req.get("limit") or 100)
        limit = max(1, min(limit, 2000))
        bucket = _minute_bucket()
        idempotency_key = f"webhook_outbox_flush:{bucket}"

        job_id = await workflow.execute_activity(
            "jobs.enqueue",
            {
                "organization_id": "internal",
                "job_type": "webhook.outbox.flush",
                "payload": {"limit": limit},
                "priority": 0,
                "max_attempts": 3,
                "idempotency_key": idempotency_key,
                "resource_key": "system:webhook_outbox_flush",
            },
            start_to_close_timeout=timedelta(seconds=10),
        )
        return {"job_id": str(job_id), "idempotency_key": idempotency_key}


@workflow.defn(name="cron.candidates_process")
class CandidatesProcessCronWorkflow:
    @workflow.run
    async def run(self, req: dict[str, Any]) -> dict[str, Any]:
        limit = int(req.get("limit") or 200)
        limit = max(1, min(limit, 2000))
        interval_seconds = int(req.get("interval_seconds") or 60)
        interval_seconds = max(10, min(interval_seconds, 24 * 60 * 60))
        bucket = int(workflow.now().timestamp()) // interval_seconds
        idempotency_key = f"candidates_process:{bucket}"

        job_id = await workflow.execute_activity(
            "jobs.enqueue",
            {
                "organization_id": "internal",
                "job_type": "candidates.process",
                "payload": {"limit": limit},
                "priority": 0,
                "max_attempts": 3,
                "idempotency_key": idempotency_key,
                "resource_key": "system:candidates_process",
            },
            start_to_close_timeout=timedelta(seconds=10),
        )
        return {"job_id": str(job_id), "idempotency_key": idempotency_key}


@workflow.defn(name="cron.reports_weekly")
class WeeklyReportsCronWorkflow:
    @workflow.run
    async def run(self, req: dict[str, Any]) -> dict[str, Any]:
        pilot_only = bool(req.get("pilot_only", True))
        brief_days = int(req.get("brief_days") or 7)
        blindspot_days = int(req.get("blindspot_days") or 30)

        year, week, _ = workflow.now().isocalendar()
        idempotency_key = f"weekly_reports:{year}-W{week}"

        job_id = await workflow.execute_activity(
            "jobs.enqueue",
            {
                "organization_id": "internal",
                "job_type": "reports.weekly",
                "payload": {
                    "pilot_only": pilot_only,
                    "brief_days": brief_days,
                    "blindspot_days": blindspot_days,
                },
                "priority": 0,
                "max_attempts": 1,
                "idempotency_key": idempotency_key,
                "resource_key": "system:reports_weekly",
            },
            start_to_close_timeout=timedelta(seconds=10),
        )
        return {"job_id": str(job_id), "idempotency_key": idempotency_key}


@workflow.defn(name="cron.reports_daily")
class DailyReportsCronWorkflow:
    @workflow.run
    async def run(self, req: dict[str, Any]) -> dict[str, Any]:
        pilot_only = bool(req.get("pilot_only", True))
        brief_days = int(req.get("brief_days") or 1)

        day = workflow.now().strftime("%Y-%m-%d")
        idempotency_key = f"daily_reports:{day}"

        job_id = await workflow.execute_activity(
            "jobs.enqueue",
            {
                "organization_id": "internal",
                "job_type": "reports.daily",
                "payload": {
                    "pilot_only": pilot_only,
                    "brief_days": brief_days,
                },
                "priority": 0,
                "max_attempts": 1,
                "idempotency_key": idempotency_key,
                "resource_key": "system:reports_daily",
            },
            start_to_close_timeout=timedelta(seconds=10),
        )
        return {"job_id": str(job_id), "idempotency_key": idempotency_key}


@workflow.defn(name="cron.memory_decay")
class MemoryDecayCronWorkflow:
    @workflow.run
    async def run(self, _req: dict[str, Any]) -> dict[str, Any]:
        day = workflow.now().strftime("%Y-%m-%d")
        idempotency_key = f"memory_decay:{day}"

        job_id = await workflow.execute_activity(
            "jobs.enqueue",
            {
                "organization_id": "internal",
                "job_type": "memory.decay",
                "payload": {"organization_id": None},
                "priority": 0,
                "max_attempts": 1,
                "idempotency_key": idempotency_key,
                "resource_key": "system:memory_decay",
            },
            start_to_close_timeout=timedelta(seconds=10),
        )
        return {"job_id": str(job_id), "idempotency_key": idempotency_key}


@workflow.defn(name="cron.evidence_retention")
class EvidenceRetentionCronWorkflow:
    @workflow.run
    async def run(self, req: dict[str, Any]) -> dict[str, Any]:
        limit = int(req.get("limit") or 500)
        limit = max(1, min(limit, 10_000))

        day = workflow.now().strftime("%Y-%m-%d")
        idempotency_key = f"evidence_retention:{day}"

        job_id = await workflow.execute_activity(
            "jobs.enqueue",
            {
                "organization_id": "internal",
                "job_type": "evidence.retention",
                "payload": {"organization_id": None, "dry_run": False, "limit": limit},
                "priority": 0,
                "max_attempts": 1,
                "idempotency_key": idempotency_key,
                "resource_key": "system:evidence_retention",
            },
            start_to_close_timeout=timedelta(seconds=10),
        )
        return {"job_id": str(job_id), "idempotency_key": idempotency_key}

