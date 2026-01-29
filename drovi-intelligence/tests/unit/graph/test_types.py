"""
Unit tests for Graph Type Definitions.

Tests enums and Pydantic models for graph nodes.
"""

import pytest
from datetime import datetime

from src.graph.types import (
    SourceType,
    IdentityType,
    GraphNodeType,
    GraphRelationshipType,
    BaseNode,
    EpisodeNode,
    EntityNode,
    ContactNode,
    IdentityNode,
    CommitmentNode,
    DecisionNode,
    UserProfileNode,
    OrganizationBaselineNode,
    PatternNode,
    StatWindow,
)

pytestmark = pytest.mark.unit


# =============================================================================
# SourceType Tests
# =============================================================================


class TestSourceType:
    """Tests for SourceType enum."""

    def test_email_value(self):
        """Test EMAIL value."""
        assert SourceType.EMAIL.value == "email"

    def test_slack_value(self):
        """Test SLACK value."""
        assert SourceType.SLACK.value == "slack"

    def test_notion_value(self):
        """Test NOTION value."""
        assert SourceType.NOTION.value == "notion"

    def test_google_docs_value(self):
        """Test GOOGLE_DOCS value."""
        assert SourceType.GOOGLE_DOCS.value == "google_docs"

    def test_whatsapp_value(self):
        """Test WHATSAPP value."""
        assert SourceType.WHATSAPP.value == "whatsapp"

    def test_calendar_value(self):
        """Test CALENDAR value."""
        assert SourceType.CALENDAR.value == "calendar"

    def test_crm_sources(self):
        """Test CRM source types."""
        assert SourceType.CRM_SALESFORCE.value == "crm_salesforce"
        assert SourceType.CRM_HUBSPOT.value == "crm_hubspot"
        assert SourceType.CRM_PIPEDRIVE.value == "crm_pipedrive"
        assert SourceType.CRM_ZOHO.value == "crm_zoho"

    def test_all_values_are_strings(self):
        """Test all source types are strings."""
        for source_type in SourceType:
            assert isinstance(source_type.value, str)


# =============================================================================
# IdentityType Tests
# =============================================================================


class TestIdentityType:
    """Tests for IdentityType enum."""

    def test_email_types(self):
        """Test email identity types."""
        assert IdentityType.EMAIL.value == "email"
        assert IdentityType.EMAIL_ALIAS.value == "email_alias"

    def test_slack_types(self):
        """Test Slack identity types."""
        assert IdentityType.SLACK_ID.value == "slack_id"
        assert IdentityType.SLACK_HANDLE.value == "slack_handle"

    def test_phone_types(self):
        """Test phone identity types."""
        assert IdentityType.PHONE.value == "phone"
        assert IdentityType.WHATSAPP_ID.value == "whatsapp_id"

    def test_crm_types(self):
        """Test CRM identity types."""
        assert IdentityType.CRM_SALESFORCE.value == "crm_salesforce"
        assert IdentityType.CRM_HUBSPOT.value == "crm_hubspot"

    def test_social_types(self):
        """Test social identity types."""
        assert IdentityType.LINKEDIN_URL.value == "linkedin_url"
        assert IdentityType.TWITTER_HANDLE.value == "twitter_handle"
        assert IdentityType.GITHUB_USERNAME.value == "github_username"


# =============================================================================
# GraphNodeType Tests
# =============================================================================


