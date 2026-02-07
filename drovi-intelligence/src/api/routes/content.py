"""
Content Search API

Fast search over raw captured content stored in the Unified Event Model (UEM).

This is intentionally *evidence-first*: results point to concrete captured
events (messages, documents, notes) that can be opened in evidence lenses.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

import structlog
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import text

from src.auth.middleware import APIKeyContext, require_scope_with_rate_limit
from src.auth.private_sources import get_session_user_id, is_admin_or_internal
from src.auth.scopes import Scope
from src.db.client import get_db_session

logger = structlog.get_logger()

router = APIRouter(prefix="/content", tags=["Content"])


class ContentKind(str):
    MESSAGE = "message"
    DOCUMENT = "document"
    MEETING = "meeting"
    NOTE = "note"


class ContentSearchRequest(BaseModel):
    query: str = Field(..., min_length=2, max_length=500)
    organization_id: str | None = None
    kinds: list[Literal["message", "document", "meeting", "note"]] | None = None
    limit: int = Field(default=20, ge=1, le=50)


class ContentSearchResult(BaseModel):
    id: str
    kind: str
    source_type: str
    source_id: str | None = None
    source_account_id: str | None = None
    conversation_id: str | None = None
    message_id: str | None = None
    title: str | None = None
    snippet: str | None = None
    captured_at: datetime | None = None
    received_at: datetime


class ContentSearchResponse(BaseModel):
    success: bool = True
    results: list[ContentSearchResult] = Field(default_factory=list)
    count: int = 0


@router.post("/search", response_model=ContentSearchResponse)
async def content_search(
    request: ContentSearchRequest,
    ctx: APIKeyContext = Depends(require_scope_with_rate_limit(Scope.READ)),
) -> ContentSearchResponse:
    org_id = request.organization_id or ctx.organization_id
    if not org_id or org_id == "internal":
        raise HTTPException(status_code=400, detail="organization_id is required")

    if ctx.organization_id != "internal" and request.organization_id and request.organization_id != ctx.organization_id:
        raise HTTPException(status_code=403, detail="Organization ID mismatch with authenticated key")

    q = request.query.strip()
    if len(q) < 2:
        return ContentSearchResponse(success=True, results=[], count=0)

    session_user_id = get_session_user_id(ctx)
    is_admin = is_admin_or_internal(ctx)

    # Map client-facing kinds to UEM event_type values.
    kind_filter = request.kinds or []
    event_types: list[str] | None = None
    if kind_filter:
        event_types = [k.lower() for k in kind_filter]

    # Private boundary filter for events associated to private connections.
    private_sql = ""
    private_params: dict[str, Any] = {}
    if not is_admin:
        if session_user_id:
            private_sql = """
                AND NOT (
                    c.visibility = 'private'
                    AND (c.created_by_user_id IS DISTINCT FROM :current_user_id)
                )
            """.strip()
            private_params["current_user_id"] = session_user_id
        else:
            private_sql = "AND NOT (c.visibility = 'private')"

    where_event_types = ""
    params: dict[str, Any] = {
        "org_id": org_id,
        "q": f"%{q}%",
        "limit": request.limit,
        **private_params,
    }
    if event_types:
        where_event_types = "AND e.event_type = ANY(:event_types)"
        params["event_types"] = event_types

    async with get_db_session() as session:
        result = await session.execute(
            text(
                f"""
                SELECT
                    e.id,
                    e.event_type,
                    e.source_type,
                    e.source_id,
                    e.source_account_id,
                    e.conversation_id,
                    e.message_id,
                    e.content_text,
                    e.metadata,
                    e.captured_at,
                    e.received_at,
                    COALESCE(e.metadata->>'subject', e.metadata->>'title') AS title
                FROM unified_event e
                LEFT JOIN connections c
                  ON c.organization_id = e.organization_id
                 AND c.id::text = e.source_account_id
                WHERE e.organization_id = :org_id
                  AND (
                    e.content_text ILIKE :q
                    OR COALESCE(e.metadata->>'subject', '') ILIKE :q
                    OR COALESCE(e.metadata->>'title', '') ILIKE :q
                  )
                  {where_event_types}
                  {private_sql}
                ORDER BY e.captured_at DESC NULLS LAST, e.received_at DESC
                LIMIT :limit
                """
            ),
            params,
        )
        rows = result.fetchall()

    results: list[ContentSearchResult] = []
    for row in rows:
        content_text = getattr(row, "content_text", None)
        snippet = None
        if isinstance(content_text, str) and content_text.strip():
            cleaned = " ".join(content_text.strip().split())
            snippet = cleaned[:240] + ("..." if len(cleaned) > 240 else "")

        results.append(
            ContentSearchResult(
                id=str(row.id),
                kind=str(row.event_type),
                source_type=str(row.source_type),
                source_id=getattr(row, "source_id", None),
                source_account_id=getattr(row, "source_account_id", None),
                conversation_id=getattr(row, "conversation_id", None),
                message_id=getattr(row, "message_id", None),
                title=getattr(row, "title", None),
                snippet=snippet,
                captured_at=getattr(row, "captured_at", None),
                received_at=getattr(row, "received_at", None),
            )
        )

    return ContentSearchResponse(success=True, results=results, count=len(results))

