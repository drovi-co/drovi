"""
UIO Pydantic Schemas

Type-safe schemas for creating and managing UIOs with their extension details.
These match the PostgreSQL tables defined in the TypeScript schema.
"""

from datetime import datetime
from enum import Enum
from typing import Literal
from uuid import uuid4

from pydantic import BaseModel, Field


# =============================================================================
# Enums
# =============================================================================


class UIOType(str, Enum):
    """Types of unified intelligence objects."""

    COMMITMENT = "commitment"
    DECISION = "decision"
    CLAIM = "claim"
    TASK = "task"
    RISK = "risk"
    BRIEF = "brief"
    TOPIC = "topic"
    PROJECT = "project"


class UIOStatus(str, Enum):
    """Status of unified intelligence objects."""

    ACTIVE = "active"
    MERGED = "merged"
    ARCHIVED = "archived"
    DISMISSED = "dismissed"


class CommitmentDirection(str, Enum):
    """Direction of commitment."""

    OWED_BY_ME = "owed_by_me"
    OWED_TO_ME = "owed_to_me"


class CommitmentPriority(str, Enum):
    """Priority levels for commitments."""

    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"
    URGENT = "urgent"


class CommitmentStatus(str, Enum):
    """Status for commitments."""

    PENDING = "pending"
    IN_PROGRESS = "in_progress"
    COMPLETED = "completed"
    CANCELLED = "cancelled"
    OVERDUE = "overdue"
    WAITING = "waiting"
    SNOOZED = "snoozed"


class DecisionStatus(str, Enum):
    """Status for decisions."""

    MADE = "made"
    PENDING = "pending"
    DEFERRED = "deferred"
    REVERSED = "reversed"


class TaskStatus(str, Enum):
    """Status for tasks."""

    BACKLOG = "backlog"
    TODO = "todo"
    IN_PROGRESS = "in_progress"
    IN_REVIEW = "in_review"
    DONE = "done"
    CANCELLED = "cancelled"


class TaskPriority(str, Enum):
    """Priority for tasks."""

    NO_PRIORITY = "no_priority"
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"
    URGENT = "urgent"


class RiskType(str, Enum):
    """Types of risks."""

    DEADLINE_RISK = "deadline_risk"
    COMMITMENT_CONFLICT = "commitment_conflict"
    UNCLEAR_OWNERSHIP = "unclear_ownership"
    MISSING_INFORMATION = "missing_information"
    ESCALATION_NEEDED = "escalation_needed"
    POLICY_VIOLATION = "policy_violation"
    FINANCIAL_RISK = "financial_risk"
    RELATIONSHIP_RISK = "relationship_risk"
    SENSITIVE_DATA = "sensitive_data"
    CONTRADICTION = "contradiction"
    FRAUD_SIGNAL = "fraud_signal"
    OTHER = "other"


class RiskSeverity(str, Enum):
    """Severity levels for risks."""

    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"
    CRITICAL = "critical"


class BriefAction(str, Enum):
    """Suggested actions for briefs."""

    RESPOND = "respond"
    REVIEW = "review"
    DELEGATE = "delegate"
    SCHEDULE = "schedule"
    WAIT = "wait"
    ESCALATE = "escalate"
    ARCHIVE = "archive"
    FOLLOW_UP = "follow_up"
    NONE = "none"


class BriefPriority(str, Enum):
    """Priority tiers for briefs."""

    URGENT = "urgent"
    HIGH = "high"
    MEDIUM = "medium"
    LOW = "low"


class ClaimType(str, Enum):
    """Types of claims."""

    FACT = "fact"
    PROMISE = "promise"
    REQUEST = "request"
    QUESTION = "question"
    DECISION = "decision"
    OPINION = "opinion"
    DEADLINE = "deadline"
    PRICE = "price"
    CONTACT_INFO = "contact_info"
    REFERENCE = "reference"
    ACTION_ITEM = "action_item"


class ClaimImportance(str, Enum):
    """Importance levels for claims."""

    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"


# =============================================================================
# Source Context
# =============================================================================