class TestGraphNodeType:
    """Tests for GraphNodeType enum."""

    def test_core_intelligence_types(self):
        """Test core intelligence node types."""
        assert GraphNodeType.UIO.value == "UIO"
        assert GraphNodeType.COMMITMENT.value == "Commitment"
        assert GraphNodeType.DECISION.value == "Decision"
        assert GraphNodeType.TOPIC.value == "Topic"
        assert GraphNodeType.PROJECT.value == "Project"

    def test_entity_types(self):
        """Test entity node types."""
        assert GraphNodeType.CONTACT.value == "Contact"
        assert GraphNodeType.CONVERSATION.value == "Conversation"
        assert GraphNodeType.MESSAGE.value == "Message"
        assert GraphNodeType.TASK.value == "Task"
        assert GraphNodeType.CLAIM.value == "Claim"
        assert GraphNodeType.ORGANIZATION.value == "Organization"

    def test_agentic_memory_types(self):
        """Test agentic memory node types."""
        assert GraphNodeType.EPISODE.value == "Episode"
        assert GraphNodeType.ENTITY.value == "Entity"

    def test_multi_source_types(self):
        """Test multi-source node types."""
        assert GraphNodeType.SLACK_CHANNEL.value == "SlackChannel"
        assert GraphNodeType.NOTION_PAGE.value == "NotionPage"
        assert GraphNodeType.GOOGLE_DOC.value == "GoogleDoc"
        assert GraphNodeType.WHATSAPP_GROUP.value == "WhatsAppGroup"
        assert GraphNodeType.CALENDAR_EVENT.value == "CalendarEvent"

    def test_memory_system_types(self):
        """Test memory system node types."""
        assert GraphNodeType.USER_PROFILE.value == "UserProfile"
        assert GraphNodeType.ORGANIZATION_BASELINE.value == "OrganizationBaseline"
        assert GraphNodeType.PATTERN.value == "Pattern"

    def test_identity_type(self):
        """Test identity node type."""
        assert GraphNodeType.IDENTITY.value == "Identity"


# =============================================================================
# GraphRelationshipType Tests
# =============================================================================


class TestGraphRelationshipType:
    """Tests for GraphRelationshipType enum."""

    def test_core_relationships(self):
        """Test core relationship types."""
        assert GraphRelationshipType.ORIGINATED_FROM.value == "ORIGINATED_FROM"
        assert GraphRelationshipType.MENTIONED_IN.value == "MENTIONED_IN"
        assert GraphRelationshipType.OWNED_BY.value == "OWNED_BY"
        assert GraphRelationshipType.INVOLVES.value == "INVOLVES"
        assert GraphRelationshipType.SUPERSEDES.value == "SUPERSEDES"
        assert GraphRelationshipType.DEPENDS_ON.value == "DEPENDS_ON"

    def test_knowledge_evolution_relationships(self):
        """Test knowledge evolution relationship types."""
        assert GraphRelationshipType.DERIVED_FROM.value == "DERIVED_FROM"
        assert GraphRelationshipType.CONTRADICTS.value == "CONTRADICTS"
        assert GraphRelationshipType.CONFIRMS.value == "CONFIRMS"

    def test_agentic_memory_relationships(self):
        """Test agentic memory relationship types."""
        assert GraphRelationshipType.RECORDED_IN.value == "RECORDED_IN"
        assert GraphRelationshipType.ENTITY_IN.value == "ENTITY_IN"
        assert GraphRelationshipType.OCCURRED_AFTER.value == "OCCURRED_AFTER"
        assert GraphRelationshipType.REFERENCES.value == "REFERENCES"

    def test_identity_relationships(self):
        """Test identity resolution relationship types."""
        assert GraphRelationshipType.HAS_IDENTITY.value == "HAS_IDENTITY"
        assert GraphRelationshipType.POTENTIAL_MERGE.value == "POTENTIAL_MERGE"
        assert GraphRelationshipType.MERGED_FROM.value == "MERGED_FROM"


# =============================================================================
# BaseNode Tests
# =============================================================================


class TestBaseNode:
    """Tests for BaseNode model."""

    def test_required_fields(self):
        """Test required fields."""
        node = BaseNode(
            id="node_123",
            organization_id="org_456",
        )

        assert node.id == "node_123"
        assert node.organization_id == "org_456"

    def test_default_timestamps(self):
        """Test timestamps are set automatically."""
        node = BaseNode(
            id="node_123",
            organization_id="org_456",
        )

        assert node.created_at is not None
        assert node.updated_at is not None
        assert isinstance(node.created_at, datetime)
        assert isinstance(node.updated_at, datetime)


# =============================================================================
# EpisodeNode Tests
# =============================================================================


