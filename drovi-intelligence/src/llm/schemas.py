"""
Pydantic Output Schemas for LLM Structured Outputs

These schemas define the expected output format from LLM calls,
enabling type-safe extraction with validation.
"""

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field


# =============================================================================
# Evidence Span Schema
# =============================================================================


class EvidenceSpanSchema(BaseModel):
    """Schema for supporting evidence spans."""

    quoted_text: str = Field(description="Exact supporting quote")
    quoted_text_start: int | None = Field(
        default=None,
        description="0-based start index of quoted_text within CONTENT"
    )
    quoted_text_end: int | None = Field(
        default=None,
        description="0-based end index of quoted_text within CONTENT"
    )


# =============================================================================
# Classification Schema
# =============================================================================


class ClassificationOutput(BaseModel):
    """Output schema for content classification."""

    has_intelligence: bool = Field(
        description="Whether the content contains any extractable intelligence"
    )
    has_commitments: bool = Field(
        description="Whether the content contains commitments or promises"
    )
    has_decisions: bool = Field(
        description="Whether the content contains decisions"
    )
    has_claims: bool = Field(
        description="Whether the content contains factual claims"
    )
    has_risks: bool = Field(
        description="Whether the content contains potential risks"
    )
    has_questions: bool = Field(
        description="Whether the content contains questions that need answers"
    )

    intent: str | None = Field(
        default=None,
        description="The primary intent of the content (informing, requesting, confirming, etc.)"
    )
    topics: list[str] = Field(
        default_factory=list,
        description="Key topics mentioned in the content"
    )
    urgency: float = Field(
        default=0.0,
        ge=0.0,
        le=1.0,
        description="Urgency score from 0 (not urgent) to 1 (very urgent)"
    )
    importance: float = Field(
        default=0.0,
        ge=0.0,
        le=1.0,
        description="Importance score from 0 (not important) to 1 (very important)"
    )
    sentiment: float = Field(
        default=0.0,
        ge=-1.0,
        le=1.0,
        description="Sentiment score from -1 (negative) to 1 (positive)"
    )

    confidence: float = Field(
        ge=0.0,
        le=1.0,
        description="Confidence in this classification"
    )
    reasoning: str | None = Field(
        default=None,
        description="Brief explanation of classification reasoning"
    )


# =============================================================================
# Claim Extraction Schema
# =============================================================================


class ExtractedClaimSchema(BaseModel):
    """Schema for a single extracted claim."""

    type: Literal[
        "fact", "promise", "request", "question", "decision",
        "opinion", "deadline", "price", "contact_info", "reference", "action_item"
    ] = Field(description="Type of claim")

    content: str = Field(description="The claim content in clear, concise language")

    quoted_text: str = Field(
        description="The exact text from the source that supports this claim"
    )
    quoted_text_start: int | None = Field(
        default=None,
        description="0-based start index of quoted_text within CONTENT"
    )
    quoted_text_end: int | None = Field(
        default=None,
        description="0-based end index of quoted_text within CONTENT"
    )

    confidence: float = Field(
        ge=0.0,
        le=1.0,
        description="Confidence in this extraction"
    )

    importance: Literal["low", "medium", "high"] = Field(
        default="medium",
        description="Importance level of this claim"
    )

    source_message_index: int | None = Field(
        default=None,
        description="Index of the message this claim came from (if applicable)"
    )


class ClaimExtractionOutput(BaseModel):
    """Output schema for claim extraction."""

    claims: list[ExtractedClaimSchema] = Field(
        default_factory=list,
        description="List of extracted claims"
    )


# =============================================================================
# Commitment Extraction Schema
# =============================================================================


