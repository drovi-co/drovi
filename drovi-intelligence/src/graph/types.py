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
    MEETING = "meeting"
    CALL = "call"
    RECORDING = "recording"
    TRANSCRIPT = "transcript"
    GITHUB = "github"
    LINEAR = "linear"
    JIRA = "jira"
    API = "api"
    WEBHOOK = "webhook"
    MANUAL = "manual"
    # CRM sources
    CRM_SALESFORCE = "crm_salesforce"
    CRM_HUBSPOT = "crm_hubspot"
    CRM_PIPEDRIVE = "crm_pipedrive"
    CRM_ZOHO = "crm_zoho"


class IdentityType(str, Enum):
    """Types of identities that can be linked to a contact."""

    EMAIL = "email"
    EMAIL_ALIAS = "email_alias"
    SLACK_ID = "slack_id"
    SLACK_HANDLE = "slack_handle"
    PHONE = "phone"
    WHATSAPP_ID = "whatsapp_id"
    CRM_SALESFORCE = "crm_salesforce"
    CRM_HUBSPOT = "crm_hubspot"
    CRM_PIPEDRIVE = "crm_pipedrive"
    CRM_ZOHO = "crm_zoho"
    LINKEDIN_URL = "linkedin_url"
    TWITTER_HANDLE = "twitter_handle"
    GITHUB_USERNAME = "github_username"
    NOTION_USER_ID = "notion_user_id"
    GOOGLE_ID = "google_id"
    CALENDAR_ATTENDEE_ID = "calendar_attendee_id"
    EXTERNAL_ID = "external_id"