class SourceContext(BaseModel):
    """Context about where intelligence was extracted from."""

    source_type: Literal[
        "email",
        "slack",
        "calendar",
        "whatsapp",
        "notion",
        "google_docs",
        "meeting",
        "call",
        "recording",
        "transcript",
        "api",
        "manual",
    ]
    source_account_id: str | None = None
    conversation_id: str | None = None
    message_id: str | None = None
    quoted_text: str | None = None
    quoted_text_start: str | None = None
    quoted_text_end: str | None = None
    confidence: float = 0.5


# =============================================================================
# Base UIO Schema
# =============================================================================


class UIOBase(BaseModel):
    """Base schema for creating a UIO."""

    organization_id: str
    type: UIOType
    canonical_title: str
    canonical_description: str | None = None
    due_date: datetime | None = None
    due_date_confidence: float | None = None
    owner_contact_id: str | None = None
    participant_contact_ids: list[str] = Field(default_factory=list)
    overall_confidence: float = 0.5
    is_user_verified: bool = False
    is_user_dismissed: bool = False


class UIOCreate(UIOBase):
    """Schema for creating a new UIO."""

    id: str = Field(default_factory=lambda: str(uuid4()))
    status: UIOStatus = UIOStatus.ACTIVE
    first_seen_at: datetime = Field(default_factory=datetime.utcnow)
    last_updated_at: datetime = Field(default_factory=datetime.utcnow)


# =============================================================================
# Commitment Details
# =============================================================================


class CommitmentExtractionContext(BaseModel):
    """LLM extraction context for commitments."""

    reasoning: str | None = None
    quoted_text: str | None = None
    commitment_type: Literal["promise", "request"] | None = None
    model_used: str | None = None


class CommitmentDetailsCreate(BaseModel):
    """Schema for creating commitment details."""

    direction: CommitmentDirection
    debtor_contact_id: str | None = None
    creditor_contact_id: str | None = None
    due_date_source: Literal["explicit", "inferred", "user_set"] | None = None
    due_date_original_text: str | None = None
    priority: CommitmentPriority = CommitmentPriority.MEDIUM
    status: CommitmentStatus = CommitmentStatus.PENDING
    is_conditional: bool = False
    condition: str | None = None
    completed_at: datetime | None = None
    completed_via: Literal["user_action", "detected", "auto"] | None = None
    snoozed_until: datetime | None = None
    supersedes_uio_id: str | None = None
    superseded_by_uio_id: str | None = None
    extraction_context: CommitmentExtractionContext | None = None


# =============================================================================
# Decision Details
# =============================================================================


class DecisionAlternative(BaseModel):
    """Alternative considered in a decision."""

    title: str
    description: str | None = None
    pros: list[str] = Field(default_factory=list)
    cons: list[str] = Field(default_factory=list)
    rejected: bool = False


class DecisionExtractionContext(BaseModel):
    """LLM extraction context for decisions."""

    reasoning: str | None = None
    quoted_text: str | None = None
    model_used: str | None = None


class DecisionDetailsCreate(BaseModel):
    """Schema for creating decision details."""

    statement: str
    rationale: str | None = None
    alternatives: list[DecisionAlternative] = Field(default_factory=list)
    decision_maker_contact_id: str | None = None
    stakeholder_contact_ids: list[str] = Field(default_factory=list)
    impact_areas: list[str] = Field(default_factory=list)
    status: DecisionStatus = DecisionStatus.MADE
    decided_at: datetime | None = None
    supersedes_uio_id: str | None = None
    superseded_by_uio_id: str | None = None
    extraction_context: DecisionExtractionContext | None = None


# =============================================================================
# Claim Details
# =============================================================================


class ClaimExtractionContext(BaseModel):
    """LLM extraction context for claims."""

    entities: list[dict] = Field(default_factory=list)  # [{type, value}]
    temporal_references: list[str] = Field(default_factory=list)
    related_claim_ids: list[str] = Field(default_factory=list)
    model_used: str | None = None


class ClaimDetailsCreate(BaseModel):
    """Schema for creating claim details."""

    claim_type: ClaimType
    quoted_text: str | None = None
    quoted_text_start: str | None = None
    quoted_text_end: str | None = None
    normalized_text: str | None = None
    importance: ClaimImportance = ClaimImportance.MEDIUM
    source_message_index: str | None = None
    extraction_context: ClaimExtractionContext | None = None


