"""
UIO API Routes

CRUD and lifecycle management for Universal Intelligence Objects.
Provides endpoints for:
- Listing and filtering UIOs
- Getting UIO details
- Status changes (with validation)
- User corrections
- UIO merging
- Type-specific mutations
"""

import base64
import json
import time
from datetime import datetime, timedelta, timezone
from uuid import uuid4
from typing import Literal

import structlog
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from prometheus_client import Counter, Histogram

from src.auth.context import AuthContext
from src.auth.middleware import APIKeyContext, require_scope_with_rate_limit, get_auth_context
from src.auth.scopes import Scope
from src.orchestrator.state import UIOStatus
from src.uio.manager import get_uio_manager

logger = structlog.get_logger()

router = APIRouter(prefix="/uios", tags=["uios"])

# Prometheus metrics
UIOS_LATENCY = Histogram(
    "drovi_uios_latency_seconds",
    "UIOs endpoint latency",
    ["org_id", "type"],
    buckets=[0.05, 0.1, 0.15, 0.2, 0.3, 0.5, 1.0],
)
UIOS_REQUESTS = Counter(
    "drovi_uios_requests_total",
    "Total UIOs list requests",
    ["org_id", "type"],
)


def _validate_org_id(ctx: APIKeyContext, organization_id: str) -> None:
    """Validate organization_id matches auth context."""
    if ctx.organization_id != "internal" and organization_id != ctx.organization_id:
        raise HTTPException(
            status_code=403,
            detail="Organization ID mismatch with authenticated key",
        )


# =============================================================================
# Request/Response Models
# =============================================================================


class UIOListResponse(BaseModel):
    """Response for listing UIOs."""

    items: list[dict]
    total: int
    limit: int
    offset: int


class StatusChangeRequest(BaseModel):
    """Request to change UIO status."""

    status: Literal["draft", "active", "in_progress", "completed", "cancelled", "archived"]
    user_id: str | None = None


class CorrectionRequest(BaseModel):
    """Request to apply user corrections."""

    corrections: dict = Field(
        ...,
        description="Dict of field names to corrected values",
        examples=[{"title": "Corrected title", "due_date": "2024-02-01"}],
    )
    user_id: str


class MergeRequest(BaseModel):
    """Request to merge UIOs."""

    target_uio_id: str = Field(..., description="UIO to merge into")
    strategy: Literal["newest_wins", "highest_confidence", "manual"] = "newest_wins"
    manual_resolution: dict | None = Field(
        None,
        description="Field values for manual strategy",
    )


class CreateUIORequest(BaseModel):
    """Request to create a UIO manually."""

    type: Literal["commitment", "decision", "task", "claim", "risk"]
    data: dict = Field(..., description="UIO-specific data")
    source_type: str = "manual"
    source_id: str | None = None


# =============================================================================
# Mutation Request Models
# =============================================================================


class SnoozeRequest(BaseModel):
    """Request to snooze a commitment/task."""

    snooze_until: datetime = Field(..., description="When to un-snooze the UIO")


class TaskStatusRequest(BaseModel):
    """Request to update task status."""

    status: Literal["backlog", "todo", "in_progress", "in_review", "done", "cancelled"]


class TaskPriorityRequest(BaseModel):
    """Request to update task priority."""

    priority: Literal["no_priority", "low", "medium", "high", "urgent"]


class CommitmentPriorityRequest(BaseModel):
    """Request to update commitment priority."""

    priority: Literal["low", "medium", "high", "urgent"]


class CommitmentDirectionRequest(BaseModel):
    """Request to update commitment direction."""

    direction: Literal["owed_by_me", "owed_to_me"]


class SupersedeDecisionRequest(BaseModel):
    """Request to mark a decision as superseded."""

    superseded_by_id: str = Field(..., description="ID of the new decision that supersedes this one")


class SupersedeGenericRequest(BaseModel):
    """Request to mark a UIO as superseded."""

    superseded_by_id: str = Field(..., description="ID of the new UIO that supersedes this one")
    uio_type: Literal["commitment", "task", "risk"] = Field(..., description="UIO type")


# =============================================================================
# Extended Response Models (Full Contact Resolution)
# =============================================================================


class Contact(BaseModel):
    """Full contact for display (resolved from contact table)."""

    id: str
    display_name: str | None = None
    primary_email: str
    avatar_url: str | None = None
    company: str | None = None
    title: str | None = None

    class Config:
        from_attributes = True


class CommitmentDetails(BaseModel):
    """Commitment-specific details."""

    status: str | None = None  # pending, in_progress, completed, cancelled, overdue, snoozed
    priority: str | None = None  # low, medium, high, urgent
    direction: str | None = None  # owed_by_me, owed_to_me
    due_date_source: str | None = None  # explicit, inferred
    is_conditional: bool = False
    condition: str | None = None
    snoozed_until: datetime | None = None
    completed_at: datetime | None = None
    supersedes_uio_id: str | None = None
    superseded_by_uio_id: str | None = None


class DecisionDetails(BaseModel):
    """Decision-specific details."""

    status: str | None = None  # made, pending, deferred, reversed, superseded
    statement: str | None = None
    rationale: str | None = None
    decided_at: datetime | None = None
    supersedes_uio_id: str | None = None
    superseded_by_uio_id: str | None = None
    impact_areas: list[str] | None = None


class TaskDetails(BaseModel):
    """Task-specific details."""

    status: str | None = None  # backlog, todo, in_progress, in_review, done, cancelled
    priority: str | None = None  # no_priority, low, medium, high, urgent
    estimated_effort: str | None = None
    completed_at: datetime | None = None
    project: str | None = None
    tags: list[str] | None = None
    supersedes_uio_id: str | None = None
    superseded_by_uio_id: str | None = None


class RiskDetails(BaseModel):
    """Risk-specific details."""

    severity: str | None = None  # low, medium, high, critical
    risk_type: str | None = None
    suggested_action: str | None = None
    findings: dict | None = None
    supersedes_uio_id: str | None = None
    superseded_by_uio_id: str | None = None


class ClaimDetails(BaseModel):
    """Claim-specific details."""

    claim_type: str | None = None
    quoted_text: str | None = None
    normalized_text: str | None = None
    importance: str | None = None


class BriefDetails(BaseModel):
    """Brief-specific details."""

    priority_tier: str | None = None  # urgent, high, medium, low
    summary: str | None = None
    suggested_action: str | None = None
    action_reasoning: str | None = None
    urgency_score: float | None = None
    importance_score: float | None = None
    intent_classification: str | None = None


class SourceInfo(BaseModel):
    """Source/evidence information."""

    id: str
    source_type: str | None = None  # gmail, slack, outlook, etc.
    source_timestamp: datetime | None = None
    quoted_text: str | None = None
    segment_hash: str | None = None
    conversation_id: str | None = None
    message_id: str | None = None
    role: str | None = None


class UIOResponse(BaseModel):
    """Complete UIO response with all nested data and resolved contacts."""

    # Core fields
    id: str
    type: Literal["commitment", "decision", "task", "risk", "claim", "topic", "project", "brief"]
    canonical_title: str
    canonical_description: str | None = None
    user_corrected_title: str | None = None
    status: str

    # Confidence
    overall_confidence: float | None = None
    confidence_tier: Literal["high", "medium", "low"]
    is_user_verified: bool = False
    is_user_dismissed: bool = False

    # Dates
    due_date: datetime | None = None
    created_at: datetime
    updated_at: datetime | None = None
    first_seen_at: datetime | None = None

    # Owner (resolved Contact)
    owner: Contact | None = None

    # Commitment-specific contacts
    debtor: Contact | None = None
    creditor: Contact | None = None

    # Decision-specific contacts
    decision_maker: Contact | None = None

    # Task-specific contacts
    assignee: Contact | None = None
    created_by: Contact | None = None

    # Type-specific details (only one populated based on type)
    commitment_details: CommitmentDetails | None = None
    decision_details: DecisionDetails | None = None
    task_details: TaskDetails | None = None
    risk_details: RiskDetails | None = None
    claim_details: ClaimDetails | None = None
    brief_details: BriefDetails | None = None

    # Evidence sources
    sources: list[SourceInfo] | None = None
    evidence_id: str | None = None

    class Config:
        from_attributes = True


