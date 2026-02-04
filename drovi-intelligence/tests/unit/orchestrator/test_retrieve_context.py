"""
Unit tests for retrieve_context_node.
"""

from unittest.mock import AsyncMock, patch

import pytest

from src.orchestrator.nodes.retrieve_context import retrieve_context_node
from src.orchestrator.state import AnalysisInput, IntelligenceState, ParsedMessage


pytestmark = pytest.mark.unit


class _FakeCache:
    def __init__(self, payload=None):
        self.payload = payload
        self.set_called = False

    async def get(self, _key):
        return self.payload

    async def set(self, _key, _payload, **_kwargs):
        self.set_called = True


@pytest.mark.asyncio
async def test_retrieve_context_uses_cache():
    state = IntelligenceState(
        input=AnalysisInput(
            organization_id="org_123",
            content="Discussing the roadmap",
            source_type="email",
            conversation_id="conv_1",
        ),
        messages=[ParsedMessage(id="m1", content="Discussing the roadmap")],
    )

    cache_payload = {"recent_uios": [{"id": "cached"}], "conversation_uios": []}
    fake_cache = _FakeCache(payload=cache_payload)

    with patch(
        "src.orchestrator.nodes.retrieve_context.get_context_cache",
        AsyncMock(return_value=fake_cache),
    ), patch(
        "src.orchestrator.nodes.retrieve_context.get_memory_service",
        AsyncMock(return_value=AsyncMock(get_context_version=AsyncMock(return_value="v1"))),
    ), patch(
        "src.orchestrator.nodes.retrieve_context.get_hybrid_search",
        AsyncMock(),
    ) as mock_hybrid:
        result = await retrieve_context_node(state)

    assert result["memory_context"]["recent_uios"][0]["id"] == "cached"
    mock_hybrid.assert_not_called()


@pytest.mark.asyncio
async def test_retrieve_context_computes_relevant_uios():
    state = IntelligenceState(
        input=AnalysisInput(
            organization_id="org_123",
            content="Please send the proposal to Acme",
            source_type="email",
            conversation_id="conv_2",
            metadata={
                "context_budget": {
                    "stale_days": 10000,
                    "decay_threshold": 0.0,
                    "min_relevance": 0.0,
                }
            },
        ),
        messages=[ParsedMessage(id="m1", content="Please send the proposal to Acme")],
    )

    hybrid = AsyncMock()
    hybrid.search = AsyncMock(
        return_value=[
            {
                "id": "u1",
                "type": "commitment",
                "score": 0.7,
                "properties": {
                    "title": "Send proposal to Acme",
                    "status": "active",
                    "updatedAt": "2024-01-01T00:00:00",
                },
            }
        ]
    )

    memory = AsyncMock()
    memory.search_uios_as_of = AsyncMock(return_value=[])
    memory.get_conversation_uios = AsyncMock(return_value=[])
    memory.get_context_version = AsyncMock(return_value="v1")
    memory.get_uio_evidence = AsyncMock(return_value={})

    fake_cache = _FakeCache(payload=None)

    with patch(
        "src.orchestrator.nodes.retrieve_context.get_context_cache",
        AsyncMock(return_value=fake_cache),
    ), patch(
        "src.orchestrator.nodes.retrieve_context.get_memory_service",
        AsyncMock(return_value=memory),
    ), patch(
        "src.orchestrator.nodes.retrieve_context.get_hybrid_search",
        AsyncMock(return_value=hybrid),
    ):
        result = await retrieve_context_node(state)

    assert result["memory_context"]["recent_uios"][0]["id"] == "u1"
    assert fake_cache.set_called is True


@pytest.mark.asyncio
async def test_retrieve_context_respects_budget_override():
    state = IntelligenceState(
        input=AnalysisInput(
            organization_id="org_123",
            content="Q2 launch status",
            source_type="email",
            conversation_id="conv_3",
            metadata={
                "context_budget": {
                    "max_recent_uios": 1,
                    "hybrid_limit": 5,
                    "temporal_limit": 0,
                    "evidence_limit": 0,
                }
            },
        ),
        messages=[ParsedMessage(id="m1", content="Q2 launch status")],
    )

    hybrid = AsyncMock()
    hybrid.search = AsyncMock(
        return_value=[
            {"id": "u1", "type": "decision", "score": 0.7, "properties": {"title": "Launch plan"}},
            {"id": "u2", "type": "risk", "score": 0.6, "properties": {"title": "Risk factors"}},
        ]
    )

    memory = AsyncMock()
    memory.search_uios_as_of = AsyncMock(return_value=[])
    memory.get_conversation_uios = AsyncMock(return_value=[])
    memory.get_context_version = AsyncMock(return_value="v1")
    memory.get_uio_evidence = AsyncMock(return_value={})

    fake_cache = _FakeCache(payload=None)

    with patch(
        "src.orchestrator.nodes.retrieve_context.get_context_cache",
        AsyncMock(return_value=fake_cache),
    ), patch(
        "src.orchestrator.nodes.retrieve_context.get_memory_service",
        AsyncMock(return_value=memory),
    ), patch(
        "src.orchestrator.nodes.retrieve_context.get_hybrid_search",
        AsyncMock(return_value=hybrid),
    ):
        result = await retrieve_context_node(state)

    assert len(result["memory_context"]["recent_uios"]) == 1
