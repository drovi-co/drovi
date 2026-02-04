"""Continuum persistence, versioning, and lifecycle management."""

from __future__ import annotations

import json
from datetime import datetime, timedelta
from typing import Any
from uuid import uuid4

import structlog
from apscheduler.triggers.cron import CronTrigger
from sqlalchemy import text

from src.continuum.dsl import ContinuumDefinition, compute_definition_hash, utc_now
from src.continuum.models import (
    ContinuumAlertStatus,
    ContinuumAlertType,
    ContinuumRunStatus,
    ContinuumStatus,
)
from src.continuum.state_machine import require_transition
from src.db.client import get_db_session
from src.db.rls import rls_context
from src.audit.log import record_audit_event

logger = structlog.get_logger()


def _extract_schedule(definition: ContinuumDefinition) -> tuple[str, int | None, str | None]:
    schedule = definition.schedule
    return schedule.type, schedule.interval_minutes, schedule.cron


def compute_next_run_at(
    definition: ContinuumDefinition,
    from_time: datetime | None = None,
) -> datetime | None:
    """Compute the next run time based on the schedule."""
    from_time = from_time or utc_now()
    schedule = definition.schedule
    if schedule.type == "on_demand":
        return None
    if schedule.type == "interval":
        interval = schedule.interval_minutes or 60
        return from_time + timedelta(minutes=interval)
    if schedule.type == "cron":
        if not schedule.cron:
            raise ValueError("Cron schedule requires cron expression")
        trigger = CronTrigger.from_crontab(schedule.cron)
        return trigger.get_next_fire_time(None, from_time)
    return None


async def create_continuum(
    *,
    organization_id: str,
    definition: ContinuumDefinition,
    created_by: str | None,
    activate: bool = False,
) -> dict[str, Any]:
    """Create a new Continuum with initial version."""
    now = utc_now()
    continuum_id = str(uuid4())
    version_id = str(uuid4())
    version_number = 1
    status = ContinuumStatus.ACTIVE if activate else ContinuumStatus.DRAFT
    schedule_type, schedule_interval, schedule_cron = _extract_schedule(definition)
    definition_hash = compute_definition_hash(definition)
    next_run_at = compute_next_run_at(definition, now) if activate else None

    async with get_db_session() as session:
        await session.execute(
            text(
                """
                INSERT INTO continuum (
                    id, organization_id, name, description,
                    status, current_version, active_version,
                    schedule_type, schedule_interval_minutes, schedule_cron,
                    escalation_policy, created_by,
                    created_at, updated_at, last_run_at, next_run_at
                ) VALUES (
                    :id, :org_id, :name, :description,
                    :status, :current_version, :active_version,
                    :schedule_type, :schedule_interval_minutes, :schedule_cron,
                    :escalation_policy, :created_by,
                    :created_at, :updated_at, :last_run_at, :next_run_at
                )
                """
            ),
            {
                "id": continuum_id,
                "org_id": organization_id,
                "name": definition.name,
                "description": definition.goal,
                "status": status.value,
                "current_version": version_number,
                "active_version": version_number,
                "schedule_type": schedule_type,
                "schedule_interval_minutes": schedule_interval,
                "schedule_cron": schedule_cron,
                "escalation_policy": json.dumps(definition.escalation.model_dump()),
                "created_by": created_by,
                "created_at": now,
                "updated_at": now,
                "last_run_at": None,
                "next_run_at": next_run_at,
            },
        )

        await session.execute(
            text(
                """
                INSERT INTO continuum_version (
                    id, continuum_id, organization_id,
                    version, definition, definition_hash,
                    created_by, created_at, is_active
                ) VALUES (
                    :id, :continuum_id, :org_id,
                    :version, :definition, :definition_hash,
                    :created_by, :created_at, :is_active
                )
                """
            ),
            {
                "id": version_id,
                "continuum_id": continuum_id,
                "org_id": organization_id,
                "version": version_number,
                "definition": json.dumps(definition.model_dump()),
                "definition_hash": definition_hash,
                "created_by": created_by,
                "created_at": now,
                "is_active": True,
            },
        )

    await _audit_continuum(
        organization_id=organization_id,
        action="continuum.create",
        actor_id=created_by,
        continuum_id=continuum_id,
        metadata={"version": version_number, "status": status.value},
    )

    return {
        "id": continuum_id,
        "version": version_number,
        "status": status.value,
        "next_run_at": next_run_at,
    }