class TestEpisodeNode:
    """Tests for EpisodeNode model."""

    def test_required_fields(self):
        """Test required fields."""
        now = datetime.utcnow()
        node = EpisodeNode(
            id="ep_123",
            organization_id="org_456",
            name="Meeting Notes",
            content="Discussion about...",
            source_type=SourceType.EMAIL,
            source_id="msg_789",
            reference_time=now,
            recorded_at=now,
        )

        assert node.id == "ep_123"
        assert node.name == "Meeting Notes"
        assert node.source_type == SourceType.EMAIL

    def test_optional_fields_defaults(self):
        """Test optional fields have correct defaults."""
        now = datetime.utcnow()
        node = EpisodeNode(
            id="ep_123",
            organization_id="org_456",
            name="Test",
            content="Content",
            source_type=SourceType.SLACK,
            source_id="msg_123",
            reference_time=now,
            recorded_at=now,
        )

        assert node.summary is None
        assert node.valid_from is None
        assert node.valid_to is None
        assert node.participants == []
        assert node.confidence == 1.0
        assert node.embedding is None

    def test_bi_temporal_model(self):
        """Test bi-temporal model fields."""
        ref_time = datetime(2024, 1, 15, 10, 0)
        rec_time = datetime(2024, 1, 15, 10, 5)
        valid_from = datetime(2024, 1, 1)

        node = EpisodeNode(
            id="ep_123",
            organization_id="org_456",
            name="Test",
            content="Content",
            source_type=SourceType.EMAIL,
            source_id="msg_123",
            reference_time=ref_time,
            recorded_at=rec_time,
            valid_from=valid_from,
        )

        assert node.reference_time == ref_time
        assert node.recorded_at == rec_time
        assert node.valid_from == valid_from
        assert node.valid_to is None  # Still valid

    def test_source_metadata(self):
        """Test source-specific metadata fields."""
        node = EpisodeNode(
            id="ep_123",
            organization_id="org_456",
            name="Test",
            content="Content",
            source_type=SourceType.SLACK,
            source_id="msg_123",
            reference_time=datetime.utcnow(),
            recorded_at=datetime.utcnow(),
            thread_id="thread_abc",
            channel_id="channel_xyz",
        )

        assert node.thread_id == "thread_abc"
        assert node.channel_id == "channel_xyz"


# =============================================================================
# EntityNode Tests
# =============================================================================


class TestEntityNode:
    """Tests for EntityNode model."""

    def test_required_fields(self):
        """Test required fields."""
        now = datetime.utcnow()
        node = EntityNode(
            id="ent_123",
            organization_id="org_456",
            name="Project Alpha",
            entity_type="project",
            first_seen=now,
            last_seen=now,
        )

        assert node.id == "ent_123"
        assert node.name == "Project Alpha"
        assert node.entity_type == "project"

    def test_entity_types(self):
        """Test various entity types."""
        now = datetime.utcnow()

        for entity_type in [
            "person", "organization", "project", "location",
            "event", "document", "topic", "preference",
            "requirement", "procedure", "fact"
        ]:
            node = EntityNode(
                id="ent_123",
                organization_id="org_456",
                name="Test",
                entity_type=entity_type,
                first_seen=now,
                last_seen=now,
            )
            assert node.entity_type == entity_type

    def test_knowledge_evolution_fields(self):
        """Test knowledge evolution fields."""
        now = datetime.utcnow()
        node = EntityNode(
            id="ent_123",
            organization_id="org_456",
            name="Test",
            entity_type="fact",
            first_seen=now,
            last_seen=now,
            superseded_by_id="ent_456",
            derivation_source_ids=["ent_100", "ent_101"],
            derivation_rule="job_role_inference",
        )

        assert node.superseded_by_id == "ent_456"
        assert node.derivation_source_ids == ["ent_100", "ent_101"]
        assert node.derivation_rule == "job_role_inference"

    def test_forgetting_mechanism_fields(self):
        """Test forgetting mechanism fields."""
        now = datetime.utcnow()
        node = EntityNode(
            id="ent_123",
            organization_id="org_456",
            name="Test",
            entity_type="topic",
            first_seen=now,
            last_seen=now,
            relevance_score=0.8,
            last_accessed_at=now,
            access_count=5,
            decay_rate=0.02,
        )

        assert node.relevance_score == 0.8
        assert node.access_count == 5
        assert node.decay_rate == 0.02


