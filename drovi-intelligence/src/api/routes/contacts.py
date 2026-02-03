"""
Contact API Routes

CRUD and intelligence operations for contacts.
Provides endpoints for:
- Listing and filtering contacts
- Getting contact details and intelligence
- Updating contact status (VIP, at-risk)
- Triggering contact intelligence analysis
- Generating meeting briefs
"""

import time
from datetime import datetime, timezone

import structlog
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import text

from src.auth.middleware import APIKeyContext, require_scope_with_rate_limit
from src.auth.scopes import Scope
from src.db.client import get_db_session
from src.identity import get_identity_graph
from src.identity.types import Identity, IdentityType

logger = structlog.get_logger()

router = APIRouter(prefix="/contacts", tags=["contacts"])


# =============================================================================
# Response Models
# =============================================================================


class ContactSummary(BaseModel):
    """Summary contact info for list views."""

    id: str
    primary_email: str
    display_name: str | None = None
    avatar_url: str | None = None
    company: str | None = None
    title: str | None = None

    # Intelligence scores
    health_score: float | None = None
    importance_score: float | None = None
    engagement_score: float | None = None
    sentiment_score: float | None = None

    # Status flags
    is_vip: bool = False
    is_at_risk: bool = False
    is_internal: bool = False

    # Lifecycle
    lifecycle_stage: str | None = None
    role_type: str | None = None

    # Interaction stats
    total_threads: int = 0
    total_messages: int = 0
    last_interaction_at: datetime | None = None
    days_since_last_contact: int | None = None

    class Config:
        from_attributes = True


class ContactDetail(ContactSummary):
    """Full contact details including intelligence."""

    # Extended identity
    first_name: str | None = None
    last_name: str | None = None
    emails: list[str] = []
    phone: str | None = None
    linkedin_url: str | None = None

    # Professional info
    department: str | None = None
    seniority_level: str | None = None
    role_confidence: float | None = None

    # Response patterns
    avg_response_time_minutes: int | None = None
    response_rate: float | None = None
    avg_words_per_message: int | None = None

    # Communication profile
    communication_profile: dict | None = None

    # Graph metrics
    influence_score: float | None = None
    bridging_score: float | None = None
    community_ids: list[str] = []

    # Brief
    contact_brief: str | None = None

    # Risk
    risk_reason: str | None = None

    # Notes
    notes: str | None = None

    # Intelligence tracking
    last_intelligence_at: datetime | None = None
    intelligence_version: int | None = None

    # Timestamps
    first_interaction_at: datetime | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None


class ContactListResponse(BaseModel):
    """Response for listing contacts."""

    items: list[ContactSummary]
    total: int
    limit: int
    offset: int


class ContactStatsResponse(BaseModel):
    """Contact statistics response."""

    total_contacts: int = 0
    vip_count: int = 0
    at_risk_count: int = 0
    internal_count: int = 0
    new_this_week: int = 0
    avg_health_score: float | None = None


class ContactIdentityLinkRequest(BaseModel):
    """Request to link an identity to a contact."""

    identity_type: str = Field(..., description="Identity type (email, phone, slack_id, etc.)")
    identity_value: str = Field(..., description="Identity value")
    confidence: float = Field(1.0, ge=0.0, le=1.0)
    is_verified: bool = False


class ContactIdentityRecord(BaseModel):
    """Linked identity details."""

    id: str
    identity_type: str
    identity_value: str
    confidence: float
    is_verified: bool
    source: str | None = None
    source_account_id: str | None = None
    last_seen_at: datetime | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None


class ContactMergeSuggestion(BaseModel):
    contact_a_id: str
    contact_a_name: str | None = None
    contact_a_email: str | None = None
    contact_b_id: str
    contact_b_name: str | None = None
    contact_b_email: str | None = None
    confidence: float
    match_reasons: list[str] = []


class ContactMergeRequest(BaseModel):
    source_contact_id: str
    target_contact_id: str
    reason: str | None = None


class ToggleVipRequest(BaseModel):
    """Request to toggle VIP status."""

    is_vip: bool


class MeetingBriefResponse(BaseModel):
    """Generated meeting brief."""

    contact_id: str
    contact_name: str | None
    brief: str
    talking_points: list[str] = []
    open_commitments: list[str] = []
    pending_decisions: list[str] = []
    generated_at: datetime


# =============================================================================
# Helper Functions
# =============================================================================


