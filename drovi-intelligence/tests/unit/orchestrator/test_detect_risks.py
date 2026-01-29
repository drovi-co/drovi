"""
Unit tests for the detect_risks node.

Tests the risk detection functionality.
"""

import pytest
from unittest.mock import AsyncMock, patch
from dataclasses import dataclass, field
from typing import Optional

from src.orchestrator.nodes.detect_risks import detect_risks_node
from src.orchestrator.state import (
    IntelligenceState,
    AnalysisInput,
    ParsedMessage,
    ExtractedIntelligence,
    ExtractedCommitment,
    ExtractedDecision,
    DetectedRisk,
    Confidence,
)

pytestmark = [pytest.mark.unit, pytest.mark.asyncio]


@dataclass
class MockRisk:
    """Mock risk from LLM output."""
    type: str = "deadline_risk"  # Valid types: deadline_risk, commitment_conflict, unclear_ownership, missing_information, escalation_needed, policy_violation, financial_risk, relationship_risk, sensitive_data, contradiction, fraud_signal, other
    title: str = "Test risk"
    description: str = "Test risk description"
    severity: str = "medium"
    related_commitment_indices: list = field(default_factory=list)
    related_decision_indices: list = field(default_factory=list)
    suggested_action: Optional[str] = None
    quoted_text: Optional[str] = None
    confidence: float = 0.8
    reasoning: str = "Identified risk in analysis"


@dataclass
class MockRiskDetectionOutput:
    """Mock risk detection output from LLM."""
    risks: list = field(default_factory=list)


@dataclass
class MockLLMCall:
    """Mock LLM call metadata."""
    model: str = "gpt-4"
    prompt_tokens: int = 300
    completion_tokens: int = 150
    duration_ms: int = 1000


