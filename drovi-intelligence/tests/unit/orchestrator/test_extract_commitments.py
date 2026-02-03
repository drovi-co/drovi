"""
Unit tests for the extract_commitments node.

Tests the commitment extraction functionality.
"""

import pytest
from unittest.mock import AsyncMock, patch, MagicMock
from dataclasses import dataclass, field
from datetime import datetime
from typing import Optional

from src.orchestrator.nodes.extract_commitments import extract_commitments_node
from src.orchestrator.state import (
    IntelligenceState,
    AnalysisInput,
    ParsedMessage,
    ExtractedIntelligence,
    ExtractedClaim,
    ExtractedCommitment,
    Classification,
    Confidence,
)

pytestmark = [pytest.mark.unit, pytest.mark.asyncio]


@dataclass
class MockCommitment:
    """Mock commitment from LLM output."""
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
    due_date: Optional[datetime] = None
    due_date_text: Optional[str] = None
    due_date_confidence: float = 0.0
    due_date_is_explicit: bool = False
    is_conditional: bool = False
    condition: Optional[str] = None
    quoted_text: str = "Default quoted text"  # Required field, not optional
    supporting_quotes: list = field(default_factory=list)
    confidence: float = 0.8
    reasoning: str = "Found commitment in text"
    claim_index: Optional[int] = None


@dataclass
class MockCommitmentExtractionOutput:
    """Mock commitment extraction output from LLM."""
    commitments: list = field(default_factory=list)

    def __post_init__(self):
        if not self.commitments:
            self.commitments = []


@dataclass
class MockLLMCall:
    """Mock LLM call metadata."""
    model: str = "gpt-4"
    prompt_tokens: int = 200
    completion_tokens: int = 100
    duration_ms: int = 800