class ExtendedCursorUIOListResponse(BaseModel):
    """Extended cursor-paginated UIO listing with full data."""

    items: list[UIOResponse]
    total: int
    cursor: str | None = None
    has_more: bool = False


# Legacy models for backwards compatibility
class ContactInfo(BaseModel):
    """Contact information for UIO parties (legacy)."""

    name: str | None = None
    email: str | None = None
    company: str | None = None


class UIOItem(BaseModel):
    """Enhanced UIO item for pilot surface API (legacy)."""

    id: str
    type: Literal["commitment", "decision", "risk", "task", "claim"]
    title: str
    status: str
    direction: Literal["owed_to_me", "owed_by_me"] | None = None
    debtor: ContactInfo | None = None
    creditor: ContactInfo | None = None
    due_date: datetime | None = None
    confidence: float = Field(ge=0.0, le=1.0)
    confidence_tier: Literal["high", "medium", "low"]
    evidence_id: str | None = None
    extracted_at: datetime | None = None


class CursorUIOListResponse(BaseModel):
    """Response for cursor-paginated UIO listing (legacy)."""

    items: list[UIOItem]
    total: int
    cursor: str | None = None
    has_more: bool = False


def encode_cursor(offset: int) -> str:
    """Encode pagination offset as opaque cursor."""
    return base64.urlsafe_b64encode(json.dumps({"offset": offset}).encode()).decode()


def decode_cursor(cursor: str) -> int:
    """Decode opaque cursor to pagination offset."""
    try:
        data = json.loads(base64.urlsafe_b64decode(cursor.encode()))
        return data.get("offset", 0)
    except Exception:
        return 0


def confidence_to_tier(confidence: float) -> Literal["high", "medium", "low"]:
    """Convert numeric confidence to tier."""
    if confidence >= 0.85:
        return "high"
    if confidence >= 0.5:
        return "medium"
    return "low"


def _build_contact(row: dict, prefix: str) -> Contact | None:
    """Build a Contact from a row with prefixed columns."""
    contact_id = row.get(f"{prefix}_id")
    if not contact_id:
        return None
    return Contact(
        id=contact_id,
        display_name=row.get(f"{prefix}_display_name"),
        primary_email=row.get(f"{prefix}_email") or "",
        avatar_url=row.get(f"{prefix}_avatar_url"),
        company=row.get(f"{prefix}_company"),
        title=row.get(f"{prefix}_title"),
    )


def _row_to_dict(row) -> dict:
    """Convert SQLAlchemy row to dict."""
    if hasattr(row, "_mapping"):
        return dict(row._mapping)
    return dict(row)


async def build_uio_response(row, session=None) -> UIOResponse:
    """Build a complete UIOResponse from a database row."""
    row_dict = _row_to_dict(row)

    # Core fields
    uio_type = row_dict.get("type", "commitment")
    confidence = row_dict.get("overall_confidence") or 0.0

    # Build owner contact
    owner = None
    if row_dict.get("owner_id"):
        owner = Contact(
            id=row_dict["owner_id"],
            display_name=row_dict.get("owner_display_name"),
            primary_email=row_dict.get("owner_email") or "",
            avatar_url=row_dict.get("owner_avatar_url"),
            company=row_dict.get("owner_company"),
            title=row_dict.get("owner_title"),
        )

    # Type-specific details and contacts
    debtor = None
    creditor = None
    decision_maker = None
    assignee = None
    created_by = None
    commitment_details = None
    decision_details = None
    task_details = None
    risk_details = None
    claim_details = None
    brief_details = None

    if uio_type == "commitment":
        # Build debtor and creditor contacts
        if row_dict.get("debtor_id"):
            debtor = Contact(
                id=row_dict["debtor_id"],
                display_name=row_dict.get("debtor_display_name"),
                primary_email=row_dict.get("debtor_email") or "",
                avatar_url=row_dict.get("debtor_avatar_url"),
                company=row_dict.get("debtor_company"),
                title=row_dict.get("debtor_title"),
            )
        if row_dict.get("creditor_id"):
            creditor = Contact(
                id=row_dict["creditor_id"],
                display_name=row_dict.get("creditor_display_name"),
                primary_email=row_dict.get("creditor_email") or "",
                avatar_url=row_dict.get("creditor_avatar_url"),
                company=row_dict.get("creditor_company"),
                title=row_dict.get("creditor_title"),
            )
        commitment_details = CommitmentDetails(
            status=row_dict.get("commitment_status"),
            priority=row_dict.get("commitment_priority"),
            direction=row_dict.get("direction"),
            due_date_source=row_dict.get("due_date_source"),
            is_conditional=row_dict.get("is_conditional") or False,
            condition=row_dict.get("condition"),
            snoozed_until=row_dict.get("snoozed_until"),
            completed_at=row_dict.get("commitment_completed_at"),
            supersedes_uio_id=row_dict.get("commitment_supersedes_uio_id"),
            superseded_by_uio_id=row_dict.get("commitment_superseded_by_uio_id"),
        )

    elif uio_type == "decision":
        if row_dict.get("decision_maker_id"):
            decision_maker = Contact(
                id=row_dict["decision_maker_id"],
                display_name=row_dict.get("decision_maker_display_name"),
                primary_email=row_dict.get("decision_maker_email") or "",
                avatar_url=row_dict.get("decision_maker_avatar_url"),
                company=row_dict.get("decision_maker_company"),
                title=row_dict.get("decision_maker_title"),
            )
        decision_details = DecisionDetails(
            status=row_dict.get("decision_status"),
            statement=row_dict.get("statement"),
            rationale=row_dict.get("rationale"),
            decided_at=row_dict.get("decided_at"),
            supersedes_uio_id=row_dict.get("supersedes_uio_id"),
            superseded_by_uio_id=row_dict.get("superseded_by_uio_id"),
            impact_areas=row_dict.get("impact_areas"),
        )

    elif uio_type == "task":
        if row_dict.get("assignee_id"):
            assignee = Contact(
                id=row_dict["assignee_id"],
                display_name=row_dict.get("assignee_display_name"),
                primary_email=row_dict.get("assignee_email") or "",
                avatar_url=row_dict.get("assignee_avatar_url"),
                company=row_dict.get("assignee_company"),
                title=row_dict.get("assignee_title"),
            )
        if row_dict.get("created_by_id"):
            created_by = Contact(
                id=row_dict["created_by_id"],
                display_name=row_dict.get("created_by_display_name"),
                primary_email=row_dict.get("created_by_email") or "",
                avatar_url=row_dict.get("created_by_avatar_url"),
                company=row_dict.get("created_by_company"),
                title=row_dict.get("created_by_title"),
            )
        task_details = TaskDetails(
            status=row_dict.get("task_status"),
            priority=row_dict.get("task_priority"),
            estimated_effort=row_dict.get("estimated_effort"),
            completed_at=row_dict.get("task_completed_at"),
            project=row_dict.get("project"),
            tags=row_dict.get("tags"),
            supersedes_uio_id=row_dict.get("task_supersedes_uio_id"),
            superseded_by_uio_id=row_dict.get("task_superseded_by_uio_id"),
        )

    elif uio_type == "risk":
        risk_details = RiskDetails(
            severity=row_dict.get("severity"),
            risk_type=row_dict.get("risk_type"),
            suggested_action=row_dict.get("risk_suggested_action"),
            findings=row_dict.get("findings"),
            supersedes_uio_id=row_dict.get("risk_supersedes_uio_id"),
            superseded_by_uio_id=row_dict.get("risk_superseded_by_uio_id"),
        )

    elif uio_type == "claim":
        claim_details = ClaimDetails(
            claim_type=row_dict.get("claim_type"),
            quoted_text=row_dict.get("claim_quoted_text"),
            normalized_text=row_dict.get("normalized_text"),
            importance=row_dict.get("claim_importance"),
        )

    elif uio_type == "brief":
        brief_details = BriefDetails(
            priority_tier=row_dict.get("priority_tier"),
            summary=row_dict.get("brief_summary"),
            suggested_action=row_dict.get("brief_suggested_action"),
            action_reasoning=row_dict.get("action_reasoning"),
            urgency_score=row_dict.get("urgency_score"),
            importance_score=row_dict.get("brief_importance_score"),
            intent_classification=row_dict.get("intent_classification"),
        )

    # Build source info
    sources = None
    if row_dict.get("source_id"):
        sources = [
            SourceInfo(
                id=row_dict["source_id"],
                source_type=row_dict.get("source_type"),
                source_timestamp=row_dict.get("source_timestamp"),
                quoted_text=row_dict.get("source_quoted_text"),
                segment_hash=row_dict.get("source_segment_hash"),
                conversation_id=row_dict.get("conversation_id"),
                message_id=row_dict.get("message_id"),
                role=row_dict.get("source_role"),
            )
        ]

    return UIOResponse(
        id=row_dict["id"],
        type=uio_type,
        canonical_title=row_dict.get("canonical_title") or "Untitled",
        canonical_description=row_dict.get("canonical_description"),
        user_corrected_title=row_dict.get("user_corrected_title"),
        status=row_dict.get("status") or "active",
        overall_confidence=confidence,
        confidence_tier=confidence_to_tier(confidence),
        is_user_verified=row_dict.get("is_user_verified") or False,
        is_user_dismissed=row_dict.get("is_user_dismissed") or False,
        due_date=row_dict.get("due_date"),
        created_at=row_dict.get("created_at") or datetime.now(timezone.utc),
        updated_at=row_dict.get("updated_at"),
        first_seen_at=row_dict.get("first_seen_at"),
        owner=owner,
        debtor=debtor,
        creditor=creditor,
        decision_maker=decision_maker,
        assignee=assignee,
        created_by=created_by,
        commitment_details=commitment_details,
        decision_details=decision_details,
        task_details=task_details,
        risk_details=risk_details,
        claim_details=claim_details,
        brief_details=brief_details,
        sources=sources,
        evidence_id=row_dict.get("source_id"),
    )