class ExtractedCommitmentSchema(BaseModel):
    """Schema for a single extracted commitment."""

    title: str = Field(description="Short title for the commitment")

    description: str | None = Field(
        default=None,
        description="Detailed description of what was committed"
    )

    direction: Literal["owed_by_me", "owed_to_me"] = Field(
        description="Whether the user owes this or is owed this"
    )

    priority: Literal["low", "medium", "high", "urgent"] = Field(
        default="medium",
        description="Priority level"
    )

    # Parties
    debtor_name: str | None = Field(
        default=None,
        description="Name of person who owes this"
    )
    debtor_email: str | None = Field(
        default=None,
        description="Email of person who owes this"
    )
    debtor_is_user: bool = Field(
        default=False,
        description="Whether the debtor is the user"
    )

    creditor_name: str | None = Field(
        default=None,
        description="Name of person who is owed this"
    )
    creditor_email: str | None = Field(
        default=None,
        description="Email of person who is owed this"
    )
    creditor_is_user: bool = Field(
        default=False,
        description="Whether the creditor is the user"
    )

    # Due date
    due_date: datetime | None = Field(
        default=None,
        description="Due date if explicitly stated (ISO format)"
    )
    due_date_text: str | None = Field(
        default=None,
        description="Original text mentioning the due date"
    )
    due_date_confidence: float = Field(
        default=0.0,
        ge=0.0,
        le=1.0,
        description="Confidence in the due date extraction"
    )
    due_date_is_explicit: bool = Field(
        default=False,
        description="Whether the due date was explicitly stated"
    )

    # Conditional
    is_conditional: bool = Field(
        default=False,
        description="Whether this commitment is conditional"
    )
    condition: str | None = Field(
        default=None,
        description="The condition if conditional"
    )

    # Evidence
    quoted_text: str = Field(
        description="The exact text that shows this commitment"
    )
    quoted_text_start: int | None = Field(
        default=None,
        description="0-based start index of quoted_text within CONTENT"
    )
    quoted_text_end: int | None = Field(
        default=None,
        description="0-based end index of quoted_text within CONTENT"
    )
    confidence: float = Field(
        ge=0.0,
        le=1.0,
        description="Confidence in this extraction"
    )
    reasoning: str | None = Field(
        default=None,
        description="Why this was identified as a commitment"
    )
    supporting_quotes: list[EvidenceSpanSchema] = Field(
        default_factory=list,
        description="Additional quoted spans that support this commitment (from other messages)"
    )

    # Link to claim
    claim_index: int | None = Field(
        default=None,
        description="Index of the related claim in the claims list"
    )


class CommitmentExtractionOutput(BaseModel):
    """Output schema for commitment extraction."""

    commitments: list[ExtractedCommitmentSchema] = Field(
        default_factory=list,
        description="List of extracted commitments"
    )


class CommitmentFulfillmentSchema(BaseModel):
    """Schema for a fulfilled commitment match."""

    commitment_id: str = Field(description="ID of the commitment that was fulfilled")
    evidence_quote: str = Field(description="Exact quote indicating fulfillment")
    confidence: float = Field(ge=0.0, le=1.0, description="Confidence in fulfillment match")
    reason: str | None = Field(default=None, description="Short reason for the fulfillment match")


class CommitmentFulfillmentOutput(BaseModel):
    """Output schema for commitment fulfillment detection."""

    fulfilled: list[CommitmentFulfillmentSchema] = Field(
        default_factory=list,
        description="List of commitments fulfilled by the content"
    )


# =============================================================================
# Decision Extraction Schema
# =============================================================================


