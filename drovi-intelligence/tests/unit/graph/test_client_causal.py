from __future__ import annotations

from unittest.mock import MagicMock, patch

import pytest

from src.graph.client import DroviGraph

pytestmark = pytest.mark.unit


@pytest.fixture
def mock_falkordb():
    with patch("src.graph.client.FalkorDB") as mock:
        mock_client = MagicMock()
        mock_graph = MagicMock()
        mock_client.select_graph.return_value = mock_graph
        mock.return_value = mock_client
        yield mock, mock_client, mock_graph


@pytest.fixture
def graph_client():
    return DroviGraph(
        host="localhost",
        port=6379,
        graph_name="test_graph",
    )


@pytest.mark.asyncio
async def test_get_causal_edges_uses_expected_filters(mock_falkordb, graph_client) -> None:
    _mock_class, _mock_client, mock_graph = mock_falkordb
    mock_result = MagicMock()
    mock_result.header = ["source_ref", "target_ref", "confidence"]
    mock_result.result_set = [["a", "b", 0.8]]
    mock_graph.query.return_value = mock_result

    await graph_client.connect()
    rows = await graph_client.get_causal_edges(
        organization_id="org_1",
        source_ref="a",
        min_confidence=0.2,
        limit=100,
    )

    assert rows[0]["source_ref"] == "a"
    query, params = mock_graph.query.call_args.args
    assert ":CAUSES" in query
    assert params["orgId"] == "org_1"
    assert params["sourceRef"] == "a"
    assert params["minConfidence"] == 0.2


@pytest.mark.asyncio
async def test_traverse_causal_impacts_queries_variable_length_paths(
    mock_falkordb,
    graph_client,
) -> None:
    _mock_class, _mock_client, mock_graph = mock_falkordb
    mock_result = MagicMock()
    mock_result.header = ["source_ref", "target_ref", "hop", "path_weight", "path_confidence", "path"]
    mock_result.result_set = [["origin", "target", 2, 0.42, 0.63, ["origin", "mid", "target"]]]
    mock_graph.query.return_value = mock_result

    await graph_client.connect()
    rows = await graph_client.traverse_causal_impacts(
        origin_ref="origin",
        organization_id="org_1",
        max_hops=3,
        min_confidence=0.1,
        limit=50,
    )

    assert rows
    query, params = mock_graph.query.call_args.args
    assert "[:CAUSES*1..3]" in query
    assert params["originRef"] == "origin"
    assert params["orgId"] == "org_1"


@pytest.mark.asyncio
async def test_initialize_indexes_includes_risk_indexes(mock_falkordb, graph_client) -> None:
    _mock_class, _mock_client, mock_graph = mock_falkordb
    mock_result = MagicMock()
    mock_result.header = []
    mock_result.result_set = []
    mock_graph.query.return_value = mock_result

    await graph_client.connect()
    await graph_client.initialize_indexes()

    queries = [call.args[0] for call in mock_graph.query.call_args_list]
    assert any("CREATE INDEX ON :Risk(id)" in query for query in queries)
    assert any("CREATE INDEX ON :Risk(organizationId)" in query for query in queries)
