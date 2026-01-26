"""
Contact Intelligence Pipeline State

Defines the state schema for the contact intelligence LangGraph pipeline.
This pipeline performs deep analysis of individual contacts to generate
relationship intelligence, communication profiles, and lifecycle insights.

Runs: Daily for all contacts, on-demand for specific contacts.
"""

from datetime import datetime
from enum import Enum
from typing import Literal
from uuid import uuid4

from pydantic import BaseModel, Field


# =============================================================================
# ENUMS
# =============================================================================


class LifecycleStage(str, Enum):
    """Contact lifecycle stages."""

    UNKNOWN = "unknown"
    LEAD = "lead"
    PROSPECT = "prospect"
    OPPORTUNITY = "opportunity"
    CUSTOMER = "customer"
    CHURNED = "churned"
    FORMER = "former"


class RoleType(str, Enum):
    """Contact role types in the organization."""

    UNKNOWN = "unknown"
    DECISION_MAKER = "decision_maker"
    INFLUENCER = "influencer"
    GATEKEEPER = "gatekeeper"
    CHAMPION = "champion"
    END_USER = "end_user"
    TECHNICAL = "technical"
    EXECUTIVE = "executive"


class SeniorityLevel(str, Enum):
    """Estimated seniority level."""

    UNKNOWN = "unknown"
    C_LEVEL = "c_level"
    VP = "vp"
    DIRECTOR = "director"
    MANAGER = "manager"
    IC = "ic"  # Individual contributor
    INTERN = "intern"


class FormalityLevel(str, Enum):
    """Communication formality level."""

    FORMAL = "formal"
    PROFESSIONAL = "professional"
    CASUAL = "casual"
    MIXED = "mixed"


class PreferredChannel(str, Enum):
    """Preferred communication channel."""

    EMAIL = "email"
    SLACK = "slack"
    CALENDAR = "calendar"
    WHATSAPP = "whatsapp"
    UNKNOWN = "unknown"


# =============================================================================
# INPUT
# =============================================================================


class ContactIntelligenceInput(BaseModel):
    """Input for contact intelligence analysis."""

    organization_id: str
    contact_id: str

    # Optional: limit analysis to specific time range
    since_date: datetime | None = None
    until_date: datetime | None = None

    # Control flags
    force_refresh: bool = False  # Recompute even if recent analysis exists
    include_graph_analytics: bool = True  # Run expensive graph computations


# =============================================================================
# LOADED DATA
# =============================================================================


class InteractionRecord(BaseModel):
    """A single interaction with the contact."""

    id: str
    source_type: Literal["email", "slack", "calendar", "whatsapp", "notion"]
    timestamp: datetime
    direction: Literal["inbound", "outbound"]  # From contact or to contact

    # Content summary
    subject: str | None = None
    snippet: str | None = None
    word_count: int = 0

    # Response tracking
    response_time_minutes: float | None = None  # Time to respond (if applicable)
    was_responded_to: bool | None = None

    # Sentiment (if analyzed)
    sentiment_score: float | None = None  # -1 to 1

    # Thread/conversation context
    thread_id: str | None = None
    is_thread_starter: bool = False


class CommitmentRecord(BaseModel):
    """A commitment involving this contact."""

    id: str
    title: str
    direction: Literal["owed_by_contact", "owed_to_contact"]
    status: str
    due_date: datetime | None = None
    created_at: datetime


class DecisionRecord(BaseModel):
    """A decision involving this contact."""

    id: str
    title: str
    is_decision_maker: bool
    decided_at: datetime | None = None


class LoadedContactData(BaseModel):
    """All data loaded for the contact."""

    contact_id: str
    contact_email: str
    contact_name: str | None = None
    contact_company: str | None = None
    contact_title: str | None = None

    # Interactions across all sources
    interactions: list[InteractionRecord] = Field(default_factory=list)

    # Related intelligence
    commitments: list[CommitmentRecord] = Field(default_factory=list)
    decisions: list[DecisionRecord] = Field(default_factory=list)

    # Network data (for graph analytics)
    mutual_contact_ids: list[str] = Field(default_factory=list)
    shared_thread_contact_ids: list[str] = Field(default_factory=list)

    # Metadata
    first_interaction_at: datetime | None = None
    last_interaction_at: datetime | None = None
    total_interactions: int = 0


# =============================================================================
# COMPUTED METRICS
# =============================================================================


class RelationshipMetrics(BaseModel):
    """Computed relationship metrics."""

    # Volume
    interaction_count: int = 0
    inbound_count: int = 0  # From contact
    outbound_count: int = 0  # To contact

    # Response metrics
    avg_response_time_minutes: float | None = None
    response_rate: float = 0.0  # 0-1, how often they respond

    # Frequency
    interactions_per_week: float = 0.0
    interactions_per_month: float = 0.0

    # Recency
    days_since_last_interaction: int | None = None
    days_since_first_interaction: int | None = None

    # Sentiment
    sentiment_trend: list[float] = Field(default_factory=list)  # Last N periods
    avg_sentiment: float = 0.0
    sentiment_direction: Literal["improving", "stable", "declining"] = "stable"

    # Engagement
    thread_participation_rate: float = 0.0  # How often they engage in threads
    avg_message_length: float = 0.0

    # Computed scores
    frequency_score: float = 0.0  # 0-1
    recency_score: float = 0.0  # 0-1
    engagement_score: float = 0.0  # 0-1
    strength_score: float = 0.0  # 0-1 (overall relationship strength)