# =============================================================================
# ContactNode Tests
# =============================================================================


class TestContactNode:
    """Tests for ContactNode model."""

    def test_required_fields(self):
        """Test required fields."""
        node = ContactNode(
            id="contact_123",
            organization_id="org_456",
        )

        assert node.id == "contact_123"
        assert node.organization_id == "org_456"

    def test_default_values(self):
        """Test default values."""
        node = ContactNode(
            id="contact_123",
            organization_id="org_456",
        )

        assert node.email is None
        assert node.name is None
        assert node.importance_score == 0.0
        assert node.pagerank_score == 0.0
        assert node.betweenness_score == 0.0
        assert node.interaction_count == 0
        assert node.lifecycle_stage == "unknown"
        assert node.role_type == "unknown"
        assert node.seniority_level == "unknown"
        assert node.is_vip is False
        assert node.is_at_risk is False

    def test_graph_analytics_metrics(self):
        """Test graph analytics metric fields."""
        node = ContactNode(
            id="contact_123",
            organization_id="org_456",
            pagerank_score=0.75,
            betweenness_score=0.45,
            community_id="comm_1",
            community_ids=["comm_1", "comm_2"],
        )

        assert node.pagerank_score == 0.75
        assert node.betweenness_score == 0.45
        assert node.community_id == "comm_1"
        assert node.community_ids == ["comm_1", "comm_2"]

    def test_contact_intelligence_fields(self):
        """Test contact intelligence fields."""
        node = ContactNode(
            id="contact_123",
            organization_id="org_456",
            lifecycle_stage="customer",
            lifecycle_stage_confidence=0.9,
            role_type="decision_maker",
            role_type_confidence=0.85,
            seniority_level="c_level",
            seniority_confidence=0.95,
        )

        assert node.lifecycle_stage == "customer"
        assert node.role_type == "decision_maker"
        assert node.seniority_level == "c_level"

    def test_health_and_risk_fields(self):
        """Test health and risk tracking fields."""
        node = ContactNode(
            id="contact_123",
            organization_id="org_456",
            health_score=0.8,
            engagement_score=0.7,
            sentiment_score=0.6,
            is_vip=True,
            is_at_risk=False,
        )

        assert node.health_score == 0.8
        assert node.engagement_score == 0.7
        assert node.sentiment_score == 0.6
        assert node.is_vip is True


# =============================================================================
# IdentityNode Tests
# =============================================================================


class TestIdentityNode:
    """Tests for IdentityNode model."""

    def test_required_fields(self):
        """Test required fields."""
        node = IdentityNode(
            id="ident_123",
            organization_id="org_456",
            contact_id="contact_789",
            identity_type="email",
            identity_value="user@example.com",
        )

        assert node.id == "ident_123"
        assert node.contact_id == "contact_789"
        assert node.identity_type == "email"
        assert node.identity_value == "user@example.com"

    def test_default_values(self):
        """Test default values."""
        node = IdentityNode(
            id="ident_123",
            organization_id="org_456",
            contact_id="contact_789",
            identity_type="email",
            identity_value="user@example.com",
        )

        assert node.confidence == 1.0
        assert node.is_verified is False
        assert node.verified_at is None

    def test_verification_fields(self):
        """Test verification tracking."""
        now = datetime.utcnow()
        node = IdentityNode(
            id="ident_123",
            organization_id="org_456",
            contact_id="contact_789",
            identity_type="email",
            identity_value="user@example.com",
            confidence=0.95,
            is_verified=True,
            verified_at=now,
        )

        assert node.is_verified is True
        assert node.verified_at == now

    def test_provenance_fields(self):
        """Test provenance tracking."""
        node = IdentityNode(
            id="ident_123",
            organization_id="org_456",
            contact_id="contact_789",
            identity_type="slack_id",
            identity_value="U12345",
            source="slack_profile",
            source_account_id="team_abc",
        )

        assert node.source == "slack_profile"
        assert node.source_account_id == "team_abc"


# =============================================================================
# CommitmentNode Tests
# =============================================================================