def _validate_org_id(ctx: APIKeyContext, organization_id: str) -> None:
    """Validate organization_id matches auth context."""
    if ctx.organization_id != "internal" and organization_id != ctx.organization_id:
        raise HTTPException(
            status_code=403,
            detail="Organization ID mismatch with authenticated key",
        )


CONTACT_BASE_QUERY = """
SELECT
    c.id, c.primary_email, c.display_name, c.avatar_url,
    c.company, c.title, c.first_name, c.last_name,
    c.emails, c.phone, c.linkedin_url, c.department,
    c.health_score, c.importance_score, c.engagement_score, c.sentiment_score,
    c.is_vip, c.is_at_risk, c.is_internal,
    c.lifecycle_stage, c.role_type, c.seniority_level, c.role_type_confidence,
    c.total_threads, c.total_messages,
    c.first_interaction_at, c.last_interaction_at, c.days_since_last_contact,
    c.avg_response_time_minutes, c.response_rate, c.avg_words_per_message,
    c.communication_profile, c.influence_score, c.bridging_score, c.community_ids,
    c.contact_brief, c.risk_reason, c.notes,
    c.last_intelligence_at, c.intelligence_version,
    c.created_at, c.updated_at
FROM contact c
WHERE c.organization_id = :org_id
"""


def _row_to_summary(row) -> ContactSummary:
    """Convert a database row to ContactSummary."""
    return ContactSummary(
        id=row.id,
        primary_email=row.primary_email,
        display_name=row.display_name,
        avatar_url=row.avatar_url,
        company=row.company,
        title=row.title,
        health_score=row.health_score,
        importance_score=row.importance_score,
        engagement_score=row.engagement_score,
        sentiment_score=row.sentiment_score,
        is_vip=row.is_vip or False,
        is_at_risk=row.is_at_risk or False,
        is_internal=row.is_internal or False,
        lifecycle_stage=row.lifecycle_stage,
        role_type=row.role_type,
        total_threads=row.total_threads or 0,
        total_messages=row.total_messages or 0,
        last_interaction_at=row.last_interaction_at,
        days_since_last_contact=row.days_since_last_contact,
    )


def _row_to_detail(row) -> ContactDetail:
    """Convert a database row to ContactDetail."""
    return ContactDetail(
        id=row.id,
        primary_email=row.primary_email,
        display_name=row.display_name,
        avatar_url=row.avatar_url,
        company=row.company,
        title=row.title,
        first_name=row.first_name,
        last_name=row.last_name,
        emails=row.emails or [],
        phone=row.phone,
        linkedin_url=row.linkedin_url,
        department=row.department,
        health_score=row.health_score,
        importance_score=row.importance_score,
        engagement_score=row.engagement_score,
        sentiment_score=row.sentiment_score,
        is_vip=row.is_vip or False,
        is_at_risk=row.is_at_risk or False,
        is_internal=row.is_internal or False,
        lifecycle_stage=row.lifecycle_stage,
        role_type=row.role_type,
        seniority_level=row.seniority_level,
        role_confidence=row.role_type_confidence,
        total_threads=row.total_threads or 0,
        total_messages=row.total_messages or 0,
        first_interaction_at=row.first_interaction_at,
        last_interaction_at=row.last_interaction_at,
        days_since_last_contact=row.days_since_last_contact,
        avg_response_time_minutes=row.avg_response_time_minutes,
        response_rate=row.response_rate,
        avg_words_per_message=row.avg_words_per_message,
        communication_profile=row.communication_profile,
        influence_score=row.influence_score,
        bridging_score=row.bridging_score,
        community_ids=row.community_ids or [],
        contact_brief=row.contact_brief,
        risk_reason=row.risk_reason,
        notes=row.notes,
        last_intelligence_at=row.last_intelligence_at,
        intelligence_version=row.intelligence_version,
        created_at=row.created_at,
        updated_at=row.updated_at,
    )


# =============================================================================
# Endpoints
# =============================================================================