class GraphNodeType(str, Enum):
    """All graph node types."""

    # Core Intelligence
    UIO = "UIO"
    COMMITMENT = "Commitment"
    DECISION = "Decision"
    RISK = "Risk"
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

    # Memory System (from Supermemory/Context Graph research)
    USER_PROFILE = "UserProfile"  # User's memory profile (RAM layer)
    ORGANIZATION_BASELINE = "OrganizationBaseline"  # Statistical baseline for signal detection
    PATTERN = "Pattern"  # Recognition pattern for Klein's RPD

    # Identity Resolution (Contact-First Intelligence)
    IDENTITY = "Identity"  # Cross-source identity linking for contacts

    # Raw Content Layer (Phase 1 - Deeper Graph)
    RAW_MESSAGE = "RawMessage"  # Raw message content for full-text search
    THREAD_CONTEXT = "ThreadContext"  # Thread/conversation aggregation
    COMMUNICATION_EVENT = "CommunicationEvent"  # Communication pattern tracking

    # Live Sessions
    MEETING_SESSION = "MeetingSession"
    CALL_SESSION = "CallSession"
    TRANSCRIPT_SEGMENT = "TranscriptSegment"
    RECORDING = "Recording"


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

    # Knowledge Evolution relationships (NEW - from Supermemory research)
    DERIVED_FROM = "DERIVED_FROM"  # Fact derived from other facts
    CONTRADICTS = "CONTRADICTS"  # Explicit contradiction between facts
    CONFIRMS = "CONFIRMS"  # Fact confirms another fact

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

    # User Profile relationships (NEW)
    PROFILE_OF = "PROFILE_OF"  # UserProfile -> Contact
    VIP_CONTACT = "VIP_CONTACT"  # UserProfile -> Contact (prioritized)
    FOCUSED_ON = "FOCUSED_ON"  # UserProfile -> Project/Topic
    INTERESTED_IN = "INTERESTED_IN"  # UserProfile -> Topic (weighted by recency)

    # Pattern relationships
    LEARNED_FROM = "LEARNED_FROM"  # Pattern -> UIO (source of learning)
    MATCHED = "MATCHED"  # Pattern -> Episode (pattern matched)
    CONFIRMED_BY = "CONFIRMED_BY"  # Pattern -> Contact (user confirmed)
    REJECTED_BY = "REJECTED_BY"  # Pattern -> Contact (user rejected)

    # Identity Resolution relationships (Contact-First Intelligence)
    HAS_IDENTITY = "HAS_IDENTITY"  # Contact -> Identity (contact owns this identity)
    POTENTIAL_MERGE = "POTENTIAL_MERGE"  # Contact -> Contact (suggested merge candidates)
    MERGED_FROM = "MERGED_FROM"  # Contact -> Contact (after merge, source contacts)

    # Raw Content Layer relationships (Phase 1 - Deeper Graph)
    IN_THREAD = "IN_THREAD"  # RawMessage -> ThreadContext
    SENT_BY = "SENT_BY"  # RawMessage -> Contact (sender)
    RECEIVED_BY = "RECEIVED_BY"  # RawMessage -> Contact (recipient)
    COMMUNICATED = "COMMUNICATED"  # CommunicationEvent -> Contact (edge)
    THREAD_PARTICIPANT = "THREAD_PARTICIPANT"  # ThreadContext -> Contact

    # Intelligence Cross-Links (Phase 2 - Wider Graph)
    IMPACTS = "IMPACTS"  # Decision -> Commitment
    THREATENS = "THREATENS"  # Risk -> Decision/Commitment
    FULFILLS = "FULFILLS"  # Task -> Commitment

    # Live session relationships
    IN_SESSION = "IN_SESSION"  # TranscriptSegment -> MeetingSession/CallSession
    SPOKEN_BY = "SPOKEN_BY"  # TranscriptSegment -> Contact
    PARTICIPATED_IN_SESSION = "PARTICIPATED_IN_SESSION"  # Contact -> Session


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

    Extended with knowledge evolution fields from Supermemory research:
    - Temporal validity (valid_from/valid_to)
    - Supersession tracking (superseded_by_id)
    - Derivation chain (derivation_source_ids)
    - Forgetting mechanism (relevance_score, decay_rate)
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
        "fact",  # NEW: For derived/stated facts
    ]
    summary: str | None = None
    aliases: list[str] = Field(default_factory=list)

    # Temporal tracking
    first_seen: datetime
    last_seen: datetime

    # Bi-temporal validity (NEW - from Supermemory)
    valid_from: datetime | None = None  # When this entity became valid
    valid_to: datetime | None = None  # When superseded (None = still valid)

    # Knowledge Evolution (NEW - from Supermemory)
    superseded_by_id: str | None = None  # ID of entity that replaced this
    derivation_source_ids: list[str] = Field(default_factory=list)  # IDs if derived
    derivation_rule: str | None = None  # Rule that created this (e.g., "job_role_inference")

    # Forgetting Mechanism (NEW - from Supermemory)
    relevance_score: float = 1.0  # Decays over time if not accessed
    last_accessed_at: datetime | None = None
    access_count: int = 0
    decay_rate: float = 0.01  # How fast relevance decays

    # Confidence for derived entities
    confidence: float = 1.0

    # Graph Analytics Metrics (from Phase 4 - Smart Graph)
    pagerank_score: float = 0.0  # PageRank-derived importance
    importance_score: float = 0.0  # Computed importance score
    community_id: str | None = None  # CDLP community assignment
    analytics_updated_at: datetime | None = None  # When analytics were last computed

    # Embedding
    embedding: list[float] | None = None


class ContactNode(BaseNode):
    """Contact/person node with intelligence fields."""

    email: str | None = None
    name: str | None = None
    company: str | None = None
    title: str | None = None

    # Graph Analytics Metrics
    importance_score: float = 0.0
    pagerank_score: float = 0.0  # PageRank-derived influence
    betweenness_score: float = 0.0  # Betweenness centrality (bridging)
    community_id: str | None = None
    community_ids: list[str] = Field(default_factory=list)  # Multiple communities
    analytics_updated_at: datetime | None = None  # When analytics were last computed

    # Relationship stats
    interaction_count: int = 0
    last_interaction: datetime | None = None

    # Contact Intelligence (from Contact Intelligence Pipeline)
    lifecycle_stage: Literal[
        "unknown", "lead", "prospect", "opportunity",
        "customer", "churned", "partner", "vendor", "colleague"
    ] = "unknown"
    lifecycle_stage_confidence: float = 0.0

    role_type: Literal[
        "unknown", "decision_maker", "influencer", "gatekeeper",
        "champion", "end_user", "evaluator", "blocker"
    ] = "unknown"
    role_type_confidence: float = 0.0

    seniority_level: Literal[
        "unknown", "intern", "ic", "manager", "senior_manager",
        "director", "vp", "c_level", "founder"
    ] = "unknown"
    seniority_confidence: float = 0.0

    # Communication Profile
    communication_formality: Literal["formal", "casual", "professional"] | None = None
    preferred_channel: Literal["email", "slack", "calendar", "whatsapp", "phone"] | None = None
    timezone_inferred: str | None = None

    # Health and risk
    health_score: float = 0.0
    engagement_score: float = 0.0
    sentiment_score: float = 0.0
    is_vip: bool = False
    is_at_risk: bool = False

    # Intelligence tracking
    last_intelligence_at: datetime | None = None
    intelligence_version: str | None = None

    # Embedding
    embedding: list[float] | None = None


