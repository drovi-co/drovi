"""
Unit tests for Hybrid Search Engine.

Tests vector search, fulltext search, RRF fusion, and graph-aware search.
"""

import pytest
from datetime import datetime, timedelta
from unittest.mock import AsyncMock, MagicMock, patch

from src.search.hybrid import HybridSearch, get_hybrid_search

pytestmark = pytest.mark.unit


# =============================================================================
# Test Fixtures
# =============================================================================


@pytest.fixture
def mock_graph():
    """Create a mock graph client."""
    mock = MagicMock()
    mock.vector_search = AsyncMock(return_value=[])
    mock.fulltext_search = AsyncMock(return_value=[])
    mock.query = AsyncMock(return_value=[])
    return mock


@pytest.fixture
def hybrid_search(mock_graph):
    """Create HybridSearch with mock dependencies."""
    search = HybridSearch()
    search._graph = mock_graph
    return search


# =============================================================================
# Initialization Tests
# =============================================================================


class TestHybridSearchInit:
    """Tests for HybridSearch initialization."""

    def test_init(self):
        """Test initialization."""
        search = HybridSearch()
        assert search._graph is None
        assert search._embedding_model is None


# =============================================================================
# Vector Search Tests
# =============================================================================


class TestVectorSearch:
    """Tests for vector search operations."""

    @pytest.mark.asyncio
    async def test_vector_search_generates_embedding(self, hybrid_search, mock_graph):
        """Test vector search generates embedding for query."""
        mock_graph.vector_search.return_value = []

        with patch(
            "src.search.hybrid.generate_embedding",
            new_callable=AsyncMock,
        ) as mock_embed:
            mock_embed.return_value = [0.1] * 1536

            await hybrid_search.vector_search(
                query="test query",
                organization_id="org_123",
            )

            mock_embed.assert_called_once_with("test query")

    @pytest.mark.asyncio
    async def test_vector_search_searches_all_types(self, hybrid_search, mock_graph):
        """Test vector search searches all default types."""
        mock_graph.vector_search.return_value = []

        with patch(
            "src.search.hybrid.generate_embedding",
            new_callable=AsyncMock,
            return_value=[0.1] * 1536,
        ):
            await hybrid_search.vector_search(
                query="test",
                organization_id="org_123",
            )

            # Should search default types
            assert mock_graph.vector_search.call_count >= 5

    @pytest.mark.asyncio
    async def test_vector_search_filters_by_types(self, hybrid_search, mock_graph):
        """Test vector search filters by specified types."""
        mock_graph.vector_search.return_value = []

        with patch(
            "src.search.hybrid.generate_embedding",
            new_callable=AsyncMock,
            return_value=[0.1] * 1536,
        ):
            await hybrid_search.vector_search(
                query="test",
                organization_id="org_123",
                types=["Commitment", "Decision"],
            )

            assert mock_graph.vector_search.call_count == 2

    @pytest.mark.asyncio
    async def test_vector_search_returns_results(self, hybrid_search, mock_graph):
        """Test vector search returns formatted results."""
        mock_graph.vector_search.return_value = [
            {"id": "node_1", "properties": {"name": "Test"}, "score": 0.95},
        ]

        with patch(
            "src.search.hybrid.generate_embedding",
            new_callable=AsyncMock,
            return_value=[0.1] * 1536,
        ):
            results = await hybrid_search.vector_search(
                query="test",
                organization_id="org_123",
                types=["Commitment"],
            )

            assert len(results) == 1
            assert results[0]["id"] == "node_1"
            assert results[0]["match_source"] == "vector"
            assert results[0]["scores"]["vector"] == 0.95

    @pytest.mark.asyncio
    async def test_vector_search_handles_error(self, hybrid_search, mock_graph):
        """Test vector search handles errors gracefully."""
        mock_graph.vector_search.side_effect = Exception("Search failed")

        with patch(
            "src.search.hybrid.generate_embedding",
            new_callable=AsyncMock,
            return_value=[0.1] * 1536,
        ):
            results = await hybrid_search.vector_search(
                query="test",
                organization_id="org_123",
                types=["Commitment"],
            )

            # Should return empty, not raise
            assert results == []

    @pytest.mark.asyncio
    async def test_vector_search_embedding_error(self, hybrid_search):
        """Test vector search propagates embedding errors."""
        with patch(
            "src.search.hybrid.generate_embedding",
            new_callable=AsyncMock,
        ) as mock_embed:
            from src.search.embeddings import EmbeddingError
            mock_embed.side_effect = EmbeddingError("Embedding failed")

            with pytest.raises(EmbeddingError):
                await hybrid_search.vector_search(
                    query="test",
                    organization_id="org_123",
                )


# =============================================================================
# Fulltext Search Tests
# =============================================================================


