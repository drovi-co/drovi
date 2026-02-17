"""Admin onboarding operations routes (Phase 11)."""

from __future__ import annotations

from datetime import datetime, timezone
from types import SimpleNamespace
from typing import Any, Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import text

from src.audit.log import record_audit_event
from src.auth.middleware import APIKeyContext, require_scope_with_rate_limit
from src.auth.scopes import Scope
from src.config import get_settings
from src.db.client import get_db_session
from src.jobs.queue import EnqueueJobRequest, enqueue_job

router = APIRouter(prefix="/admin/onboarding", tags=["Admin Onboarding"])


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _require_internal_admin(
    ctx: APIKeyContext = Depends(require_scope_with_rate_limit(Scope.ADMIN)),
) -> APIKeyContext:
    if not ctx.is_internal and ctx.organization_id != "internal":
        raise HTTPException(status_code=403, detail="Admin access required")
    return ctx


class OnboardingChecklist(BaseModel):
    security_review_complete: bool = False
    data_custody_mapped: bool = False
    pilot_mandate_set: bool = False
    go_live_ready: bool = False


class OnboardingRunbookItem(BaseModel):
    organization_id: str
    organization_name: str
    checklist: OnboardingChecklist
    owner_email: str | None = None
    target_go_live_at: datetime | None = None
    notes: str | None = None
    updated_by: str | None = None
    updated_at: datetime | None = None
    open_ticket_count: int = 0


class OnboardingRunbookListResponse(BaseModel):
    runbooks: list[OnboardingRunbookItem]


class UpsertOnboardingRunbookRequest(BaseModel):
    security_review_complete: bool | None = None
    data_custody_mapped: bool | None = None
    pilot_mandate_set: bool | None = None
    go_live_ready: bool | None = None
    owner_email: str | None = Field(default=None, max_length=255)
    target_go_live_at: datetime | None = None
    notes: str | None = Field(default=None, max_length=5000)


class TriggerAutomationRequest(BaseModel):
    month: str | None = Field(default=None, pattern=r"^\d{4}-\d{2}$")


class TriggerAutomationResponse(BaseModel):
    key: str
    job_id: str
    status: str
    job_type: str
    queued_at: datetime


class OnboardingAutomationItem(BaseModel):
    key: str
    label: str
    job_type: str
    enabled: bool
    cron: str
    pilot_only: bool
    cadence: str
    last_job_id: str | None = None
    last_status: str | None = None
    last_run_at: datetime | None = None


class OnboardingAutomationListResponse(BaseModel):
    automations: list[OnboardingAutomationItem]


def _normalize_string(value: str | None) -> str | None:
    if value is None:
        return None
    stripped = value.strip()
    return stripped or None


def _map_runbook_row(row: Any) -> OnboardingRunbookItem:
    return OnboardingRunbookItem(
        organization_id=str(row.organization_id),
        organization_name=str(row.organization_name or row.organization_id),
        checklist=OnboardingChecklist(
            security_review_complete=bool(row.security_review_complete),
            data_custody_mapped=bool(row.data_custody_mapped),
            pilot_mandate_set=bool(row.pilot_mandate_set),
            go_live_ready=bool(row.go_live_ready),
        ),
        owner_email=str(row.owner_email) if row.owner_email is not None else None,
        target_go_live_at=row.target_go_live_at,
        notes=str(row.notes) if row.notes is not None else None,
        updated_by=str(row.updated_by) if row.updated_by is not None else None,
        updated_at=row.updated_at,
        open_ticket_count=int(row.open_ticket_count or 0),
    )


