"""
Intelligence State Definition

Defines the state schema for the LangGraph orchestrator.
This state flows through all nodes in the extraction pipeline.
"""

from datetime import datetime
from enum import Enum
from typing import Annotated, Literal
from uuid import uuid4

from pydantic import BaseModel, Field


# =============================================================================
# UIO (Universal Intelligence Object) Lifecycle
# =============================================================================


class UIOStatus(str, Enum):
    """UIO lifecycle states."""

    DRAFT = "draft"  # Just extracted, pending review
    ACTIVE = "active"  # Confirmed and active
    IN_PROGRESS = "in_progress"  # Being worked on
    COMPLETED = "completed"  # Done/fulfilled
    CANCELLED = "cancelled"  # No longer relevant
    ARCHIVED = "archived"  # Historical reference


class UIOBase(BaseModel):
    """Base class for all UIOs with common lifecycle fields."""

    id: str = Field(default_factory=lambda: str(uuid4()))
    status: UIOStatus = UIOStatus.DRAFT

    # Temporal tracking
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)
    status_changed_at: datetime | None = None
    completed_at: datetime | None = None

    # Provenance
    source_type: str = "api"
    source_id: str | None = None
    conversation_id: str | None = None
    episode_id: str | None = None  # Link to Graphiti episode

    # Confidence & Review
    confidence: float = 0.0
    needs_review: bool = True
    reviewed_by: str | None = None
    reviewed_at: datetime | None = None

    # User corrections
    user_corrected: bool = False
    original_extraction: dict | None = None  # Store original if corrected


# =============================================================================
# Input Types
# =============================================================================


class AnalysisInput(BaseModel):
    """Input for intelligence analysis."""

    organization_id: str
    content: str
    source_type: Literal[
        "email", "slack", "notion", "google_docs", "whatsapp", "calendar", "api", "manual"
    ] = "api"
    source_id: str | None = None
    source_account_id: str | None = None
    conversation_id: str | None = None
    message_ids: list[str] | None = None
    user_email: str | None = None
    user_name: str | None = None


class ParsedMessage(BaseModel):
    """A parsed message from the input content."""

    id: str
    content: str
    sender_email: str | None = None
    sender_name: str | None = None
    sent_at: datetime | None = None
    is_from_user: bool = False


# =============================================================================
# Extracted Types
# =============================================================================


class ExtractedClaim(BaseModel):
    """A claim extracted from content."""

    id: str = Field(default_factory=lambda: str(uuid4()))
    type: Literal[
        "fact", "promise", "request", "question", "decision",
        "opinion", "deadline", "price", "contact_info", "reference", "action_item"
    ]
    content: str
    quoted_text: str
    confidence: float
    source_message_id: str | None = None
    importance: Literal["low", "medium", "high"] = "medium"


class ExtractedCommitment(BaseModel):
    """A commitment extracted from content."""

    id: str = Field(default_factory=lambda: str(uuid4()))
    title: str
    description: str | None = None
    direction: Literal["owed_by_me", "owed_to_me"]
    priority: Literal["low", "medium", "high", "urgent"] = "medium"

    # Parties
    debtor_name: str | None = None
    debtor_email: str | None = None
    debtor_is_user: bool = False
    creditor_name: str | None = None
    creditor_email: str | None = None
    creditor_is_user: bool = False

    # Due date
    due_date: datetime | None = None
    due_date_text: str | None = None
    due_date_confidence: float = 0.0
    due_date_is_explicit: bool = False

    # Conditional
    is_conditional: bool = False
    condition: str | None = None

    # Evidence
    quoted_text: str
    confidence: float
    reasoning: str | None = None

    # Linked claim
    claim_id: str | None = None


class ExtractedDecision(BaseModel):
    """A decision extracted from content."""

    id: str = Field(default_factory=lambda: str(uuid4()))
    title: str
    statement: str
    rationale: str | None = None

    # Decision maker
    decision_maker_name: str | None = None
    decision_maker_email: str | None = None
    decision_maker_is_user: bool = False

    # Status
    status: Literal["made", "pending", "deferred", "reversed"] = "made"

    # Related items
    stakeholders: list[str] = Field(default_factory=list)
    dependencies: list[str] = Field(default_factory=list)
    implications: list[str] = Field(default_factory=list)

    # Evidence
    quoted_text: str
    confidence: float
    reasoning: str | None = None

    # Linked claim
    claim_id: str | None = None