# Full SQL query for fetching UIOs with all extension tables and contacts
FULL_UIO_QUERY = """
SELECT
    -- Base UIO
    u.id, u.type, u.canonical_title, u.canonical_description,
    u.user_corrected_title, u.status, u.overall_confidence, u.due_date,
    u.created_at, u.updated_at, u.first_seen_at, u.last_updated_at,
    u.is_user_verified, u.is_user_dismissed,

    -- Owner contact
    oc.id as owner_id, oc.display_name as owner_display_name,
    oc.primary_email as owner_email, oc.avatar_url as owner_avatar_url,
    oc.company as owner_company, oc.title as owner_title,

    -- Commitment details
    cd.direction, cd.priority as commitment_priority,
    cd.status as commitment_status, cd.due_date_source,
    cd.is_conditional, cd.condition, cd.snoozed_until,
    cd.completed_at as commitment_completed_at,
    cd.supersedes_uio_id as commitment_supersedes_uio_id,
    cd.superseded_by_uio_id as commitment_superseded_by_uio_id,

    -- Debtor contact (for commitments)
    dc.id as debtor_id, dc.display_name as debtor_display_name,
    dc.primary_email as debtor_email, dc.avatar_url as debtor_avatar_url,
    dc.company as debtor_company, dc.title as debtor_title,

    -- Creditor contact (for commitments)
    cc.id as creditor_id, cc.display_name as creditor_display_name,
    cc.primary_email as creditor_email, cc.avatar_url as creditor_avatar_url,
    cc.company as creditor_company, cc.title as creditor_title,

    -- Decision details
    dd.statement, dd.rationale, dd.decided_at,
    dd.status as decision_status, dd.supersedes_uio_id, dd.superseded_by_uio_id,
    dd.impact_areas,

    -- Decision maker contact
    dmc.id as decision_maker_id, dmc.display_name as decision_maker_display_name,
    dmc.primary_email as decision_maker_email, dmc.avatar_url as decision_maker_avatar_url,
    dmc.company as decision_maker_company, dmc.title as decision_maker_title,

    -- Task details
    td.status as task_status, td.priority as task_priority, td.estimated_effort,
    td.completed_at as task_completed_at, td.project, td.tags,
    td.supersedes_uio_id as task_supersedes_uio_id,
    td.superseded_by_uio_id as task_superseded_by_uio_id,

    -- Assignee contact (for tasks)
    ac.id as assignee_id, ac.display_name as assignee_display_name,
    ac.primary_email as assignee_email, ac.avatar_url as assignee_avatar_url,
    ac.company as assignee_company, ac.title as assignee_title,

    -- Created by contact (for tasks)
    cbc.id as created_by_id, cbc.display_name as created_by_display_name,
    cbc.primary_email as created_by_email, cbc.avatar_url as created_by_avatar_url,
    cbc.company as created_by_company, cbc.title as created_by_title,

    -- Risk details
    rd.severity, rd.risk_type, rd.suggested_action as risk_suggested_action, rd.findings,
    rd.supersedes_uio_id as risk_supersedes_uio_id,
    rd.superseded_by_uio_id as risk_superseded_by_uio_id,

    -- Claim details
    cld.claim_type, cld.quoted_text as claim_quoted_text, cld.normalized_text,
    cld.importance as claim_importance,

    -- Brief details
    bd.priority_tier, bd.summary as brief_summary, bd.suggested_action as brief_suggested_action,
    bd.action_reasoning, bd.urgency_score, bd.importance_score as brief_importance_score,
    bd.intent_classification,

    -- Source (first evidence)
    uos.id as source_id, uos.source_type, uos.source_timestamp,
    uos.quoted_text as source_quoted_text, uos.segment_hash as source_segment_hash,
    uos.conversation_id, uos.message_id,
    uos.role as source_role

FROM unified_intelligence_object u

-- Owner
LEFT JOIN contact oc ON u.owner_contact_id = oc.id

-- Commitment details + contacts
LEFT JOIN uio_commitment_details cd ON u.id = cd.uio_id
LEFT JOIN contact dc ON cd.debtor_contact_id = dc.id
LEFT JOIN contact cc ON cd.creditor_contact_id = cc.id

-- Decision details + decision maker
LEFT JOIN uio_decision_details dd ON u.id = dd.uio_id
LEFT JOIN contact dmc ON dd.decision_maker_contact_id = dmc.id

-- Task details + assignee + created_by
LEFT JOIN uio_task_details td ON u.id = td.uio_id
LEFT JOIN contact ac ON td.assignee_contact_id = ac.id
LEFT JOIN contact cbc ON td.created_by_contact_id = cbc.id

-- Risk details
LEFT JOIN uio_risk_details rd ON u.id = rd.uio_id

-- Claim details
LEFT JOIN uio_claim_details cld ON u.id = cld.uio_id

-- Brief details
LEFT JOIN uio_brief_details bd ON u.id = bd.uio_id

-- First source (using lateral join for single source)
LEFT JOIN LATERAL (
    SELECT * FROM unified_object_source
    WHERE unified_object_id = u.id
    ORDER BY source_timestamp DESC NULLS LAST
    LIMIT 1
) uos ON true
"""


