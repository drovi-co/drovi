from __future__ import annotations

from dataclasses import dataclass, field
from unittest.mock import AsyncMock, patch

import pytest

from src.orchestrator.nodes.extract_tasks import extract_tasks_node
from src.orchestrator.state import (
    AnalysisInput,
    ExtractedCommitment,
    ExtractedIntelligence,
    IntelligenceState,
    ParsedMessage,
)

pytestmark = [pytest.mark.unit, pytest.mark.asyncio]


@dataclass
class _EmptyTaskOutput:
    tasks: list = field(default_factory=list)


@dataclass
class _MockLLMCall:
    model: str = "test-model"
    prompt_tokens: int = 10
    completion_tokens: int = 10
    duration_ms: int = 5


async def test_task_fallback_derives_from_commitments(factory) -> None:
    commitment = ExtractedCommitment(
        title="Renew Grafana subscription",
        description="Renew Grafana subscription before trial expires",
        direction="owed_by_me",
        priority="high",
        debtor_name="Jeremy",
        debtor_email="jeremy@drovi.co",
        debtor_is_user=True,
        creditor_name="Grafana",
        creditor_email="vendor@grafana.com",
        creditor_is_user=False,
        quoted_text="Please renew before trial expires",
        quoted_text_start=0,
        quoted_text_end=35,
        confidence=0.9,
        source_message_id="msg_1",
    )
    state = IntelligenceState(
        input=AnalysisInput(
            organization_id=factory.organization_id(),
            content="Please renew before trial expires",
            source_type="email",
            user_email="jeremy@drovi.co",
            user_name="Jeremy",
        ),
        messages=[
            ParsedMessage(
                id="msg_1",
                content="Please renew before trial expires",
                is_from_user=True,
            )
        ],
        extracted=ExtractedIntelligence(commitments=[commitment]),
    )

    with (
        patch("src.orchestrator.nodes.extract_tasks.get_llm_service") as mock_llm,
        patch("src.orchestrator.nodes.extract_tasks.get_org_profile", new=AsyncMock(return_value=None)),
    ):
        mock_service = AsyncMock()
        mock_service.complete_structured.return_value = (_EmptyTaskOutput(), _MockLLMCall())
        mock_llm.return_value = mock_service

        result = await extract_tasks_node(state)

    tasks = result["extracted"].tasks
    assert len(tasks) == 1
    assert tasks[0].title == "Renew Grafana subscription"
    assert tasks[0].commitment_id == commitment.id
    assert tasks[0].assignee_is_user is True
    assert tasks[0].model_used == "commitment_fallback"
