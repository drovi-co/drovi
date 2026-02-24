"""World crawl fabric operator APIs."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field

from src.auth.middleware import APIKeyContext, require_scope_with_rate_limit
from src.auth.scopes import Scope
from src.crawlers.frontier.service import dispatch_frontier_tick, seed_frontier_url
from src.crawlers.policy import request_legal_hold, request_takedown
from src.crawlers.repository import list_audit_logs, list_frontier_entries, list_policy_rules

router = APIRouter(prefix="/crawl", tags=["World Crawl"])


def _resolve_org(ctx: APIKeyContext, requested_org_id: str | None) -> str:
    resolved = requested_org_id or ctx.organization_id
    if ctx.organization_id != "internal" and resolved != ctx.organization_id:
        raise HTTPException(status_code=403, detail="Organization mismatch for authenticated key")
    return resolved


class CrawlSeedRequest(BaseModel):
    organization_id: str | None = None
    source_key: str = Field(..., min_length=2, max_length=100)
    url: str = Field(..., min_length=8, max_length=4000)
    seed_type: str = Field(default="manual", max_length=50)
    priority: int = Field(default=0, ge=0, le=9)
    freshness_policy_minutes: int = Field(default=60, ge=1, le=24 * 60)
    metadata: dict[str, Any] = Field(default_factory=dict)


class CrawlTickRequest(BaseModel):
    sync_params: dict[str, Any] = Field(default_factory=dict)


class CrawlPolicyRequest(BaseModel):
    organization_id: str | None = None
    scope: str = Field(..., min_length=3, max_length=4000)
    reason: str = Field(..., min_length=3, max_length=1000)
    metadata: dict[str, Any] = Field(default_factory=dict)


@router.post("/frontier/seed")
async def seed_frontier(
    body: CrawlSeedRequest,
    ctx: APIKeyContext = Depends(require_scope_with_rate_limit(Scope.WRITE)),
) -> dict[str, Any]:
    org_id = _resolve_org(ctx, body.organization_id)
    seeded = await seed_frontier_url(
        organization_id=org_id,
        source_key=body.source_key,
        url=body.url,
        seed_type=body.seed_type,
        priority=body.priority,
        freshness_policy_minutes=body.freshness_policy_minutes,
        metadata=body.metadata,
        actor=ctx.key_id,
    )
    return {"status": "queued", "frontier_entry": seeded}


@router.post("/frontier/tick")
async def tick_frontier(
    body: CrawlTickRequest,
    _ctx: APIKeyContext = Depends(require_scope_with_rate_limit(Scope.WRITE)),
) -> dict[str, Any]:
    result = await dispatch_frontier_tick(sync_params=body.sync_params)
    return {"status": "ok", **result}


@router.get("/frontier")
async def get_frontier(
    organization_id: str | None = Query(default=None),
    status: str | None = Query(default=None),
    limit: int = Query(default=100, ge=1, le=500),
    ctx: APIKeyContext = Depends(require_scope_with_rate_limit(Scope.READ)),
) -> dict[str, Any]:
    org_id = _resolve_org(ctx, organization_id)
    rows = await list_frontier_entries(organization_id=org_id, status=status, limit=limit)
    return {"organization_id": org_id, "count": len(rows), "items": rows}


@router.get("/audit")
async def get_crawl_audit(
    organization_id: str | None = Query(default=None),
    event_type: str | None = Query(default=None),
    limit: int = Query(default=100, ge=1, le=1000),
    ctx: APIKeyContext = Depends(require_scope_with_rate_limit(Scope.READ)),
) -> dict[str, Any]:
    org_id = _resolve_org(ctx, organization_id)
    rows = await list_audit_logs(
        organization_id=org_id,
        event_type=event_type,
        limit=limit,
    )
    return {"organization_id": org_id, "count": len(rows), "items": rows}


@router.get("/policy/rules")
async def get_crawl_policy_rules(
    organization_id: str | None = Query(default=None),
    only_active: bool = Query(default=True),
    ctx: APIKeyContext = Depends(require_scope_with_rate_limit(Scope.READ)),
) -> dict[str, Any]:
    org_id = _resolve_org(ctx, organization_id)
    rows = await list_policy_rules(
        organization_id=org_id,
        only_active=only_active,
    )
    return {"organization_id": org_id, "count": len(rows), "items": rows}


@router.post("/policy/takedown")
async def takedown_scope(
    body: CrawlPolicyRequest,
    ctx: APIKeyContext = Depends(require_scope_with_rate_limit(Scope.WRITE)),
) -> dict[str, Any]:
    org_id = _resolve_org(ctx, body.organization_id)
    result = await request_takedown(
        organization_id=org_id,
        scope=body.scope,
        reason=body.reason,
        actor=ctx.key_id,
        metadata=body.metadata,
    )
    return {"status": "ok", **result}


@router.post("/policy/legal-hold")
async def legal_hold_scope(
    body: CrawlPolicyRequest,
    ctx: APIKeyContext = Depends(require_scope_with_rate_limit(Scope.WRITE)),
) -> dict[str, Any]:
    org_id = _resolve_org(ctx, body.organization_id)
    result = await request_legal_hold(
        organization_id=org_id,
        scope=body.scope,
        reason=body.reason,
        actor=ctx.key_id,
        metadata=body.metadata,
    )
    return {"status": "ok", **result}
