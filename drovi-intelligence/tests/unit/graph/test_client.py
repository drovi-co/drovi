"""
Unit tests for FalkorDB Graph Client.

Tests DroviGraph client operations including node/relationship CRUD,
query execution, and index management.
"""

import pytest
from datetime import datetime
from unittest.mock import AsyncMock, MagicMock, patch, PropertyMock
import json

from src.graph.client import DroviGraph, get_graph_client, close_graph_client
from src.graph.types import GraphNodeType

pytestmark = pytest.mark.unit


# =============================================================================
# Test Fixtures
# =============================================================================


@pytest.fixture
def mock_falkordb():
    """Mock FalkorDB client."""
    with patch("src.graph.client.FalkorDB") as mock:
        mock_client = MagicMock()
        mock_graph = MagicMock()
        mock_client.select_graph.return_value = mock_graph
        mock.return_value = mock_client
        yield mock, mock_client, mock_graph


@pytest.fixture
def graph_client():
    """Create a DroviGraph instance."""
    return DroviGraph(
        host="localhost",
        port=6379,
        graph_name="test_graph",
    )


# =============================================================================
# DroviGraph Initialization Tests
# =============================================================================


class TestDroviGraphInit:
    """Tests for DroviGraph initialization."""

    def test_init_sets_attributes(self):
        """Test initialization sets attributes correctly."""
        client = DroviGraph(
            host="localhost",
            port=6379,
            graph_name="test_graph",
        )

        assert client.host == "localhost"
        assert client.port == 6379
        assert client.graph_name == "test_graph"
        assert client._client is None
        assert client._graph is None

    def test_init_default_graph_name(self):
        """Test default graph name."""
        client = DroviGraph(
            host="localhost",
            port=6379,
        )

        assert client.graph_name == "drovi_intelligence"


# =============================================================================
# Connection Tests
# =============================================================================


class TestDroviGraphConnection:
    """Tests for connection management."""

    @pytest.mark.asyncio
    async def test_connect_success(self, mock_falkordb, graph_client):
        """Test successful connection."""
        mock_class, mock_client, mock_graph = mock_falkordb

        await graph_client.connect()

        mock_class.assert_called_once_with(host="localhost", port=6379)
        mock_client.select_graph.assert_called_once_with("test_graph")
        assert graph_client._client == mock_client
        assert graph_client._graph == mock_graph

    @pytest.mark.asyncio
    async def test_connect_failure(self, graph_client):
        """Test connection failure handling."""
        with patch("src.graph.client.FalkorDB") as mock:
            mock.side_effect = Exception("Connection refused")

            with pytest.raises(Exception, match="Connection refused"):
                await graph_client.connect()

    @pytest.mark.asyncio
    async def test_close(self, mock_falkordb, graph_client):
        """Test connection close."""
        mock_class, mock_client, mock_graph = mock_falkordb

        await graph_client.connect()
        await graph_client.close()

        assert graph_client._client is None
        assert graph_client._graph is None


# =============================================================================
# Query Tests
# =============================================================================


class TestDroviGraphQuery:
    """Tests for query execution."""

    @pytest.mark.asyncio
    async def test_query_not_connected(self, graph_client):
        """Test query fails when not connected."""
        with pytest.raises(RuntimeError, match="Not connected to FalkorDB"):
            await graph_client.query("MATCH (n) RETURN n")

    @pytest.mark.asyncio
    async def test_query_success(self, mock_falkordb, graph_client):
        """Test successful query execution."""
        mock_class, mock_client, mock_graph = mock_falkordb

        # Setup mock result
        mock_result = MagicMock()
        mock_result.header = ["n"]
        mock_result.result_set = [[{"id": "123", "name": "Test"}]]
        mock_graph.query.return_value = mock_result

        await graph_client.connect()
        result = await graph_client.query("MATCH (n) RETURN n")

        assert len(result) == 1
        mock_graph.query.assert_called_once()

    @pytest.mark.asyncio
    async def test_query_with_params(self, mock_falkordb, graph_client):
        """Test query with parameters."""
        mock_class, mock_client, mock_graph = mock_falkordb

        mock_result = MagicMock()
        mock_result.header = ["count"]
        mock_result.result_set = [[5]]
        mock_graph.query.return_value = mock_result

        await graph_client.connect()
        await graph_client.query(
            "MATCH (n {id: $id}) RETURN count(n)",
            {"id": "123"},
        )

        mock_graph.query.assert_called_with(
            "MATCH (n {id: $id}) RETURN count(n)",
            {"id": "123"},
        )

    @pytest.mark.asyncio
    async def test_query_failure(self, mock_falkordb, graph_client):
        """Test query failure handling."""
        mock_class, mock_client, mock_graph = mock_falkordb

        mock_graph.query.side_effect = Exception("Cypher syntax error")

        await graph_client.connect()

        with pytest.raises(Exception, match="Cypher syntax error"):
            await graph_client.query("INVALID CYPHER")