@router.get("", response_model=ContactListResponse)
async def list_contacts(
    organization_id: str,
    limit: int = Query(50, ge=1, le=100),
    offset: int = Query(0, ge=0),
    is_vip: bool | None = None,
    is_at_risk: bool | None = None,
    sort_by: str = Query("importance_score", pattern="^(importance_score|health_score|last_interaction_at|display_name)$"),
    sort_order: str = Query("desc", pattern="^(asc|desc)$"),
    ctx: APIKeyContext = Depends(require_scope_with_rate_limit(Scope.READ)),
):
    """
    List contacts for an organization.

    Supports filtering by VIP and at-risk status, and sorting by various fields.
    """
    _validate_org_id(ctx, organization_id)

    # Build query with filters
    query = CONTACT_BASE_QUERY
    params: dict = {"org_id": organization_id}

    if is_vip is not None:
        query += " AND c.is_vip = :is_vip"
        params["is_vip"] = is_vip

    if is_at_risk is not None:
        query += " AND c.is_at_risk = :is_at_risk"
        params["is_at_risk"] = is_at_risk

    # Add sorting
    query += f" ORDER BY c.{sort_by} {'DESC NULLS LAST' if sort_order == 'desc' else 'ASC NULLS LAST'}"
    query += " LIMIT :limit OFFSET :offset"
    params["limit"] = limit
    params["offset"] = offset

    async with get_db_session() as session:
        # Get total count
        count_query = f"""
            SELECT COUNT(*) FROM contact c
            WHERE c.organization_id = :org_id
            {"AND c.is_vip = :is_vip" if is_vip is not None else ""}
            {"AND c.is_at_risk = :is_at_risk" if is_at_risk is not None else ""}
        """
        count_result = await session.execute(text(count_query), params)
        total = count_result.scalar() or 0

        # Get contacts
        result = await session.execute(text(query), params)
        rows = result.fetchall()

        items = [_row_to_summary(row) for row in rows]

    return ContactListResponse(
        items=items,
        total=total,
        limit=limit,
        offset=offset,
    )


@router.get("/stats", response_model=ContactStatsResponse)
async def get_contact_stats(
    organization_id: str,
    ctx: APIKeyContext = Depends(require_scope_with_rate_limit(Scope.READ)),
):
    """Get contact statistics for an organization."""
    _validate_org_id(ctx, organization_id)

    async with get_db_session() as session:
        result = await session.execute(
            text("""
                SELECT
                    COUNT(*) as total,
                    COUNT(*) FILTER (WHERE is_vip = true) as vip_count,
                    COUNT(*) FILTER (WHERE is_at_risk = true) as at_risk_count,
                    COUNT(*) FILTER (WHERE is_internal = true) as internal_count,
                    COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '7 days') as new_this_week,
                    AVG(health_score) as avg_health
                FROM contact
                WHERE organization_id = :org_id
            """),
            {"org_id": organization_id},
        )
        row = result.fetchone()

        return ContactStatsResponse(
            total_contacts=row.total or 0,
            vip_count=row.vip_count or 0,
            at_risk_count=row.at_risk_count or 0,
            internal_count=row.internal_count or 0,
            new_this_week=row.new_this_week or 0,
            avg_health_score=float(row.avg_health) if row.avg_health else None,
        )


@router.get("/vips", response_model=ContactListResponse)
async def get_vip_contacts(
    organization_id: str,
    limit: int = Query(50, ge=1, le=100),
    ctx: APIKeyContext = Depends(require_scope_with_rate_limit(Scope.READ)),
):
    """Get VIP contacts for an organization."""
    _validate_org_id(ctx, organization_id)

    query = CONTACT_BASE_QUERY + " AND c.is_vip = true ORDER BY c.importance_score DESC NULLS LAST LIMIT :limit"

    async with get_db_session() as session:
        result = await session.execute(
            text(query),
            {"org_id": organization_id, "limit": limit},
        )
        rows = result.fetchall()

        items = [_row_to_summary(row) for row in rows]

        # Count VIPs
        count_result = await session.execute(
            text("SELECT COUNT(*) FROM contact WHERE organization_id = :org_id AND is_vip = true"),
            {"org_id": organization_id},
        )
        total = count_result.scalar() or 0

    return ContactListResponse(
        items=items,
        total=total,
        limit=limit,
        offset=0,
    )


@router.get("/at-risk", response_model=ContactListResponse)
async def get_at_risk_contacts(
    organization_id: str,
    limit: int = Query(50, ge=1, le=100),
    ctx: APIKeyContext = Depends(require_scope_with_rate_limit(Scope.READ)),
):
    """Get at-risk contacts for an organization."""
    _validate_org_id(ctx, organization_id)

    query = CONTACT_BASE_QUERY + " AND c.is_at_risk = true ORDER BY c.health_score ASC NULLS LAST LIMIT :limit"

    async with get_db_session() as session:
        result = await session.execute(
            text(query),
            {"org_id": organization_id, "limit": limit},
        )
        rows = result.fetchall()

        items = [_row_to_summary(row) for row in rows]

        # Count at-risk
        count_result = await session.execute(
            text("SELECT COUNT(*) FROM contact WHERE organization_id = :org_id AND is_at_risk = true"),
            {"org_id": organization_id},
        )
        total = count_result.scalar() or 0

    return ContactListResponse(
        items=items,
        total=total,
        limit=limit,
        offset=0,
    )