async def add_continuum_version(
    *,
    continuum_id: str,
    organization_id: str,
    definition: ContinuumDefinition,
    created_by: str | None,
    activate: bool = False,
) -> dict[str, Any]:
    """Create a new Continuum version."""
    now = utc_now()
    version_id = str(uuid4())
    definition_hash = compute_definition_hash(definition)

    async with get_db_session() as session:
        result = await session.execute(
            text(
                """
                SELECT current_version
                FROM continuum
                WHERE id = :continuum_id AND organization_id = :org_id
                """
            ),
            {"continuum_id": continuum_id, "org_id": organization_id},
        )
        row = result.fetchone()
        if not row:
            raise ValueError("Continuum not found")

        new_version = int(row.current_version) + 1

        await session.execute(
            text(
                """
                INSERT INTO continuum_version (
                    id, continuum_id, organization_id,
                    version, definition, definition_hash,
                    created_by, created_at, is_active
                ) VALUES (
                    :id, :continuum_id, :org_id,
                    :version, :definition, :definition_hash,
                    :created_by, :created_at, :is_active
                )
                """
            ),
            {
                "id": version_id,
                "continuum_id": continuum_id,
                "org_id": organization_id,
                "version": new_version,
                "definition": json.dumps(definition.model_dump()),
                "definition_hash": definition_hash,
                "created_by": created_by,
                "created_at": now,
                "is_active": activate,
            },
        )

        await session.execute(
            text(
                """
                UPDATE continuum
                SET current_version = :current_version,
                    active_version = CASE WHEN :activate THEN :current_version ELSE active_version END,
                    updated_at = :now
                WHERE id = :continuum_id AND organization_id = :org_id
                """
            ),
            {
                "current_version": new_version,
                "activate": activate,
                "now": now,
                "continuum_id": continuum_id,
                "org_id": organization_id,
            },
        )

    await _audit_continuum(
        organization_id=organization_id,
        action="continuum.version_add",
        actor_id=created_by,
        continuum_id=continuum_id,
        metadata={"version": new_version, "activated": activate},
    )

    return {"version": new_version, "activated": activate}


async def set_continuum_status(
    *,
    continuum_id: str,
    organization_id: str,
    status: ContinuumStatus,
    next_run_at: datetime | None = None,
) -> None:
    now = utc_now()
    async with get_db_session() as session:
        current = await session.execute(
            text(
                """
                SELECT status
                FROM continuum
                WHERE id = :continuum_id AND organization_id = :org_id
                """
            ),
            {"continuum_id": continuum_id, "org_id": organization_id},
        )
        row = current.fetchone()
        if not row:
            raise ValueError("Continuum not found")
        require_transition(ContinuumStatus(row.status), status)
        await session.execute(
            text(
                """
                UPDATE continuum
                SET status = :status,
                    next_run_at = :next_run_at,
                    updated_at = :now
                WHERE id = :continuum_id AND organization_id = :org_id
                """
            ),
            {
                "status": status.value,
                "next_run_at": next_run_at,
                "now": now,
                "continuum_id": continuum_id,
                "org_id": organization_id,
            },
        )
    await _audit_continuum(
        organization_id=organization_id,
        action="continuum.status_update",
        actor_id=None,
        continuum_id=continuum_id,
        metadata={"status": status.value},
    )


