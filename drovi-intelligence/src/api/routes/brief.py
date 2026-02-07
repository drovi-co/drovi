"""
Brief API Route

Precomputed intelligence summary endpoint.
Returns cached org-level brief with summary stats and attention items.

Performance target: < 200ms p95 (served from Redis cache)
"""

import hashlib
import json
from datetime import datetime, timedelta, timezone
from enum import Enum
from typing import Literal

import structlog
from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, Field
from prometheus_client import Counter, Histogram

from src.auth.middleware import APIKeyContext, require_scope_with_rate_limit
from src.auth.scopes import Scope
from src.config import get_settings

logger = structlog.get_logger()

router = APIRouter(prefix="/brief", tags=["brief"])

# Prometheus metrics
BRIEF_LATENCY = Histogram(
    "drovi_brief_latency_seconds",
    "Brief endpoint latency",
    ["org_id", "cache_hit"],
    buckets=[0.05, 0.1, 0.15, 0.2, 0.3, 0.5, 1.0],
)
BRIEF_REQUESTS = Counter(
    "drovi_brief_requests_total",
    "Total brief requests",
    ["org_id", "period"],
)


class BriefPeriod(str, Enum):
    """Time period for brief aggregation."""

    LAST_7_DAYS = "last_7_days"
    TODAY = "today"


class Counterparty(BaseModel):
    """Person/company involved in an attention item."""

    name: str
    email: str | None = None
    company: str | None = None


class AttentionItem(BaseModel):
    """Item requiring user attention."""

    type: Literal[
        "overdue_commitment",
        "upcoming_commitment",
        "contradiction",
        "high_risk",
        "pending_decision",
    ]
    id: str
    title: str
    confidence: float = Field(ge=0.0, le=1.0)
    evidence_id: str | None = None

    # Optional fields based on type
    days_overdue: int | None = None
    days_until_due: int | None = None
    owner: str | None = None
    counterparty: Counterparty | None = None
    severity: Literal["low", "medium", "high", "critical"] | None = None
    evidence_ids: list[str] | None = None


class BriefSummary(BaseModel):
    """Aggregated counts for the brief period."""

    open_commitments: int = 0
    overdue_commitments: int = 0
    decisions_made: int = 0
    high_risks: int = 0
    people_involved: int = 0


class BriefResponse(BaseModel):
    """Response model for /brief endpoint."""

    etag: str
    max_age_seconds: int = 60
    generated_at: datetime
    period: BriefPeriod
    summary: BriefSummary
    attention_items: list[AttentionItem] = Field(default_factory=list)


# =============================================================================
# Redis Cache Client
# =============================================================================

_redis_client = None


async def get_redis():
    """Get or create Redis client for brief caching."""
    global _redis_client
    if _redis_client is None:
        import redis.asyncio as redis

        settings = get_settings()
        redis_url = str(settings.redis_url)
        _redis_client = redis.from_url(redis_url)

    return _redis_client


# =============================================================================
# Brief Computation
# =============================================================================

BRIEF_CACHE_PREFIX = "drovi:brief:"
BRIEF_CACHE_TTL = 60  # 1 minute cache