class DetectedRisk(BaseModel):
    """A detected risk or issue."""

    id: str = Field(default_factory=lambda: str(uuid4()))
    type: Literal[
        "deadline_risk", "commitment_conflict", "unclear_ownership",
        "missing_information", "escalation_needed", "policy_violation",
        "financial_risk", "relationship_risk", "sensitive_data",
        "contradiction", "fraud_signal", "other"
    ]
    title: str
    description: str
    severity: Literal["low", "medium", "high", "critical"]

    # Related items
    related_to: list[dict] = Field(default_factory=list)  # [{type, reference}]

    # Action
    suggested_action: str | None = None

    # Evidence
    quoted_text: str | None = None
    confidence: float
    reasoning: str | None = None


class ExtractedTopic(BaseModel):
    """A topic extracted from content."""

    id: str = Field(default_factory=lambda: str(uuid4()))
    name: str
    confidence: float


class ExtractedTask(BaseModel):
    """
    A task extracted from content for Kanban board.

    Tasks are actionable items that can be tracked, assigned, and completed.
    They are often derived from commitments but can also be standalone.
    """

    id: str = Field(default_factory=lambda: str(uuid4()))
    title: str
    description: str | None = None
    status: Literal["todo", "in_progress", "done", "blocked"] = "todo"
    priority: Literal["low", "medium", "high", "urgent"] = "medium"

    # Ownership
    assignee_name: str | None = None
    assignee_email: str | None = None
    assignee_is_user: bool = False
    created_by_name: str | None = None
    created_by_email: str | None = None

    # Timeline
    due_date: datetime | None = None
    due_date_text: str | None = None  # Original text like "by Friday"
    due_date_confidence: float = 0.0
    estimated_effort: str | None = None  # "1h", "2d", etc.

    # Dependencies
    depends_on: list[str] = Field(default_factory=list)  # Task IDs
    blocks: list[str] = Field(default_factory=list)  # Task IDs

    # Relationships
    commitment_id: str | None = None  # If derived from a commitment
    parent_task_id: str | None = None  # For subtasks
    subtask_ids: list[str] = Field(default_factory=list)

    # Context
    project: str | None = None  # Inferred project/topic
    tags: list[str] = Field(default_factory=list)

    # Evidence
    quoted_text: str
    confidence: float
    reasoning: str | None = None

    # Source tracking
    source_message_id: str | None = None


class ExtractedContact(BaseModel):
    """
    A contact extracted from content for entity resolution.

    Used to track people mentioned in communications and link them
    across different sources (email, Slack, etc.).
    """

    id: str = Field(default_factory=lambda: str(uuid4()))
    name: str
    email: str | None = None
    phone: str | None = None

    # Aliases and alternative identifiers
    aliases: list[str] = Field(default_factory=list)
    slack_id: str | None = None
    slack_handle: str | None = None

    # Role/relationship context
    role: str | None = None
    company: str | None = None
    relationship: str | None = None  # "colleague", "client", "vendor", etc.

    # Source tracking
    source_type: str | None = None
    first_seen_at: datetime = Field(default_factory=datetime.utcnow)
    last_seen_at: datetime = Field(default_factory=datetime.utcnow)

    # Confidence
    confidence: float = 0.0


# =============================================================================
# Aggregated Extracted Intelligence
# =============================================================================


class ExtractedIntelligence(BaseModel):
    """All extracted intelligence from analysis."""

    claims: list[ExtractedClaim] = Field(default_factory=list)
    commitments: list[ExtractedCommitment] = Field(default_factory=list)
    decisions: list[ExtractedDecision] = Field(default_factory=list)
    tasks: list[ExtractedTask] = Field(default_factory=list)
    topics: list[ExtractedTopic] = Field(default_factory=list)
    risks: list[DetectedRisk] = Field(default_factory=list)
    contacts: list[ExtractedContact] = Field(default_factory=list)


# =============================================================================
# Classification
# =============================================================================


class Classification(BaseModel):
    """Content classification results."""

    has_intelligence: bool = False
    has_commitments: bool = False
    has_decisions: bool = False
    has_claims: bool = False
    has_risks: bool = False
    has_questions: bool = False

    intent: str | None = None
    topics: list[str] = Field(default_factory=list)
    urgency: float = 0.0  # 0-1
    importance: float = 0.0  # 0-1
    sentiment: float = 0.0  # -1 to 1

    confidence: float = 0.0
    reasoning: str | None = None