class CommunicationProfile(BaseModel):
    """Profiled communication style."""

    formality_level: FormalityLevel = FormalityLevel.MIXED
    formality_confidence: float = 0.0

    preferred_channel: PreferredChannel = PreferredChannel.UNKNOWN
    channel_confidence: float = 0.0

    # Activity patterns
    active_hours: list[int] = Field(default_factory=list)  # 0-23
    active_days: list[int] = Field(default_factory=list)  # 0-6 (Mon-Sun)
    timezone_inferred: str | None = None

    # Communication characteristics
    avg_words_per_message: float = 0.0
    uses_greetings: bool = True
    uses_signatures: bool = True
    emoji_usage: Literal["none", "minimal", "moderate", "frequent"] = "minimal"

    # Response patterns
    typical_response_time: str | None = None  # "within an hour", "same day", etc.
    prefers_quick_replies: bool = False


class RoleDetection(BaseModel):
    """Detected role and influence."""

    role_type: RoleType = RoleType.UNKNOWN
    role_confidence: float = 0.0

    seniority_estimate: SeniorityLevel = SeniorityLevel.UNKNOWN
    seniority_confidence: float = 0.0

    # Influence indicators
    makes_decisions: bool = False
    approves_commitments: bool = False
    delegates_tasks: bool = False
    receives_reports: bool = False

    # Evidence
    role_indicators: list[str] = Field(default_factory=list)


class LifecycleDetection(BaseModel):
    """Inferred lifecycle stage."""

    stage: LifecycleStage = LifecycleStage.UNKNOWN
    confidence: float = 0.0

    # Risk indicators
    churn_risk_score: float = 0.0  # 0-1
    churn_risk_factors: list[str] = Field(default_factory=list)

    # Opportunity indicators
    expansion_potential: float = 0.0  # 0-1
    expansion_signals: list[str] = Field(default_factory=list)

    # Evidence
    stage_indicators: list[str] = Field(default_factory=list)


class GraphAnalytics(BaseModel):
    """Graph-based analytics."""

    # Centrality metrics
    pagerank_score: float = 0.0  # Influence in network
    betweenness_centrality: float = 0.0  # Bridge between groups
    degree_centrality: float = 0.0  # Direct connections

    # Community
    community_ids: list[str] = Field(default_factory=list)
    primary_community_id: str | None = None

    # Network position
    is_hub: bool = False  # Many connections
    is_bridge: bool = False  # Connects communities
    is_peripheral: bool = False  # Few connections

    # Influence
    influence_score: float = 0.0  # 0-1 combined
    bridging_score: float = 0.0  # 0-1 combined


class ContactBrief(BaseModel):
    """Generated executive summary for the contact."""

    # Summary
    brief_summary: str  # 2-3 sentence overview
    relationship_status: Literal[
        "strong", "healthy", "neutral", "needs_attention", "at_risk"
    ]

    # Key insights
    key_insights: list[str] = Field(default_factory=list)  # 3-5 bullet points

    # Recommended actions
    suggested_actions: list[str] = Field(default_factory=list)

    # Open items
    open_commitments_summary: str | None = None
    pending_decisions_summary: str | None = None

    # Talking points (for meetings)
    talking_points: list[str] = Field(default_factory=list)

    # Generated timestamp
    generated_at: datetime = Field(default_factory=datetime.utcnow)


# =============================================================================
# OUTPUT
# =============================================================================


class ContactIntelligenceOutput(BaseModel):
    """Final output of contact intelligence analysis."""

    contact_id: str
    organization_id: str

    # Computed intelligence
    relationship_metrics: RelationshipMetrics
    communication_profile: CommunicationProfile
    role_detection: RoleDetection
    lifecycle_detection: LifecycleDetection
    graph_analytics: GraphAnalytics | None = None
    brief: ContactBrief

    # Aggregate scores (for quick filtering)
    health_score: float = 0.0  # 0-1
    importance_score: float = 0.0  # 0-1
    engagement_score: float = 0.0  # 0-1

    # Flags
    is_vip: bool = False
    is_at_risk: bool = False
    needs_attention: bool = False

    # Metadata
    analysis_id: str
    analyzed_at: datetime
    analysis_duration_ms: int = 0


# =============================================================================
# TRACE
# =============================================================================


class NodeTiming(BaseModel):
    """Timing for a single node execution."""

    started_at: float
    completed_at: float | None = None
    duration_ms: int | None = None


class Trace(BaseModel):
    """Execution trace for debugging and monitoring."""

    started_at: float = Field(default_factory=lambda: datetime.utcnow().timestamp())
    completed_at: float | None = None
    nodes: list[str] = Field(default_factory=list)
    current_node: str | None = None
    node_timings: dict[str, NodeTiming] = Field(default_factory=dict)
    errors: list[str] = Field(default_factory=list)


# =============================================================================
# MAIN STATE
# =============================================================================


class ContactIntelligenceState(BaseModel):
    """
    Main state object for the contact intelligence pipeline.

    This state flows through all nodes to build up contact intelligence.
    """

    # Unique analysis ID
    analysis_id: str = Field(default_factory=lambda: str(uuid4()))

    # Input
    input: ContactIntelligenceInput

    # Loaded data
    loaded_data: LoadedContactData | None = None

    # Computed intelligence (built up through pipeline)
    relationship_metrics: RelationshipMetrics = Field(
        default_factory=RelationshipMetrics
    )
    communication_profile: CommunicationProfile = Field(
        default_factory=CommunicationProfile
    )
    role_detection: RoleDetection = Field(default_factory=RoleDetection)
    lifecycle_detection: LifecycleDetection = Field(default_factory=LifecycleDetection)
    graph_analytics: GraphAnalytics | None = None
    brief: ContactBrief | None = None

    # Output
    output: ContactIntelligenceOutput | None = None

    # Trace
    trace: Trace = Field(default_factory=Trace)

    # Skip flags
    skip_remaining: bool = False
    skip_reason: str | None = None

    class Config:
        """Pydantic config."""

        arbitrary_types_allowed = True