# =============================================================================
# Task Details
# =============================================================================


class TaskUserOverrides(BaseModel):
    """User overrides for tasks."""

    title: str | None = None
    description: str | None = None
    due_date: str | None = None
    priority: str | None = None
    status: str | None = None


class TaskDetailsCreate(BaseModel):
    """Schema for creating task details."""

    status: TaskStatus = TaskStatus.TODO
    priority: TaskPriority = TaskPriority.MEDIUM
    assignee_contact_id: str | None = None
    created_by_contact_id: str | None = None
    estimated_effort: str | None = None  # "1h", "2d", "1 week"
    completed_at: datetime | None = None
    depends_on_uio_ids: list[str] = Field(default_factory=list)
    blocks_uio_ids: list[str] = Field(default_factory=list)
    parent_task_uio_id: str | None = None
    commitment_uio_id: str | None = None
    supersedes_uio_id: str | None = None
    superseded_by_uio_id: str | None = None
    project: str | None = None
    tags: list[str] = Field(default_factory=list)
    user_overrides: TaskUserOverrides | None = None


# =============================================================================
# Risk Details
# =============================================================================


class RiskFindings(BaseModel):
    """Detailed findings for a risk."""

    description: str | None = None
    evidence: list[str] = Field(default_factory=list)
    affected_parties: list[str] = Field(default_factory=list)
    potential_impact: str | None = None
    mitigation_steps: list[str] = Field(default_factory=list)


class RiskExtractionContext(BaseModel):
    """LLM extraction context for risks."""

    reasoning: str | None = None
    quoted_text: str | None = None
    model_used: str | None = None


class RiskDetailsCreate(BaseModel):
    """Schema for creating risk details."""

    risk_type: RiskType
    severity: RiskSeverity
    related_commitment_uio_ids: list[str] = Field(default_factory=list)
    related_decision_uio_ids: list[str] = Field(default_factory=list)
    suggested_action: str | None = None
    findings: RiskFindings | None = None
    supersedes_uio_id: str | None = None
    superseded_by_uio_id: str | None = None
    extraction_context: RiskExtractionContext | None = None


# =============================================================================
# Brief Details
# =============================================================================


class OpenLoop(BaseModel):
    """An open loop (unanswered question or pending item)."""

    description: str
    owner: str | None = None
    is_blocking: bool = False


class BriefDetailsCreate(BaseModel):
    """Schema for creating brief details."""

    summary: str
    suggested_action: BriefAction
    action_reasoning: str | None = None
    open_loops: list[OpenLoop] = Field(default_factory=list)
    priority_tier: BriefPriority
    urgency_score: float = 0.0
    importance_score: float = 0.0
    sentiment_score: float = 0.0  # -1 to 1
    intent_classification: str | None = None
    conversation_id: str | None = None


# =============================================================================
# Unified Create Request
# =============================================================================


class CreateCommitmentUIO(BaseModel):
    """Request to create a commitment UIO with details."""

    base: UIOCreate
    details: CommitmentDetailsCreate
    source: SourceContext


class CreateDecisionUIO(BaseModel):
    """Request to create a decision UIO with details."""

    base: UIOCreate
    details: DecisionDetailsCreate
    source: SourceContext


class CreateClaimUIO(BaseModel):
    """Request to create a claim UIO with details."""

    base: UIOCreate
    details: ClaimDetailsCreate
    source: SourceContext


class CreateTaskUIO(BaseModel):
    """Request to create a task UIO with details."""

    base: UIOCreate
    details: TaskDetailsCreate
    source: SourceContext


class CreateRiskUIO(BaseModel):
    """Request to create a risk UIO with details."""

    base: UIOCreate
    details: RiskDetailsCreate
    source: SourceContext


class CreateBriefUIO(BaseModel):
    """Request to create a brief UIO with details."""

    base: UIOCreate
    details: BriefDetailsCreate
    source: SourceContext


# Type alias for any UIO creation request
UIOCreateRequest = (
    CreateCommitmentUIO
    | CreateDecisionUIO
    | CreateClaimUIO
    | CreateTaskUIO
    | CreateRiskUIO
    | CreateBriefUIO
)
