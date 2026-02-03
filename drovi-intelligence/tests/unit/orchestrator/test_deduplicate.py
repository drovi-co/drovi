"""Tests for deduplication node parsing vector search results."""

import pytest
from unittest.mock import AsyncMock, patch

from src.orchestrator.state import AnalysisInput, IntelligenceState, ExtractedCommitment, ExtractedIntelligence
from src.orchestrator.nodes.deduplicate import deduplicate_node

pytestmark = [pytest.mark.unit, pytest.mark.asyncio]


async def test_deduplicate_parses_vector_results_with_node_field():
    commitment = ExtractedCommitment(
        title="Send proposal",
        description="Send proposal to client",
        direction="owed_by_me",
        quoted_text="I'll send the proposal tomorrow",
        confidence=0.9,
    )

    state = IntelligenceState(
        input=AnalysisInput(
            organization_id="org_test",
            content="",
            source_type="email",
        ),
        extracted=ExtractedIntelligence(commitments=[commitment]),
    )

    mock_graph = AsyncMock()
    mock_graph.vector_search.return_value = [
        {"node": {"id": "uio_123"}, "score": 0.9}
    ]

    with patch("src.graph.client.get_graph_client", new_callable=AsyncMock) as graph_factory:
        graph_factory.return_value = mock_graph
        with patch("src.orchestrator.nodes.deduplicate.generate_embedding") as embed_mock:
            embed_mock.return_value = [0.1, 0.2, 0.3]
            result = await deduplicate_node(state)

    dedup = result["deduplication"]
    assert "uio_123" in dedup.existing_uio_ids
    assert dedup.merge_candidates[0].existing_uio_id == "uio_123"
