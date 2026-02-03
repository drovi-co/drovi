"""Tests for summarize_long_content node."""

import pytest
from unittest.mock import AsyncMock, patch

from src.orchestrator.state import AnalysisInput, IntelligenceState, ParsedMessage
from src.orchestrator.nodes.summarize_long_content import summarize_long_content_node

pytestmark = [pytest.mark.unit, pytest.mark.asyncio]


async def test_summarize_long_content_updates_trace():
    long_text = "A" * 13000
    state = IntelligenceState(
        input=AnalysisInput(
            organization_id="org_test",
            content=long_text,
            source_type="email",
        ),
        messages=[ParsedMessage(id="msg_0", content=long_text)],
    )

    mock_llm = AsyncMock()
    mock_llm.complete.return_value = ("summary", None)

    with patch("src.orchestrator.nodes.summarize_long_content.get_llm_service") as llm_factory:
        llm_factory.return_value = mock_llm
        result = await summarize_long_content_node(state)

    assert "cleaned_content" in result
    chunk_size = 4000
    expected_chunks = [
        long_text[i:i + chunk_size]
        for i in range(0, len(long_text), chunk_size)
    ]
    expected_summary = "\n\n".join(["summary"] * len(expected_chunks))
    assert result["cleaned_content"]["summary"] == expected_summary
    assert state.messages[0].content == long_text

    trace = result.get("trace")
    assert trace is not None
    assert "summarize_long_content" in trace.node_timings
