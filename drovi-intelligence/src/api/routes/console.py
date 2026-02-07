"""
Console API Routes

High-performance endpoints for the Datadog-like Console view.
Provides:
- /query - Ultra-fast filtered queries with aggregations
- /entities - Autocomplete for search entity values
"""

import json
import time
from datetime import datetime, timedelta, timezone
from typing import Literal

import structlog
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from prometheus_client import Counter, Histogram

from src.auth.context import AuthContext
from src.auth.middleware import get_auth_context
from src.auth.scopes import Scope
from src.db import get_db_pool

logger = structlog.get_logger()

router = APIRouter(prefix="/console", tags=["console"])

# Prometheus metrics
CONSOLE_QUERY_LATENCY = Histogram(
    "drovi_console_query_latency_seconds",
    "Console query endpoint latency",
    ["org_id"],
    buckets=[0.05, 0.1, 0.15, 0.2, 0.3, 0.5, 1.0, 2.0],
)
CONSOLE_QUERY_REQUESTS = Counter(
    "drovi_console_query_requests_total",
    "Total console query requests",
    ["org_id"],
)


# =============================================================================
# Request/Response Models
# =============================================================================


class FilterItem(BaseModel):
    """Single filter in query."""

    entity: str = Field(..., description="Entity type: type, status, contact, owner, etc.")
    operator: Literal["=", "!=", "in", "not_in", "contains", "starts_with"] = "="
    value: str | None = None
    values: list[str] | None = None


class TimeRange(BaseModel):
    """Time range for query."""

    type: Literal["relative", "absolute"] = "relative"
    value: str | None = Field(None, description="For relative: 15m, 1h, 1d, 7d, 30d, 90d, 1y")
    field: str = "created_at"
    from_date: datetime | None = None
    to_date: datetime | None = None


class ConsoleQueryRequest(BaseModel):
    """Request body for console query."""

    filters: list[FilterItem] = Field(default_factory=list)
    free_text: list[str] = Field(default_factory=list)
    time_range: TimeRange | None = None
    group_by: str | None = None
    visualization: Literal["list", "timeseries", "top_list", "table", "tree_map", "pie"] = "list"
    limit: int = Field(default=100, ge=1, le=1000)
    cursor: str | None = None


class ContactInfo(BaseModel):
    """Contact information for display."""

    id: str
    display_name: str | None = None
    email: str
    avatar_url: str | None = None
    company: str | None = None


class UIOItem(BaseModel):
    """UIO item in response."""

    id: str
    type: str
    title: str
    description: str | None = None
    status: str
    priority: str | None = None
    confidence: float | None = None
    confidence_tier: str | None = None
    due_date: datetime | None = None
    created_at: datetime
    updated_at: datetime | None = None
    is_user_verified: bool = False

    # Risk indicators
    is_at_risk: bool = False
    is_overdue: bool = False

    # Contacts
    owner: ContactInfo | None = None
    debtor: ContactInfo | None = None
    creditor: ContactInfo | None = None
    assignee: ContactInfo | None = None
    decision_maker: ContactInfo | None = None

    # Type-specific fields
    direction: str | None = None
    severity: str | None = None
    decided_at: datetime | None = None

    # Source
    source_type: str | None = None
    source_id: str | None = None

    # Fallback sender from source message (when no contact linked)
    source_sender_name: str | None = None
    source_sender_email: str | None = None


class ConsoleMetrics(BaseModel):
    """Metrics for current filter."""

    total_count: int
    active_count: int
    at_risk_count: int
    overdue_count: int
    avg_confidence: float | None
    signal_quality: float | None = None
    ai_calibration: float | None = None
    blindspot_count: int | None = None


class Aggregation(BaseModel):
    """Aggregation bucket."""

    key: str
    count: int
    percentage: float | None = None


class TimeseriesPoint(BaseModel):
    """Single timeseries data point."""

    timestamp: datetime
    count: int
    breakdown: dict[str, int] | None = None


class ConsoleQueryResponse(BaseModel):
    """Response from console query."""

    items: list[UIOItem]
    metrics: ConsoleMetrics
    aggregations: dict[str, list[Aggregation]] | None = None
    timeseries: list[TimeseriesPoint] | None = None
    next_cursor: str | None = None
    has_more: bool = False
    query_time_ms: int


class EntitySuggestion(BaseModel):
    """Suggestion for entity autocomplete."""

    value: str
    label: str
    count: int | None = None
    metadata: dict | None = None


# =============================================================================
# Helper Functions
# =============================================================================


def _parse_relative_time(value: str) -> timedelta:
    """Parse relative time string like '15m', '1h', '7d' to timedelta."""
    if not value:
        return timedelta(days=7)

    unit = value[-1].lower()
    try:
        amount = int(value[:-1])
    except ValueError:
        return timedelta(days=7)

    if unit == "m":
        return timedelta(minutes=amount)
    if unit == "h":
        return timedelta(hours=amount)
    if unit == "d":
        return timedelta(days=amount)
    if unit == "w":
        return timedelta(weeks=amount)
    if unit == "y":
        return timedelta(days=amount * 365)

    return timedelta(days=7)


def _build_contact(row: dict, prefix: str) -> ContactInfo | None:
    """Build ContactInfo from row with prefix."""
    contact_id = row.get(f"{prefix}_id")
    if not contact_id:
        return None

    return ContactInfo(
        id=contact_id,
        display_name=row.get(f"{prefix}_name"),
        email=row.get(f"{prefix}_email", ""),
        avatar_url=row.get(f"{prefix}_avatar"),
        company=row.get(f"{prefix}_company"),
    )


# =============================================================================
# Query Endpoint
# =============================================================================