class TestExtractCommitmentsNode:
    """Tests for the extract_commitments_node function."""

    async def test_extract_single_commitment(self, factory):
        """Test extracting a single commitment."""
        state = IntelligenceState(
            input=AnalysisInput(
                organization_id=factory.organization_id(),
                content="I'll send you the report by Friday",
                source_type="email",
                user_email="user@company.com",
            ),
            messages=[
                ParsedMessage(
                    id="msg_0",
                    content="I'll send you the report by Friday",
                    is_from_user=True,
                ),
            ],
            extracted=ExtractedIntelligence(
                claims=[
                    ExtractedClaim(
                        id="claim_0",
                        type="promise",  # Valid type: promise
                        content="I'll send report by Friday",
                        quoted_text="I'll send you the report by Friday",
                        confidence=0.8,
                    ),
                ],
            ),
        )

        with patch("src.orchestrator.nodes.extract_commitments.get_llm_service") as mock_llm:
            mock_service = AsyncMock()
            mock_service.complete_structured.return_value = (
                MockCommitmentExtractionOutput(
                    commitments=[
                        MockCommitment(
                            title="Send report",
                            description="Send the report by Friday",
                            direction="owed_by_me",
                            due_date_text="Friday",
                            quoted_text="I'll send you the report by Friday",
                            claim_index=0,
                        ),
                    ]
                ),
                MockLLMCall(),
            )
            mock_llm.return_value = mock_service

            result = await extract_commitments_node(state)

            assert "extracted" in result
            assert len(result["extracted"].commitments) == 1
            assert result["extracted"].commitments[0].title == "Send report"
            assert result["extracted"].commitments[0].direction == "owed_by_me"

    async def test_extract_multiple_commitments(self, factory):
        """Test extracting multiple commitments."""
        state = IntelligenceState(
            input=AnalysisInput(
                organization_id=factory.organization_id(),
                content="I'll handle the design and John will do the backend",
                source_type="email",
            ),
            messages=[
                ParsedMessage(id="msg_0", content="Design and backend tasks"),
            ],
            extracted=ExtractedIntelligence(),
        )

        with patch("src.orchestrator.nodes.extract_commitments.get_llm_service") as mock_llm:
            mock_service = AsyncMock()
            mock_service.complete_structured.return_value = (
                MockCommitmentExtractionOutput(
                    commitments=[
                        MockCommitment(
                            title="Handle design",
                            direction="owed_by_me",
                            debtor_is_user=True,
                        ),
                        MockCommitment(
                            title="Do backend",
                            direction="owed_to_me",
                            debtor_name="John",
                            debtor_is_user=False,
                        ),
                    ]
                ),
                MockLLMCall(),
            )
            mock_llm.return_value = mock_service

            result = await extract_commitments_node(state)

            assert len(result["extracted"].commitments) == 2

    async def test_extract_commitment_owed_to_me(self, factory):
        """Test extracting commitment owed to user."""
        state = IntelligenceState(
            input=AnalysisInput(
                organization_id=factory.organization_id(),
                content="John promised to review my PR today",
                source_type="slack",
            ),
            messages=[
                ParsedMessage(id="msg_0", content="John will review PR"),
            ],
            extracted=ExtractedIntelligence(),
        )

        with patch("src.orchestrator.nodes.extract_commitments.get_llm_service") as mock_llm:
            mock_service = AsyncMock()
            mock_service.complete_structured.return_value = (
                MockCommitmentExtractionOutput(
                    commitments=[
                        MockCommitment(
                            title="Review PR",
                            direction="owed_to_me",
                            debtor_name="John",
                            creditor_is_user=True,
                        ),
                    ]
                ),
                MockLLMCall(),
            )
            mock_llm.return_value = mock_service

            result = await extract_commitments_node(state)

            commitment = result["extracted"].commitments[0]
            assert commitment.direction == "owed_to_me"

    async def test_extract_commitment_with_due_date(self, factory):
        """Test extracting commitment with explicit due date."""
        state = IntelligenceState(
            input=AnalysisInput(
                organization_id=factory.organization_id(),
                content="I'll complete this by January 20th",
                source_type="email",
            ),
            messages=[
                ParsedMessage(id="msg_0", content="Complete by Jan 20th"),
            ],
            extracted=ExtractedIntelligence(),
        )

        with patch("src.orchestrator.nodes.extract_commitments.get_llm_service") as mock_llm:
            mock_service = AsyncMock()
            mock_service.complete_structured.return_value = (
                MockCommitmentExtractionOutput(
                    commitments=[
                        MockCommitment(
                            title="Complete task",
                            due_date=datetime(2024, 1, 20),
                            due_date_text="January 20th",
                            due_date_confidence=0.9,
                            due_date_is_explicit=True,
                        ),
                    ]
                ),
                MockLLMCall(),
            )
            mock_llm.return_value = mock_service

            result = await extract_commitments_node(state)

            commitment = result["extracted"].commitments[0]
            assert commitment.due_date == datetime(2024, 1, 20)  # datetime object, not string
            assert commitment.due_date_is_explicit is True
            assert commitment.due_date_confidence == 0.9

    async def test_extract_conditional_commitment(self, factory):
        """Test extracting conditional commitment."""
        state = IntelligenceState(
            input=AnalysisInput(
                organization_id=factory.organization_id(),
                content="If the budget is approved, I'll hire two more engineers",
                source_type="email",
            ),
            messages=[
                ParsedMessage(id="msg_0", content="Conditional hiring"),
            ],
            extracted=ExtractedIntelligence(),
        )

        with patch("src.orchestrator.nodes.extract_commitments.get_llm_service") as mock_llm:
            mock_service = AsyncMock()
            mock_service.complete_structured.return_value = (
                MockCommitmentExtractionOutput(
                    commitments=[
                        MockCommitment(
                            title="Hire engineers",
                            is_conditional=True,
                            condition="budget is approved",
                        ),
                    ]
                ),
                MockLLMCall(),
            )
            mock_llm.return_value = mock_service

            result = await extract_commitments_node(state)

            commitment = result["extracted"].commitments[0]
            assert commitment.is_conditional is True
            assert "budget" in commitment.condition.lower()

    async def test_extract_commitment_with_priority(self, factory):
        """Test extracting commitment with priority level."""
        state = IntelligenceState(
            input=AnalysisInput(
                organization_id=factory.organization_id(),
                content="This is urgent - I'll fix the bug immediately",
                source_type="slack",
            ),
            messages=[
                ParsedMessage(id="msg_0", content="Urgent bug fix"),
            ],
            extracted=ExtractedIntelligence(),
        )

        with patch("src.orchestrator.nodes.extract_commitments.get_llm_service") as mock_llm:
            mock_service = AsyncMock()
            mock_service.complete_structured.return_value = (
                MockCommitmentExtractionOutput(
                    commitments=[
                        MockCommitment(
                            title="Fix urgent bug",
                            priority="urgent",  # Valid values: low, medium, high, urgent
                        ),
                    ]
                ),
                MockLLMCall(),
            )
            mock_llm.return_value = mock_service

            result = await extract_commitments_node(state)

            commitment = result["extracted"].commitments[0]
            assert commitment.priority == "urgent"

    async def test_extract_no_commitments(self, factory):
        """Test when no commitments are found."""
        state = IntelligenceState(
            input=AnalysisInput(
                organization_id=factory.organization_id(),
                content="Thanks for the update!",
                source_type="email",
            ),
            messages=[
                ParsedMessage(id="msg_0", content="Thanks!"),
            ],
            extracted=ExtractedIntelligence(),
        )

        with patch("src.orchestrator.nodes.extract_commitments.get_llm_service") as mock_llm:
            mock_service = AsyncMock()
            mock_service.complete_structured.return_value = (
                MockCommitmentExtractionOutput(commitments=[]),
                MockLLMCall(),
            )
            mock_llm.return_value = mock_service

            result = await extract_commitments_node(state)

            assert len(result["extracted"].commitments) == 0

    async def test_extract_links_to_claim(self, factory):
        """Test commitment links to source claim."""
        claim = ExtractedClaim(
            id="claim_123",
            type="promise",
            content="Will deliver report",
            quoted_text="I'll deliver the report",
            confidence=0.8,
        )

        state = IntelligenceState(
            input=AnalysisInput(
                organization_id=factory.organization_id(),
                content="I'll deliver the report",
                source_type="email",
            ),
            messages=[
                ParsedMessage(id="msg_0", content="Deliver report"),
            ],
            extracted=ExtractedIntelligence(claims=[claim]),
        )

        with patch("src.orchestrator.nodes.extract_commitments.get_llm_service") as mock_llm:
            mock_service = AsyncMock()
            mock_service.complete_structured.return_value = (
                MockCommitmentExtractionOutput(
                    commitments=[
                        MockCommitment(
                            title="Deliver report",
                            claim_index=0,
                        ),
                    ]
                ),
                MockLLMCall(),
            )
            mock_llm.return_value = mock_service

            result = await extract_commitments_node(state)

            commitment = result["extracted"].commitments[0]
            assert commitment.claim_id == "claim_123"

    async def test_extract_preserves_quoted_text(self, factory):
        """Test commitment preserves quoted text from source."""
        state = IntelligenceState(
            input=AnalysisInput(
                organization_id=factory.organization_id(),
                content="I guarantee we'll ship by Q2",
                source_type="email",
            ),
            messages=[
                ParsedMessage(id="msg_0", content="Ship by Q2"),
            ],
            extracted=ExtractedIntelligence(),
        )

        with patch("src.orchestrator.nodes.extract_commitments.get_llm_service") as mock_llm:
            mock_service = AsyncMock()
            mock_service.complete_structured.return_value = (
                MockCommitmentExtractionOutput(
                    commitments=[
                        MockCommitment(
                            title="Ship product",
                            quoted_text="I guarantee we'll ship by Q2",
                        ),
                    ]
                ),
                MockLLMCall(),
            )
            mock_llm.return_value = mock_service

            result = await extract_commitments_node(state)

            commitment = result["extracted"].commitments[0]
            assert "Q2" in commitment.quoted_text

    async def test_extract_handles_llm_error(self, factory):
        """Test extraction handles LLM errors gracefully."""
        state = IntelligenceState(
            input=AnalysisInput(
                organization_id=factory.organization_id(),
                content="Test content",
                source_type="api",
            ),
            messages=[
                ParsedMessage(id="msg_0", content="Test"),
            ],
            extracted=ExtractedIntelligence(),
        )

        with patch("src.orchestrator.nodes.extract_commitments.get_llm_service") as mock_llm:
            mock_service = AsyncMock()
            mock_service.complete_structured.side_effect = Exception("LLM error")
            mock_llm.return_value = mock_service

            result = await extract_commitments_node(state)

            # Should handle error gracefully
            assert "trace" in result
            assert "errors" in result["trace"]

    async def test_extract_records_timing(self, factory):
        """Test extraction records timing information."""
        state = IntelligenceState(
            input=AnalysisInput(
                organization_id=factory.organization_id(),
                content="Test",
                source_type="api",
            ),
            messages=[
                ParsedMessage(id="msg_0", content="Test"),
            ],
            extracted=ExtractedIntelligence(),
        )

        with patch("src.orchestrator.nodes.extract_commitments.get_llm_service") as mock_llm:
            mock_service = AsyncMock()
            mock_service.complete_structured.return_value = (
                MockCommitmentExtractionOutput(),
                MockLLMCall(),
            )
            mock_llm.return_value = mock_service

            result = await extract_commitments_node(state)

            assert "node_timings" in result["trace"]
            assert "extract_commitments" in result["trace"]["node_timings"]

    async def test_extract_updates_confidence(self, factory):
        """Test extraction updates confidence scores."""
        state = IntelligenceState(
            input=AnalysisInput(
                organization_id=factory.organization_id(),
                content="Test",
                source_type="api",
            ),
            messages=[
                ParsedMessage(id="msg_0", content="Test"),
            ],
            extracted=ExtractedIntelligence(),
            confidence=Confidence(),
        )

        with patch("src.orchestrator.nodes.extract_commitments.get_llm_service") as mock_llm:
            mock_service = AsyncMock()
            mock_service.complete_structured.return_value = (
                MockCommitmentExtractionOutput(
                    commitments=[
                        MockCommitment(title="Commitment A", quoted_text="Commitment A", confidence=0.9),
                        MockCommitment(title="Commitment B", quoted_text="Commitment B", confidence=0.7),
                    ]
                ),
                MockLLMCall(),
            )
            mock_llm.return_value = mock_service

            result = await extract_commitments_node(state)

            assert "confidence" in result
            assert result["confidence"]["by_type"]["commitments"] == 0.8  # avg of 0.9 and 0.7

    async def test_extract_preserves_existing_claims(self, factory):
        """Test extraction preserves existing claims in state."""
        existing_claims = [
            ExtractedClaim(id="claim_1", type="fact", content="Fact 1", quoted_text="Fact 1 text", confidence=0.8),
            ExtractedClaim(id="claim_2", type="fact", content="Fact 2", quoted_text="Fact 2 text", confidence=0.8),
        ]

        state = IntelligenceState(
            input=AnalysisInput(
                organization_id=factory.organization_id(),
                content="Test",
                source_type="api",
            ),
            messages=[
                ParsedMessage(id="msg_0", content="Test"),
            ],
            extracted=ExtractedIntelligence(claims=existing_claims),
        )

        with patch("src.orchestrator.nodes.extract_commitments.get_llm_service") as mock_llm:
            mock_service = AsyncMock()
            mock_service.complete_structured.return_value = (
                MockCommitmentExtractionOutput(
                    commitments=[MockCommitment()],
                ),
                MockLLMCall(),
            )
            mock_llm.return_value = mock_service

            result = await extract_commitments_node(state)

            # Should preserve existing claims
            assert len(result["extracted"].claims) == 2

    async def test_extract_records_llm_call(self, factory):
        """Test extraction records LLM call metadata."""
        state = IntelligenceState(
            input=AnalysisInput(
                organization_id=factory.organization_id(),
                content="Test",
                source_type="api",
            ),
            messages=[
                ParsedMessage(id="msg_0", content="Test"),
            ],
            extracted=ExtractedIntelligence(),
        )

        with patch("src.orchestrator.nodes.extract_commitments.get_llm_service") as mock_llm:
            mock_service = AsyncMock()
            mock_service.complete_structured.return_value = (
                MockCommitmentExtractionOutput(),
                MockLLMCall(prompt_tokens=250, completion_tokens=120),
            )
            mock_llm.return_value = mock_service

            result = await extract_commitments_node(state)

            assert len(result["trace"]["llm_calls"]) > 0
            llm_call = result["trace"]["llm_calls"][-1]
            assert llm_call.prompt_tokens == 250