# =============================================================================
# Parse Result Tests
# =============================================================================


class TestParseResult:
    """Tests for result parsing."""

    def test_parse_result_empty(self, graph_client):
        """Test parsing empty result."""
        result = graph_client._parse_result(None)
        assert result == []

    def test_parse_result_simple(self, graph_client):
        """Test parsing simple result."""
        mock_result = MagicMock()
        mock_result.header = ["name", "age"]
        mock_result.result_set = [["Alice", 30], ["Bob", 25]]

        result = graph_client._parse_result(mock_result)

        assert len(result) == 2
        assert result[0]["name"] == "Alice"
        assert result[0]["age"] == 30
        assert result[1]["name"] == "Bob"

    def test_parse_result_tuple_header(self, graph_client):
        """Test parsing result with tuple headers."""
        mock_result = MagicMock()
        mock_result.header = [("col", "alias"), "simple"]
        mock_result.result_set = [["value1", "value2"]]

        result = graph_client._parse_result(mock_result)

        assert "alias" in result[0]
        assert "simple" in result[0]


# =============================================================================
# Parse Value Tests
# =============================================================================


class TestParseValue:
    """Tests for value parsing."""

    def test_parse_value_none(self, graph_client):
        """Test parsing None."""
        assert graph_client._parse_value(None) is None

    def test_parse_value_string(self, graph_client):
        """Test parsing string."""
        assert graph_client._parse_value("hello") == "hello"

    def test_parse_value_int(self, graph_client):
        """Test parsing integer."""
        assert graph_client._parse_value(42) == 42

    def test_parse_value_float(self, graph_client):
        """Test parsing float."""
        assert graph_client._parse_value(3.14) == 3.14

    def test_parse_value_bool(self, graph_client):
        """Test parsing boolean."""
        assert graph_client._parse_value(True) is True
        assert graph_client._parse_value(False) is False

    def test_parse_value_list(self, graph_client):
        """Test parsing list."""
        result = graph_client._parse_value([1, "two", 3.0])
        assert result == [1, "two", 3.0]

    def test_parse_value_node(self, graph_client):
        """Test parsing node object."""
        mock_node = MagicMock(spec=["properties"])  # Only allow properties attr
        mock_node.properties = {"id": "123", "name": "Test"}

        result = graph_client._parse_value(mock_node)

        assert result == {"id": "123", "name": "Test"}

    def test_parse_value_relationship(self, graph_client):
        """Test parsing relationship object."""
        mock_rel = MagicMock()
        mock_rel.relation = "KNOWS"
        mock_rel.properties = {"since": "2024"}

        # Remove properties attribute check for src_node
        type(mock_rel).src_node = PropertyMock(return_value="node_a")

        result = graph_client._parse_value(mock_rel)

        assert result["type"] == "KNOWS"
        assert result["properties"]["since"] == "2024"


# =============================================================================
# Node Operations Tests
# =============================================================================