@router.post("/query", response_model=ConsoleQueryResponse)
async def console_query(
    request: ConsoleQueryRequest,
    auth: AuthContext = Depends(get_auth_context),
) -> ConsoleQueryResponse:
    """
    Ultra-fast console query endpoint.

    Supports:
    - Multiple entity filters (type, status, contact, owner, etc.)
    - Free text search
    - Time range filtering
    - Grouping and visualization modes
    - Pagination with cursor
    """
    start_time = time.time()
    org_id = auth.organization_id

    CONSOLE_QUERY_REQUESTS.labels(org_id=org_id).inc()

    try:
        pool = await get_db_pool()

        # Build WHERE conditions
        conditions = ["u.organization_id = $1"]
        params: list = [org_id]
        param_idx = 2

        # Enforce private-source visibility boundaries.
        # Semantics:
        # - Admin/internal: no filter.
        # - Session user: exclude UIOs that have ANY evidence from a private connection
        #   owned by someone else.
        # - API key (no user): exclude ALL private-sourced UIOs.
        if not auth.is_internal and not auth.has_scope(Scope.ADMIN):
            if auth.user_id:
                conditions.append(
                    f"""
                    NOT EXISTS (
                        SELECT 1
                        FROM unified_object_source uos_priv
                        JOIN connections c_priv
                          ON c_priv.organization_id = u.organization_id
                         AND c_priv.id::text = uos_priv.source_account_id
                        WHERE uos_priv.unified_object_id = u.id
                          AND c_priv.visibility = 'private'
                          AND (c_priv.created_by_user_id IS DISTINCT FROM ${param_idx})
                    )
                    """.strip()
                )
                params.append(auth.user_id)
                param_idx += 1
            else:
                conditions.append(
                    """
                    NOT EXISTS (
                        SELECT 1
                        FROM unified_object_source uos_priv
                        JOIN connections c_priv
                          ON c_priv.organization_id = u.organization_id
                         AND c_priv.id::text = uos_priv.source_account_id
                        WHERE uos_priv.unified_object_id = u.id
                          AND c_priv.visibility = 'private'
                    )
                    """.strip()
                )

        # Apply entity filters
        for f in request.filters:
            # Helper: get single value from either value or values[0]
            single_value = f.value or (f.values[0] if f.values else None)

            if f.entity == "type":
                if f.operator == "=" and single_value:
                    conditions.append(f"u.type = ${param_idx}")
                    params.append(single_value)
                    param_idx += 1
                elif f.operator == "in" and f.values:
                    placeholders = ", ".join(f"${param_idx + i}" for i in range(len(f.values)))
                    conditions.append(f"u.type IN ({placeholders})")
                    params.extend(f.values)
                    param_idx += len(f.values)
                elif f.operator == "!=" and single_value:
                    conditions.append(f"u.type != ${param_idx}")
                    params.append(single_value)
                    param_idx += 1

            elif f.entity == "status":
                if f.operator == "=" and single_value:
                    conditions.append(f"u.status = ${param_idx}")
                    params.append(single_value)
                    param_idx += 1
                elif f.operator == "in" and f.values:
                    placeholders = ", ".join(f"${param_idx + i}" for i in range(len(f.values)))
                    conditions.append(f"u.status IN ({placeholders})")
                    params.extend(f.values)
                    param_idx += len(f.values)
                elif f.operator == "not_in" and f.values:
                    placeholders = ", ".join(f"${param_idx + i}" for i in range(len(f.values)))
                    conditions.append(f"u.status NOT IN ({placeholders})")
                    params.extend(f.values)
                    param_idx += len(f.values)

            elif f.entity == "priority":
                if f.operator == "=" and single_value:
                    conditions.append(
                        f"(cd.priority = ${param_idx} OR td.priority = ${param_idx})"
                    )
                    params.append(single_value)
                    param_idx += 1

            elif f.entity == "direction":
                if f.operator == "=" and single_value:
                    conditions.append(f"cd.direction = ${param_idx}")
                    params.append(single_value)
                    param_idx += 1

            elif f.entity == "confidence":
                tier_map = {"high": 0.8, "medium": 0.5, "low": 0.0}
                if f.operator == "=" and single_value and single_value in tier_map:
                    if single_value == "high":
                        conditions.append(f"u.overall_confidence >= 0.8")
                    elif single_value == "medium":
                        conditions.append(f"u.overall_confidence >= 0.5 AND u.overall_confidence < 0.8")
                    else:
                        conditions.append(f"u.overall_confidence < 0.5")

            elif f.entity == "verified":
                if single_value == "true":
                    conditions.append("u.is_user_verified = true")
                elif single_value == "false":
                    conditions.append("u.is_user_verified = false")

            elif f.entity == "overdue":
                if single_value == "true":
                    conditions.append("u.due_date < NOW() AND u.status NOT IN ('completed', 'cancelled', 'archived')")

            elif f.entity == "at_risk":
                if single_value == "true":
                    conditions.append("(u.due_date IS NOT NULL AND u.due_date > NOW() AND u.due_date <= NOW() + INTERVAL '3 days' AND u.status NOT IN ('completed', 'cancelled', 'archived'))")

            elif f.entity in ("contact", "owner", "debtor", "creditor", "assignee", "decision_maker"):
                # Join on contact email or name
                if single_value:
                    if f.entity == "owner":
                        conditions.append(
                            f"(oc.primary_email ILIKE ${param_idx} OR oc.display_name ILIKE ${param_idx})"
                        )
                    elif f.entity == "debtor":
                        conditions.append(
                            f"(dc.primary_email ILIKE ${param_idx} OR dc.display_name ILIKE ${param_idx})"
                        )
                    elif f.entity == "creditor":
                        conditions.append(
                            f"(cc.primary_email ILIKE ${param_idx} OR cc.display_name ILIKE ${param_idx})"
                        )
                    elif f.entity == "assignee":
                        conditions.append(
                            f"(ac.primary_email ILIKE ${param_idx} OR ac.display_name ILIKE ${param_idx})"
                        )
                    elif f.entity == "decision_maker":
                        conditions.append(
                            f"(dmc.primary_email ILIKE ${param_idx} OR dmc.display_name ILIKE ${param_idx})"
                        )
                    else:
                        # Any contact
                        conditions.append(f"""(
                            oc.primary_email ILIKE ${param_idx} OR oc.display_name ILIKE ${param_idx} OR
                            dc.primary_email ILIKE ${param_idx} OR dc.display_name ILIKE ${param_idx} OR
                            cc.primary_email ILIKE ${param_idx} OR cc.display_name ILIKE ${param_idx} OR
                            ac.primary_email ILIKE ${param_idx} OR ac.display_name ILIKE ${param_idx} OR
                            dmc.primary_email ILIKE ${param_idx} OR dmc.display_name ILIKE ${param_idx}
                        )""")
                    params.append(f"%{single_value}%")
                    param_idx += 1

            elif f.entity == "source":
                if f.operator == "=" and single_value:
                    conditions.append(f"uos.source_type = ${param_idx}")
                    params.append(single_value)
                    param_idx += 1

        # Apply time range
        if request.time_range:
            tr = request.time_range
            time_field = f"u.{tr.field}"

            if tr.type == "relative" and tr.value:
                delta = _parse_relative_time(tr.value)
                cutoff = datetime.now(timezone.utc) - delta
                conditions.append(f"{time_field} >= ${param_idx}")
                params.append(cutoff)
                param_idx += 1
            elif tr.type == "absolute":
                if tr.from_date:
                    conditions.append(f"{time_field} >= ${param_idx}")
                    params.append(tr.from_date)
                    param_idx += 1
                if tr.to_date:
                    conditions.append(f"{time_field} <= ${param_idx}")
                    params.append(tr.to_date)
                    param_idx += 1

        # Apply free text search
        for text in request.free_text:
            conditions.append(
                f"(u.canonical_title ILIKE ${param_idx} OR u.canonical_description ILIKE ${param_idx})"
            )
            params.append(f"%{text}%")
            param_idx += 1

        where_clause = " AND ".join(conditions)

        # Build query
        query = f"""
            SELECT
                u.id, u.type, u.canonical_title, u.canonical_description,
                u.status, u.overall_confidence, u.due_date,
                u.created_at, u.updated_at, u.is_user_verified,
                -- Compute is_at_risk: due within 3 days but not overdue
                CASE
                    WHEN u.due_date IS NOT NULL
                         AND u.due_date > NOW()
                         AND u.due_date <= NOW() + INTERVAL '3 days'
                         AND u.status NOT IN ('completed', 'cancelled', 'archived')
                    THEN true
                    ELSE false
                END as is_at_risk,

                -- Compute is_overdue: past due date and not completed
                CASE
                    WHEN u.due_date IS NOT NULL
                         AND u.due_date < NOW()
                         AND u.status NOT IN ('completed', 'cancelled', 'archived')
                    THEN true
                    ELSE false
                END as is_overdue,

                -- Owner
                oc.id as owner_id, oc.display_name as owner_name,
                oc.primary_email as owner_email, oc.avatar_url as owner_avatar,
                oc.company as owner_company,

                -- Commitment details
                cd.direction, cd.priority as commitment_priority, cd.status as commitment_status,

                -- Debtor
                dc.id as debtor_id, dc.display_name as debtor_name,
                dc.primary_email as debtor_email, dc.company as debtor_company,

                -- Creditor
                cc.id as creditor_id, cc.display_name as creditor_name,
                cc.primary_email as creditor_email, cc.company as creditor_company,

                -- Decision details
                dd.decided_at, dd.status as decision_status,

                -- Decision maker
                dmc.id as decision_maker_id, dmc.display_name as decision_maker_name,
                dmc.primary_email as decision_maker_email,

                -- Task details
                td.status as task_status, td.priority as task_priority,

                -- Assignee
                ac.id as assignee_id, ac.display_name as assignee_name,
                ac.primary_email as assignee_email,

                -- Risk details
                rd.severity,

                -- Source
                uos.source_type, uos.id as source_id,

                -- Fallback: source message sender (when no contact linked)
                m.sender_name as source_sender_name,
                m.sender_email as source_sender_email

            FROM unified_intelligence_object u

            LEFT JOIN contact oc ON u.owner_contact_id = oc.id
            LEFT JOIN uio_commitment_details cd ON u.id = cd.uio_id
            LEFT JOIN contact dc ON cd.debtor_contact_id = dc.id
            LEFT JOIN contact cc ON cd.creditor_contact_id = cc.id
            LEFT JOIN uio_decision_details dd ON u.id = dd.uio_id
            LEFT JOIN contact dmc ON dd.decision_maker_contact_id = dmc.id
            LEFT JOIN uio_task_details td ON u.id = td.uio_id
            LEFT JOIN contact ac ON td.assignee_contact_id = ac.id
            LEFT JOIN uio_risk_details rd ON u.id = rd.uio_id
            LEFT JOIN unified_object_source uos ON u.id = uos.unified_object_id
            LEFT JOIN conversation conv ON conv.external_id = uos.conversation_id
                AND conv.source_account_id = uos.source_account_id
            LEFT JOIN message m ON m.external_id = uos.message_id
                AND m.conversation_id = conv.id

            WHERE {where_clause}

            ORDER BY u.created_at DESC
            LIMIT ${param_idx}
        """
        params.append(request.limit + 1)  # +1 to check for more
        param_idx += 1

        # Execute query
        async with pool.acquire() as conn:
            rows = await conn.fetch(query, *params)

        # Check if there are more results
        has_more = len(rows) > request.limit
        if has_more:
            rows = rows[:-1]

        # Build items
        items = []
        for row in rows:
            # Determine priority
            priority = row.get("commitment_priority") or row.get("task_priority")

            # Determine confidence tier
            confidence = row.get("overall_confidence")
            confidence_tier = None
            if confidence is not None:
                if confidence >= 0.8:
                    confidence_tier = "high"
                elif confidence >= 0.5:
                    confidence_tier = "medium"
                else:
                    confidence_tier = "low"

            item = UIOItem(
                id=row["id"],
                type=row["type"],
                title=row["canonical_title"] or "Untitled",
                description=row.get("canonical_description"),
                status=row["status"],
                priority=priority,
                confidence=confidence,
                confidence_tier=confidence_tier,
                due_date=row.get("due_date"),
                created_at=row["created_at"],
                updated_at=row.get("updated_at"),
                is_user_verified=row.get("is_user_verified", False),
                is_at_risk=row.get("is_at_risk", False),
                is_overdue=row.get("is_overdue", False),
                owner=_build_contact(dict(row), "owner"),
                debtor=_build_contact(dict(row), "debtor"),
                creditor=_build_contact(dict(row), "creditor"),
                assignee=_build_contact(dict(row), "assignee"),
                decision_maker=_build_contact(dict(row), "decision_maker"),
                direction=row.get("direction"),
                severity=row.get("severity"),
                decided_at=row.get("decided_at"),
                source_type=row.get("source_type"),
                source_id=row.get("source_id"),
                source_sender_name=row.get("source_sender_name"),
                source_sender_email=row.get("source_sender_email"),
            )
            items.append(item)

        # Get metrics (aggregate query)
        metrics_query = f"""
            SELECT
                COUNT(*) as total_count,
                COUNT(*) FILTER (WHERE u.status = 'active') as active_count,
                COUNT(*) FILTER (WHERE u.due_date IS NOT NULL AND u.due_date > NOW() AND u.due_date <= NOW() + INTERVAL '3 days' AND u.status NOT IN ('completed', 'cancelled', 'archived')) as at_risk_count,
                COUNT(*) FILTER (WHERE u.due_date < NOW() AND u.status NOT IN ('completed', 'cancelled', 'archived')) as overdue_count,
                AVG(u.overall_confidence) as avg_confidence
            FROM unified_intelligence_object u
            LEFT JOIN contact oc ON u.owner_contact_id = oc.id
            LEFT JOIN uio_commitment_details cd ON u.id = cd.uio_id
            LEFT JOIN contact dc ON cd.debtor_contact_id = dc.id
            LEFT JOIN contact cc ON cd.creditor_contact_id = cc.id
            LEFT JOIN uio_decision_details dd ON u.id = dd.uio_id
            LEFT JOIN contact dmc ON dd.decision_maker_contact_id = dmc.id
            LEFT JOIN uio_task_details td ON u.id = td.uio_id
            LEFT JOIN contact ac ON td.assignee_contact_id = ac.id
            LEFT JOIN uio_risk_details rd ON u.id = rd.uio_id
            LEFT JOIN unified_object_source uos ON u.id = uos.unified_object_id
            WHERE {where_clause}
        """

        async with pool.acquire() as conn:
            metrics_row = await conn.fetchrow(metrics_query, *params[:-1])  # Exclude limit

        metrics = ConsoleMetrics(
            total_count=metrics_row["total_count"] if metrics_row else 0,
            active_count=metrics_row["active_count"] if metrics_row else 0,
            at_risk_count=metrics_row["at_risk_count"] if metrics_row else 0,
            overdue_count=metrics_row["overdue_count"] if metrics_row else 0,
            avg_confidence=float(metrics_row["avg_confidence"]) if metrics_row and metrics_row["avg_confidence"] else None,
        )

        # Get aggregations if grouping
        aggregations = None
        if request.group_by:
            agg_field = {
                "type": "u.type",
                "status": "u.status",
                "priority": "COALESCE(cd.priority, td.priority)",
                "source": "uos.source_type",
            }.get(request.group_by, "u.type")

            agg_query = f"""
                SELECT
                    {agg_field} as key,
                    COUNT(*) as count
                FROM unified_intelligence_object u
                LEFT JOIN uio_commitment_details cd ON u.id = cd.uio_id
                LEFT JOIN uio_task_details td ON u.id = td.uio_id
                LEFT JOIN unified_object_source uos ON u.id = uos.unified_object_id
                WHERE u.organization_id = $1
                GROUP BY {agg_field}
                ORDER BY count DESC
                LIMIT 20
            """

            async with pool.acquire() as conn:
                agg_rows = await conn.fetch(agg_query, org_id)

            total = sum(row["count"] for row in agg_rows)
            aggregations = {
                request.group_by: [
                    Aggregation(
                        key=row["key"] or "unknown",
                        count=row["count"],
                        percentage=round(row["count"] / total * 100, 1) if total > 0 else 0,
                    )
                    for row in agg_rows
                    if row["key"]
                ]
            }

        # Generate next cursor
        next_cursor = None
        if has_more and items:
            next_cursor = items[-1].id

        # Generate timeseries data (always included for histogram)
        timeseries = await _generate_timeseries(
            pool=pool,
            org_id=org_id,
            time_range=request.time_range,
            where_clause=where_clause,
            params=params[:-1],  # Exclude limit param
        )

        logger.info(
            "Console query timeseries result",
            org_id=org_id,
            timeseries_count=len(timeseries) if timeseries else 0,
            first_point=timeseries[0].model_dump() if timeseries else None,
        )

        query_time = int((time.time() - start_time) * 1000)
        CONSOLE_QUERY_LATENCY.labels(org_id=org_id).observe(time.time() - start_time)

        return ConsoleQueryResponse(
            items=items,
            metrics=metrics,
            aggregations=aggregations,
            timeseries=timeseries,
            next_cursor=next_cursor,
            has_more=has_more,
            query_time_ms=query_time,
        )

    except Exception as e:
        logger.error("Console query failed", error=str(e), org_id=org_id)
        raise HTTPException(status_code=500, detail=f"Query failed: {str(e)}")