class TestFulltextSearch:
    """Tests for fulltext search operations."""

    @pytest.mark.asyncio
    async def test_fulltext_search_all_types(self, hybrid_search, mock_graph):
        """Test fulltext search searches all default types."""
        mock_graph.fulltext_search.return_value = []

        await hybrid_search.fulltext_search(
            query="test",
            organization_id="org_123",
        )

        assert mock_graph.fulltext_search.call_count >= 5

    @pytest.mark.asyncio
    async def test_fulltext_search_filters_by_types(self, hybrid_search, mock_graph):
        """Test fulltext search filters by specified types."""
        mock_graph.fulltext_search.return_value = []

        await hybrid_search.fulltext_search(
            query="test",
            organization_id="org_123",
            types=["Contact"],
        )

        assert mock_graph.fulltext_search.call_count == 1

    @pytest.mark.asyncio
    async def test_fulltext_search_returns_results(self, hybrid_search, mock_graph):
        """Test fulltext search returns formatted results."""
        mock_graph.fulltext_search.return_value = [
            {"id": "node_1", "properties": {"name": "Test"}, "score": 1.0},
        ]

        results = await hybrid_search.fulltext_search(
            query="test",
            organization_id="org_123",
            types=["Contact"],
        )

        assert len(results) == 1
        assert results[0]["match_source"] == "fulltext"

    @pytest.mark.asyncio
    async def test_fulltext_search_handles_error(self, hybrid_search, mock_graph):
        """Test fulltext search handles errors gracefully."""
        mock_graph.fulltext_search.side_effect = Exception("Search failed")

        results = await hybrid_search.fulltext_search(
            query="test",
            organization_id="org_123",
            types=["Contact"],
        )

        assert results == []


# =============================================================================
# Hybrid Search Tests
# =============================================================================


class TestHybridSearchMethod:
    """Tests for combined hybrid search."""

    @pytest.mark.asyncio
    async def test_search_combines_vector_fulltext(self, hybrid_search, mock_graph):
        """Test search combines vector and fulltext results."""
        mock_graph.vector_search.return_value = [
            {"id": "node_1", "properties": {}, "score": 0.9},
        ]
        mock_graph.fulltext_search.return_value = [
            {"id": "node_2", "properties": {}, "score": 0.8},
        ]

        with patch(
            "src.search.hybrid.generate_embedding",
            new_callable=AsyncMock,
            return_value=[0.1] * 1536,
        ):
            results = await hybrid_search.search(
                query="test",
                organization_id="org_123",
                types=["Contact"],
            )

            # Should have results from both
            assert len(results) >= 2

    @pytest.mark.asyncio
    async def test_search_filters_by_source_types(self, hybrid_search, mock_graph):
        """Test search filters by source types."""
        mock_graph.vector_search.return_value = [
            {"id": "node_1", "properties": {"sourceType": "email"}, "score": 0.9},
            {"id": "node_2", "properties": {"sourceType": "slack"}, "score": 0.8},
        ]
        mock_graph.fulltext_search.return_value = []

        with patch(
            "src.search.hybrid.generate_embedding",
            new_callable=AsyncMock,
            return_value=[0.1] * 1536,
        ):
            results = await hybrid_search.search(
                query="test",
                organization_id="org_123",
                types=["Episode"],
                source_types=["email"],
            )

            # Should filter out slack results
            assert all(
                r.get("properties", {}).get("sourceType") == "email"
                for r in results
            )

    @pytest.mark.asyncio
    async def test_search_includes_graph_context(self, hybrid_search, mock_graph):
        """Test search includes graph context when requested."""
        mock_graph.vector_search.return_value = [
            {"id": "node_1", "properties": {}, "score": 0.9},
        ]
        mock_graph.fulltext_search.return_value = []
        mock_graph.query.return_value = [
            {"relationship": "OWNS", "type": "Contact", "id": "c_1", "name": "John"},
        ]

        with patch(
            "src.search.hybrid.generate_embedding",
            new_callable=AsyncMock,
            return_value=[0.1] * 1536,
        ):
            results = await hybrid_search.search(
                query="test",
                organization_id="org_123",
                types=["Commitment"],
                include_graph_context=True,
            )

            assert len(results) > 0
            assert "connections" in results[0]

    @pytest.mark.asyncio
    async def test_search_respects_limit(self, hybrid_search, mock_graph):
        """Test search respects limit parameter."""
        mock_graph.vector_search.return_value = [
            {"id": f"node_{i}", "properties": {}, "score": 0.9 - i * 0.01}
            for i in range(30)
        ]
        mock_graph.fulltext_search.return_value = []

        with patch(
            "src.search.hybrid.generate_embedding",
            new_callable=AsyncMock,
            return_value=[0.1] * 1536,
        ):
            results = await hybrid_search.search(
                query="test",
                organization_id="org_123",
                types=["Contact"],
                limit=5,
            )

            assert len(results) <= 5