async def compute_brief(
    organization_id: str,
    period: BriefPeriod,
    ctx: APIKeyContext,
) -> BriefResponse:
    """
    Compute intelligence brief for an organization.

    Aggregates UIOs from FalkorDB/PostgreSQL to build:
    - Summary counts (commitments, decisions, risks, people)
    - Attention items (overdue, contradictions, high risks)
    """
    from src.graph.client import get_graph_client
    from src.db.client import get_db_session
    from sqlalchemy import text

    now = datetime.now(timezone.utc)

    # Calculate period start
    if period == BriefPeriod.TODAY:
        period_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    else:
        period_start = now - timedelta(days=7)

    summary = BriefSummary()
    attention_items: list[AttentionItem] = []

    # Apply private-source visibility boundaries (same semantics as /uios).
    from src.auth.private_sources import get_session_user_id, is_admin_or_internal

    private_clause = ""
    private_params: dict[str, object] = {}
    if not is_admin_or_internal(ctx):
        session_user_id = get_session_user_id(ctx)
        if session_user_id:
            private_clause = """
                AND NOT EXISTS (
                    SELECT 1
                    FROM unified_object_source uos_priv
                    JOIN connections c_priv
                      ON c_priv.organization_id = u.organization_id
                     AND c_priv.id::text = uos_priv.source_account_id
                    WHERE uos_priv.unified_object_id = u.id
                      AND c_priv.visibility = 'private'
                      AND (c_priv.created_by_user_id IS DISTINCT FROM :current_user_id)
                )
            """.strip()
            private_params["current_user_id"] = session_user_id
        else:
            private_clause = """
                AND NOT EXISTS (
                    SELECT 1
                    FROM unified_object_source uos_priv
                    JOIN connections c_priv
                      ON c_priv.organization_id = u.organization_id
                     AND c_priv.id::text = uos_priv.source_account_id
                    WHERE uos_priv.unified_object_id = u.id
                      AND c_priv.visibility = 'private'
                )
            """.strip()

    # Query PostgreSQL for UIO counts
    try:
        async with get_db_session() as session:
            # Open commitments
            result = await session.execute(
                text("""
                    SELECT COUNT(*) as count
                    FROM unified_intelligence_object u
                    WHERE u.organization_id = :org_id
                    AND u.type = 'commitment'
                    AND u.status IN ('draft', 'active', 'in_progress')
                    AND u.created_at >= :period_start
                    {private_clause}
                """.format(private_clause=private_clause)),
                {"org_id": organization_id, "period_start": period_start, **private_params},
            )
            row = result.fetchone()
            summary.open_commitments = row.count if row else 0

            # Overdue commitments
            result = await session.execute(
                text("""
                    SELECT COUNT(*) as count
                    FROM unified_intelligence_object u
                    WHERE u.organization_id = :org_id
                    AND u.type = 'commitment'
                    AND u.status IN ('draft', 'active', 'in_progress')
                    AND u.due_date < :now
                    {private_clause}
                """.format(private_clause=private_clause)),
                {"org_id": organization_id, "now": now, **private_params},
            )
            row = result.fetchone()
            summary.overdue_commitments = row.count if row else 0

            # Decisions made
            result = await session.execute(
                text("""
                    SELECT COUNT(*) as count
                    FROM unified_intelligence_object u
                    WHERE u.organization_id = :org_id
                    AND u.type = 'decision'
                    AND u.created_at >= :period_start
                    {private_clause}
                """.format(private_clause=private_clause)),
                {"org_id": organization_id, "period_start": period_start, **private_params},
            )
            row = result.fetchone()
            summary.decisions_made = row.count if row else 0

            # High risks
            result = await session.execute(
                text("""
                    SELECT COUNT(*) as count
                    FROM unified_intelligence_object u
                    JOIN uio_risk_details r ON r.uio_id = u.id
                    WHERE u.organization_id = :org_id
                    AND u.type = 'risk'
                    AND r.severity IN ('high', 'critical')
                    AND u.status NOT IN ('completed', 'cancelled', 'archived')
                    {private_clause}
                """.format(private_clause=private_clause)),
                {"org_id": organization_id, **private_params},
            )
            row = result.fetchone()
            summary.high_risks = row.count if row else 0

            # People involved (unique contacts)
            result = await session.execute(
                text("""
                    SELECT COUNT(DISTINCT owner_contact_id) as count
                    FROM unified_intelligence_object u
                    WHERE u.organization_id = :org_id
                    AND owner_contact_id IS NOT NULL
                    AND created_at >= :period_start
                    {private_clause}
                """.format(private_clause=private_clause)),
                {"org_id": organization_id, "period_start": period_start, **private_params},
            )
            row = result.fetchone()
            summary.people_involved = row.count if row else 0

            # Get overdue commitments for attention items
            result = await session.execute(
                text("""
                    SELECT
                        u.id,
                        u.canonical_title,
                        u.due_date,
                        u.overall_confidence,
                        cd.direction,
                        cd.debtor_contact_id,
                        cd.creditor_contact_id,
                        s.id as source_id
                    FROM unified_intelligence_object u
                    LEFT JOIN uio_commitment_details cd ON cd.uio_id = u.id
                    LEFT JOIN unified_object_source s ON s.unified_object_id = u.id
                    WHERE u.organization_id = :org_id
                    AND u.type = 'commitment'
                    AND u.status IN ('draft', 'active', 'in_progress')
                    AND u.due_date < :now
                    {private_clause}
                    ORDER BY u.due_date ASC
                    LIMIT 10
                """.format(private_clause=private_clause)),
                {"org_id": organization_id, "now": now, **private_params},
            )
            rows = result.fetchall()

            for row in rows:
                days_overdue = (now.date() - row.due_date).days if row.due_date else 0
                attention_items.append(
                    AttentionItem(
                        type="overdue_commitment",
                        id=row.id,
                        title=row.canonical_title or "Untitled commitment",
                        confidence=row.overall_confidence or 0.0,
                        evidence_id=row.source_id,
                        days_overdue=days_overdue,
                        owner="You" if row.direction == "owed_by_me" else None,
                    )
                )

            # Get high risks for attention items
            result = await session.execute(
                text("""
                    SELECT
                        u.id,
                        u.canonical_title,
                        u.overall_confidence,
                        r.severity,
                        r.suggested_action,
                        s.id as source_id
                    FROM unified_intelligence_object u
                    JOIN uio_risk_details r ON r.uio_id = u.id
                    LEFT JOIN unified_object_source s ON s.unified_object_id = u.id
                    WHERE u.organization_id = :org_id
                    AND u.type = 'risk'
                    AND r.severity IN ('high', 'critical')
                    AND u.status NOT IN ('completed', 'cancelled', 'archived')
                    {private_clause}
                    ORDER BY CASE r.severity WHEN 'critical' THEN 0 ELSE 1 END
                    LIMIT 5
                """.format(private_clause=private_clause)),
                {"org_id": organization_id, **private_params},
            )
            rows = result.fetchall()

            for row in rows:
                attention_items.append(
                    AttentionItem(
                        type="high_risk",
                        id=row.id,
                        title=row.canonical_title or "Risk detected",
                        confidence=row.overall_confidence or 0.0,
                        evidence_id=row.source_id,
                        severity=row.severity,
                    )
                )

    except Exception as e:
        logger.warning(
            "Failed to query PostgreSQL for brief",
            organization_id=organization_id,
            error=str(e),
        )

    # Generate ETag from content
    content_hash = hashlib.md5(
        json.dumps(
            {
                "summary": summary.model_dump(),
                "attention_items": [a.model_dump() for a in attention_items],
            },
            default=str,
        ).encode()
    ).hexdigest()[:12]

    return BriefResponse(
        etag=f'W/"{content_hash}"',
        max_age_seconds=BRIEF_CACHE_TTL,
        generated_at=now,
        period=period,
        summary=summary,
        attention_items=attention_items,
    )