async def rollback_continuum(
    *,
    continuum_id: str,
    organization_id: str,
    target_version: int | None,
    triggered_by: str | None,
) -> dict[str, Any]:
    """Rollback to a previous version and mark it active."""
    now = utc_now()
    async with get_db_session() as session:
        result = await session.execute(
            text(
                """
                SELECT current_version, active_version
                FROM continuum
                WHERE id = :continuum_id AND organization_id = :org_id
                """
            ),
            {"continuum_id": continuum_id, "org_id": organization_id},
        )
        row = result.fetchone()
        if not row:
            raise ValueError("Continuum not found")

        if target_version is None:
            target_version = max(1, int(row.active_version) - 1) if row.active_version else 1

        await session.execute(
            text(
                """
                UPDATE continuum_version
                SET is_active = CASE WHEN version = :target_version THEN TRUE ELSE FALSE END
                WHERE continuum_id = :continuum_id AND organization_id = :org_id
                """
            ),
            {
                "target_version": target_version,
                "continuum_id": continuum_id,
                "org_id": organization_id,
            },
        )

        await session.execute(
            text(
                """
                UPDATE continuum
                SET active_version = :target_version,
                    updated_at = :now
                WHERE id = :continuum_id AND organization_id = :org_id
                """
            ),
            {
                "target_version": target_version,
                "now": now,
                "continuum_id": continuum_id,
                "org_id": organization_id,
            },
        )

    logger.info(
        "Continuum rollback",
        continuum_id=continuum_id,
        version=target_version,
        triggered_by=triggered_by,
    )

    await _audit_continuum(
        organization_id=organization_id,
        action="continuum.rollback",
        actor_id=triggered_by,
        continuum_id=continuum_id,
        metadata={"target_version": target_version},
    )

    return {"active_version": target_version}


async def _audit_continuum(
    *,
    organization_id: str,
    action: str,
    actor_id: str | None,
    continuum_id: str,
    metadata: dict[str, Any] | None = None,
) -> None:
    try:
        await record_audit_event(
            organization_id=organization_id,
            action=action,
            actor_type="user" if actor_id else "system",
            actor_id=actor_id,
            resource_type="continuum",
            resource_id=continuum_id,
            metadata=metadata,
        )
    except Exception as exc:
        logger.warning("Failed to audit continuum event", action=action, error=str(exc))


async def record_continuum_run(
    *,
    continuum_id: str,
    organization_id: str,
    version: int,
    status: ContinuumRunStatus,
    run_metadata: dict[str, Any] | None = None,
    step_results: list[dict[str, Any]] | None = None,
    error_message: str | None = None,
    attempt: int = 1,
    started_at: datetime | None = None,
    completed_at: datetime | None = None,
) -> str:
    run_id = str(uuid4())
    started_at = started_at or utc_now()
    async with get_db_session() as session:
        await session.execute(
            text(
                """
                INSERT INTO continuum_run (
                    id, continuum_id, organization_id, version,
                    status, started_at, completed_at,
                    error_message, run_metadata, step_results,
                    attempt, created_at
                ) VALUES (
                    :id, :continuum_id, :org_id, :version,
                    :status, :started_at, :completed_at,
                    :error_message, :run_metadata, :step_results,
                    :attempt, :created_at
                )
                """
            ),
            {
                "id": run_id,
                "continuum_id": continuum_id,
                "org_id": organization_id,
                "version": version,
                "status": status.value,
                "started_at": started_at,
                "completed_at": completed_at,
                "error_message": error_message,
                "run_metadata": json.dumps(run_metadata or {}),
                "step_results": json.dumps(step_results or []),
                "attempt": attempt,
                "created_at": utc_now(),
            },
        )
    return run_id


async def create_continuum_alert(
    *,
    continuum_id: str,
    organization_id: str,
    alert_type: ContinuumAlertType,
    severity: str,
    title: str,
    description: str,
    details: dict[str, Any] | None = None,
) -> str:
    alert_id = str(uuid4())
    now = utc_now()
    async with get_db_session() as session:
        await session.execute(
            text(
                """
                INSERT INTO continuum_alert (
                    id, continuum_id, organization_id,
                    alert_type, severity, status,
                    title, description, details,
                    created_at, resolved_at, resolved_by
                ) VALUES (
                    :id, :continuum_id, :org_id,
                    :alert_type, :severity, :status,
                    :title, :description, :details,
                    :created_at, :resolved_at, :resolved_by
                )
                """
            ),
            {
                "id": alert_id,
                "continuum_id": continuum_id,
                "org_id": organization_id,
                "alert_type": alert_type.value,
                "severity": severity,
                "status": ContinuumAlertStatus.OPEN.value,
                "title": title,
                "description": description,
                "details": json.dumps(details or {}),
                "created_at": now,
                "resolved_at": None,
                "resolved_by": None,
            },
        )
    return alert_id