class IdentityNode(BaseNode):
    """
    Identity node for cross-source contact resolution.

    Links various identifiers (email, Slack ID, phone, CRM ID) to contacts.
    Enables the Unified Identity Graph for contact resolution.
    """

    contact_id: str  # The contact this identity belongs to
    identity_type: str  # IdentityType enum value
    identity_value: str  # The actual identifier (email address, Slack ID, etc.)

    # Confidence and verification
    confidence: float = 1.0
    is_verified: bool = False
    verified_at: datetime | None = None

    # Provenance
    source: Literal[
        "email_header", "slack_profile", "crm_sync", "calendar_invite",
        "manual", "ai_inference", "oauth_profile", "api_enrichment"
    ] | None = None
    source_account_id: str | None = None

    # Activity tracking
    last_seen_at: datetime | None = None


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


# ============================================================================
# Memory System Nodes (NEW - from Supermemory/Context Graph research)
# ============================================================================


class UserProfileNode(BaseNode):
    """
    User's memory profile - the 'RAM layer' always included in context.

    From Supermemory research: This provides default context that should
    ALWAYS be available to the AI, not just retrieved on demand.

    Contains:
    - Static context: User-configured, rarely changes (name, role, priorities)
    - Dynamic context: Computed frequently (current focus, recent topics, mood)
    """

    user_id: str  # Links to auth user
    contact_id: str | None = None  # Links to ContactNode

    # STATIC CONTEXT (user-configured, rarely changes)
    name: str
    role: str | None = None
    timezone: str | None = None
    communication_style: Literal["direct", "diplomatic", "detailed"] | None = None
    priorities: list[str] = Field(default_factory=list)  # ["product launches", "investor relations"]
    vip_contact_ids: list[str] = Field(default_factory=list)  # ContactNode IDs to always highlight

    # DYNAMIC CONTEXT (computed, refreshed frequently)
    current_focus: list[str] = Field(default_factory=list)  # Inferred from recent activity
    recent_topics: list[str] = Field(default_factory=list)  # From last 24h conversations
    active_project_ids: list[str] = Field(default_factory=list)  # Project entities user is involved in
    mood_indicator: Literal["busy", "stressed", "normal", "relaxed"] | None = None

    # Open items summary (computed)
    unread_commitments_count: int = 0
    overdue_commitments_count: int = 0
    pending_decisions_count: int = 0

    # Embeddings for matching
    static_embedding: list[float] | None = None  # 1536 dims
    dynamic_embedding: list[float] | None = None  # 1536 dims

    # Refresh tracking
    static_updated_at: datetime | None = None
    dynamic_updated_at: datetime | None = None
    dynamic_refresh_needed: bool = False


class StatWindow(BaseModel):
    """Statistical window for baseline tracking."""

    mean: float = 0.0
    std: float = 1.0
    count: int = 0
    last_updated: datetime | None = None