@router.get("/search", response_model=ContactListResponse)
async def search_contacts(
    organization_id: str,
    query: str = Query(..., min_length=1),
    limit: int = Query(20, ge=1, le=50),
    ctx: APIKeyContext = Depends(require_scope_with_rate_limit(Scope.READ)),
):
    """Search contacts by name or email."""
    _validate_org_id(ctx, organization_id)

    search_query = CONTACT_BASE_QUERY + """
        AND (
            c.display_name ILIKE :search
            OR c.primary_email ILIKE :search
            OR c.company ILIKE :search
        )
        ORDER BY c.importance_score DESC NULLS LAST
        LIMIT :limit
    """

    async with get_db_session() as session:
        result = await session.execute(
            text(search_query),
            {"org_id": organization_id, "search": f"%{query}%", "limit": limit},
        )
        rows = result.fetchall()

        items = [_row_to_summary(row) for row in rows]

    return ContactListResponse(
        items=items,
        total=len(items),
        limit=limit,
        offset=0,
    )


@router.get("/{contact_id}", response_model=ContactDetail)
async def get_contact(
    contact_id: str,
    organization_id: str,
    ctx: APIKeyContext = Depends(require_scope_with_rate_limit(Scope.READ)),
):
    """Get detailed contact information."""
    _validate_org_id(ctx, organization_id)

    query = CONTACT_BASE_QUERY + " AND c.id = :contact_id"

    async with get_db_session() as session:
        result = await session.execute(
            text(query),
            {"org_id": organization_id, "contact_id": contact_id},
        )
        row = result.fetchone()

        if not row:
            raise HTTPException(status_code=404, detail="Contact not found")

        return _row_to_detail(row)


@router.post("/{contact_id}/toggle-vip")
async def toggle_vip(
    contact_id: str,
    organization_id: str,
    request: ToggleVipRequest,
    ctx: APIKeyContext = Depends(require_scope_with_rate_limit(Scope.WRITE)),
):
    """Toggle VIP status for a contact."""
    _validate_org_id(ctx, organization_id)

    async with get_db_session() as session:
        result = await session.execute(
            text("""
                UPDATE contact
                SET is_vip = :is_vip, user_override_vip = true, updated_at = NOW()
                WHERE id = :contact_id AND organization_id = :org_id
                RETURNING id
            """),
            {"contact_id": contact_id, "org_id": organization_id, "is_vip": request.is_vip},
        )
        row = result.fetchone()
        await session.commit()

        if not row:
            raise HTTPException(status_code=404, detail="Contact not found")

    return {"success": True, "is_vip": request.is_vip}


@router.post("/{contact_id}/analyze")
async def analyze_contact(
    contact_id: str,
    organization_id: str,
    include_graph_analytics: bool = Query(True),
    ctx: APIKeyContext = Depends(require_scope_with_rate_limit(Scope.WRITE)),
):
    """Trigger contact intelligence analysis."""
    _validate_org_id(ctx, organization_id)

    # Import here to avoid circular imports
    from src.orchestrator.contact_pipeline.graph import run_contact_intelligence

    try:
        result = await run_contact_intelligence(
            contact_id=contact_id,
            organization_id=organization_id,
            include_graph_analytics=include_graph_analytics,
            force_refresh=True,
        )

        return {
            "success": True,
            "contact_id": contact_id,
            "analysis_id": result.analysis_id,
            "duration_ms": result.output.analysis_duration_ms if result.output else None,
        }
    except Exception as e:
        logger.error("Contact analysis failed", contact_id=contact_id, error=str(e))
        raise HTTPException(status_code=500, detail=f"Analysis failed: {str(e)}")