@router.get("/runbooks", response_model=OnboardingRunbookListResponse)
async def list_onboarding_runbooks(
    organization_id: str | None = Query(default=None),
    status: Literal["all", "ready", "in_progress"] = Query(default="all"),
    limit: int = Query(default=100, ge=1, le=500),
    ctx: APIKeyContext = Depends(_require_internal_admin),
) -> OnboardingRunbookListResponse:
    _ = ctx
    where = ["o.pilot_status = 'active'"]
    params: dict[str, Any] = {"limit": int(limit)}

    if organization_id:
        where.append("o.id = :organization_id")
        params["organization_id"] = organization_id

    if status == "ready":
        where.append("COALESCE(r.go_live_ready, false) = true")
    elif status == "in_progress":
        where.append("COALESCE(r.go_live_ready, false) = false")

    where_sql = " AND ".join(where)

    async with get_db_session() as session:
        result = await session.execute(
            text(
                f"""
                SELECT
                    o.id AS organization_id,
                    o.name AS organization_name,
                    COALESCE(r.security_review_complete, false) AS security_review_complete,
                    COALESCE(r.data_custody_mapped, false) AS data_custody_mapped,
                    COALESCE(r.pilot_mandate_set, false) AS pilot_mandate_set,
                    COALESCE(r.go_live_ready, false) AS go_live_ready,
                    r.owner_email AS owner_email,
                    r.target_go_live_at AS target_go_live_at,
                    r.notes AS notes,
                    r.updated_by AS updated_by,
                    r.updated_at AS updated_at,
                    COALESCE(t.open_ticket_count, 0) AS open_ticket_count
                FROM organizations o
                LEFT JOIN admin_onboarding_runbook r
                  ON r.organization_id = o.id
                LEFT JOIN (
                    SELECT organization_id, COUNT(*) AS open_ticket_count
                    FROM support_ticket
                    WHERE status IN ('open', 'pending')
                    GROUP BY organization_id
                ) t
                  ON t.organization_id = o.id
                WHERE {where_sql}
                ORDER BY
                    COALESCE(r.go_live_ready, false) ASC,
                    COALESCE(r.updated_at, o.updated_at, o.created_at) DESC NULLS LAST
                LIMIT :limit
                """
            ),
            params,
        )
        runbooks = [_map_runbook_row(row) for row in result.fetchall()]

    return OnboardingRunbookListResponse(runbooks=runbooks)