async def get_cached_brief(
    organization_id: str,
    period: BriefPeriod,
    cache_scope: str,
) -> tuple[BriefResponse | None, bool]:
    """
    Get brief from cache if available.

    Returns:
        Tuple of (brief_response, cache_hit)
    """
    try:
        redis = await get_redis()
        cache_key = f"{BRIEF_CACHE_PREFIX}{organization_id}:{period.value}:{cache_scope}"

        cached = await redis.get(cache_key)
        if cached:
            data = json.loads(cached)
            return BriefResponse.model_validate(data), True

    except Exception as e:
        logger.debug("Brief cache miss", organization_id=organization_id, error=str(e))

    return None, False


async def cache_brief(
    organization_id: str,
    period: BriefPeriod,
    brief: BriefResponse,
    cache_scope: str,
) -> None:
    """Cache computed brief in Redis."""
    try:
        redis = await get_redis()
        cache_key = f"{BRIEF_CACHE_PREFIX}{organization_id}:{period.value}:{cache_scope}"

        await redis.setex(
            cache_key,
            BRIEF_CACHE_TTL,
            brief.model_dump_json(),
        )

    except Exception as e:
        logger.warning(
            "Failed to cache brief",
            organization_id=organization_id,
            error=str(e),
        )


# =============================================================================
# API Endpoint
# =============================================================================


