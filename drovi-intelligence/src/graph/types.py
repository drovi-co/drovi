"""Graph node and relationship type definitions."""

from datetime import datetime
from enum import Enum
from typing import Literal

from pydantic import BaseModel, Field


class SourceType(str, Enum):
    """Multi-source data types."""

    EMAIL = "email"
    SLACK = "slack"
    NOTION = "notion"
    GOOGLE_DOCS = "google_docs"
    WHATSAPP = "whatsapp"
    CALENDAR = "calendar"
    GITHUB = "github"
    LINEAR = "linear"
    JIRA = "jira"
    API = "api"
    WEBHOOK = "webhook"
    MANUAL = "manual"


class GraphNodeType(str, Enum):
    """All graph node types."""

    # Core Intelligence
    UIO = "UIO"
    COMMITMENT = "Commitment"
    DECISION = "Decision"
    TOPIC = "Topic"
    PROJECT = "Project"

    # Entities
    CONTACT = "Contact"
    CONVERSATION = "Conversation"
    MESSAGE = "Message"
    TASK = "Task"
    CLAIM = "Claim"
    ORGANIZATION = "Organization"

    # Agentic Memory
    EPISODE = "Episode"
    ENTITY = "Entity"

    # Multi-source
    SLACK_CHANNEL = "SlackChannel"
    NOTION_PAGE = "NotionPage"
    GOOGLE_DOC = "GoogleDoc"
    WHATSAPP_GROUP = "WhatsAppGroup"
    CALENDAR_EVENT = "CalendarEvent"


class GraphRelationshipType(str, Enum):
    """All graph relationship types."""

    # Core relationships
    ORIGINATED_FROM = "ORIGINATED_FROM"
    MENTIONED_IN = "MENTIONED_IN"
    OWNED_BY = "OWNED_BY"
    INVOLVES = "INVOLVES"
    SUPERSEDES = "SUPERSEDES"
    DEPENDS_ON = "DEPENDS_ON"
    RELATED_TO = "RELATED_TO"
    MERGED_INTO = "MERGED_INTO"
    TRACKS = "TRACKS"
    PARTICIPATED_IN = "PARTICIPATED_IN"
    COMMUNICATES_WITH = "COMMUNICATES_WITH"
    REPLIES_TO = "REPLIES_TO"
    EXTRACTED_FROM = "EXTRACTED_FROM"
    BELONGS_TO = "BELONGS_TO"

    # Agentic Memory relationships
    RECORDED_IN = "RECORDED_IN"
    ENTITY_IN = "ENTITY_IN"
    OCCURRED_AFTER = "OCCURRED_AFTER"
    REFERENCES = "REFERENCES"
    DISCUSSED_IN = "DISCUSSED_IN"

    # Multi-source relationships
    MEMBER_OF = "MEMBER_OF"
    HAS_ACCESS_TO = "HAS_ACCESS_TO"
    ATTENDEE_OF = "ATTENDEE_OF"


# ============================================================================
# Node Models
# ============================================================================


class BaseNode(BaseModel):
    """Base class for all graph nodes."""

    id: str
    organization_id: str
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)


class EpisodeNode(BaseNode):
    """
    Episode node for agentic memory.
    Represents a temporal snapshot of information from any source.
    """

    name: str
    content: str
    summary: str | None = None
    source_type: SourceType
    source_id: str

    # Bi-temporal model
    reference_time: datetime  # When this actually happened
    recorded_at: datetime  # When we learned about it
    valid_from: datetime | None = None
    valid_to: datetime | None = None  # None = still valid

    # Participants
    participants: list[str] = Field(default_factory=list)  # Contact IDs

    # Confidence
    confidence: float = 1.0

    # Source-specific metadata
    thread_id: str | None = None
    channel_id: str | None = None
    page_id: str | None = None
    doc_id: str | None = None
    group_id: str | None = None
    event_id: str | None = None

    # Embedding for vector search
    embedding: list[float] | None = None


class EntityNode(BaseNode):
    """
    Entity node for semantic memory.
    Represents a concept, person, project, or topic extracted from episodes.
    """

    name: str
    entity_type: Literal[
        "person",
        "organization",
        "project",
        "location",
        "event",
        "document",
        "topic",
        "preference",
        "requirement",
        "procedure",
    ]
    summary: str | None = None
    aliases: list[str] = Field(default_factory=list)

    # Temporal tracking
    first_seen: datetime
    last_seen: datetime

    # Embedding
    embedding: list[float] | None = None


class ContactNode(BaseNode):
    """Contact/person node."""

    email: str | None = None
    name: str | None = None
    company: str | None = None
    title: str | None = None

    # Metrics
    importance_score: float = 0.0
    pagerank_score: float = 0.0
    betweenness_score: float = 0.0
    community_id: str | None = None

    # Relationship stats
    interaction_count: int = 0
    last_interaction: datetime | None = None

    # Embedding
    embedding: list[float] | None = None


class CommitmentNode(BaseNode):
    """Commitment (promise/request) node."""

    title: str
    description: str | None = None
    direction: Literal["owed_by_me", "owed_to_me"]
    status: Literal["pending", "in_progress", "completed", "cancelled", "overdue"]
    priority: Literal["low", "medium", "high", "urgent"]

    # Parties
    debtor_contact_id: str | None = None
    creditor_contact_id: str | None = None

    # Due date
    due_date: datetime | None = None
    due_date_confidence: float = 0.0

    # Confidence
    confidence: float = 1.0

    # Embedding
    embedding: list[float] | None = None


class DecisionNode(BaseNode):
    """Decision node."""

    title: str
    statement: str
    rationale: str | None = None

    # Parties
    owner_contact_id: str | None = None
    participant_contact_ids: list[str] = Field(default_factory=list)

    # Status
    status: Literal["made", "pending", "deferred", "reversed"] = "made"

    # Confidence
    confidence: float = 1.0

    # Supersession
    supersedes_id: str | None = None

    # Embedding
    embedding: list[float] | None = None