@router.put("/runbooks/{organization_id}", response_model=OnboardingRunbookItem)
async def upsert_onboarding_runbook(
    organization_id: str,
    request: UpsertOnboardingRunbookRequest,
    ctx: APIKeyContext = Depends(_require_internal_admin),
) -> OnboardingRunbookItem:
    now = _utc_now()
    actor = _normalize_string(ctx.key_id) or "admin"

    async with get_db_session() as session:
        org_result = await session.execute(
            text("SELECT id, name FROM organizations WHERE id = :organization_id LIMIT 1"),
            {"organization_id": organization_id},
        )
        org_row = org_result.fetchone()
        if not org_row:
            raise HTTPException(status_code=404, detail="Organization not found")

        existing_result = await session.execute(
            text(
                """
                SELECT
                    security_review_complete,
                    data_custody_mapped,
                    pilot_mandate_set,
                    go_live_ready,
                    owner_email,
                    target_go_live_at,
                    notes
                FROM admin_onboarding_runbook
                WHERE organization_id = :organization_id
                LIMIT 1
                """
            ),
            {"organization_id": organization_id},
        )
        existing_row = existing_result.fetchone()

        security_review_complete = (
            request.security_review_complete
            if request.security_review_complete is not None
            else bool(existing_row.security_review_complete) if existing_row else False
        )
        data_custody_mapped = (
            request.data_custody_mapped
            if request.data_custody_mapped is not None
            else bool(existing_row.data_custody_mapped) if existing_row else False
        )
        pilot_mandate_set = (
            request.pilot_mandate_set
            if request.pilot_mandate_set is not None
            else bool(existing_row.pilot_mandate_set) if existing_row else False
        )
        go_live_ready = (
            request.go_live_ready
            if request.go_live_ready is not None
            else bool(existing_row.go_live_ready) if existing_row else False
        )
        owner_email = _normalize_string(request.owner_email)
        if owner_email is None and existing_row:
            owner_email = (
                str(existing_row.owner_email)
                if existing_row.owner_email is not None
                else None
            )
        notes = _normalize_string(request.notes)
        if notes is None and existing_row:
            notes = str(existing_row.notes) if existing_row.notes is not None else None
        target_go_live_at = request.target_go_live_at
        if target_go_live_at is None and existing_row:
            target_go_live_at = existing_row.target_go_live_at

        result = await session.execute(
            text(
                """
                INSERT INTO admin_onboarding_runbook (
                    organization_id,
                    security_review_complete,
                    data_custody_mapped,
                    pilot_mandate_set,
                    go_live_ready,
                    owner_email,
                    target_go_live_at,
                    notes,
                    updated_by,
                    created_at,
                    updated_at
                ) VALUES (
                    :organization_id,
                    :security_review_complete,
                    :data_custody_mapped,
                    :pilot_mandate_set,
                    :go_live_ready,
                    :owner_email,
                    :target_go_live_at,
                    :notes,
                    :updated_by,
                    :now,
                    :now
                )
                ON CONFLICT (organization_id) DO UPDATE SET
                    security_review_complete = EXCLUDED.security_review_complete,
                    data_custody_mapped = EXCLUDED.data_custody_mapped,
                    pilot_mandate_set = EXCLUDED.pilot_mandate_set,
                    go_live_ready = EXCLUDED.go_live_ready,
                    owner_email = EXCLUDED.owner_email,
                    target_go_live_at = EXCLUDED.target_go_live_at,
                    notes = EXCLUDED.notes,
                    updated_by = EXCLUDED.updated_by,
                    updated_at = EXCLUDED.updated_at
                RETURNING
                    organization_id,
                    security_review_complete,
                    data_custody_mapped,
                    pilot_mandate_set,
                    go_live_ready,
                    owner_email,
                    target_go_live_at,
                    notes,
                    updated_by,
                    updated_at
                """
            ),
            {
                "organization_id": organization_id,
                "security_review_complete": bool(security_review_complete),
                "data_custody_mapped": bool(data_custody_mapped),
                "pilot_mandate_set": bool(pilot_mandate_set),
                "go_live_ready": bool(go_live_ready),
                "owner_email": owner_email,
                "target_go_live_at": target_go_live_at,
                "notes": notes,
                "updated_by": actor,
                "now": now,
            },
        )
        row = result.fetchone()

        ticket_result = await session.execute(
            text(
                """
                SELECT COUNT(*) AS open_ticket_count
                FROM support_ticket
                WHERE organization_id = :organization_id
                  AND status IN ('open', 'pending')
                """
            ),
            {"organization_id": organization_id},
        )
        ticket_row = ticket_result.fetchone()

    await record_audit_event(
        organization_id="internal",
        action="admin.onboarding.runbook.updated",
        actor_type="user",
        actor_id=actor,
        resource_type="organization",
        resource_id=organization_id,
        metadata={
            "security_review_complete": bool(row.security_review_complete),
            "data_custody_mapped": bool(row.data_custody_mapped),
            "pilot_mandate_set": bool(row.pilot_mandate_set),
            "go_live_ready": bool(row.go_live_ready),
            "owner_email": row.owner_email,
            "target_go_live_at": (
                row.target_go_live_at.isoformat() if row.target_go_live_at else None
            ),
        },
    )

    mapped = _map_runbook_row(
        SimpleNamespace(
            organization_id=organization_id,
            organization_name=str(org_row.name),
            security_review_complete=bool(row.security_review_complete),
            data_custody_mapped=bool(row.data_custody_mapped),
            pilot_mandate_set=bool(row.pilot_mandate_set),
            go_live_ready=bool(row.go_live_ready),
            owner_email=row.owner_email,
            target_go_live_at=row.target_go_live_at,
            notes=row.notes,
            updated_by=row.updated_by,
            updated_at=row.updated_at,
            open_ticket_count=int(ticket_row.open_ticket_count or 0),
        )
    )
    return mapped