# =============================================================================
# Timeseries Generation Helper
# =============================================================================


async def _generate_timeseries(
    pool,
    org_id: str,
    time_range: TimeRange | None,
    where_clause: str,
    params: list,
) -> list[TimeseriesPoint]:
    """
    Generate timeseries data for the histogram.

    Dynamically determines time range from actual data:
    - If time_range filter is set, uses that
    - Otherwise, uses min/max created_at from the filtered data

    Bins data into time buckets based on the range:
    - < 1 hour: 1-minute buckets
    - 1-6 hours: 5-minute buckets
    - 6-24 hours: 15-minute buckets
    - 1-7 days: 1-hour buckets
    - 7-30 days: 4-hour buckets
    - > 30 days: 1-day buckets
    """
    try:
        now = datetime.now(timezone.utc)

        # First, get the actual data range from the filtered results
        # This query uses the same WHERE clause as the main query
        range_query = f"""
            SELECT
                MIN(u.created_at) as min_date,
                MAX(u.created_at) as max_date,
                COUNT(*) as total_count
            FROM unified_intelligence_object u
            LEFT JOIN contact oc ON u.owner_contact_id = oc.id
            LEFT JOIN uio_commitment_details cd ON u.id = cd.uio_id
            LEFT JOIN contact dc ON cd.debtor_contact_id = dc.id
            LEFT JOIN contact cc ON cd.creditor_contact_id = cc.id
            LEFT JOIN uio_decision_details dd ON u.id = dd.uio_id
            LEFT JOIN contact dmc ON dd.decision_maker_contact_id = dmc.id
            LEFT JOIN uio_task_details td ON u.id = td.uio_id
            LEFT JOIN contact ac ON td.assignee_contact_id = ac.id
            LEFT JOIN uio_risk_details rd ON u.id = rd.uio_id
            LEFT JOIN unified_object_source uos ON u.id = uos.unified_object_id
            WHERE {where_clause}
        """

        async with pool.acquire() as conn:
            range_row = await conn.fetchrow(range_query, *params)

        if not range_row or not range_row["min_date"] or range_row["total_count"] == 0:
            logger.info("No data for timeseries", org_id=org_id)
            return []

        # Use actual data range
        start_time = range_row["min_date"]
        end_time = range_row["max_date"]

        # If data spans less than 1 minute, expand to at least show something
        if start_time == end_time:
            start_time = start_time - timedelta(hours=1)
            end_time = end_time + timedelta(hours=1)

        # Calculate range in hours to determine bucket size
        range_hours = (end_time - start_time).total_seconds() / 3600

        # Determine bucket interval based on actual data range
        if range_hours <= 1:
            interval = "1 minute"
            bucket_count = 60
        elif range_hours <= 6:
            interval = "5 minutes"
            bucket_count = int(range_hours * 12)
        elif range_hours <= 24:
            interval = "15 minutes"
            bucket_count = int(range_hours * 4)
        elif range_hours <= 168:  # 7 days
            interval = "1 hour"
            bucket_count = int(range_hours)
        elif range_hours <= 720:  # 30 days
            interval = "4 hours"
            bucket_count = int(range_hours / 4)
        else:
            interval = "1 day"
            bucket_count = int(range_hours / 24)

        # Limit buckets for performance (aim for ~50-100 bars)
        bucket_count = max(min(bucket_count, 100), 10)

        # Build timeseries query using date_trunc for bucketing
        # date_trunc requires singular form: minute, hour, day (not plurals)
        trunc_unit = interval.split()[1].rstrip("s")
        ts_query = f"""
            SELECT
                date_trunc('{trunc_unit}', u.created_at) as bucket,
                COUNT(*) as count
            FROM unified_intelligence_object u
            LEFT JOIN contact oc ON u.owner_contact_id = oc.id
            LEFT JOIN uio_commitment_details cd ON u.id = cd.uio_id
            LEFT JOIN contact dc ON cd.debtor_contact_id = dc.id
            LEFT JOIN contact cc ON cd.creditor_contact_id = cc.id
            LEFT JOIN uio_decision_details dd ON u.id = dd.uio_id
            LEFT JOIN contact dmc ON dd.decision_maker_contact_id = dmc.id
            LEFT JOIN uio_task_details td ON u.id = td.uio_id
            LEFT JOIN contact ac ON td.assignee_contact_id = ac.id
            LEFT JOIN uio_risk_details rd ON u.id = rd.uio_id
            LEFT JOIN unified_object_source uos ON u.id = uos.unified_object_id
            WHERE {where_clause}
            GROUP BY bucket
            ORDER BY bucket ASC
        """

        async with pool.acquire() as conn:
            ts_rows = await conn.fetch(ts_query, *params)

        logger.info(
            "Timeseries query result",
            org_id=org_id,
            row_count=len(ts_rows),
            data_range_hours=round(range_hours, 1),
            interval=interval,
            trunc_unit=trunc_unit,
            start_time=start_time.isoformat(),
            end_time=end_time.isoformat(),
        )

        # Return data directly from DB
        if ts_rows:
            timeseries = [
                TimeseriesPoint(
                    timestamp=row["bucket"],
                    count=row["count"],
                    breakdown=None,
                )
                for row in ts_rows
                if row["bucket"]
            ]
            return timeseries

        return []

    except Exception as e:
        import traceback
        logger.error(
            "Failed to generate timeseries",
            error=str(e),
            traceback=traceback.format_exc(),
        )
        return []


