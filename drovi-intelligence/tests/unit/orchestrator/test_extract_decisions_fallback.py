from __future__ import annotations

from dataclasses import dataclass, field
from unittest.mock import AsyncMock, patch

import pytest

from src.orchestrator.nodes.extract_decisions import extract_decisions_node
from src.orchestrator.state import (
    AnalysisInput,
    ExtractedClaim,
    ExtractedIntelligence,
    IntelligenceState,
    ParsedMessage,
)

pytestmark = [pytest.mark.unit, pytest.mark.asyncio]


@dataclass
class _EmptyDecisionOutput:
    decisions: list = field(default_factory=list)


@dataclass
class _MockLLMCall:
    model: str = "test-model"
    prompt_tokens: int = 10
    completion_tokens: int = 10
    duration_ms: int = 5


async def test_decision_fallback_derives_from_decision_like_claim(factory) -> None:
    state = IntelligenceState(
        input=AnalysisInput(
            organization_id=factory.organization_id(),
            content="Decision: we will proceed with the revised pricing plan.",
            source_type="email",
            user_email="jeremy@drovi.co",
            user_name="Jeremy",
        ),
        messages=[
            ParsedMessage(
                id="msg_1",
                content="Decision: we will proceed with the revised pricing plan.",
                sender_email="jeremy@drovi.co",
                sender_name="Jeremy",
                is_from_user=True,
            )
        ],
        extracted=ExtractedIntelligence(
            claims=[
                ExtractedClaim(
                    type="fact",
                    content="Decision: we will proceed with the revised pricing plan",
                    quoted_text="we will proceed with the revised pricing plan",
                    quoted_text_start=10,
                    quoted_text_end=56,
                    confidence=0.88,
                    source_message_id="msg_1",
                )
            ]
        ),
    )

    with (
        patch("src.orchestrator.nodes.extract_decisions.get_llm_service") as mock_llm,
        patch("src.orchestrator.nodes.extract_decisions.get_org_profile", new=AsyncMock(return_value=None)),
    ):
        mock_service = AsyncMock()
        mock_service.complete_structured.return_value = (_EmptyDecisionOutput(), _MockLLMCall())
        mock_llm.return_value = mock_service

        result = await extract_decisions_node(state)

    decisions = result["extracted"].decisions
    assert len(decisions) == 1
    assert decisions[0].status == "made"
    assert "proceed with" in decisions[0].statement.lower()
    assert decisions[0].decision_maker_is_user is True
    assert decisions[0].model_used == "claim_fallback"
