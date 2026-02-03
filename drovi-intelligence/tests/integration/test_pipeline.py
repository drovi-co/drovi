"""
Integration tests for the intelligence extraction pipeline.

Tests the full orchestrator flow from input to output.
"""

import pytest
from unittest.mock import AsyncMock, patch, MagicMock
from dataclasses import dataclass, field
from typing import Optional

from src.orchestrator.state import (
    IntelligenceState,
    AnalysisInput,
)

pytestmark = [pytest.mark.integration, pytest.mark.asyncio]


# =============================================================================
# Mock Outputs for Each Node
# =============================================================================

@dataclass
class MockClassificationOutput:
    """Mock classification from LLM."""
    has_intelligence: bool = True
    has_commitments: bool = True
    has_decisions: bool = True
    has_claims: bool = True
    has_risks: bool = False
    has_questions: bool = False
    intent: str = "action"
    topics: list = field(default_factory=lambda: ["project"])
    urgency: float = 0.5
    importance: float = 0.7
    sentiment: float = 0.8
    confidence: float = 0.85
    reasoning: str = "Content contains actionable items"


@dataclass
class MockClaimOutput:
    """Mock claim from LLM."""
    type: str = "promise"
    content: str = "Test claim"
    quoted_text: str = "Original quote"
    speaker_name: Optional[str] = None
    confidence: float = 0.8


@dataclass
class MockClaimExtractionOutput:
    """Mock claim extraction from LLM."""
    claims: list = field(default_factory=list)


@dataclass
class MockCommitment:
    """Mock commitment from LLM."""
    title: str = "Test commitment"
    description: str = "Test description"
    direction: str = "owed_by_me"
    priority: str = "medium"
    debtor_name: Optional[str] = None
    debtor_email: Optional[str] = None
    debtor_is_user: bool = True
    creditor_name: Optional[str] = None
    creditor_email: Optional[str] = None
    creditor_is_user: bool = False
    due_date: Optional[str] = None
    due_date_text: Optional[str] = None
    due_date_confidence: float = 0.0
    due_date_is_explicit: bool = False
    is_conditional: bool = False
    condition: Optional[str] = None
    quoted_text: str = "Default quoted text"
    supporting_quotes: list = field(default_factory=list)
    confidence: float = 0.8
    reasoning: str = "Found commitment"
    claim_index: Optional[int] = None


@dataclass
class MockCommitmentExtractionOutput:
    """Mock commitment extraction from LLM."""
    commitments: list = field(default_factory=list)


@dataclass
class MockDecision:
    """Mock decision from LLM."""
    title: str = "Test decision"
    statement: str = "We decided to proceed"
    status: str = "made"
    stakeholders: list = field(default_factory=list)
    rationale: Optional[str] = None
    quoted_text: Optional[str] = None
    supporting_quotes: list = field(default_factory=list)
    confidence: float = 0.8


@dataclass
class MockDecisionExtractionOutput:
    """Mock decision extraction from LLM."""
    decisions: list = field(default_factory=list)


@dataclass
class MockRisk:
    """Mock risk from LLM."""
    type: str = "deadline_risk"
    title: str = "Test risk"
    description: str = "Risk description"
    severity: str = "medium"
    related_commitment_indices: list = field(default_factory=list)
    related_decision_indices: list = field(default_factory=list)
    suggested_action: Optional[str] = None
    quoted_text: Optional[str] = None
    confidence: float = 0.7
    reasoning: str = "Detected risk"


@dataclass
class MockRiskDetectionOutput:
    """Mock risk detection from LLM."""
    risks: list = field(default_factory=list)


@dataclass
class MockBriefOutput:
    """Mock brief generation from LLM."""
    summary: str = "Brief summary of content"
    key_points: list = field(default_factory=lambda: ["Point 1", "Point 2"])
    open_questions: list = field(default_factory=list)
    suggested_actions: list = field(default_factory=list)


@dataclass
class MockLLMCall:
    """Mock LLM call metadata."""
    model: str = "gpt-4"
    prompt_tokens: int = 100
    completion_tokens: int = 50
    duration_ms: int = 500


# =============================================================================
# Integration Tests
# =============================================================================

class TestFullPipelineFlow:
    """Tests for complete pipeline execution."""

    async def test_simple_email_analysis(self, factory):
        """Test analyzing a simple email through the full pipeline."""
        state = IntelligenceState(
            input=AnalysisInput(
                organization_id=factory.organization_id(),
                content="""
                Hi team,

                I'll send the quarterly report by Friday.
                We've decided to use the new CRM system.

                Best,
                John
                """,
                source_type="email",
                user_email="john@company.com",
                user_name="John",
            ),
        )

        # Import nodes
        from src.orchestrator.nodes.parse import parse_messages_node

        # Run parse node (doesn't need LLM)
        result = await parse_messages_node(state)

        assert "messages" in result
        assert len(result["messages"]) >= 1
        assert "Friday" in result["messages"][0].content

    async def test_pipeline_handles_empty_content(self, factory):
        """Test pipeline handles empty content gracefully."""
        from src.orchestrator.nodes.parse import parse_messages_node

        state = IntelligenceState(
            input=AnalysisInput(
                organization_id=factory.organization_id(),
                content="",
                source_type="api",
            ),
        )

        result = await parse_messages_node(state)

        # Should handle empty content without error
        assert "messages" in result

    async def test_pipeline_records_trace(self, factory):
        """Test pipeline records trace information."""
        from src.orchestrator.nodes.parse import parse_messages_node

        state = IntelligenceState(
            input=AnalysisInput(
                organization_id=factory.organization_id(),
                content="Test content for tracing",
                source_type="email",
            ),
        )

        result = await parse_messages_node(state)

        assert "trace" in result
        assert "node_timings" in result["trace"]


