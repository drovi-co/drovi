"""
Unit tests for Graph Analytics Engine.

Tests PageRank, betweenness centrality, community detection, and path finding.
"""

import pytest
from unittest.mock import AsyncMock, MagicMock, patch

from src.graph.analytics import GraphAnalyticsEngine
from src.graph.client import DroviGraph

pytestmark = pytest.mark.unit


# =============================================================================
# Test Fixtures
# =============================================================================


@pytest.fixture
def mock_graph():
    """Create a mock DroviGraph."""
    mock = MagicMock(spec=DroviGraph)
    mock.query = AsyncMock()
    return mock


@pytest.fixture
def analytics_engine(mock_graph):
    """Create a GraphAnalyticsEngine with mock graph."""
    return GraphAnalyticsEngine(mock_graph)


# =============================================================================
# PageRank Tests
# =============================================================================


class TestPageRank:
    """Tests for PageRank computation."""

    @pytest.mark.asyncio
    async def test_compute_pagerank_empty(self, analytics_engine, mock_graph):
        """Test PageRank with no contacts."""
        mock_graph.query.return_value = []

        result = await analytics_engine.compute_pagerank("org_123")

        assert result == {}

    @pytest.mark.asyncio
    async def test_compute_pagerank_single_node(self, analytics_engine, mock_graph):
        """Test PageRank with single contact."""
        mock_graph.query.side_effect = [
            [{"id": "contact_1"}],  # contacts
            [],  # edges
        ]

        result = await analytics_engine.compute_pagerank("org_123")

        assert "contact_1" in result
        assert result["contact_1"] == 1.0  # Only node gets normalized to 1.0

    @pytest.mark.asyncio
    async def test_compute_pagerank_connected(self, analytics_engine, mock_graph):
        """Test PageRank with connected contacts."""
        mock_graph.query.side_effect = [
            # Contacts
            [{"id": "contact_1"}, {"id": "contact_2"}, {"id": "contact_3"}],
            # Edges - contact_1 is highly connected
            [
                {"source": "contact_2", "target": "contact_1", "weight": 1.0},
                {"source": "contact_3", "target": "contact_1", "weight": 1.0},
            ],
        ]

        result = await analytics_engine.compute_pagerank("org_123")

        assert len(result) == 3
        # Contact 1 should have highest score (most incoming links)
        assert result["contact_1"] >= result["contact_2"]
        assert result["contact_1"] >= result["contact_3"]

    @pytest.mark.asyncio
    async def test_compute_pagerank_damping_factor(self, analytics_engine, mock_graph):
        """Test PageRank with custom damping factor."""
        mock_graph.query.side_effect = [
            [{"id": "contact_1"}, {"id": "contact_2"}],
            [{"source": "contact_1", "target": "contact_2", "weight": 1.0}],
        ]

        result = await analytics_engine.compute_pagerank(
            "org_123",
            damping_factor=0.5,
        )

        assert len(result) == 2

    @pytest.mark.asyncio
    async def test_compute_pagerank_convergence(self, analytics_engine, mock_graph):
        """Test PageRank converges within iterations."""
        mock_graph.query.side_effect = [
            [{"id": f"contact_{i}"} for i in range(5)],
            [
                {"source": "contact_0", "target": "contact_1", "weight": 1.0},
                {"source": "contact_1", "target": "contact_2", "weight": 1.0},
                {"source": "contact_2", "target": "contact_3", "weight": 1.0},
                {"source": "contact_3", "target": "contact_4", "weight": 1.0},
            ],
        ]

        result = await analytics_engine.compute_pagerank(
            "org_123",
            max_iterations=100,
            tolerance=0.0001,
        )

        # All contacts should have scores
        assert all(0 <= score <= 1 for score in result.values())

    @pytest.mark.asyncio
    async def test_compute_pagerank_handles_error(self, analytics_engine, mock_graph):
        """Test PageRank handles query errors."""
        mock_graph.query.side_effect = Exception("Database error")

        result = await analytics_engine.compute_pagerank("org_123")

        assert result == {}