def _parse_interval(interval: str) -> timedelta:
    """Parse interval string to timedelta."""
    parts = interval.split()
    amount = int(parts[0])
    unit = parts[1].lower()

    if unit in ("minute", "minutes"):
        return timedelta(minutes=amount)
    if unit in ("hour", "hours"):
        return timedelta(hours=amount)
    if unit in ("day", "days"):
        return timedelta(days=amount)
    return timedelta(hours=1)


def _truncate_to_interval(dt: datetime, unit: str) -> datetime:
    """Truncate datetime to interval boundary (same as PostgreSQL date_trunc)."""
    if unit == "minute":
        return dt.replace(second=0, microsecond=0)
    if unit == "hour":
        return dt.replace(minute=0, second=0, microsecond=0)
    if unit == "day":
        return dt.replace(hour=0, minute=0, second=0, microsecond=0)
    if unit == "week":
        # Truncate to start of week (Monday)
        days_since_monday = dt.weekday()
        return (dt - timedelta(days=days_since_monday)).replace(hour=0, minute=0, second=0, microsecond=0)
    if unit == "month":
        return dt.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    if unit == "year":
        return dt.replace(month=1, day=1, hour=0, minute=0, second=0, microsecond=0)
    # Default to hour
    return dt.replace(minute=0, second=0, microsecond=0)