# =============================================================================
# Confidence
# =============================================================================


class Confidence(BaseModel):
    """Confidence metrics for the analysis."""

    overall: float = 0.0
    by_type: dict[str, float] = Field(default_factory=dict)
    needs_review: bool = False
    review_reason: str | None = None


# =============================================================================
# Routing
# =============================================================================


class Routing(BaseModel):
    """Routing decisions for conditional execution."""

    should_extract_commitments: bool = True
    should_extract_decisions: bool = True
    should_analyze_risk: bool = True
    should_deduplicate: bool = True
    escalate_to_human: bool = False
    skip_remaining_nodes: bool = False


# =============================================================================
# Deduplication
# =============================================================================


class MergeCandidate(BaseModel):
    """A potential merge candidate from deduplication."""

    new_item_id: str
    existing_uio_id: str
    similarity: float
    should_merge: bool


class Deduplication(BaseModel):
    """Deduplication results."""

    existing_uio_ids: list[str] = Field(default_factory=list)
    merge_candidates: list[MergeCandidate] = Field(default_factory=list)


# =============================================================================
# Brief (Thread Summary)
# =============================================================================


class Brief(BaseModel):
    """Generated brief summary for the conversation."""

    brief_summary: str | None = None  # 3-line contextual brief
    suggested_action: str | None = None  # respond, review, delegate, etc.
    suggested_action_reason: str | None = None
    open_loops: list[dict] = Field(default_factory=list)  # Unanswered questions
    has_open_loops: bool = False
    open_loop_count: int = 0
    priority_tier: str = "medium"  # urgent, high, medium, low


# =============================================================================
# Output
# =============================================================================


class Output(BaseModel):
    """Final output of the analysis."""

    uios_created: list[dict] = Field(default_factory=list)  # [{id, type}]
    uios_merged: list[dict] = Field(default_factory=list)  # [{sourceId, targetId}]
    tasks_created: list[dict] = Field(default_factory=list)  # [{id, title}]
    claims_created: list[dict] = Field(default_factory=list)  # [{id, type}]
    contacts_created: list[dict] = Field(default_factory=list)  # [{id, email}]


# =============================================================================
# Trace
# =============================================================================


class LLMCall(BaseModel):
    """Record of an LLM API call."""

    id: str = Field(default_factory=lambda: str(uuid4()))
    node: str
    model: str
    prompt_tokens: int = 0
    completion_tokens: int = 0
    duration_ms: int = 0


class NodeTiming(BaseModel):
    """Timing for a single node execution."""

    started_at: float
    completed_at: float | None = None


class Trace(BaseModel):
    """Execution trace for debugging and monitoring."""

    started_at: float = Field(default_factory=lambda: datetime.utcnow().timestamp())
    completed_at: float | None = None
    nodes: list[str] = Field(default_factory=list)
    current_node: str | None = None
    node_timings: dict[str, NodeTiming] = Field(default_factory=dict)
    llm_calls: list[LLMCall] = Field(default_factory=list)
    errors: list[str] = Field(default_factory=list)


# =============================================================================
# Main Intelligence State
# =============================================================================


def merge_lists(left: list, right: list) -> list:
    """Merge two lists by concatenation."""
    return left + right


class IntelligenceState(BaseModel):
    """
    Main state object that flows through the LangGraph orchestrator.

    This state accumulates intelligence as it passes through each node.
    """

    # Unique analysis ID
    analysis_id: str = Field(default_factory=lambda: str(uuid4()))

    # Input
    input: AnalysisInput

    # Parsed messages
    messages: list[ParsedMessage] = Field(default_factory=list)

    # Classification
    classification: Classification = Field(default_factory=Classification)

    # Brief (thread summary)
    brief: Brief = Field(default_factory=Brief)

    # Extracted intelligence
    extracted: ExtractedIntelligence = Field(default_factory=ExtractedIntelligence)

    # Confidence
    confidence: Confidence = Field(default_factory=Confidence)

    # Routing
    routing: Routing = Field(default_factory=Routing)

    # Deduplication
    deduplication: Deduplication = Field(default_factory=Deduplication)

    # Output
    output: Output = Field(default_factory=Output)

    # Trace
    trace: Trace = Field(default_factory=Trace)

    class Config:
        """Pydantic config."""

        arbitrary_types_allowed = True