class TestClassificationIntegration:
    """Tests for classification integration with other nodes."""

    async def test_classification_determines_extraction_path(self, factory):
        """Test classification determines which extractors run."""
        from src.orchestrator.nodes.parse import parse_messages_node
        from src.orchestrator.nodes.classify import classify_node
        from src.orchestrator.state import ParsedMessage

        # Set up state
        state = IntelligenceState(
            input=AnalysisInput(
                organization_id=factory.organization_id(),
                content="I'll handle the design review by Monday",
                source_type="email",
            ),
        )

        # Run parse
        parse_result = await parse_messages_node(state)
        state.messages = parse_result["messages"]

        # Mock classify
        with patch("src.orchestrator.nodes.classify.get_llm_service") as mock_llm:
            mock_service = AsyncMock()
            mock_service.complete_structured.return_value = (
                MockClassificationOutput(
                    has_intelligence=True,
                    has_commitments=True,
                    has_decisions=False,
                ),
                MockLLMCall(),
            )
            mock_llm.return_value = mock_service

            result = await classify_node(state)

            # Should route to commitment extraction but not decisions
            assert result["routing"].should_extract_commitments is True
            assert result["routing"].should_extract_decisions is False


class TestExtractionIntegration:
    """Tests for extraction nodes integration."""

    async def test_commitment_extraction_uses_claims(self, factory):
        """Test commitment extraction uses claims as context."""
        from src.orchestrator.nodes.extract_commitments import extract_commitments_node
        from src.orchestrator.state import (
            ParsedMessage,
            ExtractedIntelligence,
            ExtractedClaim,
        )

        claims = [
            ExtractedClaim(
                id="claim_0",
                type="promise",
                content="Will deliver report",
                quoted_text="I'll deliver the report by Friday",
                confidence=0.8,
            ),
        ]

        state = IntelligenceState(
            input=AnalysisInput(
                organization_id=factory.organization_id(),
                content="I'll deliver the report by Friday",
                source_type="email",
            ),
            messages=[
                ParsedMessage(
                    id="msg_0",
                    content="I'll deliver the report by Friday",
                ),
            ],
            extracted=ExtractedIntelligence(claims=claims),
        )

        with patch("src.orchestrator.nodes.extract_commitments.get_llm_service") as mock_llm:
            mock_service = AsyncMock()
            mock_service.complete_structured.return_value = (
                MockCommitmentExtractionOutput(
                    commitments=[
                        MockCommitment(
                            title="Deliver report",
                            claim_index=0,  # Links to claim
                        ),
                    ]
                ),
                MockLLMCall(),
            )
            mock_llm.return_value = mock_service

            result = await extract_commitments_node(state)

            # Commitment should link to claim
            commitment = result["extracted"].commitments[0]
            assert commitment.claim_id == "claim_0"


class TestRiskIntegration:
    """Tests for risk detection integration."""

    async def test_risk_detection_links_to_commitments(self, factory):
        """Test risk detection links risks to commitments."""
        from src.orchestrator.nodes.detect_risks import detect_risks_node
        from src.orchestrator.state import (
            ParsedMessage,
            ExtractedIntelligence,
            ExtractedCommitment,
        )

        commitment = ExtractedCommitment(
            id="comm_123",
            title="Deliver by Friday",
            direction="owed_by_me",
            due_date_text="Friday",
            quoted_text="I'll deliver by Friday",
            confidence=0.8,
        )

        state = IntelligenceState(
            input=AnalysisInput(
                organization_id=factory.organization_id(),
                content="I'll deliver by Friday but resources are tight",
                source_type="email",
            ),
            messages=[
                ParsedMessage(id="msg_0", content="Delivery with resource concerns"),
            ],
            extracted=ExtractedIntelligence(commitments=[commitment]),
        )

        with patch("src.orchestrator.nodes.detect_risks.get_llm_service") as mock_llm:
            mock_service = AsyncMock()
            mock_service.complete_structured.return_value = (
                MockRiskDetectionOutput(
                    risks=[
                        MockRisk(
                            title="Resource constraint",
                            type="missing_information",
                            related_commitment_indices=[0],
                        ),
                    ]
                ),
                MockLLMCall(),
            )
            mock_llm.return_value = mock_service

            result = await detect_risks_node(state)

            risk = result["extracted"].risks[0]
            assert len(risk.related_to) == 1
            assert risk.related_to[0]["type"] == "commitment"
            assert risk.related_to[0]["reference"] == "comm_123"