# =============================================================================
# Entity Autocomplete Endpoint
# =============================================================================


@router.get("/entities", response_model=list[EntitySuggestion])
async def get_entity_suggestions(
    entity: str = Query(..., description="Entity type: contact, owner, source, type, status, priority"),
    query: str | None = Query(None, description="Partial match query"),
    limit: int = Query(20, ge=1, le=100),
    auth: AuthContext = Depends(get_auth_context),
) -> list[EntitySuggestion]:
    """
    Get autocomplete suggestions for search entities.

    Supports dynamic entities (contacts) and static entities (type, status, priority).
    """
    org_id = auth.organization_id

    try:
        pool = await get_db_pool()

        # Static entity suggestions
        static_entities = {
            "type": [
                EntitySuggestion(value="commitment", label="Commitment", count=None),
                EntitySuggestion(value="decision", label="Decision", count=None),
                EntitySuggestion(value="task", label="Task", count=None),
                EntitySuggestion(value="risk", label="Risk", count=None),
                EntitySuggestion(value="claim", label="Claim", count=None),
                EntitySuggestion(value="brief", label="Brief", count=None),
            ],
            "status": [
                EntitySuggestion(value="draft", label="Draft", count=None),
                EntitySuggestion(value="active", label="Active", count=None),
                EntitySuggestion(value="in_progress", label="In Progress", count=None),
                EntitySuggestion(value="completed", label="Completed", count=None),
                EntitySuggestion(value="cancelled", label="Cancelled", count=None),
                EntitySuggestion(value="archived", label="Archived", count=None),
                EntitySuggestion(value="snoozed", label="Snoozed", count=None),
            ],
            "priority": [
                EntitySuggestion(value="urgent", label="Urgent", count=None),
                EntitySuggestion(value="high", label="High", count=None),
                EntitySuggestion(value="medium", label="Medium", count=None),
                EntitySuggestion(value="low", label="Low", count=None),
                EntitySuggestion(value="no_priority", label="No Priority", count=None),
            ],
            "direction": [
                EntitySuggestion(value="owed_by_me", label="Owed by Me", count=None),
                EntitySuggestion(value="owed_to_me", label="Owed to Me", count=None),
            ],
            "confidence": [
                EntitySuggestion(value="high", label="High (80%+)", count=None),
                EntitySuggestion(value="medium", label="Medium (50-80%)", count=None),
                EntitySuggestion(value="low", label="Low (<50%)", count=None),
            ],
            "verified": [
                EntitySuggestion(value="true", label="Verified", count=None),
                EntitySuggestion(value="false", label="Not Verified", count=None),
            ],
            "overdue": [
                EntitySuggestion(value="true", label="Overdue", count=None),
                EntitySuggestion(value="false", label="Not Overdue", count=None),
            ],
            "at_risk": [
                EntitySuggestion(value="true", label="At Risk", count=None),
                EntitySuggestion(value="false", label="Not At Risk", count=None),
            ],
        }

        if entity in static_entities:
            suggestions = static_entities[entity]
            if query:
                query_lower = query.lower()
                suggestions = [s for s in suggestions if query_lower in s.label.lower() or query_lower in s.value.lower()]
            return suggestions[:limit]

        # Dynamic entities - contacts
        if entity in ("contact", "owner", "debtor", "creditor", "assignee", "decision_maker"):
            sql = """
                SELECT
                    c.id,
                    c.display_name,
                    c.primary_email,
                    c.company,
                    COUNT(DISTINCT u.id) as uio_count
                FROM contact c
                LEFT JOIN unified_intelligence_object u ON u.owner_contact_id = c.id
                WHERE c.organization_id = $1
            """
            params: list = [org_id]

            if query:
                sql += " AND (c.display_name ILIKE $2 OR c.primary_email ILIKE $2)"
                params.append(f"%{query}%")

            sql += """
                GROUP BY c.id, c.display_name, c.primary_email, c.company
                ORDER BY uio_count DESC, c.display_name
                LIMIT ${}
            """.format(len(params) + 1)
            params.append(limit)

            async with pool.acquire() as conn:
                rows = await conn.fetch(sql, *params)

            suggestions = []

            # Add "me" as first option for owner/debtor/creditor
            if entity in ("owner", "debtor", "creditor", "assignee") and (not query or "me" in query.lower()):
                suggestions.append(EntitySuggestion(value="me", label="Me", count=None))

            for row in rows:
                label = row["display_name"] or row["primary_email"]
                if row["company"]:
                    label = f"{label} ({row['company']})"

                suggestions.append(
                    EntitySuggestion(
                        value=row["primary_email"],
                        label=label,
                        count=row["uio_count"],
                        metadata={"id": row["id"], "company": row["company"]},
                    )
                )

            return suggestions[:limit]

        # Source entity
        if entity == "source":
            sql = """
                SELECT
                    source_type,
                    COUNT(*) as count
                FROM unified_object_source
                WHERE organization_id = $1
                GROUP BY source_type
                ORDER BY count DESC
            """

            async with pool.acquire() as conn:
                rows = await conn.fetch(sql, org_id)

            suggestions = []
            for row in rows:
                if row["source_type"]:
                    label = row["source_type"].replace("_", " ").title()
                    if not query or query.lower() in label.lower() or query.lower() in row["source_type"].lower():
                        suggestions.append(
                            EntitySuggestion(
                                value=row["source_type"],
                                label=label,
                                count=row["count"],
                            )
                        )

            return suggestions[:limit]

        # Company entity
        if entity == "company":
            sql = """
                SELECT
                    company,
                    COUNT(*) as count
                FROM contact
                WHERE organization_id = $1 AND company IS NOT NULL
            """
            params = [org_id]

            if query:
                sql += " AND company ILIKE $2"
                params.append(f"%{query}%")

            sql += """
                GROUP BY company
                ORDER BY count DESC
                LIMIT ${}
            """.format(len(params) + 1)
            params.append(limit)

            async with pool.acquire() as conn:
                rows = await conn.fetch(sql, *params)

            return [
                EntitySuggestion(value=row["company"], label=row["company"], count=row["count"])
                for row in rows
                if row["company"]
            ]

        # Unknown entity
        return []

    except Exception as e:
        logger.error("Entity suggestions failed", error=str(e), entity=entity)
        raise HTTPException(status_code=500, detail=f"Failed to get suggestions: {str(e)}")