@router.post("/{contact_id}/meeting-brief", response_model=MeetingBriefResponse)
async def generate_meeting_brief(
    contact_id: str,
    organization_id: str,
    ctx: APIKeyContext = Depends(require_scope_with_rate_limit(Scope.READ)),
):
    """Generate a meeting brief for a contact."""
    _validate_org_id(ctx, organization_id)

    async with get_db_session() as session:
        # Get contact
        result = await session.execute(
            text("""
                SELECT id, display_name, contact_brief
                FROM contact
                WHERE id = :contact_id AND organization_id = :org_id
            """),
            {"contact_id": contact_id, "org_id": organization_id},
        )
        contact = result.fetchone()

        if not contact:
            raise HTTPException(status_code=404, detail="Contact not found")

        # Get recent commitments
        commitments_result = await session.execute(
            text("""
                SELECT u.canonical_title
                FROM unified_intelligence_object u
                JOIN uio_commitment_details cd ON u.id = cd.uio_id
                WHERE u.organization_id = :org_id
                  AND (cd.debtor_contact_id = :contact_id OR cd.creditor_contact_id = :contact_id)
                  AND cd.status NOT IN ('completed', 'cancelled')
                ORDER BY u.due_date ASC NULLS LAST
                LIMIT 5
            """),
            {"org_id": organization_id, "contact_id": contact_id},
        )
        commitments = [row.canonical_title for row in commitments_result.fetchall()]

        # Get recent decisions
        decisions_result = await session.execute(
            text("""
                SELECT u.canonical_title
                FROM unified_intelligence_object u
                JOIN uio_decision_details dd ON u.id = dd.uio_id
                WHERE u.organization_id = :org_id
                  AND dd.decision_maker_contact_id = :contact_id
                  AND dd.status = 'pending'
                ORDER BY u.created_at DESC
                LIMIT 5
            """),
            {"org_id": organization_id, "contact_id": contact_id},
        )
        decisions = [row.canonical_title for row in decisions_result.fetchall()]

        # Generate brief (use stored brief or create a simple one)
        brief = contact.contact_brief or f"Meeting with {contact.display_name or 'contact'}"

        # Simple talking points based on available data
        talking_points = []
        if commitments:
            talking_points.append(f"Follow up on {len(commitments)} open commitment(s)")
        if decisions:
            talking_points.append(f"Discuss {len(decisions)} pending decision(s)")

        return MeetingBriefResponse(
            contact_id=contact_id,
            contact_name=contact.display_name,
            brief=brief,
            talking_points=talking_points,
            open_commitments=commitments,
            pending_decisions=decisions,
            generated_at=datetime.now(timezone.utc),
        )


@router.get("/{contact_id}/identities", response_model=list[ContactIdentityRecord])
async def list_contact_identities(
    contact_id: str,
    organization_id: str,
    ctx: APIKeyContext = Depends(require_scope_with_rate_limit(Scope.READ)),
):
    """List linked identities for a contact."""
    _validate_org_id(ctx, organization_id)

    async with get_db_session() as session:
        result = await session.execute(
            text(
                """
                SELECT id, identity_type, identity_value, confidence, is_verified,
                       source, source_account_id, last_seen_at, created_at, updated_at
                FROM contact_identity
                WHERE organization_id = :org_id AND contact_id = :contact_id
                ORDER BY created_at DESC
                """
            ),
            {"org_id": organization_id, "contact_id": contact_id},
        )
        rows = result.fetchall()
        return [
            ContactIdentityRecord(
                id=row.id,
                identity_type=row.identity_type,
                identity_value=row.identity_value,
                confidence=row.confidence,
                is_verified=row.is_verified,
                source=row.source,
                source_account_id=row.source_account_id,
                last_seen_at=row.last_seen_at,
                created_at=row.created_at,
                updated_at=row.updated_at,
            )
            for row in rows
        ]


@router.post("/{contact_id}/identities", response_model=ContactIdentityRecord)
async def link_contact_identity(
    contact_id: str,
    request: ContactIdentityLinkRequest,
    organization_id: str,
    ctx: APIKeyContext = Depends(require_scope_with_rate_limit(Scope.WRITE)),
):
    """Link a new identity to a contact (manual override)."""
    _validate_org_id(ctx, organization_id)

    try:
        identity_type = IdentityType(request.identity_type)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid identity_type")

    identity_graph = await get_identity_graph()
    success = await identity_graph.link_identity(
        contact_id=contact_id,
        identity=Identity(
            identity_type=identity_type,
            identity_value=request.identity_value,
            confidence=request.confidence,
            is_verified=request.is_verified,
        ),
        organization_id=organization_id,
    )

    if not success:
        raise HTTPException(status_code=409, detail="Identity already linked elsewhere")

    async with get_db_session() as session:
        result = await session.execute(
            text(
                """
                SELECT id, identity_type, identity_value, confidence, is_verified,
                       source, source_account_id, last_seen_at, created_at, updated_at
                FROM contact_identity
                WHERE organization_id = :org_id
                  AND contact_id = :contact_id
                  AND identity_type = :identity_type
                  AND identity_value = :identity_value
                """
            ),
            {
                "org_id": organization_id,
                "contact_id": contact_id,
                "identity_type": identity_type.value,
                "identity_value": request.identity_value,
            },
        )
        row = result.fetchone()
        if not row:
            raise HTTPException(status_code=500, detail="Identity not persisted")

        return ContactIdentityRecord(
            id=row.id,
            identity_type=row.identity_type,
            identity_value=row.identity_value,
            confidence=row.confidence,
            is_verified=row.is_verified,
            source=row.source,
            source_account_id=row.source_account_id,
            last_seen_at=row.last_seen_at,
            created_at=row.created_at,
            updated_at=row.updated_at,
        )