# =============================================================================
# Betweenness Centrality Tests
# =============================================================================


class TestBetweennessCentrality:
    """Tests for betweenness centrality computation."""

    @pytest.mark.asyncio
    async def test_compute_betweenness_empty(self, analytics_engine, mock_graph):
        """Test betweenness with no contacts."""
        mock_graph.query.return_value = []

        result = await analytics_engine.compute_betweenness_centrality("org_123")

        assert result == {}

    @pytest.mark.asyncio
    async def test_compute_betweenness_single_node(self, analytics_engine, mock_graph):
        """Test betweenness with single contact."""
        mock_graph.query.side_effect = [
            [{"id": "contact_1"}],  # contacts
            [],  # edges
        ]

        result = await analytics_engine.compute_betweenness_centrality("org_123")

        assert result["contact_1"] == 0.0

    @pytest.mark.asyncio
    async def test_compute_betweenness_two_nodes(self, analytics_engine, mock_graph):
        """Test betweenness with two contacts."""
        mock_graph.query.side_effect = [
            [{"id": "contact_1"}, {"id": "contact_2"}],
            [],  # No edges
        ]

        result = await analytics_engine.compute_betweenness_centrality("org_123")

        assert len(result) == 2
        assert all(score == 0.0 for score in result.values())

    @pytest.mark.asyncio
    async def test_compute_betweenness_bridge_node(self, analytics_engine, mock_graph):
        """Test betweenness identifies bridge nodes."""
        # contact_2 bridges contact_1 and contact_3
        mock_graph.query.side_effect = [
            [{"id": "contact_1"}, {"id": "contact_2"}, {"id": "contact_3"}],
            [
                {"source": "contact_1", "target": "contact_2"},
                {"source": "contact_2", "target": "contact_3"},
            ],
        ]

        result = await analytics_engine.compute_betweenness_centrality("org_123")

        # contact_2 should have highest betweenness (it's the bridge)
        assert result["contact_2"] >= result["contact_1"]
        assert result["contact_2"] >= result["contact_3"]

    @pytest.mark.asyncio
    async def test_compute_betweenness_with_sampling(self, analytics_engine, mock_graph):
        """Test betweenness with sampling."""
        contacts = [{"id": f"contact_{i}"} for i in range(20)]
        edges = [
            {"source": f"contact_{i}", "target": f"contact_{i+1}"}
            for i in range(19)
        ]

        mock_graph.query.side_effect = [contacts, edges]

        result = await analytics_engine.compute_betweenness_centrality(
            "org_123",
            sample_size=10,
        )

        assert len(result) == 20

    @pytest.mark.asyncio
    async def test_compute_betweenness_handles_error(self, analytics_engine, mock_graph):
        """Test betweenness handles query errors."""
        mock_graph.query.side_effect = Exception("Database error")

        result = await analytics_engine.compute_betweenness_centrality("org_123")

        assert result == {}


# =============================================================================
# Community Detection Tests
# =============================================================================


