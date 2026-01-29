"""
Unit tests for the classify node.

Tests the content classification functionality.
"""

import pytest
from unittest.mock import AsyncMock, patch, MagicMock
from dataclasses import dataclass

from src.orchestrator.nodes.classify import classify_node
from src.orchestrator.state import (
    IntelligenceState,
    AnalysisInput,
    ParsedMessage,
    Classification,
    Routing,
)

pytestmark = [pytest.mark.unit, pytest.mark.asyncio]


@dataclass
class MockClassificationOutput:
    """Mock classification output from LLM."""
    has_intelligence: bool = True
    has_commitments: bool = False
    has_decisions: bool = False
    has_claims: bool = True
    has_risks: bool = False
    has_questions: bool = False
    intent: str = "informational"
    topics: list = None
    urgency: float = 0.3
    importance: float = 0.5
    sentiment: float = 0.0  # -1 to 1 scale (negative to positive)
    confidence: float = 0.8
    reasoning: str = "Test reasoning"

    def __post_init__(self):
        if self.topics is None:
            self.topics = ["general"]


@dataclass
class MockLLMCall:
    """Mock LLM call metadata."""
    model: str = "gpt-4"
    prompt_tokens: int = 100
    completion_tokens: int = 50
    duration_ms: int = 500


class TestClassifyNode:
    """Tests for the classify_node function."""

    async def test_classify_node_success(self, factory):
        """Test successful classification."""
        state = IntelligenceState(
            input=AnalysisInput(
                organization_id=factory.organization_id(),
                content="I'll send you the report by Friday",
                source_type="email",
            ),
            messages=[
                ParsedMessage(
                    id="msg_0",
                    content="I'll send you the report by Friday",
                    is_from_user=True,
                ),
            ],
        )

        with patch("src.orchestrator.nodes.classify.get_llm_service") as mock_llm:
            mock_service = AsyncMock()
            mock_service.complete_structured.return_value = (
                MockClassificationOutput(
                    has_intelligence=True,
                    has_commitments=True,
                    urgency=0.7,
                ),
                MockLLMCall(),
            )
            mock_llm.return_value = mock_service

            result = await classify_node(state)

            assert "classification" in result
            assert "routing" in result
            assert result["classification"].has_commitments is True

    async def test_classify_sets_routing_for_commitments(self, factory):
        """Test classification sets routing flags for commitments."""
        state = IntelligenceState(
            input=AnalysisInput(
                organization_id=factory.organization_id(),
                content="I promise to deliver this",
                source_type="api",
            ),
            messages=[
                ParsedMessage(id="msg_0", content="I promise to deliver this"),
            ],
        )

        with patch("src.orchestrator.nodes.classify.get_llm_service") as mock_llm:
            mock_service = AsyncMock()
            mock_service.complete_structured.return_value = (
                MockClassificationOutput(has_commitments=True),
                MockLLMCall(),
            )
            mock_llm.return_value = mock_service

            result = await classify_node(state)

            assert result["routing"].should_extract_commitments is True

    async def test_classify_sets_routing_for_decisions(self, factory):
        """Test classification sets routing flags for decisions."""
        state = IntelligenceState(
            input=AnalysisInput(
                organization_id=factory.organization_id(),
                content="We've decided to use React",
                source_type="api",
            ),
            messages=[
                ParsedMessage(id="msg_0", content="We've decided to use React"),
            ],
        )

        with patch("src.orchestrator.nodes.classify.get_llm_service") as mock_llm:
            mock_service = AsyncMock()
            mock_service.complete_structured.return_value = (
                MockClassificationOutput(has_decisions=True),
                MockLLMCall(),
            )
            mock_llm.return_value = mock_service

            result = await classify_node(state)

            assert result["routing"].should_extract_decisions is True

    async def test_classify_detects_risks_from_urgency(self, factory):
        """Test high urgency triggers risk analysis."""
        state = IntelligenceState(
            input=AnalysisInput(
                organization_id=factory.organization_id(),
                content="This is urgent! We might miss the deadline!",
                source_type="email",
            ),
            messages=[
                ParsedMessage(id="msg_0", content="This is urgent!"),
            ],
        )

        with patch("src.orchestrator.nodes.classify.get_llm_service") as mock_llm:
            mock_service = AsyncMock()
            mock_service.complete_structured.return_value = (
                MockClassificationOutput(has_risks=False, urgency=0.9),
                MockLLMCall(),
            )
            mock_llm.return_value = mock_service

            result = await classify_node(state)

            # High urgency should trigger risk analysis
            assert result["routing"].should_analyze_risk is True

    async def test_classify_skips_extraction_for_no_intelligence(self, factory):
        """Test content without intelligence skips extraction."""
        state = IntelligenceState(
            input=AnalysisInput(
                organization_id=factory.organization_id(),
                content="Thanks!",
                source_type="api",
            ),
            messages=[
                ParsedMessage(id="msg_0", content="Thanks!"),
            ],
        )

        with patch("src.orchestrator.nodes.classify.get_llm_service") as mock_llm:
            mock_service = AsyncMock()
            mock_service.complete_structured.return_value = (
                MockClassificationOutput(has_intelligence=False),
                MockLLMCall(),
            )
            mock_llm.return_value = mock_service

            result = await classify_node(state)

            assert result["routing"].skip_remaining_nodes is True

    async def test_classify_escalates_low_confidence(self, factory):
        """Test low confidence results escalate to human."""
        state = IntelligenceState(
            input=AnalysisInput(
                organization_id=factory.organization_id(),
                content="Ambiguous content",
                source_type="api",
            ),
            messages=[
                ParsedMessage(id="msg_0", content="Ambiguous content"),
            ],
        )

        with patch("src.orchestrator.nodes.classify.get_llm_service") as mock_llm:
            mock_service = AsyncMock()
            mock_service.complete_structured.return_value = (
                MockClassificationOutput(confidence=0.2),
                MockLLMCall(),
            )
            mock_llm.return_value = mock_service

            result = await classify_node(state)

            assert result["routing"].escalate_to_human is True

    async def test_classify_handles_llm_error(self, factory):
        """Test classification handles LLM errors gracefully."""
        state = IntelligenceState(
            input=AnalysisInput(
                organization_id=factory.organization_id(),
                content="Test content",
                source_type="api",
            ),
            messages=[
                ParsedMessage(id="msg_0", content="Test content"),
            ],
        )

        with patch("src.orchestrator.nodes.classify.get_llm_service") as mock_llm:
            mock_service = AsyncMock()
            mock_service.complete_structured.side_effect = Exception("LLM error")
            mock_llm.return_value = mock_service

            result = await classify_node(state)

            # Should return safe defaults
            assert "classification" in result
            assert result["classification"].confidence == 0.0
            assert result["routing"].escalate_to_human is True
            assert "errors" in result["trace"]

    async def test_classify_records_llm_call(self, factory):
        """Test classification records LLM call in trace."""
        state = IntelligenceState(
            input=AnalysisInput(
                organization_id=factory.organization_id(),
                content="Test",
                source_type="api",
            ),
            messages=[
                ParsedMessage(id="msg_0", content="Test"),
            ],
        )

        with patch("src.orchestrator.nodes.classify.get_llm_service") as mock_llm:
            mock_service = AsyncMock()
            mock_service.complete_structured.return_value = (
                MockClassificationOutput(),
                MockLLMCall(model="gpt-4", prompt_tokens=150, completion_tokens=75),
            )
            mock_llm.return_value = mock_service

            result = await classify_node(state)

            assert "trace" in result
            assert "llm_calls" in result["trace"]
            assert len(result["trace"]["llm_calls"]) > 0

    async def test_classify_records_timing(self, factory):
        """Test classification records timing information."""
        state = IntelligenceState(
            input=AnalysisInput(
                organization_id=factory.organization_id(),
                content="Test",
                source_type="api",
            ),
            messages=[
                ParsedMessage(id="msg_0", content="Test"),
            ],
        )

        with patch("src.orchestrator.nodes.classify.get_llm_service") as mock_llm:
            mock_service = AsyncMock()
            mock_service.complete_structured.return_value = (
                MockClassificationOutput(),
                MockLLMCall(),
            )
            mock_llm.return_value = mock_service

            result = await classify_node(state)

            assert "node_timings" in result["trace"]
            assert "classify" in result["trace"]["node_timings"]

    async def test_classify_extracts_topics(self, factory):
        """Test classification extracts topics."""
        state = IntelligenceState(
            input=AnalysisInput(
                organization_id=factory.organization_id(),
                content="Let's discuss the marketing budget for Q1",
                source_type="email",
            ),
            messages=[
                ParsedMessage(id="msg_0", content="Marketing budget Q1"),
            ],
        )

        with patch("src.orchestrator.nodes.classify.get_llm_service") as mock_llm:
            mock_service = AsyncMock()
            mock_service.complete_structured.return_value = (
                MockClassificationOutput(topics=["marketing", "budget", "q1"]),
                MockLLMCall(),
            )
            mock_llm.return_value = mock_service

            result = await classify_node(state)

            assert len(result["classification"].topics) == 3
            assert "marketing" in result["classification"].topics

    async def test_classify_detects_sentiment(self, factory):
        """Test classification detects sentiment."""
        state = IntelligenceState(
            input=AnalysisInput(
                organization_id=factory.organization_id(),
                content="I'm really excited about this opportunity!",
                source_type="email",
            ),
            messages=[
                ParsedMessage(id="msg_0", content="Really excited!"),
            ],
        )

        with patch("src.orchestrator.nodes.classify.get_llm_service") as mock_llm:
            mock_service = AsyncMock()
            mock_service.complete_structured.return_value = (
                MockClassificationOutput(sentiment=0.8),  # Positive sentiment on -1 to 1 scale
                MockLLMCall(),
            )
            mock_llm.return_value = mock_service

            result = await classify_node(state)

            assert result["classification"].sentiment > 0  # Positive sentiment

    async def test_classify_combines_multiple_messages(self, factory):
        """Test classification combines content from multiple messages."""
        state = IntelligenceState(
            input=AnalysisInput(
                organization_id=factory.organization_id(),
                content="Thread content",
                source_type="email",
            ),
            messages=[
                ParsedMessage(id="msg_0", content="First message"),
                ParsedMessage(id="msg_1", content="Second message"),
                ParsedMessage(id="msg_2", content="Third message"),
            ],
        )

        with patch("src.orchestrator.nodes.classify.get_llm_service") as mock_llm:
            mock_service = AsyncMock()
            mock_service.complete_structured.return_value = (
                MockClassificationOutput(),
                MockLLMCall(),
            )
            mock_llm.return_value = mock_service

            result = await classify_node(state)

            # Should have been called with combined content
            mock_service.complete_structured.assert_called_once()

    async def test_classify_preserves_reasoning(self, factory):
        """Test classification preserves LLM reasoning."""
        state = IntelligenceState(
            input=AnalysisInput(
                organization_id=factory.organization_id(),
                content="Test",
                source_type="api",
            ),
            messages=[
                ParsedMessage(id="msg_0", content="Test"),
            ],
        )

        with patch("src.orchestrator.nodes.classify.get_llm_service") as mock_llm:
            mock_service = AsyncMock()
            mock_service.complete_structured.return_value = (
                MockClassificationOutput(reasoning="This contains a clear commitment"),
                MockLLMCall(),
            )
            mock_llm.return_value = mock_service

            result = await classify_node(state)

            assert "commitment" in result["classification"].reasoning.lower()

    async def test_classify_always_enables_deduplication(self, factory):
        """Test classification always enables deduplication."""
        state = IntelligenceState(
            input=AnalysisInput(
                organization_id=factory.organization_id(),
                content="Test",
                source_type="api",
            ),
            messages=[
                ParsedMessage(id="msg_0", content="Test"),
            ],
        )

        with patch("src.orchestrator.nodes.classify.get_llm_service") as mock_llm:
            mock_service = AsyncMock()
            mock_service.complete_structured.return_value = (
                MockClassificationOutput(),
                MockLLMCall(),
            )
            mock_llm.return_value = mock_service

            result = await classify_node(state)

            assert result["routing"].should_deduplicate is True