class TestNodeOperations:
    """Tests for node CRUD operations."""

    @pytest.mark.asyncio
    async def test_create_node(self, mock_falkordb, graph_client):
        """Test creating a node."""
        mock_class, mock_client, mock_graph = mock_falkordb

        mock_result = MagicMock()
        mock_result.header = ["n"]
        mock_result.result_set = [[{"id": "node_123", "name": "Test"}]]
        mock_graph.query.return_value = mock_result

        await graph_client.connect()
        result = await graph_client.create_node(
            node_type=GraphNodeType.CONTACT,
            node_id="node_123",
            organization_id="org_456",
            properties={"name": "Test", "email": "test@example.com"},
        )

        assert result is not None
        mock_graph.query.assert_called_once()
        call_args = mock_graph.query.call_args[0][0]
        assert "CREATE" in call_args
        assert "Contact" in call_args

    @pytest.mark.asyncio
    async def test_get_node_exists(self, mock_falkordb, graph_client):
        """Test getting an existing node."""
        mock_class, mock_client, mock_graph = mock_falkordb

        mock_result = MagicMock()
        mock_result.header = ["n"]
        mock_result.result_set = [[{"id": "node_123", "name": "Test"}]]
        mock_graph.query.return_value = mock_result

        await graph_client.connect()
        result = await graph_client.get_node(
            node_type=GraphNodeType.CONTACT,
            node_id="node_123",
        )

        assert result is not None
        assert result["id"] == "node_123"

    @pytest.mark.asyncio
    async def test_get_node_not_found(self, mock_falkordb, graph_client):
        """Test getting a non-existent node."""
        mock_class, mock_client, mock_graph = mock_falkordb

        mock_result = MagicMock()
        mock_result.header = ["n"]
        mock_result.result_set = []
        mock_graph.query.return_value = mock_result

        await graph_client.connect()
        result = await graph_client.get_node(
            node_type=GraphNodeType.CONTACT,
            node_id="nonexistent",
        )

        assert result is None

    @pytest.mark.asyncio
    async def test_update_node(self, mock_falkordb, graph_client):
        """Test updating a node."""
        mock_class, mock_client, mock_graph = mock_falkordb

        mock_result = MagicMock()
        mock_result.header = ["n"]
        mock_result.result_set = [[{"id": "node_123", "name": "Updated"}]]
        mock_graph.query.return_value = mock_result

        await graph_client.connect()
        result = await graph_client.update_node(
            node_type=GraphNodeType.CONTACT,
            node_id="node_123",
            updates={"name": "Updated"},
        )

        assert result is not None
        call_args = mock_graph.query.call_args[0][0]
        assert "SET" in call_args

    @pytest.mark.asyncio
    async def test_delete_node(self, mock_falkordb, graph_client):
        """Test deleting a node."""
        mock_class, mock_client, mock_graph = mock_falkordb

        mock_result = MagicMock()
        mock_result.header = []
        mock_result.result_set = []
        mock_graph.query.return_value = mock_result

        await graph_client.connect()
        result = await graph_client.delete_node(
            node_type=GraphNodeType.CONTACT,
            node_id="node_123",
        )

        assert result is True
        call_args = mock_graph.query.call_args[0][0]
        assert "DETACH DELETE" in call_args


# =============================================================================
# Relationship Operations Tests
# =============================================================================


class TestRelationshipOperations:
    """Tests for relationship operations."""

    @pytest.mark.asyncio
    async def test_create_relationship(self, mock_falkordb, graph_client):
        """Test creating a relationship."""
        mock_class, mock_client, mock_graph = mock_falkordb

        mock_result = MagicMock()
        mock_result.header = ["r"]
        mock_result.result_set = [[{"type": "KNOWS"}]]
        mock_graph.query.return_value = mock_result

        await graph_client.connect()
        result = await graph_client.create_relationship(
            from_type=GraphNodeType.CONTACT,
            from_id="contact_1",
            to_type=GraphNodeType.CONTACT,
            to_id="contact_2",
            rel_type="KNOWS",
            properties={"since": "2024"},
        )

        assert result is not None
        call_args = mock_graph.query.call_args[0][0]
        assert "CREATE" in call_args
        assert "KNOWS" in call_args

    @pytest.mark.asyncio
    async def test_get_relationships_outgoing(self, mock_falkordb, graph_client):
        """Test getting outgoing relationships."""
        mock_class, mock_client, mock_graph = mock_falkordb

        mock_result = MagicMock()
        mock_result.header = ["relType", "r", "targetType", "m"]
        mock_result.result_set = [["KNOWS", {}, "Contact", {"id": "contact_2"}]]
        mock_graph.query.return_value = mock_result

        await graph_client.connect()
        result = await graph_client.get_relationships(
            node_type=GraphNodeType.CONTACT,
            node_id="contact_1",
            direction="outgoing",
        )

        assert len(result) == 1
        assert result[0]["relType"] == "KNOWS"

    @pytest.mark.asyncio
    async def test_get_relationships_incoming(self, mock_falkordb, graph_client):
        """Test getting incoming relationships."""
        mock_class, mock_client, mock_graph = mock_falkordb

        mock_result = MagicMock()
        mock_result.header = ["relType", "r", "sourceType", "m"]
        mock_result.result_set = [["KNOWS", {}, "Contact", {"id": "contact_2"}]]
        mock_graph.query.return_value = mock_result

        await graph_client.connect()
        result = await graph_client.get_relationships(
            node_type=GraphNodeType.CONTACT,
            node_id="contact_1",
            direction="incoming",
        )

        assert len(result) == 1

    @pytest.mark.asyncio
    async def test_get_relationships_both(self, mock_falkordb, graph_client):
        """Test getting relationships in both directions."""
        mock_class, mock_client, mock_graph = mock_falkordb

        mock_result = MagicMock()
        mock_result.header = ["relType", "r", "otherType", "m"]
        mock_result.result_set = [
            ["KNOWS", {}, "Contact", {"id": "contact_2"}],
            ["WORKS_WITH", {}, "Contact", {"id": "contact_3"}],
        ]
        mock_graph.query.return_value = mock_result

        await graph_client.connect()
        result = await graph_client.get_relationships(
            node_type=GraphNodeType.CONTACT,
            node_id="contact_1",
            direction="both",
        )

        assert len(result) == 2


