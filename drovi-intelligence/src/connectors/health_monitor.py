"""
Connector health monitor and auto-recovery orchestration.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any

import structlog
from sqlalchemy import func, select

from src.config import get_settings
from src.connectors.source_health import evaluate_source_health, should_auto_recover
from src.db.client import get_db_session
from src.db.models.background_jobs import BackgroundJob
from src.db.models.connections import Connection, SyncJobHistory
from src.jobs.queue import EnqueueJobRequest, enqueue_job

logger = structlog.get_logger()


async def run_connectors_health_monitor(payload: dict[str, Any] | None = None) -> dict[str, Any]:
    """
    Evaluate connector health for all eligible sources and enqueue auto-recovery syncs.

    Payload:
    - organization_id: optional tenant scope, "internal"/None = all
    """
    settings = get_settings()
    request = payload or {}
    requested_org_id = request.get("organization_id")
    organization_scope = None if not requested_org_id or requested_org_id == "internal" else str(requested_org_id)

    now = datetime.now(timezone.utc)
    # sync_job_history.started_at is currently queried as a naive timestamp in production.
    # Keep health window comparisons naive UTC to avoid asyncpg tz mismatch errors.
    failure_window_start = (
        now - timedelta(minutes=max(1, int(settings.connector_health_failure_window_minutes)))
    ).replace(tzinfo=None)

    async with get_db_session() as session:
        connection_query = select(Connection).where(
            Connection.status.in_(("active", "connected", "error", "pending_auth", "paused"))
        )
        if organization_scope:
            connection_query = connection_query.where(Connection.organization_id == organization_scope)

        connection_rows = (await session.execute(connection_query)).scalars().all()
        if not connection_rows:
            return {
                "checked_connections": 0,
                "alerts": 0,
                "slo_breaches": 0,
                "auto_recovery_enqueued": 0,
                "organization_id": organization_scope or "internal",
            }

        connection_ids = [row.id for row in connection_rows]

        failures_result = await session.execute(
            select(
                SyncJobHistory.connection_id,
                func.count(SyncJobHistory.id).label("failed_count"),
            )
            .where(SyncJobHistory.connection_id.in_(connection_ids))
            .where(SyncJobHistory.status == "failed")
            .where(SyncJobHistory.started_at >= failure_window_start)
            .group_by(SyncJobHistory.connection_id)
        )
        failure_counts: dict[str, int] = {
            str(row.connection_id): int(row.failed_count or 0)
            for row in failures_result
        }

        recovering_result = await session.execute(
            select(BackgroundJob.resource_key).where(
                BackgroundJob.job_type == "connector.sync",
                BackgroundJob.status.in_(("queued", "running")),
                BackgroundJob.idempotency_key.like("connector_auto_recovery:%"),
                BackgroundJob.resource_key.is_not(None),
            )
        )
        recovering_connection_ids: set[str] = set()
        for row in recovering_result:
            resource_key = str(row.resource_key or "")
            if resource_key.startswith("connection:"):
                recovering_connection_ids.add(resource_key.split("connection:", 1)[1])

    alerts = 0
    slo_breaches = 0
    auto_recovery_enqueued = 0
    auto_recovery_failed = 0

    recovery_cooldown_minutes = max(1, int(settings.connector_health_recovery_cooldown_minutes))
    recovery_bucket = int(now.timestamp()) // (recovery_cooldown_minutes * 60)

    for connection in connection_rows:
        snapshot = evaluate_source_health(
            connection_id=str(connection.id),
            organization_id=str(connection.organization_id),
            connector_type=str(connection.connector_type),
            connection_status=str(connection.status),
            sync_enabled=bool(connection.sync_enabled),
            sync_frequency_minutes=int(connection.sync_frequency_minutes or 5),
            last_sync_at=connection.last_sync_at,
            last_sync_status=connection.last_sync_status,
            last_error=connection.last_sync_error,
            recent_failures=failure_counts.get(str(connection.id), 0),
            recovery_in_flight=str(connection.id) in recovering_connection_ids,
            now=now,
            stale_multiplier=int(settings.connector_health_stale_multiplier),
            stale_floor_minutes=int(settings.connector_health_stale_floor_minutes),
            sync_slo_minutes=int(settings.connector_health_sync_slo_minutes),
            failure_threshold=int(settings.connector_health_error_failure_threshold),
        )

        is_alert = snapshot.status in {"stale", "error"} or snapshot.sync_slo_breached
        if is_alert:
            alerts += 1
            logger.warning(
                "Connector health alert raised",
                connection_id=snapshot.connection_id,
                organization_id=snapshot.organization_id,
                connector_type=snapshot.connector_type,
                health_status=snapshot.status,
                reason_code=snapshot.reason_code,
                reason=snapshot.reason,
                minutes_since_last_sync=snapshot.minutes_since_last_sync,
                sync_slo_breached=snapshot.sync_slo_breached,
            )
        if snapshot.sync_slo_breached:
            slo_breaches += 1

        if not settings.connector_health_auto_recovery_enabled:
            continue
        if not should_auto_recover(snapshot):
            continue

        idempotency_key = f"connector_auto_recovery:{snapshot.connection_id}:{recovery_bucket}"
        try:
            await enqueue_job(
                EnqueueJobRequest(
                    organization_id=snapshot.organization_id,
                    job_type="connector.sync",
                    payload={
                        "connection_id": snapshot.connection_id,
                        "organization_id": snapshot.organization_id,
                        "streams": None,
                        "full_refresh": False,
                        "scheduled": False,
                        "sync_params": {
                            "auto_recovery": True,
                            "reason_code": snapshot.reason_code,
                            "sync_slo_breached": snapshot.sync_slo_breached,
                        },
                    },
                    priority=2,
                    max_attempts=2,
                    idempotency_key=idempotency_key,
                    resource_key=f"connection:{snapshot.connection_id}",
                )
            )
            auto_recovery_enqueued += 1
        except Exception as exc:
            auto_recovery_failed += 1
            logger.warning(
                "Failed to enqueue connector auto-recovery sync",
                connection_id=snapshot.connection_id,
                organization_id=snapshot.organization_id,
                connector_type=snapshot.connector_type,
                error=str(exc),
            )

    return {
        "checked_connections": len(connection_rows),
        "alerts": alerts,
        "slo_breaches": slo_breaches,
        "auto_recovery_enqueued": auto_recovery_enqueued,
        "auto_recovery_failed": auto_recovery_failed,
        "organization_id": organization_scope or "internal",
        "checked_at": now.isoformat(),
    }