class OrganizationBaselineNode(BaseNode):
    """
    Statistical baseline for an organization - used for signal vs noise detection.

    From Wheeler's Statistical Process Control research:
    - Track rolling statistics to establish "normal" variation
    - Deviations > 2σ indicate special cause (signal)
    - Deviations within 2σ indicate common cause (noise)
    """

    # Rolling statistics (last 90 days)
    commitments_per_week: StatWindow = Field(default_factory=StatWindow)
    decisions_per_week: StatWindow = Field(default_factory=StatWindow)
    tasks_per_week: StatWindow = Field(default_factory=StatWindow)
    risks_per_week: StatWindow = Field(default_factory=StatWindow)

    # By category breakdowns
    commitments_by_priority: dict[str, StatWindow] = Field(default_factory=dict)
    commitments_by_direction: dict[str, StatWindow] = Field(default_factory=dict)
    decisions_by_topic: dict[str, StatWindow] = Field(default_factory=dict)
    risks_by_severity: dict[str, StatWindow] = Field(default_factory=dict)

    # Entity emergence tracking
    new_entities_per_week: StatWindow = Field(default_factory=StatWindow)
    new_topics_per_week: StatWindow = Field(default_factory=StatWindow)
    new_contacts_per_week: StatWindow = Field(default_factory=StatWindow)

    # Baseline window
    baseline_start_date: datetime | None = None
    baseline_end_date: datetime | None = None
    sample_count: int = 0


class PatternNode(BaseNode):
    """
    Recognition pattern for Klein's Recognition-Primed Decisions.

    From Klein's research: Experts don't analyze, they RECOGNIZE patterns.
    This captures domain-specific patterns that indicate significant situations.

    Matching is two-stage:
    1. Semantic: Compare episode embedding to trigger_embedding
    2. Structural: Run trigger_cypher pattern against graph
    """

    name: str
    description: str | None = None

    # Pattern matching (Cypher template)
    trigger_cypher: str | None = None  # Cypher pattern to match
    # Example: "MATCH (c:Contact)-[:MENTIONED_IN]->(ep:Episode)
    #          WHERE ep.content CONTAINS 'urgent' AND c.pagerank_score > 0.5"

    # Semantic triggers (vector-based)
    trigger_embedding: list[float] | None = None  # 1536 dims
    semantic_threshold: float = 0.8

    # Klein's RPD components
    salient_features: list[str] = Field(default_factory=list)  # What makes this distinctive
    typical_expectations: list[str] = Field(default_factory=list)  # What usually happens next
    typical_action: str | None = None  # Default response
    plausible_goals: list[str] = Field(default_factory=list)  # Why this matters

    # Domain and confidence
    domain: Literal["sales", "engineering", "legal", "hr", "finance", "general"] | None = None
    confidence_threshold: float = 0.7
    confidence_boost: float = 0.15  # How much to boost matching intelligence

    # Learning metrics
    created_by_user_id: str | None = None
    times_matched: int = 0
    times_confirmed: int = 0
    times_rejected: int = 0
    accuracy_rate: float = 1.0  # times_confirmed / (times_confirmed + times_rejected)

    is_active: bool = True


# ============================================================================
# Raw Content Layer Nodes (Phase 1 - Deeper Graph)
# ============================================================================


class RawMessageNode(BaseNode):
    """
    Raw message content for full-text search and provenance tracking.

    Stores the original message content from any source, enabling:
    - Full-text search across all communications
    - Evidence linking for extracted intelligence
    - Thread reconstruction
    - Temporal analysis
    """

    # Content
    content: str
    content_html: str | None = None  # Preserve HTML for rich formatting
    subject: str | None = None

    # Source metadata
    source_type: SourceType
    source_id: str  # External ID from source system
    source_account_id: str | None = None  # Account this came from

    # Participants
    sender_contact_id: str | None = None
    sender_email: str | None = None
    sender_name: str | None = None
    recipient_contact_ids: list[str] = Field(default_factory=list)
    recipient_emails: list[str] = Field(default_factory=list)
    cc_contact_ids: list[str] = Field(default_factory=list)
    bcc_contact_ids: list[str] = Field(default_factory=list)

    # Threading
    thread_id: str | None = None  # Links to ThreadContextNode
    in_reply_to_id: str | None = None  # Previous message in thread
    references: list[str] = Field(default_factory=list)  # Message-ID references

    # Temporal
    sent_at: datetime
    received_at: datetime | None = None

    # Multi-source specifics
    channel_id: str | None = None  # Slack channel
    channel_name: str | None = None
    page_id: str | None = None  # Notion page
    doc_id: str | None = None  # Google doc
    event_id: str | None = None  # Calendar event

    # Attachments
    has_attachments: bool = False
    attachment_count: int = 0
    attachment_names: list[str] = Field(default_factory=list)

    # Analysis flags
    is_processed: bool = False  # Intelligence extracted
    processed_at: datetime | None = None
    extraction_version: str | None = None

    # Embedding for semantic search
    embedding: list[float] | None = None

    # Metadata
    metadata: dict = Field(default_factory=dict)