# =============================================================================
# Vector Search Tests
# =============================================================================


class TestVectorSearch:
    """Tests for vector search operations."""

    @pytest.mark.asyncio
    async def test_vector_search_success(self, mock_falkordb, graph_client):
        """Test successful vector search."""
        mock_class, mock_client, mock_graph = mock_falkordb

        mock_result = MagicMock()
        mock_result.header = ["node", "score"]
        mock_result.result_set = [
            [{"id": "node_1"}, 0.95],
            [{"id": "node_2"}, 0.87],
        ]
        mock_graph.query.return_value = mock_result

        await graph_client.connect()
        result = await graph_client.vector_search(
            label="Commitment",
            embedding=[0.1] * 1536,
            organization_id="org_123",
            k=10,
        )

        assert len(result) == 2

    @pytest.mark.asyncio
    async def test_vector_search_failure_returns_empty(self, mock_falkordb, graph_client):
        """Test vector search returns empty on failure."""
        mock_class, mock_client, mock_graph = mock_falkordb

        mock_graph.query.side_effect = Exception("Vector index not found")

        await graph_client.connect()
        result = await graph_client.vector_search(
            label="Commitment",
            embedding=[0.1] * 1536,
            organization_id="org_123",
            k=10,
        )

        assert result == []


# =============================================================================
# Fulltext Search Tests
# =============================================================================


class TestFulltextSearch:
    """Tests for fulltext search operations."""

    @pytest.mark.asyncio
    async def test_fulltext_search_success(self, mock_falkordb, graph_client):
        """Test successful fulltext search."""
        mock_class, mock_client, mock_graph = mock_falkordb

        mock_result = MagicMock()
        mock_result.header = ["node", "score"]
        mock_result.result_set = [
            [{"id": "node_1", "name": "Test"}, 1.0],
        ]
        mock_graph.query.return_value = mock_result

        await graph_client.connect()
        result = await graph_client.fulltext_search(
            label="Contact",
            query_text="test query",
            organization_id="org_123",
            limit=10,
        )

        assert len(result) == 1

    @pytest.mark.asyncio
    async def test_fulltext_search_fallback(self, mock_falkordb, graph_client):
        """Test fulltext search falls back to CONTAINS."""
        mock_class, mock_client, mock_graph = mock_falkordb

        # First call fails, second succeeds (fallback)
        mock_result_success = MagicMock()
        mock_result_success.header = ["node", "score"]
        mock_result_success.result_set = [[{"id": "node_1"}, 1.0]]

        mock_graph.query.side_effect = [
            Exception("Fulltext index not found"),
            mock_result_success,
        ]

        await graph_client.connect()
        result = await graph_client.fulltext_search(
            label="Contact",
            query_text="test",
            organization_id="org_123",
            limit=10,
        )

        assert len(result) == 1
        # Should have been called twice (first for index, second for fallback)
        assert mock_graph.query.call_count == 2

    @pytest.mark.asyncio
    async def test_fulltext_search_escapes_query(self, mock_falkordb, graph_client):
        """Test fulltext search escapes special characters."""
        mock_class, mock_client, mock_graph = mock_falkordb

        mock_result = MagicMock()
        mock_result.header = ["node", "score"]
        mock_result.result_set = []
        mock_graph.query.return_value = mock_result

        await graph_client.connect()
        await graph_client.fulltext_search(
            label="Contact",
            query_text="test's query",  # Contains apostrophe
            organization_id="org_123",
            limit=10,
        )

        call_args = mock_graph.query.call_args[0][0]
        assert "\\'" in call_args  # Should be escaped