class TestSourceTypeIntegration:
    """Tests for different source types through pipeline."""

    async def test_email_source_parsing(self, factory):
        """Test email content is parsed correctly."""
        from src.orchestrator.nodes.parse import parse_messages_node

        state = IntelligenceState(
            input=AnalysisInput(
                organization_id=factory.organization_id(),
                content="""
                From: sender@example.com
                To: recipient@example.com

                Hello,
                This is the message body.
                """,
                source_type="email",
            ),
        )

        result = await parse_messages_node(state)

        assert len(result["messages"]) >= 1

    async def test_slack_source_parsing(self, factory):
        """Test Slack content is parsed correctly."""
        from src.orchestrator.nodes.parse import parse_messages_node

        state = IntelligenceState(
            input=AnalysisInput(
                organization_id=factory.organization_id(),
                content="""john: Hey team
jane: Hi John!
john: Let's discuss the project""",
                source_type="slack",
            ),
        )

        result = await parse_messages_node(state)

        # Should parse multiple messages
        assert len(result["messages"]) >= 2

    async def test_calendar_source_parsing(self, factory):
        """Test calendar content is parsed correctly."""
        from src.orchestrator.nodes.parse import parse_messages_node

        state = IntelligenceState(
            input=AnalysisInput(
                organization_id=factory.organization_id(),
                content="Quarterly planning meeting",
                source_type="calendar",
                metadata={
                    "title": "Q1 Planning",
                    "start_time": "2024-01-20T09:00:00Z",
                    "attendees": [
                        {"name": "John", "status": "accepted"},
                    ],
                },
            ),
        )

        result = await parse_messages_node(state)

        assert len(result["messages"]) >= 1
        assert "Q1 Planning" in result["messages"][0].content


class TestErrorHandlingIntegration:
    """Tests for error handling across pipeline."""

    async def test_llm_error_doesnt_crash_pipeline(self, factory):
        """Test LLM errors are handled gracefully."""
        from src.orchestrator.nodes.classify import classify_node
        from src.orchestrator.state import ParsedMessage

        state = IntelligenceState(
            input=AnalysisInput(
                organization_id=factory.organization_id(),
                content="Test content",
                source_type="api",
            ),
            messages=[
                ParsedMessage(id="msg_0", content="Test"),
            ],
        )

        with patch("src.orchestrator.nodes.classify.get_llm_service") as mock_llm:
            mock_service = AsyncMock()
            mock_service.complete_structured.side_effect = Exception("LLM unavailable")
            mock_llm.return_value = mock_service

            # Should not raise, but return error state
            result = await classify_node(state)

            assert "trace" in result
            assert "errors" in result["trace"]
            assert len(result["trace"]["errors"]) > 0


class TestConfidenceAggregation:
    """Tests for confidence score aggregation."""

    async def test_confidence_aggregates_across_nodes(self, factory):
        """Test confidence scores aggregate correctly."""
        from src.orchestrator.nodes.extract_commitments import extract_commitments_node
        from src.orchestrator.state import (
            ParsedMessage,
            ExtractedIntelligence,
            Confidence,
        )

        state = IntelligenceState(
            input=AnalysisInput(
                organization_id=factory.organization_id(),
                content="Multiple commitments",
                source_type="email",
            ),
            messages=[
                ParsedMessage(id="msg_0", content="Commitments"),
            ],
            extracted=ExtractedIntelligence(),
            confidence=Confidence(overall=0.5, by_type={}),
        )

        with patch("src.orchestrator.nodes.extract_commitments.get_llm_service") as mock_llm:
            mock_service = AsyncMock()
            mock_service.complete_structured.return_value = (
                MockCommitmentExtractionOutput(
                    commitments=[
                        MockCommitment(title="Commitment A", quoted_text="Commitment A", confidence=0.9),
                        MockCommitment(title="Commitment B", quoted_text="Commitment B", confidence=0.8),
                        MockCommitment(title="Commitment C", quoted_text="Commitment C", confidence=0.7),
                    ]
                ),
                MockLLMCall(),
            )
            mock_llm.return_value = mock_service

            result = await extract_commitments_node(state)

            # Average of 0.9, 0.8, 0.7 = 0.8
            assert result["confidence"]["by_type"]["commitments"] == pytest.approx(0.8)


class TestTraceCompleteness:
    """Tests for trace information completeness."""

    async def test_trace_includes_all_nodes(self, factory):
        """Test trace includes timing for all executed nodes."""
        from src.orchestrator.nodes.parse import parse_messages_node

        state = IntelligenceState(
            input=AnalysisInput(
                organization_id=factory.organization_id(),
                content="Test",
                source_type="api",
            ),
        )

        result = await parse_messages_node(state)

        trace = result["trace"]
        assert "node_timings" in trace
        assert "parse_messages" in trace["node_timings"]

        timing = trace["node_timings"]["parse_messages"]
        assert timing.started_at is not None
        assert timing.completed_at is not None
        assert timing.completed_at >= timing.started_at