@router.get("/merge-suggestions", response_model=list[ContactMergeSuggestion])
async def list_merge_suggestions(
    organization_id: str | None = None,
    min_confidence: float = Query(0.7, ge=0.0, le=1.0),
    limit: int = Query(50, ge=1, le=200),
    ctx: APIKeyContext = Depends(require_scope_with_rate_limit(Scope.READ)),
):
    """List suggested contact merges."""
    org_id = organization_id or ctx.organization_id
    if not org_id:
        raise HTTPException(status_code=400, detail="organization_id is required")
    _validate_org_id(ctx, org_id)

    identity_graph = await get_identity_graph()
    suggestions = await identity_graph.suggest_merges(
        organization_id=org_id,
        min_confidence=min_confidence,
        limit=limit,
    )

    return [
        ContactMergeSuggestion(
            contact_a_id=s.contact_a_id,
            contact_a_name=s.contact_a_name,
            contact_a_email=s.contact_a_email,
            contact_b_id=s.contact_b_id,
            contact_b_name=s.contact_b_name,
            contact_b_email=s.contact_b_email,
            confidence=s.confidence,
            match_reasons=s.match_reasons,
        )
        for s in suggestions
    ]


@router.post("/merge")
async def merge_contacts(
    request: ContactMergeRequest,
    organization_id: str | None = None,
    ctx: APIKeyContext = Depends(require_scope_with_rate_limit(Scope.WRITE)),
):
    """Merge a source contact into a target contact."""
    org_id = organization_id or ctx.organization_id
    if not org_id:
        raise HTTPException(status_code=400, detail="organization_id is required")
    _validate_org_id(ctx, org_id)

    identity_graph = await get_identity_graph()
    merged = await identity_graph.merge_contacts(
        organization_id=org_id,
        source_contact_id=request.source_contact_id,
        target_contact_id=request.target_contact_id,
        performed_by=ctx.user_id if hasattr(ctx, "user_id") else None,
        reason=request.reason,
    )

    if not merged:
        raise HTTPException(status_code=400, detail="Contact merge failed")

    return {"success": True}


@router.get("/identities/audit", response_model=list[ContactIdentityRecord])
async def export_identity_audit(
    organization_id: str | None = None,
    contact_id: str | None = None,
    ctx: APIKeyContext = Depends(require_scope_with_rate_limit(Scope.READ)),
):
    """Export identity audit trail for an org or a specific contact."""
    org_id = organization_id or ctx.organization_id
    if not org_id:
        raise HTTPException(status_code=400, detail="organization_id is required")
    _validate_org_id(ctx, org_id)

    async with get_db_session() as session:
        if contact_id:
            result = await session.execute(
                text(
                    """
                    SELECT id, identity_type, identity_value, confidence, is_verified,
                           source, source_account_id, last_seen_at, created_at, updated_at
                    FROM contact_identity
                    WHERE organization_id = :org_id
                      AND contact_id = :contact_id
                    ORDER BY updated_at DESC
                    """
                ),
                {"org_id": org_id, "contact_id": contact_id},
            )
        else:
            result = await session.execute(
                text(
                    """
                    SELECT id, identity_type, identity_value, confidence, is_verified,
                           source, source_account_id, last_seen_at, created_at, updated_at
                    FROM contact_identity
                    WHERE organization_id = :org_id
                    ORDER BY updated_at DESC
                    """
                ),
                {"org_id": org_id},
            )
        rows = result.fetchall()

    return [
        ContactIdentityRecord(
            id=row.id,
            identity_type=row.identity_type,
            identity_value=row.identity_value,
            confidence=row.confidence,
            is_verified=row.is_verified,
            source=row.source,
            source_account_id=row.source_account_id,
            last_seen_at=row.last_seen_at,
            created_at=row.created_at,
            updated_at=row.updated_at,
        )
        for row in rows
    ]