# =============================================================================
# Utility Method Tests
# =============================================================================


class TestUtilityMethods:
    """Tests for utility methods."""

    def test_dict_to_cypher_empty(self, graph_client):
        """Test dict_to_cypher with empty dict."""
        result = graph_client._dict_to_cypher({})
        assert result == "{}"

    def test_dict_to_cypher_simple(self, graph_client):
        """Test dict_to_cypher with simple dict."""
        result = graph_client._dict_to_cypher({"name": "Test", "age": 30})
        assert "name:" in result
        assert "'Test'" in result
        assert "age:" in result
        assert "30" in result

    def test_dict_to_cypher_skips_none(self, graph_client):
        """Test dict_to_cypher skips None values."""
        result = graph_client._dict_to_cypher({"name": "Test", "empty": None})
        assert "empty" not in result

    def test_value_to_cypher_null(self, graph_client):
        """Test value_to_cypher with None."""
        assert graph_client._value_to_cypher(None) == "null"

    def test_value_to_cypher_bool(self, graph_client):
        """Test value_to_cypher with bool."""
        assert graph_client._value_to_cypher(True) == "true"
        assert graph_client._value_to_cypher(False) == "false"

    def test_value_to_cypher_int(self, graph_client):
        """Test value_to_cypher with int."""
        assert graph_client._value_to_cypher(42) == "42"

    def test_value_to_cypher_float(self, graph_client):
        """Test value_to_cypher with float."""
        assert graph_client._value_to_cypher(3.14) == "3.14"

    def test_value_to_cypher_string(self, graph_client):
        """Test value_to_cypher with string."""
        result = graph_client._value_to_cypher("hello")
        assert result == "'hello'"

    def test_value_to_cypher_string_with_apostrophe(self, graph_client):
        """Test value_to_cypher escapes apostrophes."""
        result = graph_client._value_to_cypher("it's a test")
        assert "\\'" in result

    def test_value_to_cypher_datetime(self, graph_client):
        """Test value_to_cypher with datetime."""
        dt = datetime(2024, 1, 15, 10, 30)
        result = graph_client._value_to_cypher(dt)
        assert "2024-01-15" in result

    def test_value_to_cypher_list(self, graph_client):
        """Test value_to_cypher with list."""
        result = graph_client._value_to_cypher([1, 2, 3])
        assert result == "[1, 2, 3]"

    def test_value_to_cypher_dict(self, graph_client):
        """Test value_to_cypher with dict."""
        result = graph_client._value_to_cypher({"key": "value"})
        assert '"key"' in result
        assert '"value"' in result

    def test_build_set_clause_empty(self, graph_client):
        """Test build_set_clause with empty dict."""
        clause, params = graph_client.build_set_clause("n", {})
        assert clause == ""
        assert params == {}

    def test_build_set_clause_simple(self, graph_client):
        """Test build_set_clause with simple dict."""
        clause, params = graph_client.build_set_clause("n", {"name": "Test", "age": 30})

        assert "n.name" in clause
        assert "n.age" in clause
        assert "prop_name" in params
        assert params["prop_name"] == "Test"
        assert params["prop_age"] == 30

    def test_build_set_clause_datetime(self, graph_client):
        """Test build_set_clause converts datetime."""
        dt = datetime(2024, 1, 15)
        clause, params = graph_client.build_set_clause("n", {"updated_at": dt})

        assert "2024-01-15" in params["prop_updated_at"]

    def test_build_set_clause_list(self, graph_client):
        """Test build_set_clause converts list to JSON."""
        clause, params = graph_client.build_set_clause("n", {"tags": ["a", "b"]})

        assert json.loads(params["prop_tags"]) == ["a", "b"]

    def test_build_create_properties_empty(self, graph_client):
        """Test build_create_properties with empty dict."""
        clause, params = graph_client.build_create_properties({})
        assert clause == ""
        assert params == {}

    def test_build_create_properties_simple(self, graph_client):
        """Test build_create_properties with simple dict."""
        clause, params = graph_client.build_create_properties({"name": "Test", "age": 30})

        assert "name: $prop_name" in clause
        assert "age: $prop_age" in clause
        assert params["prop_name"] == "Test"
        assert params["prop_age"] == 30