class TestCommitmentNode:
    """Tests for CommitmentNode model."""

    def test_required_fields(self):
        """Test required fields."""
        node = CommitmentNode(
            id="comm_123",
            organization_id="org_456",
            title="Send report by Friday",
            direction="owed_by_me",
            status="pending",
            priority="high",
        )

        assert node.id == "comm_123"
        assert node.title == "Send report by Friday"
        assert node.direction == "owed_by_me"
        assert node.status == "pending"
        assert node.priority == "high"

    def test_direction_values(self):
        """Test direction values."""
        for direction in ["owed_by_me", "owed_to_me"]:
            node = CommitmentNode(
                id="comm_123",
                organization_id="org_456",
                title="Test",
                direction=direction,
                status="pending",
                priority="medium",
            )
            assert node.direction == direction

    def test_status_values(self):
        """Test status values."""
        for status in ["pending", "in_progress", "completed", "cancelled", "overdue"]:
            node = CommitmentNode(
                id="comm_123",
                organization_id="org_456",
                title="Test",
                direction="owed_by_me",
                status=status,
                priority="medium",
            )
            assert node.status == status

    def test_priority_values(self):
        """Test priority values."""
        for priority in ["low", "medium", "high", "urgent"]:
            node = CommitmentNode(
                id="comm_123",
                organization_id="org_456",
                title="Test",
                direction="owed_by_me",
                status="pending",
                priority=priority,
            )
            assert node.priority == priority

    def test_party_fields(self):
        """Test debtor/creditor fields."""
        node = CommitmentNode(
            id="comm_123",
            organization_id="org_456",
            title="Test",
            direction="owed_by_me",
            status="pending",
            priority="high",
            debtor_contact_id="contact_1",
            creditor_contact_id="contact_2",
        )

        assert node.debtor_contact_id == "contact_1"
        assert node.creditor_contact_id == "contact_2"


# =============================================================================
# DecisionNode Tests
# =============================================================================


class TestDecisionNode:
    """Tests for DecisionNode model."""

    def test_required_fields(self):
        """Test required fields."""
        node = DecisionNode(
            id="dec_123",
            organization_id="org_456",
            title="Use React for frontend",
            statement="We will use React for the frontend framework.",
        )

        assert node.id == "dec_123"
        assert node.title == "Use React for frontend"
        assert node.statement == "We will use React for the frontend framework."

    def test_default_status(self):
        """Test default status is made."""
        node = DecisionNode(
            id="dec_123",
            organization_id="org_456",
            title="Test",
            statement="Test statement",
        )

        assert node.status == "made"

    def test_status_values(self):
        """Test status values."""
        for status in ["made", "pending", "deferred", "reversed"]:
            node = DecisionNode(
                id="dec_123",
                organization_id="org_456",
                title="Test",
                statement="Test statement",
                status=status,
            )
            assert node.status == status

    def test_supersession(self):
        """Test supersession field."""
        node = DecisionNode(
            id="dec_123",
            organization_id="org_456",
            title="Test",
            statement="Test statement",
            supersedes_id="dec_100",
        )

        assert node.supersedes_id == "dec_100"


# =============================================================================
# UserProfileNode Tests
# =============================================================================


class TestUserProfileNode:
    """Tests for UserProfileNode model."""

    def test_required_fields(self):
        """Test required fields."""
        node = UserProfileNode(
            id="profile_123",
            organization_id="org_456",
            user_id="user_789",
            name="John Doe",
        )

        assert node.id == "profile_123"
        assert node.user_id == "user_789"
        assert node.name == "John Doe"

    def test_static_context_fields(self):
        """Test static context fields."""
        node = UserProfileNode(
            id="profile_123",
            organization_id="org_456",
            user_id="user_789",
            name="John Doe",
            role="Product Manager",
            timezone="America/New_York",
            communication_style="direct",
            priorities=["product launches", "investor relations"],
            vip_contact_ids=["contact_1", "contact_2"],
        )

        assert node.role == "Product Manager"
        assert node.timezone == "America/New_York"
        assert node.communication_style == "direct"
        assert len(node.priorities) == 2

    def test_dynamic_context_fields(self):
        """Test dynamic context fields."""
        node = UserProfileNode(
            id="profile_123",
            organization_id="org_456",
            user_id="user_789",
            name="John Doe",
            current_focus=["Q4 planning", "hiring"],
            recent_topics=["budget", "roadmap"],
            mood_indicator="busy",
            unread_commitments_count=5,
            overdue_commitments_count=2,
        )

        assert node.current_focus == ["Q4 planning", "hiring"]
        assert node.mood_indicator == "busy"
        assert node.unread_commitments_count == 5


