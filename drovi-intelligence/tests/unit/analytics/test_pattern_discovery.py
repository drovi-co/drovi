"""
Unit tests for pattern discovery.
"""

from unittest.mock import AsyncMock, patch

import pytest

from src.analytics.pattern_discovery import discover_pattern_candidates


pytestmark = pytest.mark.unit


@pytest.mark.asyncio
async def test_discover_pattern_candidates_clusters():
    commitments = [
        {"id": "c1", "title": "Renew Acme contract", "embedding": [1.0, 0.0, 0.0]},
        {"id": "c2", "title": "Renew Acme agreement", "embedding": [0.98, 0.05, 0.0]},
        {"id": "c3", "title": "Renew Acme renewal", "embedding": [0.97, 0.04, 0.0]},
    ]
    decisions = []

    graph = AsyncMock()
    graph.query = AsyncMock(return_value=[])

    with patch(
        "src.analytics.pattern_discovery._fetch_uio_embeddings",
        AsyncMock(side_effect=[commitments, decisions]),
    ), patch(
        "src.analytics.pattern_discovery.get_graph_client",
        AsyncMock(return_value=graph),
    ):
        candidates = await discover_pattern_candidates(
            organization_id="org_1",
            min_cluster_size=2,
            similarity_threshold=0.9,
            max_nodes=10,
        )

    assert len(candidates) == 1
    assert candidates[0]["member_count"] == 3