# =============================================================================
# Index Management Tests
# =============================================================================


class TestIndexManagement:
    """Tests for index management."""

    @pytest.mark.asyncio
    async def test_initialize_indexes(self, mock_falkordb, graph_client):
        """Test index initialization."""
        mock_class, mock_client, mock_graph = mock_falkordb

        mock_result = MagicMock()
        mock_result.header = []
        mock_result.result_set = []
        mock_graph.query.return_value = mock_result

        await graph_client.connect()
        await graph_client.initialize_indexes()

        # Should have called query multiple times for indexes
        assert mock_graph.query.call_count > 0

    @pytest.mark.asyncio
    async def test_initialize_indexes_ignores_existing(self, mock_falkordb, graph_client):
        """Test index initialization ignores 'already indexed' errors."""
        mock_class, mock_client, mock_graph = mock_falkordb

        mock_graph.query.side_effect = Exception("Property already indexed")

        await graph_client.connect()
        # Should not raise, just log warning
        await graph_client.initialize_indexes()

    @pytest.mark.asyncio
    async def test_create_vector_index(self, mock_falkordb, graph_client):
        """Test vector index creation (placeholder)."""
        await graph_client.connect()
        # Currently a no-op that logs - should not raise
        await graph_client.create_vector_index(
            label="Contact",
            prop="embedding",
            dimension=1536,
        )

    @pytest.mark.asyncio
    async def test_create_fulltext_index(self, mock_falkordb, graph_client):
        """Test fulltext index creation (placeholder)."""
        await graph_client.connect()
        # Currently a no-op that logs - should not raise
        await graph_client.create_fulltext_index(
            label="Contact",
            properties=["name", "email"],
        )


# =============================================================================
# Vector Search Guard Tests
# =============================================================================


class TestVectorSearchGuards:
    """Tests for vector search guardrails."""

    @pytest.mark.asyncio
    async def test_vector_search_skips_non_embedded_label(self, graph_client):
        """Vector search should skip labels without embeddings."""
        graph_client.query = AsyncMock()

        result = await graph_client.vector_search(
            label="Contact",
            embedding=[0.1, 0.2, 0.3],
            organization_id="org_test",
            k=5,
        )

        assert result == []
        graph_client.query.assert_not_called()

    @pytest.mark.asyncio
    async def test_vector_search_skips_dimension_mismatch(self, graph_client, monkeypatch):
        """Vector search should skip if embedding dimension mismatches expected size."""
        graph_client.query = AsyncMock()

        monkeypatch.setattr(
            "src.search.embeddings.get_embedding_dimension",
            lambda *_args, **_kwargs: 2,
        )

        result = await graph_client.vector_search(
            label="UIO",
            embedding=[0.1, 0.2, 0.3],
            organization_id="org_test",
            k=5,
        )

        assert result == []
        graph_client.query.assert_not_called()


# =============================================================================
# Factory Function Tests
# =============================================================================


class TestFactoryFunctions:
    """Tests for factory functions."""

    @pytest.mark.asyncio
    async def test_get_graph_client_creates_instance(self):
        """Test get_graph_client creates singleton."""
        import src.graph.client as client_module

        # Reset global
        client_module._graph_client = None

        with patch.object(client_module, "get_settings") as mock_settings:
            mock_settings.return_value = MagicMock(
                falkordb_host="localhost",
                falkordb_port=6379,
                falkordb_graph_name="test",
            )
            with patch.object(DroviGraph, "connect", new_callable=AsyncMock):
                client = await get_graph_client()
                assert client is not None

                # Second call should return same instance
                client2 = await get_graph_client()
                assert client is client2

        # Cleanup
        client_module._graph_client = None

    @pytest.mark.asyncio
    async def test_close_graph_client(self):
        """Test close_graph_client clears singleton."""
        import src.graph.client as client_module

        mock_client = MagicMock()
        mock_client.close = AsyncMock()
        client_module._graph_client = mock_client

        await close_graph_client()

        assert client_module._graph_client is None
        mock_client.close.assert_called_once()

    @pytest.mark.asyncio
    async def test_close_graph_client_no_op_if_none(self):
        """Test close_graph_client is no-op if no client."""
        import src.graph.client as client_module

        client_module._graph_client = None

        # Should not raise
        await close_graph_client()
