"""Sensors API routes."""

import json
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import text

from src.auth.middleware import APIKeyContext, require_scope_with_rate_limit
from src.auth.scopes import Scope
from src.config import get_settings
from src.db.client import get_db_session
from src.ingestion.reality_events import persist_reality_event
from src.ingestion.event_types import UnifiedEventType, normalize_event_type
from src.sensors import list_sensors, get_sensor

router = APIRouter(prefix="/sensors", tags=["Sensors"])


class SensorPermissionRecord(BaseModel):
    sensor_id: str
    status: str
    granted_scopes: list[str]
    reason: str | None = None
    created_at: datetime
    updated_at: datetime


class SensorPermissionUpdate(BaseModel):
    status: str
    granted_scopes: list[str] = []
    reason: str | None = None


class RealityEventIngest(BaseModel):
    organization_id: str
    source_type: str
    event_type: str
    content_text: str | None = None
    content_json: dict | list | None = None
    participants: list[dict] | None = None
    metadata: dict | None = None
    source_id: str | None = None
    source_account_id: str | None = None
    conversation_id: str | None = None
    message_id: str | None = None
    captured_at: datetime | None = None
    evidence_artifact_id: str | None = None


def _validate_org_id(ctx: APIKeyContext, organization_id: str) -> None:
    if ctx.organization_id != "internal" and organization_id != ctx.organization_id:
        raise HTTPException(status_code=403, detail="Organization ID mismatch")


@router.get("")
async def list_available_sensors():
    return {
        "count": len(list_sensors()),
        "sensors": [sensor.model_dump() for sensor in list_sensors()],
    }


@router.get("/permissions", response_model=list[SensorPermissionRecord])
async def list_sensor_permissions(
    organization_id: str = Query(...),
    ctx: APIKeyContext = Depends(require_scope_with_rate_limit(Scope.WRITE)),
):
    _validate_org_id(ctx, organization_id)
    async with get_db_session() as session:
        result = await session.execute(
            text(
                """
                SELECT sensor_id, status, granted_scopes, reason, created_at, updated_at
                FROM sensor_permission
                WHERE organization_id = :org_id
                ORDER BY sensor_id
                """
            ),
            {"org_id": organization_id},
        )
        rows = result.fetchall()
        return [
            SensorPermissionRecord(
                sensor_id=row.sensor_id,
                status=row.status,
                granted_scopes=row.granted_scopes or [],
                reason=row.reason,
                created_at=row.created_at,
                updated_at=row.updated_at,
            )
            for row in rows
        ]


@router.put("/permissions/{sensor_id}", response_model=SensorPermissionRecord)
async def upsert_sensor_permission(
    sensor_id: str,
    payload: SensorPermissionUpdate,
    organization_id: str = Query(...),
    ctx: APIKeyContext = Depends(require_scope_with_rate_limit(Scope.WRITE)),
):
    _validate_org_id(ctx, organization_id)
    now = datetime.now(timezone.utc)
    async with get_db_session() as session:
        await session.execute(
            text(
                """
                INSERT INTO sensor_permission (
                    id, organization_id, sensor_id, status, granted_scopes, reason, created_at, updated_at
                ) VALUES (
                    gen_random_uuid()::text, :org_id, :sensor_id, :status, :scopes, :reason, :now, :now
                )
                ON CONFLICT (organization_id, sensor_id)
                DO UPDATE SET status = EXCLUDED.status,
                              granted_scopes = EXCLUDED.granted_scopes,
                              reason = EXCLUDED.reason,
                              updated_at = EXCLUDED.updated_at
                """
            ),
            {
                "org_id": organization_id,
                "sensor_id": sensor_id,
                "status": payload.status,
                "scopes": payload.granted_scopes,
                "reason": payload.reason,
                "now": now,
            },
        )
        result = await session.execute(
            text(
                """
                SELECT sensor_id, status, granted_scopes, reason, created_at, updated_at
                FROM sensor_permission
                WHERE organization_id = :org_id AND sensor_id = :sensor_id
                """
            ),
            {"org_id": organization_id, "sensor_id": sensor_id},
        )
        row = result.fetchone()
        return SensorPermissionRecord(
            sensor_id=row.sensor_id,
            status=row.status,
            granted_scopes=row.granted_scopes or [],
            reason=row.reason,
            created_at=row.created_at,
            updated_at=row.updated_at,
        )


@router.post("/events")
async def ingest_reality_event(
    payload: RealityEventIngest,
    ctx: APIKeyContext = Depends(require_scope_with_rate_limit(Scope.WRITE)),
):
    _validate_org_id(ctx, payload.organization_id)
    settings = get_settings()
    event_type = normalize_event_type(payload.event_type)

    if event_type in {
        UnifiedEventType.DESKTOP_CONTEXT.value,
        UnifiedEventType.SCREEN_CAPTURE.value,
        UnifiedEventType.OCR_TEXT.value,
    }:
        if not settings.desktop_context_enabled:
            raise HTTPException(status_code=403, detail="Desktop context ingestion disabled")
        max_bytes = settings.desktop_context_max_bytes
        if payload.content_text and len(payload.content_text.encode("utf-8")) > max_bytes:
            raise HTTPException(status_code=413, detail="Desktop context payload too large")
        if payload.content_json is not None:
            payload_size = len(json.dumps(payload.content_json).encode("utf-8"))
            if payload_size > max_bytes:
                raise HTTPException(status_code=413, detail="Desktop context payload too large")
    event_id, created = await persist_reality_event(
        organization_id=payload.organization_id,
        source_type=payload.source_type,
        event_type=event_type,
        content_text=payload.content_text,
        content_json=payload.content_json,
        participants=payload.participants,
        metadata=payload.metadata,
        source_id=payload.source_id,
        source_account_id=payload.source_account_id,
        conversation_id=payload.conversation_id,
        message_id=payload.message_id,
        captured_at=payload.captured_at,
        evidence_artifact_id=payload.evidence_artifact_id,
    )
    return {
        "id": event_id,
        "created": created,
    }


@router.get("/{sensor_id}")
async def get_sensor_detail(sensor_id: str):
    sensor = get_sensor(sensor_id)
    if not sensor:
        raise HTTPException(status_code=404, detail="Sensor not found")
    return sensor.model_dump()