# =============================================================================
# Reciprocal Rank Fusion Tests
# =============================================================================


class TestReciprocalRankFusion:
    """Tests for RRF algorithm."""

    def test_rrf_combines_results(self, hybrid_search):
        """Test RRF combines results from both lists."""
        vector_results = [
            {"id": "node_1", "score": 0.9},
            {"id": "node_2", "score": 0.8},
        ]
        fulltext_results = [
            {"id": "node_3", "score": 0.95},
            {"id": "node_1", "score": 0.7},  # Duplicate
        ]

        combined = hybrid_search._reciprocal_rank_fusion(
            vector_results,
            fulltext_results,
            limit=10,
        )

        # Should have 3 unique results
        ids = [r["id"] for r in combined]
        assert len(set(ids)) == 3

    def test_rrf_deduplicates(self, hybrid_search):
        """Test RRF deduplicates results."""
        vector_results = [{"id": "node_1", "score": 0.9}]
        fulltext_results = [{"id": "node_1", "score": 0.8}]

        combined = hybrid_search._reciprocal_rank_fusion(
            vector_results,
            fulltext_results,
            limit=10,
        )

        # Should have 1 result with "both" match source
        assert len(combined) == 1
        assert combined[0]["match_source"] == "both"

    def test_rrf_preserves_scores(self, hybrid_search):
        """Test RRF preserves individual scores."""
        vector_results = [{"id": "node_1", "score": 0.9}]
        fulltext_results = [{"id": "node_1", "score": 0.8}]

        combined = hybrid_search._reciprocal_rank_fusion(
            vector_results,
            fulltext_results,
            limit=10,
        )

        assert "vector" in combined[0]["scores"]
        assert "fulltext" in combined[0]["scores"]

    def test_rrf_ranks_by_fusion_score(self, hybrid_search):
        """Test RRF ranks by fusion score."""
        # node_1 appears in both, should rank higher
        vector_results = [
            {"id": "node_1", "score": 0.5},
            {"id": "node_2", "score": 0.9},
        ]
        fulltext_results = [
            {"id": "node_1", "score": 0.5},
            {"id": "node_3", "score": 0.9},
        ]

        combined = hybrid_search._reciprocal_rank_fusion(
            vector_results,
            fulltext_results,
            limit=10,
        )

        # node_1 should be first (appears in both)
        assert combined[0]["id"] == "node_1"

    def test_rrf_respects_limit(self, hybrid_search):
        """Test RRF respects limit."""
        vector_results = [{"id": f"v_{i}", "score": 0.9} for i in range(10)]
        fulltext_results = [{"id": f"f_{i}", "score": 0.9} for i in range(10)]

        combined = hybrid_search._reciprocal_rank_fusion(
            vector_results,
            fulltext_results,
            limit=5,
        )

        assert len(combined) == 5

    def test_rrf_handles_empty_lists(self, hybrid_search):
        """Test RRF handles empty input lists."""
        combined = hybrid_search._reciprocal_rank_fusion([], [], limit=10)
        assert combined == []

        combined = hybrid_search._reciprocal_rank_fusion(
            [{"id": "node_1", "score": 0.9}],
            [],
            limit=10,
        )
        assert len(combined) == 1

    def test_rrf_handles_missing_ids(self, hybrid_search):
        """Test RRF handles results without IDs."""
        vector_results = [
            {"id": "node_1", "score": 0.9},
            {"score": 0.8},  # Missing ID
        ]
        fulltext_results = []

        combined = hybrid_search._reciprocal_rank_fusion(
            vector_results,
            fulltext_results,
            limit=10,
        )

        # Should skip result without ID
        assert len(combined) == 1


# =============================================================================
# Time Range Filter Tests
# =============================================================================