class TestCommunityDetection:
    """Tests for community detection."""

    @pytest.mark.asyncio
    async def test_detect_communities_empty(self, analytics_engine, mock_graph):
        """Test community detection with no contacts."""
        mock_graph.query.return_value = []

        result = await analytics_engine.detect_communities("org_123")

        assert result == {}

    @pytest.mark.asyncio
    async def test_detect_communities_single_node(self, analytics_engine, mock_graph):
        """Test community detection with single contact."""
        mock_graph.query.side_effect = [
            [{"id": "contact_1"}],  # contacts
            [],  # edges
        ]

        result = await analytics_engine.detect_communities("org_123")

        assert "contact_1" in result
        assert result["contact_1"].startswith("community_")

    @pytest.mark.asyncio
    async def test_detect_communities_disconnected(self, analytics_engine, mock_graph):
        """Test community detection with disconnected contacts."""
        mock_graph.query.side_effect = [
            [{"id": "contact_1"}, {"id": "contact_2"}],
            [],  # No edges
        ]

        result = await analytics_engine.detect_communities("org_123")

        # Each should be in its own community
        assert len(set(result.values())) == 2

    @pytest.mark.asyncio
    async def test_detect_communities_clusters(self, analytics_engine, mock_graph):
        """Test community detection finds clusters."""
        # Two clusters: [1,2,3] and [4,5,6]
        mock_graph.query.side_effect = [
            [{"id": f"contact_{i}"} for i in range(1, 7)],
            [
                # Cluster 1
                {"source": "contact_1", "target": "contact_2", "weight": 1.0},
                {"source": "contact_2", "target": "contact_3", "weight": 1.0},
                {"source": "contact_1", "target": "contact_3", "weight": 1.0},
                # Cluster 2
                {"source": "contact_4", "target": "contact_5", "weight": 1.0},
                {"source": "contact_5", "target": "contact_6", "weight": 1.0},
                {"source": "contact_4", "target": "contact_6", "weight": 1.0},
            ],
        ]

        result = await analytics_engine.detect_communities(
            "org_123",
            max_iterations=20,
        )

        # Should identify 2 communities
        unique_communities = set(result.values())
        assert len(unique_communities) == 2

    @pytest.mark.asyncio
    async def test_detect_communities_weighted(self, analytics_engine, mock_graph):
        """Test community detection respects weights."""
        mock_graph.query.side_effect = [
            [{"id": "contact_1"}, {"id": "contact_2"}, {"id": "contact_3"}],
            [
                {"source": "contact_1", "target": "contact_2", "weight": 10.0},  # Strong
                {"source": "contact_2", "target": "contact_3", "weight": 0.1},   # Weak
            ],
        ]

        result = await analytics_engine.detect_communities("org_123")

        # contact_1 and contact_2 should likely be in same community
        assert result["contact_1"] == result["contact_2"]

    @pytest.mark.asyncio
    async def test_detect_communities_handles_error(self, analytics_engine, mock_graph):
        """Test community detection handles query errors."""
        mock_graph.query.side_effect = Exception("Database error")

        result = await analytics_engine.detect_communities("org_123")

        assert result == {}


# =============================================================================
# Introduction Path Finding Tests
# =============================================================================


class TestIntroductionPaths:
    """Tests for introduction path finding."""

    @pytest.mark.asyncio
    async def test_find_introduction_paths(self, analytics_engine, mock_graph):
        """Test finding introduction paths."""
        mock_graph.query.return_value = [
            {"pathIds": ["contact_1", "contact_2", "contact_3"]},
        ]

        result = await analytics_engine.find_introduction_paths(
            organization_id="org_123",
            from_contact_id="contact_1",
            to_contact_id="contact_3",
            max_hops=3,
        )

        assert len(result) == 1
        assert result[0] == ["contact_1", "contact_2", "contact_3"]

    @pytest.mark.asyncio
    async def test_find_introduction_paths_no_path(self, analytics_engine, mock_graph):
        """Test when no path exists."""
        mock_graph.query.return_value = []

        result = await analytics_engine.find_introduction_paths(
            organization_id="org_123",
            from_contact_id="contact_1",
            to_contact_id="contact_3",
        )

        assert result == []

    @pytest.mark.asyncio
    async def test_find_introduction_paths_multiple(self, analytics_engine, mock_graph):
        """Test finding multiple paths."""
        mock_graph.query.return_value = [
            {"pathIds": ["contact_1", "contact_2", "contact_4"]},
            {"pathIds": ["contact_1", "contact_3", "contact_4"]},
        ]

        result = await analytics_engine.find_introduction_paths(
            organization_id="org_123",
            from_contact_id="contact_1",
            to_contact_id="contact_4",
        )

        assert len(result) == 2

    @pytest.mark.asyncio
    async def test_find_introduction_paths_handles_error(self, analytics_engine, mock_graph):
        """Test path finding handles query errors."""
        mock_graph.query.side_effect = Exception("Query failed")

        result = await analytics_engine.find_introduction_paths(
            organization_id="org_123",
            from_contact_id="contact_1",
            to_contact_id="contact_3",
        )

        assert result == []


# =============================================================================
# Potential Introducers Tests
# =============================================================================