# =============================================================================
# Sources Endpoint
# =============================================================================


class SourceItem(BaseModel):
    """Source evidence item."""

    id: str
    source_type: str
    message_id: str | None = None
    conversation_id: str | None = None
    quoted_text: str | None = None
    source_timestamp: datetime | None = None
    sender_name: str | None = None
    sender_email: str | None = None
    subject: str | None = None
    deep_link: str | None = None


class MessageDetail(BaseModel):
    """Full message details for source drill-down."""

    id: str
    source_id: str
    source_type: str
    # Sender
    sender_name: str | None = None
    sender_email: str | None = None
    sender_avatar_url: str | None = None
    # Recipients
    recipients: list[dict] = []
    # Content
    subject: str | None = None
    body_text: str | None = None
    body_html: str | None = None
    snippet: str | None = None
    quoted_text: str | None = None
    # Timestamps
    sent_at: datetime | None = None
    received_at: datetime | None = None
    # Conversation context
    conversation_id: str | None = None
    conversation_title: str | None = None
    message_count: int = 0
    # Attachments
    has_attachments: bool = False
    attachments: list[dict] = []
    # Deep link
    deep_link: str | None = None
    # Related UIOs from same source
    related_uios: list[dict] = []


@router.get("/sources/{uio_id}", response_model=list[SourceItem])
async def get_uio_sources(
    uio_id: str,
    auth: AuthContext = Depends(get_auth_context),
) -> list[SourceItem]:
    """
    Get source evidence for a UIO.

    Returns all source documents/messages that this UIO was extracted from.
    Joins with conversation and message tables using external_id matching.
    """
    org_id = auth.organization_id

    try:
        pool = await get_db_pool()

        # Query sources with message/conversation data
        # Join using external_id since conversation_id/message_id in unified_object_source
        # are external IDs (e.g., Gmail thread/message IDs)
        query = """
            SELECT
                s.id,
                s.source_type,
                s.message_id as external_message_id,
                s.conversation_id as external_conversation_id,
                s.quoted_text,
                s.source_timestamp,
                s.extracted_title,
                s.confidence,
                s.detection_method,
                s.role,
                -- Message data (joined by external_id)
                m.sender_name,
                m.sender_email,
                m.subject as message_subject,
                m.snippet as message_snippet,
                m.sent_at,
                -- Conversation data (joined by external_id)
                c.title as conversation_title,
                c.snippet as conversation_snippet
            FROM unified_object_source s
            JOIN unified_intelligence_object u ON u.id = s.unified_object_id
            LEFT JOIN conversation c ON c.external_id = s.conversation_id
                AND c.source_account_id = s.source_account_id
            LEFT JOIN message m ON m.external_id = s.message_id
                AND m.conversation_id = c.id
            WHERE s.unified_object_id = $1
            AND u.organization_id = $2
            ORDER BY s.source_timestamp DESC NULLS LAST, s.created_at DESC
            LIMIT 10
        """

        async with pool.acquire() as conn:
            rows = await conn.fetch(query, uio_id, org_id)

        sources = []
        for row in rows:
            # Build deep link for Gmail using external message_id
            deep_link = None
            message_external_id = row.get("external_message_id")
            if row.get("source_type") == "email" and message_external_id:
                deep_link = f"https://mail.google.com/mail/u/0/#inbox/{message_external_id}"

            # Determine best subject: message > conversation > extracted_title > quoted_text
            subject = (
                row.get("message_subject") or
                row.get("conversation_title") or
                row.get("extracted_title")
            )
            if not subject and row.get("quoted_text"):
                quoted = row.get("quoted_text", "")
                subject = quoted[:80] + "..." if len(quoted) > 80 else quoted

            sources.append(
                SourceItem(
                    id=row["id"],
                    source_type=row["source_type"],
                    message_id=row.get("external_message_id"),
                    conversation_id=row.get("external_conversation_id"),
                    quoted_text=row.get("quoted_text"),
                    source_timestamp=row.get("source_timestamp") or row.get("sent_at"),
                    sender_name=row.get("sender_name"),
                    sender_email=row.get("sender_email"),
                    subject=subject,
                    deep_link=deep_link,
                )
            )

        return sources

    except Exception as e:
        logger.error("Failed to get UIO sources", error=str(e), uio_id=uio_id)
        raise HTTPException(status_code=500, detail=f"Failed to get sources: {str(e)}")