# =============================================================================
# StatWindow Tests
# =============================================================================


class TestStatWindow:
    """Tests for StatWindow model."""

    def test_default_values(self):
        """Test default values."""
        window = StatWindow()

        assert window.mean == 0.0
        assert window.std == 1.0
        assert window.count == 0
        assert window.last_updated is None

    def test_custom_values(self):
        """Test with custom values."""
        now = datetime.utcnow()
        window = StatWindow(
            mean=10.5,
            std=2.3,
            count=100,
            last_updated=now,
        )

        assert window.mean == 10.5
        assert window.std == 2.3
        assert window.count == 100
        assert window.last_updated == now


# =============================================================================
# OrganizationBaselineNode Tests
# =============================================================================


class TestOrganizationBaselineNode:
    """Tests for OrganizationBaselineNode model."""

    def test_required_fields(self):
        """Test required fields."""
        node = OrganizationBaselineNode(
            id="baseline_123",
            organization_id="org_456",
        )

        assert node.id == "baseline_123"
        assert node.organization_id == "org_456"

    def test_default_stat_windows(self):
        """Test default stat windows."""
        node = OrganizationBaselineNode(
            id="baseline_123",
            organization_id="org_456",
        )

        assert node.commitments_per_week.mean == 0.0
        assert node.decisions_per_week.mean == 0.0
        assert node.tasks_per_week.mean == 0.0

    def test_category_breakdowns(self):
        """Test category breakdown fields."""
        node = OrganizationBaselineNode(
            id="baseline_123",
            organization_id="org_456",
            commitments_by_priority={
                "high": StatWindow(mean=5.0, std=1.5),
                "medium": StatWindow(mean=10.0, std=2.0),
            },
        )

        assert "high" in node.commitments_by_priority
        assert node.commitments_by_priority["high"].mean == 5.0


# =============================================================================
# PatternNode Tests
# =============================================================================


class TestPatternNode:
    """Tests for PatternNode model."""

    def test_required_fields(self):
        """Test required fields."""
        node = PatternNode(
            id="pattern_123",
            organization_id="org_456",
            name="Urgent Customer Escalation",
        )

        assert node.id == "pattern_123"
        assert node.name == "Urgent Customer Escalation"

    def test_default_values(self):
        """Test default values."""
        node = PatternNode(
            id="pattern_123",
            organization_id="org_456",
            name="Test Pattern",
        )

        assert node.semantic_threshold == 0.8
        assert node.confidence_threshold == 0.7
        assert node.confidence_boost == 0.15
        assert node.times_matched == 0
        assert node.accuracy_rate == 1.0
        assert node.is_active is True

    def test_klein_rpd_components(self):
        """Test Klein's RPD components."""
        node = PatternNode(
            id="pattern_123",
            organization_id="org_456",
            name="Deal at Risk",
            salient_features=["competitor mentioned", "budget concerns"],
            typical_expectations=["request for discount", "evaluation delay"],
            typical_action="Schedule executive call",
            plausible_goals=["retain customer", "counter competition"],
        )

        assert len(node.salient_features) == 2
        assert node.typical_action == "Schedule executive call"
        assert len(node.plausible_goals) == 2

    def test_learning_metrics(self):
        """Test learning metrics."""
        node = PatternNode(
            id="pattern_123",
            organization_id="org_456",
            name="Test Pattern",
            times_matched=100,
            times_confirmed=85,
            times_rejected=15,
            accuracy_rate=0.85,
        )

        assert node.times_matched == 100
        assert node.accuracy_rate == 0.85