class ExtractedDecisionSchema(BaseModel):
    """Schema for a single extracted decision."""

    title: str = Field(description="Short title for the decision")

    statement: str = Field(description="The decision statement")

    rationale: str | None = Field(
        default=None,
        description="Reasoning behind the decision"
    )

    # Decision maker
    decision_maker_name: str | None = Field(
        default=None,
        description="Name of person who made the decision"
    )
    decision_maker_email: str | None = Field(
        default=None,
        description="Email of person who made the decision"
    )
    decision_maker_is_user: bool = Field(
        default=False,
        description="Whether the user made this decision"
    )

    # Status
    status: Literal["made", "pending", "deferred", "reversed"] = Field(
        default="made",
        description="Current status of the decision"
    )

    # Related items
    stakeholders: list[str] = Field(
        default_factory=list,
        description="People affected by this decision"
    )
    dependencies: list[str] = Field(
        default_factory=list,
        description="Things this decision depends on"
    )
    implications: list[str] = Field(
        default_factory=list,
        description="Consequences of this decision"
    )

    # Evidence
    quoted_text: str = Field(
        description="The exact text showing this decision"
    )
    quoted_text_start: int | None = Field(
        default=None,
        description="0-based start index of quoted_text within CONTENT"
    )
    quoted_text_end: int | None = Field(
        default=None,
        description="0-based end index of quoted_text within CONTENT"
    )
    confidence: float = Field(
        ge=0.0,
        le=1.0,
        description="Confidence in this extraction"
    )
    reasoning: str | None = Field(
        default=None,
        description="Why this was identified as a decision"
    )
    supporting_quotes: list[EvidenceSpanSchema] = Field(
        default_factory=list,
        description="Additional quoted spans that support this decision (from other messages)"
    )

    # Link to claim
    claim_index: int | None = Field(
        default=None,
        description="Index of the related claim in the claims list"
    )


class DecisionExtractionOutput(BaseModel):
    """Output schema for decision extraction."""

    decisions: list[ExtractedDecisionSchema] = Field(
        default_factory=list,
        description="List of extracted decisions"
    )


# =============================================================================
# Risk Detection Schema
# =============================================================================


class DetectedRiskSchema(BaseModel):
    """Schema for a detected risk."""

    type: Literal[
        "deadline_risk", "commitment_conflict", "unclear_ownership",
        "missing_information", "escalation_needed", "policy_violation",
        "financial_risk", "relationship_risk", "sensitive_data",
        "contradiction", "fraud_signal", "other"
    ] = Field(description="Type of risk")

    title: str = Field(description="Short title for the risk")

    description: str = Field(description="Detailed description of the risk")

    severity: Literal["low", "medium", "high", "critical"] = Field(
        description="Severity level"
    )

    # Related items
    related_commitment_indices: list[int] = Field(
        default_factory=list,
        description="Indices of related commitments"
    )
    related_decision_indices: list[int] = Field(
        default_factory=list,
        description="Indices of related decisions"
    )

    # Action
    suggested_action: str | None = Field(
        default=None,
        description="Suggested action to mitigate this risk"
    )

    # Evidence
    quoted_text: str | None = Field(
        default=None,
        description="Text supporting this risk detection"
    )
    quoted_text_start: int | None = Field(
        default=None,
        description="0-based start index of quoted_text within CONTENT"
    )
    quoted_text_end: int | None = Field(
        default=None,
        description="0-based end index of quoted_text within CONTENT"
    )
    confidence: float = Field(
        ge=0.0,
        le=1.0,
        description="Confidence in this detection"
    )
    reasoning: str | None = Field(
        default=None,
        description="Why this was identified as a risk"
    )


class RiskDetectionOutput(BaseModel):
    """Output schema for risk detection."""

    risks: list[DetectedRiskSchema] = Field(
        default_factory=list,
        description="List of detected risks"
    )


# =============================================================================
# Task Extraction Schema
# =============================================================================


