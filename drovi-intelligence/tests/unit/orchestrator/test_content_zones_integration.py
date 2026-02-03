"""Tests that content_zones output is wired into parsing."""

import pytest

from src.orchestrator.state import AnalysisInput, IntelligenceState
from src.orchestrator.nodes.content_zones import content_zones_node
from src.orchestrator.nodes.parse import parse_messages_node

pytestmark = [pytest.mark.unit, pytest.mark.asyncio]


async def test_content_zones_updates_input_for_parsing():
    content = """Hello team,\n\nHere is the update.\n\n--\nJohn Doe\nSent from my iPhone"""

    state = IntelligenceState(
        input=AnalysisInput(
            organization_id="org_test",
            content=content,
            source_type="email",
        )
    )

    update = await content_zones_node(state)
    state = state.model_copy(update=update)

    assert "Sent from my iPhone" not in state.input.content

    parsed = await parse_messages_node(state)
    parsed_state = state.model_copy(update=parsed)

    # Ensure parsed messages do not include the signature
    combined = "\n".join([m.content for m in parsed_state.messages])
    assert "Sent from my iPhone" not in combined