# =============================================================================
# List/Query Endpoints
# =============================================================================


@router.get("/v2", response_model=ExtendedCursorUIOListResponse)
async def list_uios_v2(
    organization_id: str | None = None,
    type: Literal["commitment", "decision", "risk", "task", "claim", "brief"] | None = None,
    status: Literal["open", "overdue", "completed", "all"] | None = Query(default="open"),
    time_range: Literal["7d", "30d", "90d", "all"] | None = Query(default="7d", alias="range"),
    as_of: str | None = Query(default=None, description="ISO timestamp for time-slice queries"),
    limit: int = Query(20, ge=1, le=100),
    cursor: str | None = None,
    ctx: APIKeyContext = Depends(require_scope_with_rate_limit(Scope.READ)),
):
    """
    List UIOs with cursor pagination (Pilot Surface API).

    Returns complete UIO data with all extension tables joined and contacts resolved.

    Args:
        organization_id: Organization ID (optional if using session auth)
        type: Filter by UIO type (commitment, decision, risk, task, claim, brief)
        status: Filter by status (open, overdue, completed, all)
        range: Time range (7d, 30d, 90d, all)
        limit: Maximum results per page (default 20, max 100)
        cursor: Pagination cursor from previous response

    Returns:
        ExtendedCursorUIOListResponse with full UIO data

    Requires `read` scope.
    """
    start_time = time.time()

    # Use org_id from auth context if not provided in query
    org_id = organization_id or ctx.organization_id
    if not org_id or org_id == "internal":
        raise HTTPException(status_code=400, detail="organization_id is required")

    _validate_org_id(ctx, org_id)

    # Track metrics
    type_label = type or "all"
    UIOS_REQUESTS.labels(org_id=org_id, type=type_label).inc()

    # Decode cursor to offset
    offset = decode_cursor(cursor) if cursor else 0

    # Calculate date range
    now = datetime.now(timezone.utc)
    range_map = {
        "7d": timedelta(days=7),
        "30d": timedelta(days=30),
        "90d": timedelta(days=90),
        "all": None,
    }
    range_delta = range_map.get(time_range)
    period_start = (now - range_delta) if range_delta else None

    # Map status filter to internal statuses
    status_map = {
        "open": ["draft", "active", "in_progress"],
        "overdue": None,  # Special handling
        "completed": ["completed"],
        "all": None,
    }

    # Parse time-slice (bi-temporal) filter
    as_of_ts: datetime | None = None
    if as_of:
        try:
            as_of_ts = datetime.fromisoformat(as_of)
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid as_of timestamp")

    # Query from PostgreSQL with full JOINs
    from src.db.client import get_db_session
    from sqlalchemy import text

    items: list[UIOResponse] = []
    total = 0

    try:
        async with get_db_session() as session:
            # Build query conditions
            conditions = ["u.organization_id = :org_id"]
            params: dict = {"org_id": org_id, "limit": limit + 1, "offset": offset}

            # Always filter to valid UIO types only
            valid_types = ["commitment", "decision", "risk", "task", "claim", "brief"]
            if type:
                conditions.append("u.type = :type")
                params["type"] = type
            else:
                # Filter to valid types when no specific type is requested
                conditions.append("u.type IN (:type_0, :type_1, :type_2, :type_3, :type_4, :type_5)")
                for i, t in enumerate(valid_types):
                    params[f"type_{i}"] = t

            if period_start:
                conditions.append("u.created_at >= :period_start")
                params["period_start"] = period_start

            if as_of_ts:
                conditions.append("u.valid_from <= :as_of")
                conditions.append("(u.valid_to IS NULL OR u.valid_to > :as_of)")
                params["as_of"] = as_of_ts

            if status == "overdue":
                conditions.append("u.status IN ('draft', 'active', 'in_progress')")
                conditions.append("u.due_date < :now")
                params["now"] = now
            elif status and status != "all":
                internal_statuses = status_map.get(status)
                if internal_statuses:
                    conditions.append(f"u.status IN ({','.join(f':status_{i}' for i in range(len(internal_statuses)))})")
                    for i, s in enumerate(internal_statuses):
                        params[f"status_{i}"] = s

            where_clause = " AND ".join(conditions)

            # Count total
            count_result = await session.execute(
                text(f"""
                    SELECT COUNT(*) as count
                    FROM unified_intelligence_object u
                    WHERE {where_clause}
                """),
                {k: v for k, v in params.items() if k not in ("limit", "offset")},
            )
            count_row = count_result.fetchone()
            total = count_row.count if count_row else 0

            # Fetch items with full JOIN query
            result = await session.execute(
                text(f"""
                    {FULL_UIO_QUERY}
                    WHERE {where_clause}
                    ORDER BY u.created_at DESC
                    LIMIT :limit
                    OFFSET :offset
                """),
                params,
            )
            rows = result.fetchall()

            for row in rows[:limit]:  # Don't include the extra one
                uio_response = await build_uio_response(row, session)
                items.append(uio_response)

            # Check if there are more results
            has_more = len(rows) > limit

    except Exception as e:
        logger.error(
            "Failed to list UIOs",
            organization_id=org_id,
            error=str(e),
            exc_info=True,
        )
        raise HTTPException(status_code=500, detail="Failed to list UIOs")

    # Generate next cursor if has_more
    next_cursor = encode_cursor(offset + limit) if has_more else None

    # Record latency
    latency = time.time() - start_time
    UIOS_LATENCY.labels(org_id=org_id, type=type_label).observe(latency)

    logger.info(
        "UIOs listed (v2)",
        organization_id=org_id,
        type=type,
        status=status,
        time_range=time_range,
        count=len(items),
        total=total,
        latency_ms=latency * 1000,
    )

    return ExtendedCursorUIOListResponse(
        items=items,
        total=total,
        cursor=next_cursor,
        has_more=has_more,
    )


@router.get("", response_model=UIOListResponse)
async def list_uios(
    organization_id: str,
    type: Literal["commitment", "decision", "task", "claim", "risk"] | None = None,
    status: Literal["draft", "active", "in_progress", "completed", "cancelled", "archived"] | None = None,
    needs_review: bool | None = None,
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    ctx: APIKeyContext = Depends(require_scope_with_rate_limit(Scope.READ)),
):
    """
    List UIOs with filtering.

    Args:
        organization_id: Organization ID (required)
        type: Filter by UIO type
        status: Filter by status
        needs_review: Filter by review status
        limit: Maximum results (default 50)
        offset: Pagination offset

    Returns:
        List of UIOs matching filters

    Requires `read` scope.
    """
    _validate_org_id(ctx, organization_id)
    manager = await get_uio_manager(organization_id)

    uio_status = UIOStatus(status) if status else None

    uios = await manager.list_uios(
        uio_type=type,
        status=uio_status,
        needs_review=needs_review,
        limit=limit,
        offset=offset,
    )

    return UIOListResponse(
        items=uios,
        total=len(uios),  # Would need count query for accurate total
        limit=limit,
        offset=offset,
    )


@router.get("/pending-review")
async def get_pending_review(
    organization_id: str,
    limit: int = Query(50, ge=1, le=200),
    ctx: APIKeyContext = Depends(require_scope_with_rate_limit(Scope.READ)),
):
    """
    Get UIOs pending review.

    Returns UIOs in DRAFT status that need human review.

    Requires `read` scope.
    """
    _validate_org_id(ctx, organization_id)
    manager = await get_uio_manager(organization_id)
    uios = await manager.get_pending_review(limit=limit)

    return {
        "items": uios,
        "count": len(uios),
    }


# =============================================================================
# Single UIO Endpoints
# =============================================================================