class ThreadContextNode(BaseNode):
    """
    Thread/conversation aggregation for context tracking.

    Aggregates messages in a thread to provide:
    - High-level thread summary
    - Participant tracking
    - Thread health metrics
    - Quick access to thread intelligence
    """

    # Thread identification
    thread_id: str  # External thread ID
    source_type: SourceType

    # Subject and summary
    subject: str | None = None
    summary: str | None = None  # AI-generated summary
    summary_updated_at: datetime | None = None

    # Participants
    participant_contact_ids: list[str] = Field(default_factory=list)
    participant_count: int = 0
    initiator_contact_id: str | None = None

    # Message counts
    message_count: int = 0
    unread_count: int = 0

    # Temporal bounds
    first_message_at: datetime
    last_message_at: datetime
    last_activity_at: datetime | None = None

    # Thread state
    status: Literal["active", "stale", "closed", "archived"] = "active"
    is_starred: bool = False
    is_important: bool = False

    # Intelligence aggregation
    commitment_count: int = 0
    decision_count: int = 0
    open_question_count: int = 0
    risk_count: int = 0

    # Urgency/priority (computed)
    urgency_score: float = 0.0
    priority: Literal["low", "medium", "high", "urgent"] = "medium"

    # Labels/categories
    labels: list[str] = Field(default_factory=list)
    topic_ids: list[str] = Field(default_factory=list)

    # Embedding for semantic search
    embedding: list[float] | None = None


class CommunicationEventNode(BaseNode):
    """
    Communication pattern tracking for relationship intelligence.

    Captures individual communication events to enable:
    - Communication frequency analysis
    - Relationship strength computation
    - Response time patterns
    - Sentiment trajectory tracking
    """

    # Event type
    event_type: Literal[
        "email_sent",
        "email_received",
        "slack_message",
        "slack_mention",
        "meeting_scheduled",
        "meeting_attended",
        "call",
        "document_shared",
        "comment",
    ]

    # Participants
    from_contact_id: str
    to_contact_ids: list[str] = Field(default_factory=list)

    # Source
    source_type: SourceType
    source_id: str | None = None  # Links to RawMessage or event

    # Temporal
    occurred_at: datetime

    # Channel
    channel: Literal["email", "slack", "calendar", "whatsapp", "notion", "gdocs", "phone"] | None = None
    channel_id: str | None = None

    # Response tracking
    is_response: bool = False
    response_to_event_id: str | None = None
    response_time_seconds: int | None = None

    # Sentiment (if analyzed)
    sentiment_score: float | None = None  # -1 to 1
    sentiment_label: Literal["negative", "neutral", "positive"] | None = None

    # Metadata
    message_length: int | None = None
    has_attachments: bool = False
    is_first_contact: bool = False  # First communication with this person


# ============================================================================
# Confidence Tier Enum (Phase 1 - Tiered Confidence System)
# ============================================================================


class ConfidenceTier(str, Enum):
    """
    Tiered confidence system for intelligence storage.

    Replaces binary filtering with tiered storage:
    - HIGH: Full indexing, primary results
    - MEDIUM: Indexed, secondary results
    - LOW: Stored but de-prioritized
    - SPECULATIVE: Stored, flagged for review
    """

    HIGH = "high"  # >= 0.80 confidence
    MEDIUM = "medium"  # 0.50 - 0.80 confidence
    LOW = "low"  # 0.20 - 0.50 confidence
    SPECULATIVE = "speculative"  # < 0.20 confidence


def get_confidence_tier(confidence: float) -> ConfidenceTier:
    """Determine confidence tier from score."""
    if confidence >= 0.80:
        return ConfidenceTier.HIGH
    if confidence >= 0.50:
        return ConfidenceTier.MEDIUM
    if confidence >= 0.20:
        return ConfidenceTier.LOW
    return ConfidenceTier.SPECULATIVE