class ExtractedTaskSchema(BaseModel):
    """Schema for a single extracted task."""

    title: str = Field(description="Clear, actionable task title")

    description: str | None = Field(
        default=None,
        description="Detailed description of what needs to be done"
    )

    status: Literal["todo", "in_progress", "done", "blocked"] = Field(
        default="todo",
        description="Current status of the task"
    )

    priority: Literal["low", "medium", "high", "urgent"] = Field(
        default="medium",
        description="Priority level"
    )

    # Ownership
    assignee_name: str | None = Field(
        default=None,
        description="Name of person assigned to this task"
    )
    assignee_email: str | None = Field(
        default=None,
        description="Email of person assigned to this task"
    )
    assignee_is_user: bool = Field(
        default=False,
        description="Whether the task is assigned to the user"
    )
    created_by_name: str | None = Field(
        default=None,
        description="Name of person who created/requested this task"
    )
    created_by_email: str | None = Field(
        default=None,
        description="Email of person who created/requested this task"
    )

    # Timeline
    due_date: datetime | None = Field(
        default=None,
        description="Due date if explicitly stated (ISO format)"
    )
    due_date_text: str | None = Field(
        default=None,
        description="Original text mentioning the due date (e.g., 'by Friday')"
    )
    due_date_confidence: float = Field(
        default=0.0,
        ge=0.0,
        le=1.0,
        description="Confidence in the due date extraction"
    )
    estimated_effort: str | None = Field(
        default=None,
        description="Estimated effort (e.g., '1h', '2d', '1 week')"
    )

    # Dependencies
    depends_on_task_indices: list[int] = Field(
        default_factory=list,
        description="Indices of tasks this depends on (in the same extraction)"
    )
    blocks_task_indices: list[int] = Field(
        default_factory=list,
        description="Indices of tasks this blocks (in the same extraction)"
    )

    # Relationships
    commitment_index: int | None = Field(
        default=None,
        description="Index of the related commitment (if derived from one)"
    )
    is_subtask: bool = Field(
        default=False,
        description="Whether this is a subtask of another task"
    )
    parent_task_index: int | None = Field(
        default=None,
        description="Index of parent task if this is a subtask"
    )

    # Context
    project: str | None = Field(
        default=None,
        description="Inferred project or topic this task belongs to"
    )
    tags: list[str] = Field(
        default_factory=list,
        description="Tags or labels for categorization"
    )

    # Evidence
    quoted_text: str = Field(
        description="The exact text that indicates this task"
    )
    quoted_text_start: int | None = Field(
        default=None,
        description="0-based start index of quoted_text within CONTENT"
    )
    quoted_text_end: int | None = Field(
        default=None,
        description="0-based end index of quoted_text within CONTENT"
    )
    confidence: float = Field(
        ge=0.0,
        le=1.0,
        description="Confidence in this extraction"
    )
    reasoning: str | None = Field(
        default=None,
        description="Why this was identified as a task"
    )


class TaskExtractionOutput(BaseModel):
    """Output schema for task extraction."""

    tasks: list[ExtractedTaskSchema] = Field(
        default_factory=list,
        description="List of extracted tasks"
    )


# =============================================================================
# Contact Extraction Schema
# =============================================================================


class ExtractedContactSchema(BaseModel):
    """Schema for a single extracted contact."""

    name: str = Field(description="Full name of the contact")

    email: str | None = Field(
        default=None,
        description="Email address if available"
    )

    phone: str | None = Field(
        default=None,
        description="Phone number if available"
    )

    aliases: list[str] = Field(
        default_factory=list,
        description="Alternative names or nicknames"
    )

    slack_handle: str | None = Field(
        default=None,
        description="Slack handle (e.g., @john)"
    )

    role: str | None = Field(
        default=None,
        description="Job role or title if mentioned"
    )

    company: str | None = Field(
        default=None,
        description="Company or organization if mentioned"
    )

    relationship: Literal[
        "colleague", "manager", "report", "client", "vendor",
        "partner", "unknown"
    ] | None = Field(
        default=None,
        description="Relationship to the user"
    )

    confidence: float = Field(
        ge=0.0,
        le=1.0,
        description="Confidence in this extraction"
    )


class ContactExtractionOutput(BaseModel):
    """Output schema for contact extraction."""

    contacts: list[ExtractedContactSchema] = Field(
        default_factory=list,
        description="List of extracted contacts"
    )
