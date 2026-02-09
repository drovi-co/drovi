"""
Unit tests for orchestrator state management.

Tests the IntelligenceState, AnalysisInput, and related models
that form the backbone of the intelligence extraction pipeline.
"""

import pytest
from datetime import datetime
from typing import Any

from src.orchestrator.state import (
    IntelligenceState,
    AnalysisInput,
    Classification,
    ExtractedIntelligence,
    ExtractedCommitment,
    ExtractedDecision,
    ExtractedTask,
    DetectedRisk,
    ExtractedClaim,
    Confidence,
    NodeTiming,
    Trace,
)


class TestAnalysisInput:
    """Tests for AnalysisInput model."""

    def test_create_minimal_input(self, factory):
        """Test creating input with minimal required fields."""
        input_data = AnalysisInput(
            organization_id=factory.organization_id(),
            content="Test content",
            source_type="api",
        )

        assert input_data.organization_id is not None
        assert input_data.content == "Test content"
        assert input_data.source_type == "api"
        assert input_data.source_id is None
        assert input_data.conversation_id is None

    def test_create_full_input(self, factory):
        """Test creating input with all fields."""
        org_id = factory.organization_id()
        input_data = AnalysisInput(
            organization_id=org_id,
            content="Full test content",
            source_type="email",
            source_id="source_123",
            conversation_id="conv_456",
            message_ids=["msg_1", "msg_2"],
            user_email="test@example.com",
            user_name="Test User",
        )

        assert input_data.organization_id == org_id
        assert input_data.source_type == "email"
        assert input_data.source_id == "source_123"
        assert input_data.conversation_id == "conv_456"
        assert len(input_data.message_ids) == 2
        assert input_data.user_email == "test@example.com"

    def test_source_type_validation(self, factory):
        """Test that source_type accepts valid values."""
        valid_types = ["email", "slack", "notion", "google_docs", "document", "whatsapp", "calendar", "api", "manual"]

        for source_type in valid_types:
            input_data = AnalysisInput(
                organization_id=factory.organization_id(),
                content="Test",
                source_type=source_type,
            )
            assert input_data.source_type == source_type


class TestClassification:
    """Tests for Classification model."""

    def test_default_classification(self):
        """Test default classification values."""
        classification = Classification()

        assert classification.has_intelligence is False
        assert classification.has_commitments is False
        assert classification.has_decisions is False
        assert classification.urgency == 0.0
        assert classification.importance == 0.0
        assert classification.topics == []

    def test_classification_with_values(self):
        """Test classification with custom values."""
        classification = Classification(
            has_intelligence=True,
            has_commitments=True,
            intent="request",
            urgency=0.8,
            importance=0.9,
            sentiment=0.5,
            topics=["project", "deadline"],
        )

        assert classification.has_intelligence is True
        assert classification.intent == "request"
        assert classification.urgency == 0.8
        assert classification.importance == 0.9
        assert len(classification.topics) == 2

    def test_urgency_bounds(self):
        """Test urgency is bounded between 0 and 1."""
        classification = Classification(urgency=0.5)
        assert 0 <= classification.urgency <= 1


class TestExtractedCommitment:
    """Tests for ExtractedCommitment model."""

    def test_create_commitment(self, factory):
        """Test creating a commitment."""
        commitment = ExtractedCommitment(
            title="Deliver report by Friday",
            description="Complete Q1 financial report",
            direction="owed_by_me",
            debtor_name="user_123",
            creditor_name="client_456",
            due_date_text="Friday",
            priority="high",
            confidence=0.9,
            quoted_text="I'll have the report to you by Friday",
        )

        assert commitment.title == "Deliver report by Friday"
        assert commitment.direction == "owed_by_me"
        assert commitment.priority == "high"
        assert commitment.confidence == 0.9

    def test_commitment_directions(self):
        """Test valid commitment directions."""
        for direction in ["owed_by_me", "owed_to_me"]:
            commitment = ExtractedCommitment(
                title="Test",
                direction=direction,
                quoted_text="test quote",
                confidence=0.8,
            )
            assert commitment.direction == direction

    def test_commitment_priorities(self):
        """Test valid commitment priorities."""
        for priority in ["urgent", "high", "medium", "low"]:
            commitment = ExtractedCommitment(
                title="Test",
                direction="owed_by_me",
                priority=priority,
                quoted_text="test quote",
                confidence=0.8,
            )
            assert commitment.priority == priority


