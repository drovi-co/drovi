"""Tests for the LangGraph orchestrator."""

import pytest

from src.orchestrator.state import (
    IntelligenceState,
    AnalysisInput,
    Classification,
    ExtractedIntelligence,
)


class TestIntelligenceState:
    """Tests for IntelligenceState."""

    def test_create_state_with_minimal_input(self):
        """Test creating state with minimal required input."""
        input_data = AnalysisInput(
            organization_id="org_123",
            content="Hello, this is a test message.",
        )

        state = IntelligenceState(input=input_data)

        assert state.analysis_id is not None
        assert state.input.organization_id == "org_123"
        assert state.input.content == "Hello, this is a test message."
        assert state.input.source_type == "api"
        assert len(state.messages) == 0
        assert state.classification.has_intelligence is False

    def test_create_state_with_full_input(self):
        """Test creating state with all input fields."""
        input_data = AnalysisInput(
            organization_id="org_123",
            content="Meeting tomorrow at 3pm",
            source_type="email",
            source_id="email_456",
            source_account_id="account_789",
            conversation_id="conv_abc",
            message_ids=["msg_1", "msg_2"],
            user_email="user@example.com",
            user_name="John Doe",
        )

        state = IntelligenceState(input=input_data)

        assert state.input.source_type == "email"
        assert state.input.user_email == "user@example.com"
        assert state.input.message_ids == ["msg_1", "msg_2"]


class TestClassification:
    """Tests for Classification."""

    def test_default_classification(self):
        """Test default classification values."""
        classification = Classification()

        assert classification.has_intelligence is False
        assert classification.has_commitments is False
        assert classification.has_decisions is False
        assert classification.urgency == 0.0
        assert classification.importance == 0.0
        assert classification.sentiment == 0.0
        assert classification.confidence == 0.0

    def test_classification_with_values(self):
        """Test classification with specific values."""
        classification = Classification(
            has_intelligence=True,
            has_commitments=True,
            has_decisions=True,
            urgency=0.8,
            importance=0.9,
            sentiment=0.5,
            confidence=0.95,
            reasoning="High urgency email with commitments",
        )

        assert classification.has_intelligence is True
        assert classification.urgency == 0.8
        assert classification.confidence == 0.95


class TestExtractedIntelligence:
    """Tests for ExtractedIntelligence."""

    def test_default_extracted_intelligence(self):
        """Test default extracted intelligence."""
        extracted = ExtractedIntelligence()

        assert len(extracted.claims) == 0
        assert len(extracted.commitments) == 0
        assert len(extracted.decisions) == 0
        assert len(extracted.topics) == 0
        assert len(extracted.risks) == 0