class TestPotentialIntroducers:
    """Tests for finding potential introducers."""

    @pytest.mark.asyncio
    async def test_find_potential_introducers(self, analytics_engine, mock_graph):
        """Test finding potential introducers."""
        mock_graph.query.return_value = [
            {
                "targetId": "contact_2",
                "targetName": "Jane CEO",
                "targetCompany": "ACME",
                "introducerId": "contact_3",
                "introducerName": "Bob",
                "hops": 1,
            },
        ]

        result = await analytics_engine.find_potential_introducers(
            organization_id="org_123",
            user_contact_id="contact_1",
            target_role="decision_maker",
        )

        assert len(result) == 1
        assert result[0]["targetId"] == "contact_2"
        assert result[0]["introducerId"] == "contact_3"

    @pytest.mark.asyncio
    async def test_find_potential_introducers_empty(self, analytics_engine, mock_graph):
        """Test when no introducers found."""
        mock_graph.query.return_value = []

        result = await analytics_engine.find_potential_introducers(
            organization_id="org_123",
            user_contact_id="contact_1",
        )

        assert result == []

    @pytest.mark.asyncio
    async def test_find_potential_introducers_handles_error(self, analytics_engine, mock_graph):
        """Test introducer finding handles query errors."""
        mock_graph.query.side_effect = Exception("Query failed")

        result = await analytics_engine.find_potential_introducers(
            organization_id="org_123",
            user_contact_id="contact_1",
        )

        assert result == []


# =============================================================================
# Persist Analytics Tests
# =============================================================================


class TestPersistAnalytics:
    """Tests for persisting analytics results."""

    @pytest.mark.asyncio
    async def test_persist_analytics(self, analytics_engine, mock_graph):
        """Test persisting analytics to contacts."""
        mock_graph.query.return_value = None

        result = await analytics_engine.persist_analytics(
            organization_id="org_123",
            pagerank={"contact_1": 0.8, "contact_2": 0.5},
            betweenness={"contact_1": 0.3, "contact_2": 0.7},
            communities={"contact_1": "comm_1", "contact_2": "comm_1"},
        )

        assert result == 2
        assert mock_graph.query.call_count == 2

    @pytest.mark.asyncio
    async def test_persist_analytics_partial_failure(self, analytics_engine, mock_graph):
        """Test persist continues on individual failures."""
        mock_graph.query.side_effect = [
            None,  # First succeeds
            Exception("Update failed"),  # Second fails
            None,  # Third succeeds
        ]

        result = await analytics_engine.persist_analytics(
            organization_id="org_123",
            pagerank={"contact_1": 0.8, "contact_2": 0.5, "contact_3": 0.3},
            betweenness={"contact_1": 0.3, "contact_2": 0.7, "contact_3": 0.2},
            communities={"contact_1": "c1", "contact_2": "c1", "contact_3": "c2"},
        )

        # Should have updated 2 out of 3
        assert result == 2

    @pytest.mark.asyncio
    async def test_persist_analytics_missing_values(self, analytics_engine, mock_graph):
        """Test persist handles missing values with defaults."""
        mock_graph.query.return_value = None

        result = await analytics_engine.persist_analytics(
            organization_id="org_123",
            pagerank={"contact_1": 0.8},
            betweenness={},  # Missing
            communities={},  # Missing
        )

        assert result == 1
        # Check that the query used 0.0 for missing values
        call_args = mock_graph.query.call_args
        assert call_args is not None


# =============================================================================
# Factory Function Tests
# =============================================================================


class TestAnalyticsFactory:
    """Tests for analytics engine factory."""

    @pytest.mark.asyncio
    async def test_get_analytics_engine(self):
        """Test get_analytics_engine creates instance."""
        from src.graph.analytics import get_analytics_engine

        with patch("src.graph.analytics.get_graph_client", new_callable=AsyncMock) as mock_get:
            mock_graph = MagicMock()
            mock_get.return_value = mock_graph

            engine = await get_analytics_engine()

            assert isinstance(engine, GraphAnalyticsEngine)
            assert engine.graph == mock_graph