# =============================================================================
# Source Detail Endpoint (Message drill-down)
# =============================================================================


@router.get("/source/{source_id}", response_model=MessageDetail)
async def get_source_detail(
    source_id: str,
    auth: AuthContext = Depends(get_auth_context),
) -> MessageDetail:
    """
    Get full details of a source for drill-down view.

    Joins with conversation and message tables using external_id matching
    to get full message content, sender info, etc.
    """
    org_id = auth.organization_id

    try:
        pool = await get_db_pool()

        # Get source with full message/conversation details
        # Join using external_id since conversation_id/message_id in unified_object_source
        # are external IDs (e.g., Gmail thread/message IDs)
        query = """
            SELECT
                s.id as source_id,
                s.source_type,
                s.source_account_id,
                s.message_id as external_message_id,
                s.conversation_id as external_conversation_id,
                s.quoted_text,
                s.source_timestamp,
                s.extracted_title,
                s.extracted_due_date,
                s.extracted_status,
                s.confidence,
                s.detection_method,
                s.role,
                s.added_at,
                s.created_at,
                -- Message data (joined by external_id)
                m.id as msg_id,
                m.sender_name,
                m.sender_email,
                m.sender_avatar_url,
                m.recipients,
                m.subject as message_subject,
                m.body_text,
                m.body_html,
                m.snippet as message_snippet,
                m.sent_at,
                m.received_at as msg_received_at,
                m.has_attachments,
                -- Conversation data (joined by external_id)
                c.id as conv_id,
                c.title as conversation_title,
                c.snippet as conversation_snippet,
                c.message_count
            FROM unified_object_source s
            JOIN unified_intelligence_object u ON u.id = s.unified_object_id
            LEFT JOIN conversation c ON c.external_id = s.conversation_id
                AND c.source_account_id = s.source_account_id
            LEFT JOIN message m ON m.external_id = s.message_id
                AND m.conversation_id = c.id
            WHERE s.id = $1
            AND u.organization_id = $2
        """

        async with pool.acquire() as conn:
            row = await conn.fetchrow(query, source_id, org_id)

            if not row:
                raise HTTPException(status_code=404, detail="Source not found")

            # Log the available data
            logger.info(
                "Source detail query result",
                source_id=source_id,
                source_type=row.get("source_type"),
                has_message=row.get("msg_id") is not None,
                has_conversation=row.get("conv_id") is not None,
                has_sender=row.get("sender_name") is not None or row.get("sender_email") is not None,
                has_body=row.get("body_text") is not None,
                has_quoted_text=row.get("quoted_text") is not None,
            )

            # Get attachments if any
            attachments = []
            if row.get("msg_id") and row.get("has_attachments"):
                att_query = """
                    SELECT id, filename, mime_type, size_bytes
                    FROM attachment
                    WHERE message_id = $1
                    LIMIT 10
                """
                att_rows = await conn.fetch(att_query, row["msg_id"])
                attachments = [
                    {
                        "id": r["id"],
                        "filename": r["filename"],
                        "mime_type": r["mime_type"],
                        "size_bytes": r["size_bytes"],
                    }
                    for r in att_rows
                ]

            # Get related UIOs from same conversation
            related_uios = []
            if row.get("external_conversation_id"):
                related_query = """
                    SELECT DISTINCT
                        u.id,
                        u.type,
                        u.canonical_title as title,
                        u.status,
                        u.overall_confidence as confidence
                    FROM unified_intelligence_object u
                    JOIN unified_object_source s ON s.unified_object_id = u.id
                    WHERE s.conversation_id = $1
                    AND u.organization_id = $2
                    LIMIT 10
                """
                related_rows = await conn.fetch(related_query, row["external_conversation_id"], org_id)
                related_uios = [
                    {
                        "id": r["id"],
                        "type": r["type"],
                        "title": r["title"] or "Untitled",
                        "status": r["status"],
                        "confidence": r["confidence"],
                    }
                    for r in related_rows
                ]

        # Build deep link using external message_id
        deep_link = None
        message_external_id = row.get("external_message_id")
        if row.get("source_type") == "email" and message_external_id:
            deep_link = f"https://mail.google.com/mail/u/0/#inbox/{message_external_id}"

        # Parse recipients
        recipients = []
        if row.get("recipients"):
            try:
                recipients = row["recipients"] if isinstance(row["recipients"], list) else json.loads(row["recipients"])
            except Exception:
                pass

        # Determine best subject
        subject = (
            row.get("message_subject") or
            row.get("conversation_title") or
            row.get("extracted_title")
        )
        if not subject and row.get("quoted_text"):
            first_line = row["quoted_text"].split("\n")[0].strip()
            subject = first_line[:80] + "..." if len(first_line) > 80 else first_line
        if not subject:
            subject = "Source Evidence"

        # Determine best body text
        body_text = row.get("body_text") or row.get("quoted_text")

        return MessageDetail(
            id=row.get("msg_id") or source_id,
            source_id=source_id,
            source_type=row["source_type"],
            sender_name=row.get("sender_name"),
            sender_email=row.get("sender_email"),
            sender_avatar_url=row.get("sender_avatar_url"),
            recipients=recipients,
            subject=subject,
            body_text=body_text,
            body_html=row.get("body_html"),
            snippet=row.get("message_snippet") or row.get("conversation_snippet") or (row.get("quoted_text") or "")[:200],
            quoted_text=row.get("quoted_text"),
            sent_at=row.get("sent_at"),
            received_at=row.get("msg_received_at") or row.get("source_timestamp") or row.get("added_at"),
            conversation_id=row.get("external_conversation_id"),
            conversation_title=row.get("conversation_title"),
            message_count=row.get("message_count") or 0,
            has_attachments=row.get("has_attachments") or False,
            attachments=attachments,
            deep_link=deep_link,
            related_uios=related_uios,
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.error("Failed to get source detail", error=str(e), source_id=source_id)
        raise HTTPException(status_code=500, detail=f"Failed to get source detail: {str(e)}")


# =============================================================================
# Related Objects Endpoint
# =============================================================================


class RelatedItem(BaseModel):
    """Related UIO item."""

    id: str
    type: str
    title: str
    status: str
    confidence: float | None = None
    relationship: str  # "same_thread", "same_contact", "same_source"
    created_at: datetime


@router.get("/related/{uio_id}", response_model=list[RelatedItem])
async def get_related_uios(
    uio_id: str,
    limit: int = Query(default=10, ge=1, le=50),
    auth: AuthContext = Depends(get_auth_context),
) -> list[RelatedItem]:
    """
    Get UIOs related to a given UIO.

    Finds related items based on:
    - Same conversation/thread
    - Same contacts (owner, debtor, creditor)
    - Same source document
    """
    org_id = auth.organization_id

    try:
        pool = await get_db_pool()

        # Find related by same conversation
        query = """
            WITH source_uio AS (
                SELECT
                    u.id,
                    u.owner_contact_id,
                    s.conversation_id
                FROM unified_intelligence_object u
                LEFT JOIN unified_object_source s ON s.unified_object_id = u.id
                WHERE u.id = $1 AND u.organization_id = $2
                LIMIT 1
            ),
            same_thread AS (
                SELECT DISTINCT
                    u.id,
                    u.type,
                    u.canonical_title as title,
                    u.status,
                    u.overall_confidence as confidence,
                    'same_thread' as relationship,
                    u.created_at
                FROM unified_intelligence_object u
                JOIN unified_object_source s ON s.unified_object_id = u.id
                JOIN source_uio su ON s.conversation_id = su.conversation_id
                WHERE u.id != $1
                AND u.organization_id = $2
                AND su.conversation_id IS NOT NULL
                LIMIT 5
            ),
            same_contact AS (
                SELECT DISTINCT
                    u.id,
                    u.type,
                    u.canonical_title as title,
                    u.status,
                    u.overall_confidence as confidence,
                    'same_contact' as relationship,
                    u.created_at
                FROM unified_intelligence_object u
                JOIN source_uio su ON u.owner_contact_id = su.owner_contact_id
                WHERE u.id != $1
                AND u.organization_id = $2
                AND su.owner_contact_id IS NOT NULL
                AND u.id NOT IN (SELECT id FROM same_thread)
                LIMIT 5
            )
            SELECT * FROM same_thread
            UNION ALL
            SELECT * FROM same_contact
            ORDER BY created_at DESC
            LIMIT $3
        """

        async with pool.acquire() as conn:
            rows = await conn.fetch(query, uio_id, org_id, limit)

        related = []
        for row in rows:
            related.append(
                RelatedItem(
                    id=row["id"],
                    type=row["type"],
                    title=row["title"] or "Untitled",
                    status=row["status"],
                    confidence=row["confidence"],
                    relationship=row["relationship"],
                    created_at=row["created_at"],
                )
            )

        return related

    except Exception as e:
        logger.error("Failed to get related UIOs", error=str(e), uio_id=uio_id)
        raise HTTPException(status_code=500, detail=f"Failed to get related: {str(e)}")