@router.get("/{uio_id}", response_model=UIOResponse)
async def get_uio(
    uio_id: str,
    organization_id: str | None = None,
    ctx: APIKeyContext = Depends(require_scope_with_rate_limit(Scope.READ)),
):
    """
    Get a single UIO by ID with full extension details and resolved contacts.

    Args:
        uio_id: UIO ID
        organization_id: Organization ID (optional if using session auth)

    Returns:
        Complete UIO data with contacts and extension details

    Requires `read` scope.
    """
    org_id = organization_id or ctx.organization_id
    if not org_id or org_id == "internal":
        raise HTTPException(status_code=400, detail="organization_id is required")

    _validate_org_id(ctx, org_id)

    # Query from PostgreSQL with full JOINs (same as list_uios_v2)
    from src.db.client import get_db_session
    from sqlalchemy import text

    try:
        async with get_db_session() as session:
            result = await session.execute(
                text(f"""
                    {FULL_UIO_QUERY}
                    WHERE u.id = :uio_id AND u.organization_id = :org_id
                """),
                {"uio_id": uio_id, "org_id": org_id},
            )
            row = result.fetchone()

            if not row:
                raise HTTPException(status_code=404, detail="UIO not found")

            return await build_uio_response(row, session)

    except HTTPException:
        raise
    except Exception as e:
        logger.error(
            "Failed to get UIO",
            uio_id=uio_id,
            organization_id=org_id,
            error=str(e),
            exc_info=True,
        )
        raise HTTPException(status_code=500, detail="Failed to get UIO")


@router.post("")
async def create_uio(
    organization_id: str,
    request: CreateUIORequest,
    ctx: APIKeyContext = Depends(require_scope_with_rate_limit(Scope.WRITE)),
):
    """
    Create a UIO manually.

    UIOs are typically created automatically during analysis,
    but this endpoint allows manual creation.

    Requires `write` scope.
    """
    _validate_org_id(ctx, organization_id)
    manager = await get_uio_manager(organization_id)

    uio_id = await manager.create_uio(
        uio_type=request.type,
        data=request.data,
        source_type=request.source_type,
        source_id=request.source_id,
    )

    return {
        "id": uio_id,
        "type": request.type,
        "status": "draft",
        "message": "UIO created successfully",
    }


@router.patch("/{uio_id}")
async def update_uio(
    uio_id: str,
    organization_id: str,
    updates: dict,
    ctx: APIKeyContext = Depends(require_scope_with_rate_limit(Scope.WRITE)),
):
    """
    Update UIO fields.

    For status changes, use PATCH /{uio_id}/status instead.
    For user corrections, use PATCH /{uio_id}/correct instead.

    Requires `write` scope.
    """
    _validate_org_id(ctx, organization_id)
    # This would directly update fields - simplified implementation
    manager = await get_uio_manager(organization_id)

    # Get current UIO to verify it exists
    uio = await manager.get_uio(uio_id)
    if not uio:
        raise HTTPException(status_code=404, detail="UIO not found")

    # Don't allow status changes via this endpoint
    if "status" in updates:
        raise HTTPException(
            status_code=400,
            detail="Use PATCH /{uio_id}/status for status changes",
        )

    # Apply correction (which handles the update)
    success = await manager.apply_correction(
        uio_id=uio_id,
        corrections=updates,
        user_id="api_update",  # Would come from auth
    )

    if not success:
        raise HTTPException(status_code=500, detail="Failed to update UIO")

    return {
        "id": uio_id,
        "updated": True,
        "fields": list(updates.keys()),
    }


@router.delete("/{uio_id}")
async def delete_uio(
    uio_id: str,
    organization_id: str,
    ctx: APIKeyContext = Depends(require_scope_with_rate_limit(Scope.WRITE)),
):
    """
    Soft delete a UIO (archive it).

    UIOs are never hard deleted - they are archived instead.

    Requires `write` scope.
    """
    _validate_org_id(ctx, organization_id)
    manager = await get_uio_manager(organization_id)

    uio = await manager.get_uio(uio_id)
    if not uio:
        raise HTTPException(status_code=404, detail="UIO not found")

    success = await manager.update_status(
        uio_id=uio_id,
        new_status=UIOStatus.ARCHIVED,
    )

    if not success:
        raise HTTPException(status_code=400, detail="Cannot archive UIO in current state")

    return {
        "id": uio_id,
        "status": "archived",
        "message": "UIO archived successfully",
    }


# =============================================================================
# Status Management
# =============================================================================


@router.patch("/{uio_id}/status")
async def update_status(
    uio_id: str,
    request: StatusChangeRequest,
    organization_id: str | None = None,
    ctx: APIKeyContext = Depends(require_scope_with_rate_limit(Scope.WRITE)),
):
    """
    Change UIO status.

    Valid transitions:
    - draft → active, cancelled
    - active → in_progress, completed, cancelled
    - in_progress → completed, cancelled, active
    - completed → archived
    - cancelled → archived

    Requires `write` scope.
    """
    org_id = organization_id or ctx.organization_id
    if not org_id or org_id == "internal":
        raise HTTPException(status_code=400, detail="organization_id is required")

    _validate_org_id(ctx, org_id)
    manager = await get_uio_manager(org_id)

    uio = await manager.get_uio(uio_id)
    if not uio:
        raise HTTPException(status_code=404, detail="UIO not found")

    new_status = UIOStatus(request.status)
    success = await manager.update_status(
        uio_id=uio_id,
        new_status=new_status,
        user_id=request.user_id,
    )

    if not success:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid status transition from {uio.get('status')} to {request.status}",
        )

    return {
        "id": uio_id,
        "previous_status": uio.get("status"),
        "new_status": request.status,
        "message": "Status updated successfully",
    }


# =============================================================================
# User Corrections
# =============================================================================


@router.patch("/{uio_id}/correct")
async def apply_correction(
    uio_id: str,
    organization_id: str,
    request: CorrectionRequest,
    ctx: APIKeyContext = Depends(require_scope_with_rate_limit(Scope.WRITE)),
):
    """
    Apply user corrections to a UIO.

    Stores the original extraction for training data and
    marks the UIO as user-corrected.

    Requires `write` scope.
    """
    _validate_org_id(ctx, organization_id)
    manager = await get_uio_manager(organization_id)

    uio = await manager.get_uio(uio_id)
    if not uio:
        raise HTTPException(status_code=404, detail="UIO not found")

    success = await manager.apply_correction(
        uio_id=uio_id,
        corrections=request.corrections,
        user_id=request.user_id,
    )

    if not success:
        raise HTTPException(status_code=500, detail="Failed to apply correction")

    return {
        "id": uio_id,
        "corrected": True,
        "corrected_fields": list(request.corrections.keys()),
        "corrected_by": request.user_id,
        "message": "Correction applied successfully",
    }


# =============================================================================
# Merge
# =============================================================================


@router.post("/{uio_id}/merge/{target_uio_id}")
async def merge_uios(
    uio_id: str,
    target_uio_id: str,
    organization_id: str,
    request: MergeRequest | None = None,
    ctx: APIKeyContext = Depends(require_scope_with_rate_limit(Scope.WRITE)),
):
    """
    Merge two UIOs.

    The source UIO (uio_id) will be archived and linked
    to the target UIO via MERGED_INTO relationship.

    Args:
        uio_id: Source UIO (will be archived)
        target_uio_id: Target UIO (will be updated)

    Requires `write` scope.
    """
    _validate_org_id(ctx, organization_id)
    manager = await get_uio_manager(organization_id)

    # Verify both UIOs exist
    source = await manager.get_uio(uio_id)
    if not source:
        raise HTTPException(status_code=404, detail="Source UIO not found")

    target = await manager.get_uio(target_uio_id)
    if not target:
        raise HTTPException(status_code=404, detail="Target UIO not found")

    strategy = request.strategy if request else "newest_wins"
    manual_resolution = request.manual_resolution if request else None

    success = await manager.merge_uios(
        source_uio_id=uio_id,
        target_uio_id=target_uio_id,
        merge_strategy=strategy,
        manual_resolution=manual_resolution,
    )

    if not success:
        raise HTTPException(status_code=500, detail="Failed to merge UIOs")

    return {
        "source_uio_id": uio_id,
        "target_uio_id": target_uio_id,
        "merged": True,
        "strategy": strategy,
        "message": "UIOs merged successfully",
    }