class TestExtractedDecision:
    """Tests for ExtractedDecision model."""

    def test_create_decision(self):
        """Test creating a decision."""
        decision = ExtractedDecision(
            title="Use React for frontend",
            statement="We decided to use React",
            status="made",
            rationale="Better ecosystem and team familiarity",
            decision_maker_name="team_lead",
            confidence=0.95,
            quoted_text="We've decided to go with React",
        )

        assert decision.title == "Use React for frontend"
        assert decision.status == "made"
        assert decision.confidence == 0.95

    def test_decision_statuses(self):
        """Test valid decision statuses."""
        for status in ["made", "pending", "deferred", "reversed"]:
            decision = ExtractedDecision(
                title="Test",
                statement="Test statement",
                status=status,
                quoted_text="test quote",
                confidence=0.8,
            )
            assert decision.status == status


class TestExtractedTask:
    """Tests for ExtractedTask model."""

    def test_create_task(self):
        """Test creating a task."""
        task = ExtractedTask(
            title="Review PR",
            description="Review the API changes PR",
            assignee_name="dev_123",
            status="todo",
            priority="high",
            estimated_effort="2h",
            confidence=0.85,
            quoted_text="Can you review the PR?",
        )

        assert task.title == "Review PR"
        assert task.status == "todo"
        assert task.estimated_effort == "2h"

    def test_task_statuses(self):
        """Test valid task statuses."""
        for status in ["todo", "in_progress", "done", "blocked"]:
            task = ExtractedTask(
                title="Test task",
                status=status,
                quoted_text="test quote",
                confidence=0.8,
            )
            assert task.status == status


class TestDetectedRisk:
    """Tests for DetectedRisk model."""

    def test_create_risk(self):
        """Test creating a risk."""
        risk = DetectedRisk(
            title="Timeline at risk",
            description="Project may slip due to dependencies",
            type="deadline_risk",
            severity="high",
            suggested_action="Add buffer time",
            confidence=0.8,
            quoted_text="We might not make the deadline",
        )

        assert risk.title == "Timeline at risk"
        assert risk.type == "deadline_risk"
        assert risk.severity == "high"

    def test_risk_types(self):
        """Test valid risk types."""
        valid_types = [
            "deadline_risk", "commitment_conflict", "unclear_ownership",
            "missing_information", "escalation_needed", "policy_violation",
            "financial_risk", "relationship_risk",
        ]

        for risk_type in valid_types:
            risk = DetectedRisk(
                title="Test",
                description="Test risk",
                type=risk_type,
                severity="medium",
                confidence=0.8,
            )
            assert risk.type == risk_type

    def test_risk_severities(self):
        """Test valid risk severities."""
        for severity in ["critical", "high", "medium", "low"]:
            risk = DetectedRisk(
                title="Test",
                description="Test risk",
                type="deadline_risk",
                severity=severity,
                confidence=0.8,
            )
            assert risk.severity == severity


class TestExtractedIntelligence:
    """Tests for ExtractedIntelligence model."""

    def test_default_extracted_intelligence(self):
        """Test default extracted intelligence."""
        extracted = ExtractedIntelligence()

        assert extracted.claims == []
        assert extracted.commitments == []
        assert extracted.decisions == []
        assert extracted.tasks == []
        assert extracted.risks == []

    def test_extracted_with_items(self):
        """Test extracted intelligence with items."""
        commitment = ExtractedCommitment(
            title="Test commitment",
            direction="owed_by_me",
            quoted_text="I will do it",
            confidence=0.9,
        )
        decision = ExtractedDecision(
            title="Test decision",
            statement="We decided",
            status="made",
            quoted_text="We've decided",
            confidence=0.9,
        )

        extracted = ExtractedIntelligence(
            commitments=[commitment],
            decisions=[decision],
        )

        assert len(extracted.commitments) == 1
        assert len(extracted.decisions) == 1