async def resolve_alert(
    *,
    alert_id: str,
    organization_id: str,
    resolved_by: str | None,
    resolution_notes: str | None = None,
) -> None:
    now = utc_now()
    async with get_db_session() as session:
        await session.execute(
            text(
                """
                UPDATE continuum_alert
                SET status = :status,
                    resolved_at = :resolved_at,
                    resolved_by = :resolved_by,
                    description = COALESCE(description, '') || :resolution_notes
                WHERE id = :alert_id AND organization_id = :org_id
                """
            ),
            {
                "status": ContinuumAlertStatus.RESOLVED.value,
                "resolved_at": now,
                "resolved_by": resolved_by,
                "resolution_notes": f"\nResolution: {resolution_notes}" if resolution_notes else "",
                "alert_id": alert_id,
                "org_id": organization_id,
            },
        )


async def fetch_continuum_definition(
    *,
    continuum_id: str,
    organization_id: str,
    version: int | None = None,
) -> ContinuumDefinition:
    async with get_db_session() as session:
        result = await session.execute(
            text(
                """
                SELECT v.definition
                FROM continuum_version v
                JOIN continuum c ON c.id = v.continuum_id
                WHERE v.continuum_id = :continuum_id
                  AND v.organization_id = :org_id
                  AND v.version = COALESCE(:version, c.active_version)
                LIMIT 1
                """
            ),
            {"continuum_id": continuum_id, "org_id": organization_id, "version": version},
        )
        row = result.fetchone()
        if not row:
            raise ValueError("Continuum definition not found")
        return ContinuumDefinition.model_validate(json.loads(row.definition))


async def fetch_active_version(
    *,
    continuum_id: str,
    organization_id: str,
) -> int:
    async with get_db_session() as session:
        result = await session.execute(
            text(
                """
                SELECT active_version
                FROM continuum
                WHERE id = :continuum_id AND organization_id = :org_id
                """
            ),
            {"continuum_id": continuum_id, "org_id": organization_id},
        )
        row = result.fetchone()
        if not row:
            raise ValueError("Continuum not found")
        return int(row.active_version or 1)


async def list_due_continuums() -> list[dict[str, Any]]:
    now = utc_now()
    with rls_context(None, is_internal=True):
        async with get_db_session() as session:
            result = await session.execute(
                text(
                    """
                    SELECT id, organization_id, active_version, status, next_run_at
                    FROM continuum
                    WHERE status = :status
                      AND next_run_at IS NOT NULL
                      AND next_run_at <= :now
                    """
                ),
                {"status": ContinuumStatus.ACTIVE.value, "now": now},
            )
            return [
                {
                    "id": row.id,
                    "organization_id": row.organization_id,
                    "active_version": row.active_version,
                    "next_run_at": row.next_run_at,
                }
                for row in result.fetchall()
            ]


async def list_open_alerts(
    *,
    continuum_id: str,
    organization_id: str,
    alert_type: ContinuumAlertType | None = None,
) -> list[dict[str, Any]]:
    async with get_db_session() as session:
        result = await session.execute(
            text(
                """
                SELECT id, alert_type, severity, title, description, status
                FROM continuum_alert
                WHERE continuum_id = :continuum_id
                  AND organization_id = :org_id
                  AND status = :status
                  AND (:alert_type IS NULL OR alert_type = :alert_type)
                """
            ),
            {
                "continuum_id": continuum_id,
                "org_id": organization_id,
                "status": ContinuumAlertStatus.OPEN.value,
                "alert_type": alert_type.value if alert_type else None,
            },
        )
        return [dict(row._mapping) for row in result.fetchall()]