# =============================================================================
# History and Related
# =============================================================================


@router.get("/{uio_id}/history")
async def get_uio_history(
    uio_id: str,
    organization_id: str,
    ctx: APIKeyContext = Depends(require_scope_with_rate_limit(Scope.READ)),
):
    """
    Get status change history for a UIO.

    Requires `read` scope.
    """
    _validate_org_id(ctx, organization_id)
    manager = await get_uio_manager(organization_id)

    uio = await manager.get_uio(uio_id)
    if not uio:
        raise HTTPException(status_code=404, detail="UIO not found")

    history = await manager.get_uio_history(uio_id)

    return {
        "uio_id": uio_id,
        "history": history,
    }


@router.get("/{uio_id}/related")
async def get_related_uios(
    uio_id: str,
    organization_id: str,
    depth: int = Query(1, ge=1, le=3),
    ctx: APIKeyContext = Depends(require_scope_with_rate_limit(Scope.READ)),
):
    """
    Get UIOs related to this one in the graph.

    Follows relationships up to the specified depth.

    Requires `read` scope.
    """
    _validate_org_id(ctx, organization_id)
    manager = await get_uio_manager(organization_id)

    uio = await manager.get_uio(uio_id)
    if not uio:
        raise HTTPException(status_code=404, detail="UIO not found")

    related = await manager.get_related_uios(uio_id, depth=depth)

    return {
        "uio_id": uio_id,
        "related": related,
        "count": len(related),
    }


# =============================================================================
# Type-Specific Mutations
# =============================================================================


@router.post("/{uio_id}/verify", response_model=UIOResponse)
async def verify_uio(
    uio_id: str,
    organization_id: str | None = None,
    ctx: APIKeyContext = Depends(require_scope_with_rate_limit(Scope.WRITE)),
):
    """
    Mark UIO as user-verified (human confirmed AI extraction).

    Sets is_user_verified = True and activates if draft.

    Requires `write` scope.
    """
    from src.db.client import get_db_session
    from sqlalchemy import text

    org_id = organization_id or ctx.organization_id
    if not org_id or org_id == "internal":
        raise HTTPException(status_code=400, detail="organization_id is required")

    _validate_org_id(ctx, org_id)

    try:
        async with get_db_session() as session:
            # Update UIO
            await session.execute(
                text("""
                    UPDATE unified_intelligence_object
                    SET is_user_verified = true,
                        status = CASE WHEN status = 'draft' THEN 'active' ELSE status END,
                        updated_at = NOW()
                    WHERE id = :uio_id AND organization_id = :org_id
                """),
                {"uio_id": uio_id, "org_id": org_id},
            )
            await session.commit()

            # Fetch updated UIO with full data
            result = await session.execute(
                text(f"""
                    {FULL_UIO_QUERY}
                    WHERE u.id = :uio_id AND u.organization_id = :org_id
                """),
                {"uio_id": uio_id, "org_id": org_id},
            )
            row = result.fetchone()
            if not row:
                raise HTTPException(status_code=404, detail="UIO not found")

            return await build_uio_response(row, session)

    except HTTPException:
        raise
    except Exception as e:
        logger.error("Failed to verify UIO", uio_id=uio_id, error=str(e))
        raise HTTPException(status_code=500, detail="Failed to verify UIO")


@router.post("/{uio_id}/snooze", response_model=UIOResponse)
async def snooze_uio(
    uio_id: str,
    request: SnoozeRequest,
    organization_id: str | None = None,
    ctx: APIKeyContext = Depends(require_scope_with_rate_limit(Scope.WRITE)),
):
    """
    Snooze a commitment/task until specified date.

    Sets status to 'snoozed' and updates the snooze_until field.

    Requires `write` scope.
    """
    from src.db.client import get_db_session
    from sqlalchemy import text

    org_id = organization_id or ctx.organization_id
    if not org_id or org_id == "internal":
        raise HTTPException(status_code=400, detail="organization_id is required")

    _validate_org_id(ctx, org_id)

    try:
        async with get_db_session() as session:
            # Check UIO type is commitment or task
            type_result = await session.execute(
                text("""
                    SELECT type FROM unified_intelligence_object
                    WHERE id = :uio_id AND organization_id = :org_id
                """),
                {"uio_id": uio_id, "org_id": org_id},
            )
            type_row = type_result.fetchone()
            if not type_row:
                raise HTTPException(status_code=404, detail="UIO not found")

            if type_row.type not in ("commitment", "task"):
                raise HTTPException(
                    status_code=400,
                    detail="Only commitments and tasks can be snoozed",
                )

            # Update UIO status
            await session.execute(
                text("""
                    UPDATE unified_intelligence_object
                    SET status = 'snoozed',
                        updated_at = NOW()
                    WHERE id = :uio_id AND organization_id = :org_id
                """),
                {"uio_id": uio_id, "org_id": org_id},
            )

            # Update commitment details if commitment
            if type_row.type == "commitment":
                await session.execute(
                    text("""
                        UPDATE uio_commitment_details
                        SET snoozed_until = :snooze_until,
                            status = 'snoozed',
                            updated_at = NOW()
                        WHERE uio_id = :uio_id
                    """),
                    {"uio_id": uio_id, "snooze_until": request.snooze_until},
                )

            await session.commit()

            # Fetch updated UIO
            result = await session.execute(
                text(f"""
                    {FULL_UIO_QUERY}
                    WHERE u.id = :uio_id AND u.organization_id = :org_id
                """),
                {"uio_id": uio_id, "org_id": org_id},
            )
            row = result.fetchone()
            return await build_uio_response(row, session)

    except HTTPException:
        raise
    except Exception as e:
        logger.error("Failed to snooze UIO", uio_id=uio_id, error=str(e))
        raise HTTPException(status_code=500, detail="Failed to snooze UIO")


@router.patch("/{uio_id}/task-status", response_model=UIOResponse)
async def update_task_status(
    uio_id: str,
    request: TaskStatusRequest,
    organization_id: str | None = None,
    ctx: APIKeyContext = Depends(require_scope_with_rate_limit(Scope.WRITE)),
):
    """
    Update task status (Kanban workflow).

    Valid statuses: backlog, todo, in_progress, in_review, done, cancelled

    Requires `write` scope.
    """
    from src.db.client import get_db_session
    from sqlalchemy import text

    org_id = organization_id or ctx.organization_id
    if not org_id or org_id == "internal":
        raise HTTPException(status_code=400, detail="organization_id is required")

    _validate_org_id(ctx, org_id)

    try:
        async with get_db_session() as session:
            # Check UIO is a task
            type_result = await session.execute(
                text("""
                    SELECT type FROM unified_intelligence_object
                    WHERE id = :uio_id AND organization_id = :org_id
                """),
                {"uio_id": uio_id, "org_id": org_id},
            )
            type_row = type_result.fetchone()
            if not type_row:
                raise HTTPException(status_code=404, detail="UIO not found")

            if type_row.type != "task":
                raise HTTPException(status_code=400, detail="This endpoint is only for tasks")

            # Update task details
            await session.execute(
                text("""
                    UPDATE uio_task_details
                    SET status = :status,
                        completed_at = CASE WHEN :status = 'done' THEN NOW() ELSE completed_at END,
                        updated_at = NOW()
                    WHERE uio_id = :uio_id
                """),
                {"uio_id": uio_id, "status": request.status},
            )

            # Map task status to UIO status
            uio_status_map = {
                "backlog": "draft",
                "todo": "active",
                "in_progress": "in_progress",
                "in_review": "in_progress",
                "done": "completed",
                "cancelled": "cancelled",
            }
            uio_status = uio_status_map.get(request.status, "active")

            await session.execute(
                text("""
                    UPDATE unified_intelligence_object
                    SET status = :status,
                        updated_at = NOW()
                    WHERE id = :uio_id
                """),
                {"uio_id": uio_id, "status": uio_status},
            )

            await session.commit()

            # Fetch updated UIO
            result = await session.execute(
                text(f"""
                    {FULL_UIO_QUERY}
                    WHERE u.id = :uio_id AND u.organization_id = :org_id
                """),
                {"uio_id": uio_id, "org_id": org_id},
            )
            row = result.fetchone()
            return await build_uio_response(row, session)

    except HTTPException:
        raise
    except Exception as e:
        logger.error("Failed to update task status", uio_id=uio_id, error=str(e))
        raise HTTPException(status_code=500, detail="Failed to update task status")


