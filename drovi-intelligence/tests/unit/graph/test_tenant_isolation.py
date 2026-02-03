from unittest.mock import AsyncMock, patch

import pytest

from src.graph.client import DroviGraph


@pytest.mark.asyncio
async def test_fulltext_search_scopes_org():
    graph = DroviGraph(host="localhost", port=6379)
    graph.query = AsyncMock(return_value=[])

    await graph.fulltext_search(
        label="Contact",
        query_text="alice",
        organization_id="org_1",
        limit=5,
    )

    cypher = graph.query.call_args.args[0]
    params = graph.query.call_args.args[1]

    assert "organizationId" in cypher
    assert "$orgId" in cypher
    assert params["orgId"] == "org_1"


@pytest.mark.asyncio
async def test_vector_search_scopes_org():
    graph = DroviGraph(host="localhost", port=6379)
    graph.query = AsyncMock(return_value=[])

    with patch("src.search.embeddings.get_embedding_dimension", return_value=3):
        await graph.vector_search(
            label="Commitment",
            embedding=[0.1, 0.2, 0.3],
            organization_id="org_9",
            k=3,
        )

    cypher = graph.query.call_args.args[0]
    params = graph.query.call_args.args[1]

    assert "organizationId" in cypher
    assert "$orgId" in cypher
    assert params["orgId"] == "org_9"
