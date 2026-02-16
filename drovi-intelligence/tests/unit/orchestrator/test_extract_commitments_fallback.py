from __future__ import annotations

from dataclasses import dataclass, field
from unittest.mock import AsyncMock, patch

import pytest

from src.orchestrator.nodes.extract_commitments import extract_commitments_node
from src.orchestrator.state import (
    AnalysisInput,
    ExtractedClaim,
    ExtractedIntelligence,
    IntelligenceState,
    ParsedMessage,
)

pytestmark = [pytest.mark.unit, pytest.mark.asyncio]


@dataclass
class _EmptyCommitmentOutput:
    commitments: list = field(default_factory=list)


@dataclass
class _MockLLMCall:
    model: str = "test-model"
    prompt_tokens: int = 10
    completion_tokens: int = 10
    duration_ms: int = 5


async def test_commitment_fallback_derives_from_deadline_claim(factory) -> None:
    state = IntelligenceState(
        input=AnalysisInput(
            organization_id=factory.organization_id(),
            content="Your Grafana trial ends tomorrow. Please renew.",
            source_type="email",
            user_email="jeremy@drovi.co",
            user_name="Jeremy",
        ),
        messages=[
            ParsedMessage(
                id="msg_1",
                content="Your Grafana trial ends tomorrow. Please renew.",
                sender_email="vendor@grafana.com",
                sender_name="Grafana",
                is_from_user=False,
            )
        ],
        extracted=ExtractedIntelligence(
            claims=[
                ExtractedClaim(
                    type="deadline",
                    content="The Grafana trial ends tomorrow",
                    quoted_text="Grafana trial ends tomorrow",
                    quoted_text_start=4,
                    quoted_text_end=31,
                    confidence=0.92,
                    source_message_id="msg_1",
                )
            ]
        ),
    )

    with (
        patch("src.orchestrator.nodes.extract_commitments.get_llm_service") as mock_llm,
        patch("src.orchestrator.nodes.extract_commitments.get_org_profile", new=AsyncMock(return_value=None)),
    ):
        mock_service = AsyncMock()
        mock_service.complete_structured.return_value = (_EmptyCommitmentOutput(), _MockLLMCall())
        mock_llm.return_value = mock_service

        result = await extract_commitments_node(state)

    commitments = result["extracted"].commitments
    assert len(commitments) == 1
    assert commitments[0].title.startswith("The Grafana trial")
    assert commitments[0].direction == "owed_to_me"
    assert commitments[0].model_used == "claim_fallback"
    assert commitments[0].quoted_text == "Grafana trial ends tomorrow"