@router.patch("/{uio_id}/task-priority", response_model=UIOResponse)
async def update_task_priority(
    uio_id: str,
    request: TaskPriorityRequest,
    organization_id: str | None = None,
    ctx: APIKeyContext = Depends(require_scope_with_rate_limit(Scope.WRITE)),
):
    """
    Update task priority.

    Valid priorities: no_priority, low, medium, high, urgent

    Requires `write` scope.
    """
    from src.db.client import get_db_session
    from sqlalchemy import text

    org_id = organization_id or ctx.organization_id
    if not org_id or org_id == "internal":
        raise HTTPException(status_code=400, detail="organization_id is required")

    _validate_org_id(ctx, org_id)

    try:
        async with get_db_session() as session:
            # Check UIO is a task
            type_result = await session.execute(
                text("""
                    SELECT type FROM unified_intelligence_object
                    WHERE id = :uio_id AND organization_id = :org_id
                """),
                {"uio_id": uio_id, "org_id": org_id},
            )
            type_row = type_result.fetchone()
            if not type_row:
                raise HTTPException(status_code=404, detail="UIO not found")

            if type_row.type != "task":
                raise HTTPException(status_code=400, detail="This endpoint is only for tasks")

            # Update task details
            await session.execute(
                text("""
                    UPDATE uio_task_details
                    SET priority = :priority,
                        updated_at = NOW()
                    WHERE uio_id = :uio_id
                """),
                {"uio_id": uio_id, "priority": request.priority},
            )

            await session.execute(
                text("""
                    UPDATE unified_intelligence_object
                    SET updated_at = NOW()
                    WHERE id = :uio_id
                """),
                {"uio_id": uio_id},
            )

            await session.commit()

            # Fetch updated UIO
            result = await session.execute(
                text(f"""
                    {FULL_UIO_QUERY}
                    WHERE u.id = :uio_id AND u.organization_id = :org_id
                """),
                {"uio_id": uio_id, "org_id": org_id},
            )
            row = result.fetchone()
            return await build_uio_response(row, session)

    except HTTPException:
        raise
    except Exception as e:
        logger.error("Failed to update task priority", uio_id=uio_id, error=str(e))
        raise HTTPException(status_code=500, detail="Failed to update task priority")


@router.patch("/{uio_id}/commitment-priority", response_model=UIOResponse)
async def update_commitment_priority(
    uio_id: str,
    request: CommitmentPriorityRequest,
    organization_id: str | None = None,
    ctx: APIKeyContext = Depends(require_scope_with_rate_limit(Scope.WRITE)),
):
    """
    Update commitment priority.

    Valid priorities: low, medium, high, urgent

    Requires `write` scope.
    """
    from src.db.client import get_db_session
    from sqlalchemy import text

    org_id = organization_id or ctx.organization_id
    if not org_id or org_id == "internal":
        raise HTTPException(status_code=400, detail="organization_id is required")

    _validate_org_id(ctx, org_id)

    try:
        async with get_db_session() as session:
            # Check UIO is a commitment
            type_result = await session.execute(
                text("""
                    SELECT type FROM unified_intelligence_object
                    WHERE id = :uio_id AND organization_id = :org_id
                """),
                {"uio_id": uio_id, "org_id": org_id},
            )
            type_row = type_result.fetchone()
            if not type_row:
                raise HTTPException(status_code=404, detail="UIO not found")

            if type_row.type != "commitment":
                raise HTTPException(status_code=400, detail="This endpoint is only for commitments")

            # Update commitment details
            await session.execute(
                text("""
                    UPDATE uio_commitment_details
                    SET priority = :priority,
                        updated_at = NOW()
                    WHERE uio_id = :uio_id
                """),
                {"uio_id": uio_id, "priority": request.priority},
            )

            await session.execute(
                text("""
                    UPDATE unified_intelligence_object
                    SET updated_at = NOW()
                    WHERE id = :uio_id
                """),
                {"uio_id": uio_id},
            )

            await session.commit()

            # Fetch updated UIO
            result = await session.execute(
                text(f"""
                    {FULL_UIO_QUERY}
                    WHERE u.id = :uio_id AND u.organization_id = :org_id
                """),
                {"uio_id": uio_id, "org_id": org_id},
            )
            row = result.fetchone()
            return await build_uio_response(row, session)

    except HTTPException:
        raise
    except Exception as e:
        logger.error("Failed to update commitment priority", uio_id=uio_id, error=str(e))
        raise HTTPException(status_code=500, detail="Failed to update commitment priority")


@router.patch("/{uio_id}/commitment-direction", response_model=UIOResponse)
async def update_commitment_direction(
    uio_id: str,
    request: CommitmentDirectionRequest,
    organization_id: str | None = None,
    ctx: APIKeyContext = Depends(require_scope_with_rate_limit(Scope.WRITE)),
):
    """
    Change commitment direction (owed_by_me <-> owed_to_me).

    Requires `write` scope.
    """
    from src.db.client import get_db_session
    from sqlalchemy import text

    org_id = organization_id or ctx.organization_id
    if not org_id or org_id == "internal":
        raise HTTPException(status_code=400, detail="organization_id is required")

    _validate_org_id(ctx, org_id)

    try:
        async with get_db_session() as session:
            # Check UIO is a commitment
            type_result = await session.execute(
                text("""
                    SELECT type FROM unified_intelligence_object
                    WHERE id = :uio_id AND organization_id = :org_id
                """),
                {"uio_id": uio_id, "org_id": org_id},
            )
            type_row = type_result.fetchone()
            if not type_row:
                raise HTTPException(status_code=404, detail="UIO not found")

            if type_row.type != "commitment":
                raise HTTPException(status_code=400, detail="This endpoint is only for commitments")

            # Update commitment details
            await session.execute(
                text("""
                    UPDATE uio_commitment_details
                    SET direction = :direction,
                        updated_at = NOW()
                    WHERE uio_id = :uio_id
                """),
                {"uio_id": uio_id, "direction": request.direction},
            )

            await session.execute(
                text("""
                    UPDATE unified_intelligence_object
                    SET updated_at = NOW()
                    WHERE id = :uio_id
                """),
                {"uio_id": uio_id},
            )

            await session.commit()

            # Fetch updated UIO
            result = await session.execute(
                text(f"""
                    {FULL_UIO_QUERY}
                    WHERE u.id = :uio_id AND u.organization_id = :org_id
                """),
                {"uio_id": uio_id, "org_id": org_id},
            )
            row = result.fetchone()
            return await build_uio_response(row, session)

    except HTTPException:
        raise
    except Exception as e:
        logger.error("Failed to update commitment direction", uio_id=uio_id, error=str(e))
        raise HTTPException(status_code=500, detail="Failed to update commitment direction")


