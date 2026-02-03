"""
Signal + Unified Event APIs

Provides access to fast extraction candidates and unified events.
"""

from datetime import datetime

import structlog
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import text

from src.auth.middleware import APIKeyContext, require_scope_with_rate_limit
from src.auth.scopes import Scope
from src.db.client import get_db_session

logger = structlog.get_logger()

router = APIRouter(prefix="/signals", tags=["signals"])


def _validate_org_id(ctx: APIKeyContext, organization_id: str) -> None:
    if ctx.organization_id != "internal" and organization_id != ctx.organization_id:
        raise HTTPException(status_code=403, detail="Organization ID mismatch")


class SignalCandidateRecord(BaseModel):
    id: str
    candidate_type: str
    title: str | None = None
    content: str | None = None
    evidence_text: str | None = None
    confidence: float | None = None
    status: str
    conversation_id: str | None = None
    source_type: str | None = None
    source_id: str | None = None
    created_at: datetime


class UnifiedEventRecord(BaseModel):
    id: str
    event_type: str
    source_type: str
    source_id: str | None = None
    conversation_id: str | None = None
    message_id: str | None = None
    content_text: str | None = None
    captured_at: datetime | None = None
    received_at: datetime


@router.get("/candidates", response_model=list[SignalCandidateRecord])
async def list_signal_candidates(
    organization_id: str = Query(...),
    candidate_type: str | None = Query(None),
    status: str | None = Query(None),
    limit: int = Query(100, ge=1, le=500),
    ctx: APIKeyContext = Depends(require_scope_with_rate_limit(Scope.READ)),
):
    _validate_org_id(ctx, organization_id)

    async with get_db_session() as session:
        query = """
            SELECT id, candidate_type, title, content, evidence_text,
                   confidence, status, conversation_id, source_type,
                   source_id, created_at
            FROM signal_candidate
            WHERE organization_id = :org_id
        """
        params = {"org_id": organization_id, "limit": limit}
        if candidate_type:
            query += " AND candidate_type = :candidate_type"
            params["candidate_type"] = candidate_type
        if status:
            query += " AND status = :status"
            params["status"] = status
        query += " ORDER BY created_at DESC LIMIT :limit"

        result = await session.execute(text(query), params)
        rows = result.fetchall()
        return [
            SignalCandidateRecord(
                id=row.id,
                candidate_type=row.candidate_type,
                title=row.title,
                content=row.content,
                evidence_text=row.evidence_text,
                confidence=row.confidence,
                status=row.status,
                conversation_id=row.conversation_id,
                source_type=row.source_type,
                source_id=row.source_id,
                created_at=row.created_at,
            )
            for row in rows
        ]


@router.get("/events", response_model=list[UnifiedEventRecord])
async def list_unified_events(
    organization_id: str = Query(...),
    event_type: str | None = Query(None),
    source_type: str | None = Query(None),
    conversation_id: str | None = Query(None),
    limit: int = Query(100, ge=1, le=500),
    ctx: APIKeyContext = Depends(require_scope_with_rate_limit(Scope.READ)),
):
    _validate_org_id(ctx, organization_id)

    async with get_db_session() as session:
        query = """
            SELECT id, event_type, source_type, source_id,
                   conversation_id, message_id, content_text,
                   captured_at, received_at
            FROM unified_event
            WHERE organization_id = :org_id
        """
        params = {"org_id": organization_id, "limit": limit}
        if event_type:
            query += " AND event_type = :event_type"
            params["event_type"] = event_type
        if source_type:
            query += " AND source_type = :source_type"
            params["source_type"] = source_type
        if conversation_id:
            query += " AND conversation_id = :conversation_id"
            params["conversation_id"] = conversation_id
        query += " ORDER BY received_at DESC LIMIT :limit"

        result = await session.execute(text(query), params)
        rows = result.fetchall()
        return [
            UnifiedEventRecord(
                id=row.id,
                event_type=row.event_type,
                source_type=row.source_type,
                source_id=row.source_id,
                conversation_id=row.conversation_id,
                message_id=row.message_id,
                content_text=row.content_text,
                captured_at=row.captured_at,
                received_at=row.received_at,
            )
            for row in rows
        ]
