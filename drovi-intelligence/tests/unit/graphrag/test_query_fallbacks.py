from __future__ import annotations

from unittest.mock import AsyncMock

import pytest

from src.graphrag.query import DroviGraphRAG


pytestmark = [pytest.mark.unit, pytest.mark.asyncio]


async def test_execute_graph_query_returns_empty_on_graph_failure() -> None:
    graphrag = DroviGraphRAG()
    memory = AsyncMock()
    memory.graph_query = AsyncMock(side_effect=RuntimeError("falkor_down"))
    graphrag._get_memory_service = AsyncMock(return_value=memory)  # type: ignore[method-assign]

    rows = await graphrag._execute_graph_query(
        intent="commitments",
        organization_id="org_test",
        search_term="deadline",
    )

    assert rows == []


async def test_query_uses_fallback_chain_when_template_is_empty(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    graphrag = DroviGraphRAG()

    monkeypatch.setattr(
        graphrag,
        "_classify_intent_keywords",
        lambda _question: {
            "primary_intent": "commitments",
            "secondary_intents": [],
            "entity_name": None,
            "topic_filter": None,
            "is_cross_entity": False,
        },
    )
    monkeypatch.setattr(graphrag, "_execute_graph_query", AsyncMock(return_value=[]))
    monkeypatch.setattr(
        graphrag,
        "_fallback_chain",
        AsyncMock(return_value=[{"id": "uio_123", "title": "Follow up with client"}]),
    )
    monkeypatch.setattr(graphrag, "_closest_matches_fallback", AsyncMock(return_value=[]))
    monkeypatch.setattr(graphrag, "_attach_evidence", AsyncMock(return_value=None))
    monkeypatch.setattr(graphrag, "_extract_sources", lambda _rows: [{"source": "evidence"}])
    monkeypatch.setattr(graphrag, "_template_synthesize", lambda **_kwargs: "fallback answer")

    payload = await graphrag.query(
        question="What commitments are open?",
        organization_id="org_test",
        include_evidence=True,
        llm_enabled=False,
        visibility_is_admin=True,
    )

    assert payload["answer"] == "fallback answer"
    assert payload["results_count"] == 1
    assert payload["sources"]