@router.post("/{uio_id}/supersede", response_model=UIOResponse)
async def supersede_decision(
    uio_id: str,
    request: SupersedeDecisionRequest,
    organization_id: str | None = None,
    ctx: APIKeyContext = Depends(require_scope_with_rate_limit(Scope.WRITE)),
):
    """
    Mark a decision as superseded by another decision.

    Sets status to 'superseded' and links to the new decision.

    Requires `write` scope.
    """
    from src.db.client import get_db_session
    from sqlalchemy import text

    org_id = organization_id or ctx.organization_id
    if not org_id or org_id == "internal":
        raise HTTPException(status_code=400, detail="organization_id is required")

    _validate_org_id(ctx, org_id)

    try:
        async with get_db_session() as session:
            # Check both UIOs are decisions
            type_result = await session.execute(
                text("""
                    SELECT id, type FROM unified_intelligence_object
                    WHERE id IN (:uio_id, :superseded_by_id) AND organization_id = :org_id
                """),
                {"uio_id": uio_id, "superseded_by_id": request.superseded_by_id, "org_id": org_id},
            )
            rows = type_result.fetchall()

            if len(rows) < 2:
                raise HTTPException(status_code=404, detail="One or both UIOs not found")

            for row in rows:
                if row.type != "decision":
                    raise HTTPException(
                        status_code=400,
                        detail="Both UIOs must be decisions",
                    )

            # Update decision details to mark as superseded
            await session.execute(
                text("""
                    UPDATE uio_decision_details
                    SET superseded_by_uio_id = :superseded_by_id,
                        status = 'superseded',
                        updated_at = NOW()
                    WHERE uio_id = :uio_id
                """),
                {"uio_id": uio_id, "superseded_by_id": request.superseded_by_id},
            )

            # Update the new decision to note what it supersedes
            await session.execute(
                text("""
                    UPDATE uio_decision_details
                    SET supersedes_uio_id = :uio_id,
                        updated_at = NOW()
                    WHERE uio_id = :superseded_by_id
                """),
                {"uio_id": uio_id, "superseded_by_id": request.superseded_by_id},
            )

            # Update UIO status
            await session.execute(
                text("""
                    UPDATE unified_intelligence_object
                    SET status = 'archived',
                        updated_at = NOW()
                    WHERE id = :uio_id
                """),
                {"uio_id": uio_id},
            )

            await session.commit()

            # Fetch updated UIO
            result = await session.execute(
                text(f"""
                    {FULL_UIO_QUERY}
                    WHERE u.id = :uio_id AND u.organization_id = :org_id
                """),
                {"uio_id": uio_id, "org_id": org_id},
            )
            row = result.fetchone()
            return await build_uio_response(row, session)

    except HTTPException:
        raise
    except Exception as e:
        logger.error("Failed to supersede decision", uio_id=uio_id, error=str(e))
        raise HTTPException(status_code=500, detail="Failed to supersede decision")


@router.post("/{uio_id}/supersede-generic", response_model=UIOResponse)
async def supersede_generic(
    uio_id: str,
    request: SupersedeGenericRequest,
    organization_id: str | None = None,
    ctx: APIKeyContext = Depends(require_scope_with_rate_limit(Scope.WRITE)),
):
    """
    Mark a commitment/task/risk as superseded by another of the same type.
    """
    from src.db.client import get_db_session
    from sqlalchemy import text
    from src.graph.client import get_graph_client
    from src.graph.evolution import MemoryEvolution, SupersessionReason
    from src.graph.types import GraphNodeType

    org_id = organization_id or ctx.organization_id
    if not org_id or org_id == "internal":
        raise HTTPException(status_code=400, detail="organization_id is required")

    _validate_org_id(ctx, org_id)

    table_map = {
        "commitment": "uio_commitment_details",
        "task": "uio_task_details",
        "risk": "uio_risk_details",
    }
    table = table_map.get(request.uio_type)
    if not table:
        raise HTTPException(status_code=400, detail="Unsupported uio_type")

    try:
        async with get_db_session() as session:
            type_result = await session.execute(
                text(
                    """
                    SELECT id, type FROM unified_intelligence_object
                    WHERE id IN (:uio_id, :superseded_by_id) AND organization_id = :org_id
                    """
                ),
                {"uio_id": uio_id, "superseded_by_id": request.superseded_by_id, "org_id": org_id},
            )
            rows = type_result.fetchall()

            if len(rows) < 2:
                raise HTTPException(status_code=404, detail="One or both UIOs not found")

            for row in rows:
                if row.type != request.uio_type:
                    raise HTTPException(status_code=400, detail="Both UIOs must be same type")

            await session.execute(
                text(
                    f"""
                    UPDATE {table}
                    SET superseded_by_uio_id = :superseded_by_id,
                        updated_at = NOW()
                    WHERE uio_id = :uio_id
                    """
                ),
                {"uio_id": uio_id, "superseded_by_id": request.superseded_by_id},
            )

            await session.execute(
                text(
                    f"""
                    UPDATE {table}
                    SET supersedes_uio_id = :uio_id,
                        updated_at = NOW()
                    WHERE uio_id = :superseded_by_id
                    """
                ),
                {"uio_id": uio_id, "superseded_by_id": request.superseded_by_id},
            )

            await session.execute(
                text(
                    """
                    UPDATE unified_intelligence_object
                    SET valid_to = NOW(),
                        system_to = NOW(),
                        updated_at = NOW()
                    WHERE id = :uio_id
                    """
                ),
                {"uio_id": uio_id},
            )

            await session.execute(
                text(
                    """
                    INSERT INTO unified_object_timeline (
                        id, unified_object_id,
                        event_type, event_description,
                        previous_value, new_value,
                        source_type, source_id, source_name,
                        message_id, quoted_text,
                        triggered_by, confidence, event_at
                    ) VALUES (
                        :id, :unified_object_id,
                        :event_type, :event_description,
                        :previous_value, :new_value,
                        :source_type, :source_id, :source_name,
                        :message_id, :quoted_text,
                        :triggered_by, :confidence, :event_at
                    )
                    """
                ),
                {
                    "id": str(uuid4()),
                    "unified_object_id": uio_id,
                    "event_type": "superseded",
                    "event_description": f"Superseded by {request.uio_type} {request.superseded_by_id}",
                    "previous_value": None,
                    "new_value": None,
                    "source_type": "user",
                    "source_id": None,
                    "source_name": None,
                    "message_id": None,
                    "quoted_text": None,
                    "triggered_by": ctx.user_id if hasattr(ctx, "user_id") else "system",
                    "confidence": None,
                    "event_at": datetime.now(timezone.utc),
                },
            )

            await session.commit()

            # Update graph supersession
            try:
                graph = await get_graph_client()
                evolution = MemoryEvolution(graph)
                node_map = {
                    "commitment": GraphNodeType.COMMITMENT,
                    "task": GraphNodeType.TASK,
                    "risk": GraphNodeType.RISK,
                }
                await evolution.supersede_node(
                    old_node_id=uio_id,
                    new_node_id=request.superseded_by_id,
                    node_type=node_map[request.uio_type],
                    reason=SupersessionReason.UPDATED,
                )
            except Exception:
                pass

            result = await session.execute(
                text(
                    f"""
                    {FULL_UIO_QUERY}
                    WHERE u.id = :uio_id AND u.organization_id = :org_id
                    """
                ),
                {"uio_id": uio_id, "org_id": org_id},
            )
            row = result.fetchone()
            return await build_uio_response(row, session)

    except HTTPException:
        raise
    except Exception as e:
        logger.error("Failed to supersede UIO", uio_id=uio_id, error=str(e))
        raise HTTPException(status_code=500, detail="Failed to supersede UIO")