class TestDetectRisksNode:
    """Tests for the detect_risks_node function."""

    async def test_detect_single_risk(self, factory):
        """Test detecting a single risk."""
        state = IntelligenceState(
            input=AnalysisInput(
                organization_id=factory.organization_id(),
                content="The deadline might be too tight",
                source_type="email",
            ),
            messages=[
                ParsedMessage(id="msg_0", content="Deadline concerns"),
            ],
            extracted=ExtractedIntelligence(
                commitments=[
                    ExtractedCommitment(
                        id="comm_0",
                        title="Deliver by Friday",
                        direction="owed_by_me",
                        due_date_text="Friday",
                        quoted_text="I'll deliver by Friday",
                        confidence=0.8,
                    ),
                ],
            ),
        )

        with patch("src.orchestrator.nodes.detect_risks.get_llm_service") as mock_llm:
            mock_service = AsyncMock()
            mock_service.complete_structured.return_value = (
                MockRiskDetectionOutput(
                    risks=[
                        MockRisk(
                            type="deadline_risk",
                            title="Tight deadline",
                            description="Deadline may not be achievable",
                            severity="medium",
                            related_commitment_indices=[0],
                        ),
                    ]
                ),
                MockLLMCall(),
            )
            mock_llm.return_value = mock_service

            result = await detect_risks_node(state)

            assert "extracted" in result
            assert len(result["extracted"].risks) == 1
            risk = result["extracted"].risks[0]
            assert risk.type == "deadline_risk"
            assert risk.severity == "medium"

    async def test_detect_multiple_risks(self, factory):
        """Test detecting multiple risks."""
        state = IntelligenceState(
            input=AnalysisInput(
                organization_id=factory.organization_id(),
                content="Multiple concerns here",
                source_type="slack",
            ),
            messages=[
                ParsedMessage(id="msg_0", content="Concerns"),
            ],
            extracted=ExtractedIntelligence(
                commitments=[
                    ExtractedCommitment(id="comm_0", title="Task 1", direction="owed_by_me", quoted_text="Task 1 text", confidence=0.8),
                    ExtractedCommitment(id="comm_1", title="Task 2", direction="owed_to_me", quoted_text="Task 2 text", confidence=0.8),
                ],
                decisions=[
                    ExtractedDecision(id="dec_0", title="Decision A", statement="We decided on A", status="pending", quoted_text="Decision A text", confidence=0.8),
                ],
            ),
        )

        with patch("src.orchestrator.nodes.detect_risks.get_llm_service") as mock_llm:
            mock_service = AsyncMock()
            mock_service.complete_structured.return_value = (
                MockRiskDetectionOutput(
                    risks=[
                        MockRisk(
                            type="deadline_risk",
                            title="Risk 1",
                            severity="low",
                        ),
                        MockRisk(
                            type="missing_information",
                            title="Risk 2",
                            severity="high",
                        ),
                        MockRisk(
                            type="financial_risk",
                            title="Risk 3",
                            severity="critical",
                        ),
                    ]
                ),
                MockLLMCall(),
            )
            mock_llm.return_value = mock_service

            result = await detect_risks_node(state)

            assert len(result["extracted"].risks) == 3

    async def test_detect_risk_links_to_commitment(self, factory):
        """Test risk links to related commitment."""
        commitment = ExtractedCommitment(
            id="comm_123",
            title="Deliver report",
            direction="owed_by_me",
            quoted_text="I'll deliver the report",
            confidence=0.8,
        )

        state = IntelligenceState(
            input=AnalysisInput(
                organization_id=factory.organization_id(),
                content="Risk related to commitment",
                source_type="email",
            ),
            messages=[
                ParsedMessage(id="msg_0", content="Risk"),
            ],
            extracted=ExtractedIntelligence(commitments=[commitment]),
        )

        with patch("src.orchestrator.nodes.detect_risks.get_llm_service") as mock_llm:
            mock_service = AsyncMock()
            mock_service.complete_structured.return_value = (
                MockRiskDetectionOutput(
                    risks=[
                        MockRisk(
                            title="Commitment at risk",
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

    async def test_detect_risk_links_to_decision(self, factory):
        """Test risk links to related decision."""
        decision = ExtractedDecision(
            id="dec_456",
            title="Technology choice",
            statement="We will use Python",
            status="pending",
            quoted_text="Technology choice decision",
            confidence=0.8,
        )

        state = IntelligenceState(
            input=AnalysisInput(
                organization_id=factory.organization_id(),
                content="Risk with decision",
                source_type="email",
            ),
            messages=[
                ParsedMessage(id="msg_0", content="Risk"),
            ],
            extracted=ExtractedIntelligence(decisions=[decision]),
        )

        with patch("src.orchestrator.nodes.detect_risks.get_llm_service") as mock_llm:
            mock_service = AsyncMock()
            mock_service.complete_structured.return_value = (
                MockRiskDetectionOutput(
                    risks=[
                        MockRisk(
                            title="Decision risk",
                            related_decision_indices=[0],
                        ),
                    ]
                ),
                MockLLMCall(),
            )
            mock_llm.return_value = mock_service

            result = await detect_risks_node(state)

            risk = result["extracted"].risks[0]
            assert len(risk.related_to) == 1
            assert risk.related_to[0]["type"] == "decision"

    async def test_detect_high_severity_triggers_review(self, factory):
        """Test high severity risk triggers human review."""
        state = IntelligenceState(
            input=AnalysisInput(
                organization_id=factory.organization_id(),
                content="Critical issue",
                source_type="email",
            ),
            messages=[
                ParsedMessage(id="msg_0", content="Critical"),
            ],
            extracted=ExtractedIntelligence(),
            confidence=Confidence(),
        )

        with patch("src.orchestrator.nodes.detect_risks.get_llm_service") as mock_llm:
            mock_service = AsyncMock()
            mock_service.complete_structured.return_value = (
                MockRiskDetectionOutput(
                    risks=[
                        MockRisk(
                            title="Critical risk",
                            severity="critical",
                        ),
                    ]
                ),
                MockLLMCall(),
            )
            mock_llm.return_value = mock_service

            result = await detect_risks_node(state)

            assert result["confidence"]["needs_review"] is True
            assert "High severity" in result["confidence"]["review_reason"]

    async def test_detect_no_risks(self, factory):
        """Test when no risks are detected."""
        state = IntelligenceState(
            input=AnalysisInput(
                organization_id=factory.organization_id(),
                content="Everything looks good",
                source_type="email",
            ),
            messages=[
                ParsedMessage(id="msg_0", content="All good"),
            ],
            extracted=ExtractedIntelligence(),
        )

        with patch("src.orchestrator.nodes.detect_risks.get_llm_service") as mock_llm:
            mock_service = AsyncMock()
            mock_service.complete_structured.return_value = (
                MockRiskDetectionOutput(risks=[]),
                MockLLMCall(),
            )
            mock_llm.return_value = mock_service

            result = await detect_risks_node(state)

            assert len(result["extracted"].risks) == 0

    async def test_detect_risk_with_suggested_action(self, factory):
        """Test risk includes suggested mitigation action."""
        state = IntelligenceState(
            input=AnalysisInput(
                organization_id=factory.organization_id(),
                content="Potential issue",
                source_type="email",
            ),
            messages=[
                ParsedMessage(id="msg_0", content="Issue"),
            ],
            extracted=ExtractedIntelligence(),
        )

        with patch("src.orchestrator.nodes.detect_risks.get_llm_service") as mock_llm:
            mock_service = AsyncMock()
            mock_service.complete_structured.return_value = (
                MockRiskDetectionOutput(
                    risks=[
                        MockRisk(
                            title="Resource constraint",
                            type="missing_information",
                            suggested_action="Request additional resources or extend timeline",
                        ),
                    ]
                ),
                MockLLMCall(),
            )
            mock_llm.return_value = mock_service

            result = await detect_risks_node(state)

            risk = result["extracted"].risks[0]
            assert risk.suggested_action is not None
            assert "resources" in risk.suggested_action.lower()

    async def test_detect_risk_preserves_quoted_text(self, factory):
        """Test risk preserves source quoted text."""
        state = IntelligenceState(
            input=AnalysisInput(
                organization_id=factory.organization_id(),
                content="We might not make the deadline",
                source_type="email",
            ),
            messages=[
                ParsedMessage(id="msg_0", content="Might not make deadline"),
            ],
            extracted=ExtractedIntelligence(),
        )

        with patch("src.orchestrator.nodes.detect_risks.get_llm_service") as mock_llm:
            mock_service = AsyncMock()
            mock_service.complete_structured.return_value = (
                MockRiskDetectionOutput(
                    risks=[
                        MockRisk(
                            title="Deadline risk",
                            quoted_text="We might not make the deadline",
                        ),
                    ]
                ),
                MockLLMCall(),
            )
            mock_llm.return_value = mock_service

            result = await detect_risks_node(state)

            risk = result["extracted"].risks[0]
            assert "deadline" in risk.quoted_text.lower()

    async def test_detect_handles_llm_error(self, factory):
        """Test detection handles LLM errors gracefully."""
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

        with patch("src.orchestrator.nodes.detect_risks.get_llm_service") as mock_llm:
            mock_service = AsyncMock()
            mock_service.complete_structured.side_effect = Exception("LLM error")
            mock_llm.return_value = mock_service

            result = await detect_risks_node(state)

            assert "trace" in result
            assert "errors" in result["trace"]
            assert any("detect_risks" in e for e in result["trace"]["errors"])

    async def test_detect_records_timing(self, factory):
        """Test detection records timing information."""
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

        with patch("src.orchestrator.nodes.detect_risks.get_llm_service") as mock_llm:
            mock_service = AsyncMock()
            mock_service.complete_structured.return_value = (
                MockRiskDetectionOutput(),
                MockLLMCall(),
            )
            mock_llm.return_value = mock_service

            result = await detect_risks_node(state)

            assert "node_timings" in result["trace"]
            assert "detect_risks" in result["trace"]["node_timings"]

    async def test_detect_updates_confidence(self, factory):
        """Test detection updates confidence scores."""
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

        with patch("src.orchestrator.nodes.detect_risks.get_llm_service") as mock_llm:
            mock_service = AsyncMock()
            mock_service.complete_structured.return_value = (
                MockRiskDetectionOutput(
                    risks=[
                        MockRisk(confidence=0.9),
                        MockRisk(confidence=0.7),
                    ]
                ),
                MockLLMCall(),
            )
            mock_llm.return_value = mock_service

            result = await detect_risks_node(state)

            assert result["confidence"]["by_type"]["risks"] == 0.8

    async def test_detect_preserves_existing_extracted_data(self, factory):
        """Test detection preserves existing claims, commitments, decisions."""
        from src.orchestrator.state import ExtractedClaim
        existing_claims = [
            ExtractedClaim(id="claim_1", type="fact", content="Test claim", quoted_text="claim text", confidence=0.8)
        ]
        existing_commitments = [
            ExtractedCommitment(id="comm_1", title="C1", direction="owed_by_me", quoted_text="C1 text", confidence=0.8),
        ]
        existing_decisions = [
            ExtractedDecision(id="dec_1", title="D1", statement="Decision 1", status="made", quoted_text="D1 text", confidence=0.8),
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
            extracted=ExtractedIntelligence(
                claims=existing_claims,
                commitments=existing_commitments,
                decisions=existing_decisions,
            ),
        )

        with patch("src.orchestrator.nodes.detect_risks.get_llm_service") as mock_llm:
            mock_service = AsyncMock()
            mock_service.complete_structured.return_value = (
                MockRiskDetectionOutput(risks=[MockRisk()]),
                MockLLMCall(),
            )
            mock_llm.return_value = mock_service

            result = await detect_risks_node(state)

            assert len(result["extracted"].claims) == 1
            assert len(result["extracted"].commitments) == 1
            assert len(result["extracted"].decisions) == 1

    async def test_detect_various_risk_types(self, factory):
        """Test detection of various risk types."""
        state = IntelligenceState(
            input=AnalysisInput(
                organization_id=factory.organization_id(),
                content="Various risks",
                source_type="email",
            ),
            messages=[
                ParsedMessage(id="msg_0", content="Risks"),
            ],
            extracted=ExtractedIntelligence(),
        )

        risk_types = [
            "deadline_risk",
            "relationship_risk",
            "commitment_conflict",
            "missing_information",
            "policy_violation",
            "financial_risk",
        ]

        with patch("src.orchestrator.nodes.detect_risks.get_llm_service") as mock_llm:
            mock_service = AsyncMock()
            mock_service.complete_structured.return_value = (
                MockRiskDetectionOutput(
                    risks=[MockRisk(type=t, title=f"{t} detected") for t in risk_types]
                ),
                MockLLMCall(),
            )
            mock_llm.return_value = mock_service

            result = await detect_risks_node(state)

            detected_types = {r.type for r in result["extracted"].risks}
            assert detected_types == set(risk_types)

    async def test_detect_various_severity_levels(self, factory):
        """Test detection of various severity levels."""
        state = IntelligenceState(
            input=AnalysisInput(
                organization_id=factory.organization_id(),
                content="Various severities",
                source_type="email",
            ),
            messages=[
                ParsedMessage(id="msg_0", content="Severities"),
            ],
            extracted=ExtractedIntelligence(),
        )

        with patch("src.orchestrator.nodes.detect_risks.get_llm_service") as mock_llm:
            mock_service = AsyncMock()
            mock_service.complete_structured.return_value = (
                MockRiskDetectionOutput(
                    risks=[
                        MockRisk(severity="low"),
                        MockRisk(severity="medium"),
                        MockRisk(severity="high"),
                        MockRisk(severity="critical"),
                    ]
                ),
                MockLLMCall(),
            )
            mock_llm.return_value = mock_service

            result = await detect_risks_node(state)

            severities = {r.severity for r in result["extracted"].risks}
            assert severities == {"low", "medium", "high", "critical"}

    async def test_detect_records_llm_call(self, factory):
        """Test detection records LLM call metadata."""
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

        with patch("src.orchestrator.nodes.detect_risks.get_llm_service") as mock_llm:
            mock_service = AsyncMock()
            mock_service.complete_structured.return_value = (
                MockRiskDetectionOutput(),
                MockLLMCall(prompt_tokens=350, completion_tokens=180),
            )
            mock_llm.return_value = mock_service

            result = await detect_risks_node(state)

            assert len(result["trace"]["llm_calls"]) > 0