class TestTimeRangeFilter:
    """Tests for time range filtering."""

    def test_filter_by_time_range_from(self, hybrid_search):
        """Test filtering by from date."""
        now = datetime.utcnow()
        results = [
            {"id": "1", "properties": {"createdAt": (now - timedelta(days=1)).isoformat()}},
            {"id": "2", "properties": {"createdAt": (now - timedelta(days=5)).isoformat()}},
        ]

        filtered = hybrid_search._filter_by_time_range(
            results,
            {"from": (now - timedelta(days=3)).isoformat()},
        )

        assert len(filtered) == 1
        assert filtered[0]["id"] == "1"

    def test_filter_by_time_range_to(self, hybrid_search):
        """Test filtering by to date."""
        now = datetime.utcnow()
        results = [
            {"id": "1", "properties": {"createdAt": (now - timedelta(days=1)).isoformat()}},
            {"id": "2", "properties": {"createdAt": (now - timedelta(days=5)).isoformat()}},
        ]

        filtered = hybrid_search._filter_by_time_range(
            results,
            {"to": (now - timedelta(days=3)).isoformat()},
        )

        assert len(filtered) == 1
        assert filtered[0]["id"] == "2"

    def test_filter_by_time_range_both(self, hybrid_search):
        """Test filtering by both from and to dates."""
        now = datetime.utcnow()
        results = [
            {"id": "1", "properties": {"createdAt": (now - timedelta(days=1)).isoformat()}},
            {"id": "2", "properties": {"createdAt": (now - timedelta(days=3)).isoformat()}},
            {"id": "3", "properties": {"createdAt": (now - timedelta(days=5)).isoformat()}},
        ]

        filtered = hybrid_search._filter_by_time_range(
            results,
            {
                "from": (now - timedelta(days=4)).isoformat(),
                "to": (now - timedelta(days=2)).isoformat(),
            },
        )

        assert len(filtered) == 1
        assert filtered[0]["id"] == "2"

    def test_filter_includes_no_date(self, hybrid_search):
        """Test filter includes results without dates."""
        results = [
            {"id": "1", "properties": {}},  # No date
        ]

        filtered = hybrid_search._filter_by_time_range(
            results,
            {"from": "2024-01-01T00:00:00"},
        )

        assert len(filtered) == 1

    def test_filter_handles_reference_time(self, hybrid_search):
        """Test filter uses referenceTime if no createdAt."""
        now = datetime.utcnow()
        results = [
            {"id": "1", "properties": {"referenceTime": now.isoformat()}},
        ]

        filtered = hybrid_search._filter_by_time_range(
            results,
            {"from": (now - timedelta(days=1)).isoformat()},
        )

        assert len(filtered) == 1


# =============================================================================
# Graph Context Expansion Tests
# =============================================================================


class TestGraphContextExpansion:
    """Tests for graph context expansion."""

    @pytest.mark.asyncio
    async def test_expand_with_graph_context(self, hybrid_search, mock_graph):
        """Test expanding results with graph context."""
        results = [{"id": "node_1", "properties": {}}]
        mock_graph.query.return_value = [
            {"relationship": "OWNS", "type": "Contact", "id": "c_1", "name": "John"},
        ]

        expanded = await hybrid_search._expand_with_graph_context(
            results,
            "org_123",
        )

        assert len(expanded[0]["connections"]) == 1
        assert expanded[0]["connections"][0]["relationship"] == "OWNS"

    @pytest.mark.asyncio
    async def test_expand_handles_query_error(self, hybrid_search, mock_graph):
        """Test expansion handles query errors."""
        results = [{"id": "node_1", "properties": {}}]
        mock_graph.query.side_effect = Exception("Query failed")

        expanded = await hybrid_search._expand_with_graph_context(
            results,
            "org_123",
        )

        assert expanded[0]["connections"] == []

    @pytest.mark.asyncio
    async def test_expand_skips_missing_ids(self, hybrid_search, mock_graph):
        """Test expansion skips results without IDs."""
        results = [{"properties": {}}]  # No ID

        expanded = await hybrid_search._expand_with_graph_context(
            results,
            "org_123",
        )

        # Should not call query
        mock_graph.query.assert_not_called()


# =============================================================================
# Graph-Aware Search Tests
# =============================================================================


class TestGraphAwareSearch:
    """Tests for graph-aware search."""

    @pytest.mark.asyncio
    async def test_graph_aware_search(self, hybrid_search, mock_graph):
        """Test graph-aware search includes context."""
        mock_graph.vector_search.return_value = [
            {"id": "node_1", "properties": {}, "score": 0.9},
        ]
        mock_graph.fulltext_search.return_value = []
        mock_graph.query.return_value = [
            {"relationship": "OWNS", "type": "Contact", "id": "c_1", "name": "John"},
        ]

        with patch(
            "src.search.hybrid.generate_embedding",
            new_callable=AsyncMock,
            return_value=[0.1] * 1536,
        ):
            results = await hybrid_search.graph_aware_search(
                query="test",
                organization_id="org_123",
                types=["Commitment"],
                depth=1,
            )

            assert len(results) > 0
            # Should have connections from expansion
            if results:
                assert "connections" in results[0]


# =============================================================================
# Factory Function Tests
# =============================================================================


class TestHybridSearchFactory:
    """Tests for singleton factory."""

    @pytest.mark.asyncio
    async def test_get_hybrid_search_creates_singleton(self):
        """Test get_hybrid_search creates singleton."""
        import src.search.hybrid as hybrid_module

        hybrid_module._hybrid_search = None

        search1 = await get_hybrid_search()
        search2 = await get_hybrid_search()

        assert search1 is search2

        # Cleanup
        hybrid_module._hybrid_search = None