@router.get("/automations", response_model=OnboardingAutomationListResponse)
async def list_onboarding_automations(
    ctx: APIKeyContext = Depends(_require_internal_admin),
) -> OnboardingAutomationListResponse:
    _ = ctx
    settings = get_settings()

    latest_by_type: dict[str, dict[str, Any]] = {}
    async with get_db_session() as session:
        result = await session.execute(
            text(
                """
                SELECT id, job_type, status, updated_at
                FROM background_job
                WHERE job_type IN ('reports.weekly_operations', 'trust.integrity_monthly')
                ORDER BY updated_at DESC NULLS LAST
                LIMIT 200
                """
            )
        )
        for row in result.fetchall():
            job_type = str(row.job_type)
            if job_type in latest_by_type:
                continue
            latest_by_type[job_type] = {
                "id": str(row.id),
                "status": str(row.status),
                "updated_at": row.updated_at,
            }

    schedule_items = [
        OnboardingAutomationItem(
            key="weekly_operations_brief",
            label="Weekly operations brief",
            job_type="reports.weekly_operations",
            enabled=bool(settings.weekly_operations_brief_enabled),
            cron=str(settings.weekly_operations_brief_cron),
            pilot_only=bool(settings.weekly_operations_brief_pilot_only),
            cadence="weekly",
            last_job_id=latest_by_type.get("reports.weekly_operations", {}).get("id"),
            last_status=latest_by_type.get("reports.weekly_operations", {}).get("status"),
            last_run_at=latest_by_type.get("reports.weekly_operations", {}).get(
                "updated_at"
            ),
        ),
        OnboardingAutomationItem(
            key="monthly_integrity_report",
            label="Monthly integrity report",
            job_type="trust.integrity_monthly",
            enabled=bool(settings.monthly_integrity_report_enabled),
            cron=str(settings.monthly_integrity_report_cron),
            pilot_only=bool(settings.monthly_integrity_report_pilot_only),
            cadence="monthly",
            last_job_id=latest_by_type.get("trust.integrity_monthly", {}).get("id"),
            last_status=latest_by_type.get("trust.integrity_monthly", {}).get("status"),
            last_run_at=latest_by_type.get("trust.integrity_monthly", {}).get("updated_at"),
        ),
    ]
    return OnboardingAutomationListResponse(automations=schedule_items)


@router.post(
    "/automations/{automation_key}/run",
    response_model=TriggerAutomationResponse,
)
async def trigger_onboarding_automation(
    automation_key: Literal["weekly_operations_brief", "monthly_integrity_report"],
    request: TriggerAutomationRequest,
    ctx: APIKeyContext = Depends(_require_internal_admin),
) -> TriggerAutomationResponse:
    settings = get_settings()
    actor = _normalize_string(ctx.key_id) or "admin"
    now = _utc_now()

    if automation_key == "weekly_operations_brief":
        job_type = "reports.weekly_operations"
        payload: dict[str, Any] = {
            "pilot_only": bool(settings.weekly_operations_brief_pilot_only),
            "brief_days": int(settings.weekly_operations_brief_days),
            "blindspot_days": int(settings.weekly_operations_blindspot_days),
            "triggered_via": "admin_api",
        }
        idempotency_key = (
            f"manual:reports.weekly_operations:{now.strftime('%Y%m%d%H%M')}"
        )
    else:
        month = request.month or now.strftime("%Y-%m")
        job_type = "trust.integrity_monthly"
        payload = {
            "pilot_only": bool(settings.monthly_integrity_report_pilot_only),
            "month": month,
            "triggered_via": "admin_api",
        }
        idempotency_key = (
            f"manual:trust.integrity_monthly:{month}:{now.strftime('%Y%m%d%H%M')}"
        )

    job_id = await enqueue_job(
        EnqueueJobRequest(
            organization_id="internal",
            job_type=job_type,
            payload=payload,
            priority=0,
            max_attempts=1,
            idempotency_key=idempotency_key,
            resource_key=f"system:{automation_key}",
        )
    )

    await record_audit_event(
        organization_id="internal",
        action="admin.onboarding.automation.triggered",
        actor_type="user",
        actor_id=actor,
        resource_type="background_job",
        resource_id=job_id,
        metadata={
            "automation_key": automation_key,
            "job_type": job_type,
            "payload": payload,
        },
    )

    return TriggerAutomationResponse(
        key=automation_key,
        job_id=job_id,
        status="queued",
        job_type=job_type,
        queued_at=now,
    )