class TestConfidence:
    """Tests for Confidence model."""

    def test_default_confidence(self):
        """Test default confidence scores."""
        confidence = Confidence()

        assert confidence.overall == 0.0
        assert confidence.by_type == {}
        assert confidence.needs_review is False

    def test_confidence_needs_review(self):
        """Test needs_review flag."""
        confidence = Confidence(
            overall=0.4,
            needs_review=True,
            review_reason="Low extraction confidence",
        )

        assert confidence.needs_review is True
        assert confidence.review_reason == "Low extraction confidence"


class TestIntelligenceState:
    """Tests for IntelligenceState model."""

    def test_create_state_with_minimal_input(self, factory):
        """Test creating state with minimal input."""
        state = IntelligenceState(
            input=AnalysisInput(
                organization_id=factory.organization_id(),
                content="Test content",
                source_type="api",
            ),
        )

        assert state.analysis_id is not None
        assert state.input.content == "Test content"
        assert state.classification is not None
        assert state.extracted is not None
        assert state.confidence is not None

    def test_state_has_unique_analysis_id(self, factory):
        """Test that each state has unique analysis ID."""
        state1 = IntelligenceState(
            input=AnalysisInput(
                organization_id=factory.organization_id(),
                content="Test 1",
                source_type="api",
            ),
        )
        state2 = IntelligenceState(
            input=AnalysisInput(
                organization_id=factory.organization_id(),
                content="Test 2",
                source_type="api",
            ),
        )

        assert state1.analysis_id != state2.analysis_id

    def test_state_trace_initialization(self, factory):
        """Test trace is properly initialized."""
        state = IntelligenceState(
            input=AnalysisInput(
                organization_id=factory.organization_id(),
                content="Test",
                source_type="api",
            ),
        )

        assert state.trace is not None
        assert state.trace.nodes == []
        assert state.trace.llm_calls == []

    def test_state_routing_defaults(self, factory):
        """Test default routing values."""
        state = IntelligenceState(
            input=AnalysisInput(
                organization_id=factory.organization_id(),
                content="Test",
                source_type="api",
            ),
        )

        # Routing should exist and have default values
        assert state.routing is not None
        assert state.routing.should_extract_commitments is True

    def test_state_with_custom_routing(self, factory):
        """Test state with custom routing."""
        from src.orchestrator.state import Routing

        state = IntelligenceState(
            input=AnalysisInput(
                organization_id=factory.organization_id(),
                content="Test",
                source_type="api",
            ),
            routing=Routing(
                should_extract_commitments=True,
                should_extract_decisions=True,
                should_analyze_risk=False,
                should_deduplicate=True,
            ),
        )

        assert state.routing.should_analyze_risk is False


class TestNodeTiming:
    """Tests for NodeTiming model."""

    def test_node_timing(self):
        """Test node timing creation."""
        start = datetime.utcnow().timestamp()
        end = start + 1.5

        timing = NodeTiming(
            started_at=start,
            completed_at=end,
        )

        assert timing.started_at == start
        assert timing.completed_at == end

    def test_timing_duration_calculation(self):
        """Test duration can be calculated from timing."""
        start = 1000.0
        end = 1002.5

        timing = NodeTiming(started_at=start, completed_at=end)

        duration = timing.completed_at - timing.started_at
        assert duration == 2.5


class TestTrace:
    """Tests for Trace model."""

    def test_default_trace(self):
        """Test default trace info."""
        trace = Trace()

        assert trace.nodes == []
        assert trace.llm_calls == []
        assert trace.node_timings == {}
        assert trace.current_node is None

    def test_trace_with_nodes(self):
        """Test trace with node history."""
        trace = Trace(
            nodes=["parse", "classify", "extract_commitments"],
            current_node="extract_decisions",
        )

        assert len(trace.nodes) == 3
        assert trace.current_node == "extract_decisions"
        assert "parse" in trace.nodes