@router.get("", response_model=BriefResponse)
async def get_brief(
    organization_id: str,
    period: BriefPeriod = Query(default=BriefPeriod.LAST_7_DAYS),
    ctx: APIKeyContext = Depends(require_scope_with_rate_limit(Scope.READ)),
):
    """
    Get precomputed intelligence brief.

    Returns summary counts and attention items for the organization.
    Response is cached for fast retrieval (< 200ms target).

    Args:
        organization_id: Organization ID
        period: Time period for aggregation (last_7_days or today)

    Returns:
        BriefResponse with summary and attention items

    Requires `read` scope.
    """
    import time

    start_time = time.time()

    # Validate org access
    if ctx.organization_id != "internal" and organization_id != ctx.organization_id:
        from fastapi import HTTPException

        raise HTTPException(
            status_code=403,
            detail="Organization ID mismatch with authenticated key",
        )

    # Track request
    BRIEF_REQUESTS.labels(org_id=organization_id, period=period.value).inc()

    from src.auth.private_sources import get_session_user_id, is_admin_or_internal

    cache_scope = (
        "admin"
        if is_admin_or_internal(ctx)
        else (get_session_user_id(ctx) or "api_key")
    )

    # Try cache first
    brief, cache_hit = await get_cached_brief(organization_id, period, cache_scope)

    if not brief:
        # Compute fresh brief
        brief = await compute_brief(organization_id, period, ctx)

        # Cache for next request
        await cache_brief(organization_id, period, brief, cache_scope)

    # Record latency
    latency = time.time() - start_time
    BRIEF_LATENCY.labels(
        org_id=organization_id,
        cache_hit="true" if cache_hit else "false",
    ).observe(latency)

    logger.info(
        "Brief served",
        organization_id=organization_id,
        period=period.value,
        cache_hit=cache_hit,
        latency_ms=latency * 1000,
    )

    return brief


@router.post("/refresh")
async def refresh_brief(
    organization_id: str,
    ctx: APIKeyContext = Depends(require_scope_with_rate_limit(Scope.WRITE)),
):
    """
    Force refresh the brief cache.

    Use this after significant data changes to ensure fresh brief.

    Requires `write` scope.
    """
    # Validate org access
    if ctx.organization_id != "internal" and organization_id != ctx.organization_id:
        from fastapi import HTTPException

        raise HTTPException(
            status_code=403,
            detail="Organization ID mismatch with authenticated key",
        )

    from src.auth.private_sources import get_session_user_id, is_admin_or_internal

    cache_scope = (
        "admin"
        if is_admin_or_internal(ctx)
        else (get_session_user_id(ctx) or "api_key")
    )

    # Invalidate all cached briefs for this org (all scopes/periods).
    try:
        redis = await get_redis()
        pattern = f"{BRIEF_CACHE_PREFIX}{organization_id}:*"
        async for key in redis.scan_iter(match=pattern):
            await redis.delete(key)
    except Exception as e:
        logger.warning("Failed to invalidate brief cache", error=str(e))

    # Recompute for the caller's scope (others will lazy-recompute on demand).
    brief_7d = await compute_brief(organization_id, BriefPeriod.LAST_7_DAYS, ctx)
    brief_today = await compute_brief(organization_id, BriefPeriod.TODAY, ctx)

    # Cache them
    await cache_brief(organization_id, BriefPeriod.LAST_7_DAYS, brief_7d, cache_scope)
    await cache_brief(organization_id, BriefPeriod.TODAY, brief_today, cache_scope)

    return {
        "refreshed": True,
        "organization_id": organization_id,
        "periods": ["last_7_days", "today"],
    }
