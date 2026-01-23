"""
FalkorDB Graph Client

Native Python client for FalkorDB knowledge graph operations.
Provides:
- Node and relationship CRUD
- Cypher query execution
- Vector and full-text indexes
- Graph algorithms
"""

import json
from datetime import datetime
from typing import Any

import structlog
from falkordb import FalkorDB

from src.config import get_settings
from .types import GraphNodeType

logger = structlog.get_logger()

# Global client instance
_graph_client: "DroviGraph | None" = None


class DroviGraph:
    """
    FalkorDB graph client for the Drovi Intelligence Platform.

    Uses the official FalkorDB Python client for native graph operations.
    """

    def __init__(self, host: str, port: int, graph_name: str = "drovi_intelligence"):
        """Initialize FalkorDB connection."""
        self.host = host
        self.port = port
        self.graph_name = graph_name
        self._client: FalkorDB | None = None
        self._graph = None

    async def connect(self) -> None:
        """Establish connection to FalkorDB."""
        try:
            self._client = FalkorDB(host=self.host, port=self.port)
            self._graph = self._client.select_graph(self.graph_name)
            logger.info(
                "Connected to FalkorDB",
                host=self.host,
                port=self.port,
                graph=self.graph_name,
            )
        except Exception as e:
            logger.error("Failed to connect to FalkorDB", error=str(e))
            raise

    async def close(self) -> None:
        """Close FalkorDB connection."""
        if self._client:
            # FalkorDB client doesn't have explicit close, but we clear references
            self._graph = None
            self._client = None
            logger.info("Disconnected from FalkorDB")

    async def query(self, cypher: str, params: dict[str, Any] | None = None) -> list[dict]:
        """
        Execute a Cypher query.

        Args:
            cypher: Cypher query string
            params: Optional query parameters

        Returns:
            List of result dictionaries
        """
        if not self._graph:
            raise RuntimeError("Not connected to FalkorDB")

        try:
            result = self._graph.query(cypher, params or {})
            return self._parse_result(result)
        except Exception as e:
            logger.error("Cypher query failed", query=cypher[:100], error=str(e))
            raise

    def _parse_result(self, result: Any) -> list[dict]:
        """Parse FalkorDB query result into list of dicts."""
        if not result:
            return []

        parsed = []
        headers = result.header if hasattr(result, "header") else []

        for row in result.result_set if hasattr(result, "result_set") else []:
            row_dict = {}
            for i, value in enumerate(row):
                key = headers[i] if i < len(headers) else f"col_{i}"
                row_dict[key] = self._parse_value(value)
            parsed.append(row_dict)

        return parsed

    def _parse_value(self, value: Any) -> Any:
        """Parse a single value from FalkorDB result."""
        if value is None:
            return None
        if isinstance(value, (str, int, float, bool)):
            return value
        if isinstance(value, list):
            return [self._parse_value(v) for v in value]
        if hasattr(value, "properties"):
            # Node object
            return dict(value.properties)
        if hasattr(value, "src_node"):
            # Relationship object
            return {
                "type": value.relation,
                "properties": dict(value.properties) if hasattr(value, "properties") else {},
            }
        return value

    # =========================================================================
    # Index Management
    # =========================================================================

    async def initialize_indexes(self) -> None:
        """Create all required indexes for the intelligence platform."""
        logger.info("Initializing FalkorDB indexes")

        # Regular indexes
        indexes = [
            # Core nodes
            "CREATE INDEX ON :UIO(id)",
            "CREATE INDEX ON :UIO(organizationId)",
            "CREATE INDEX ON :Commitment(id)",
            "CREATE INDEX ON :Commitment(organizationId)",
            "CREATE INDEX ON :Decision(id)",
            "CREATE INDEX ON :Decision(organizationId)",
            "CREATE INDEX ON :Topic(id)",
            "CREATE INDEX ON :Project(id)",
            # Contact
            "CREATE INDEX ON :Contact(id)",
            "CREATE INDEX ON :Contact(organizationId)",
            "CREATE INDEX ON :Contact(email)",
            # Conversation/Message
            "CREATE INDEX ON :Conversation(id)",
            "CREATE INDEX ON :Conversation(organizationId)",
            "CREATE INDEX ON :Conversation(sourceId)",
            "CREATE INDEX ON :Message(id)",
            "CREATE INDEX ON :Message(organizationId)",
            # Task/Claim
            "CREATE INDEX ON :Task(id)",
            "CREATE INDEX ON :Task(organizationId)",
            "CREATE INDEX ON :Claim(id)",
            "CREATE INDEX ON :Claim(organizationId)",
            # Agentic Memory
            "CREATE INDEX ON :Episode(id)",
            "CREATE INDEX ON :Episode(organizationId)",
            "CREATE INDEX ON :Episode(sourceType)",
            "CREATE INDEX ON :Episode(sourceId)",
            "CREATE INDEX ON :Episode(referenceTime)",
            "CREATE INDEX ON :Episode(recordedAt)",
            "CREATE INDEX ON :Entity(id)",
            "CREATE INDEX ON :Entity(organizationId)",
            "CREATE INDEX ON :Entity(name)",
            "CREATE INDEX ON :Entity(entityType)",
            # Multi-source
            "CREATE INDEX ON :SlackChannel(id)",
            "CREATE INDEX ON :SlackChannel(slackId)",
            "CREATE INDEX ON :NotionPage(id)",
            "CREATE INDEX ON :NotionPage(notionId)",
            "CREATE INDEX ON :GoogleDoc(id)",
            "CREATE INDEX ON :GoogleDoc(googleId)",
            "CREATE INDEX ON :WhatsAppGroup(id)",
            "CREATE INDEX ON :CalendarEvent(id)",
            "CREATE INDEX ON :Organization(id)",
        ]

        for index_query in indexes:
            try:
                await self.query(index_query)
            except Exception as e:
                # Index may already exist
                if "already indexed" not in str(e).lower():
                    logger.warning("Failed to create index", query=index_query, error=str(e))

        # Vector indexes for semantic search
        await self._create_vector_indexes()

        # Full-text indexes for keyword search
        await self._create_fulltext_indexes()

        logger.info("FalkorDB indexes initialized")

    async def _create_vector_indexes(self) -> None:
        """
        Create vector indexes for semantic search.

        Note: FalkorDB vector index support requires specific configuration.
        Vector search falls back to brute-force if indexes aren't available.
        """
        # FalkorDB uses a different syntax for vector indexes
        # For now, we log that vector indexes should be created manually if needed
        logger.info(
            "Vector indexes: FalkorDB requires manual setup for optimal vector search. "
            "Basic functionality works without vector indexes."
        )

    async def _create_fulltext_indexes(self) -> None:
        """
        Create full-text indexes for keyword search.

        Note: FalkorDB fulltext search uses different syntax than Neo4j.
        Basic string matching still works without fulltext indexes.
        """
        # FalkorDB uses RediSearch for fulltext, which has different syntax
        logger.info(
            "Fulltext indexes: FalkorDB uses RediSearch syntax. "
            "Basic functionality works without fulltext indexes."
        )

    async def create_vector_index(
        self,
        label: str,
        prop: str,
        dimension: int = 1536,
        similarity: str = "cosine",
    ) -> None:
        """
        Create a vector index for semantic search.

        Note: FalkorDB vector index creation differs from Neo4j.
        This is a placeholder for future FalkorDB-specific implementation.
        """
        logger.debug(
            "Vector index creation skipped (FalkorDB syntax differs)",
            label=label,
            property=prop,
            dimension=dimension,
        )

    async def create_fulltext_index(self, label: str, properties: list[str]) -> None:
        """
        Create a full-text index for keyword search.

        Note: FalkorDB uses RediSearch for fulltext indexing.
        This is a placeholder for future FalkorDB-specific implementation.
        """
        logger.debug(
            "Fulltext index creation skipped (FalkorDB syntax differs)",
            label=label,
            properties=properties,
        )

    # =========================================================================
    # Node Operations
    # =========================================================================

    async def create_node(
        self,
        node_type: GraphNodeType,
        node_id: str,
        organization_id: str,
        properties: dict[str, Any],
    ) -> dict:
        """Create a new node in the graph."""
        now = datetime.utcnow().isoformat()
        props = {
            "id": node_id,
            "organizationId": organization_id,
            "createdAt": now,
            "updatedAt": now,
            **properties,
        }

        # Convert to Cypher property string
        props_str = self._dict_to_cypher(props)
        query = f"CREATE (n:{node_type.value} {props_str}) RETURN n"

        result = await self.query(query)
        return result[0]["n"] if result else props

    async def get_node(self, node_type: GraphNodeType, node_id: str) -> dict | None:
        """Get a node by ID."""
        query = f"MATCH (n:{node_type.value} {{id: $id}}) RETURN n"
        result = await self.query(query, {"id": node_id})
        return result[0]["n"] if result else None

    async def update_node(
        self,
        node_type: GraphNodeType,
        node_id: str,
        updates: dict[str, Any],
    ) -> dict | None:
        """Update a node's properties."""
        now = datetime.utcnow().isoformat()
        updates["updatedAt"] = now

        set_clauses = ", ".join(f"n.{k} = {self._value_to_cypher(v)}" for k, v in updates.items())
        query = f"""
        MATCH (n:{node_type.value} {{id: $id}})
        SET {set_clauses}
        RETURN n
        """
        result = await self.query(query, {"id": node_id})
        return result[0]["n"] if result else None

    async def delete_node(self, node_type: GraphNodeType, node_id: str) -> bool:
        """Delete a node and its relationships."""
        query = f"MATCH (n:{node_type.value} {{id: $id}}) DETACH DELETE n"
        await self.query(query, {"id": node_id})
        return True

    # =========================================================================
    # Relationship Operations
    # =========================================================================

    async def create_relationship(
        self,
        from_type: GraphNodeType,
        from_id: str,
        to_type: GraphNodeType,
        to_id: str,
        rel_type: str,
        properties: dict[str, Any] | None = None,
    ) -> dict | None:
        """Create a relationship between two nodes."""
        props_str = self._dict_to_cypher(properties or {})
        query = f"""
        MATCH (a:{from_type.value} {{id: $fromId}})
        MATCH (b:{to_type.value} {{id: $toId}})
        CREATE (a)-[r:{rel_type} {props_str}]->(b)
        RETURN r
        """
        result = await self.query(query, {"fromId": from_id, "toId": to_id})
        return result[0]["r"] if result else None

    async def get_relationships(
        self,
        node_type: GraphNodeType,
        node_id: str,
        direction: str = "both",
    ) -> list[dict]:
        """Get all relationships for a node."""
        if direction == "outgoing":
            query = f"""
            MATCH (n:{node_type.value} {{id: $id}})-[r]->(m)
            RETURN type(r) as relType, r, labels(m)[0] as targetType, m
            """
        elif direction == "incoming":
            query = f"""
            MATCH (n:{node_type.value} {{id: $id}})<-[r]-(m)
            RETURN type(r) as relType, r, labels(m)[0] as sourceType, m
            """
        else:
            query = f"""
            MATCH (n:{node_type.value} {{id: $id}})-[r]-(m)
            RETURN type(r) as relType, r, labels(m)[0] as otherType, m
            """
        return await self.query(query, {"id": node_id})

    # =========================================================================
    # Vector Search
    # =========================================================================

    async def vector_search(
        self,
        label: str,
        embedding: list[float],
        organization_id: str,
        k: int = 10,
    ) -> list[dict]:
        """
        Perform vector similarity search.

        Args:
            label: Node label to search
            embedding: Query embedding vector
            organization_id: Filter by organization
            k: Number of results

        Returns:
            List of matching nodes with scores
        """
        try:
            # FalkorDB vector index query syntax:
            # db.idx.vector.queryNodes(label:property, topK, vector, {options})
            index_name = f"{label}:embedding"
            query = f"""
            CALL db.idx.vector.queryNodes('{index_name}', $k, vecf32($embedding), {{}})
            YIELD node, score
            WHERE node.organizationId = $orgId
            RETURN node, score
            ORDER BY score DESC
            """
            return await self.query(
                query,
                {"k": k, "embedding": embedding, "orgId": organization_id},
            )
        except Exception as e:
            # Vector index may not exist or syntax differs
            logger.warning(
                "Vector search failed, returning empty results",
                label=label,
                error=str(e),
            )
            return []

    # =========================================================================
    # Full-text Search
    # =========================================================================

    async def fulltext_search(
        self,
        label: str,
        query_text: str,
        organization_id: str,
        limit: int = 10,
    ) -> list[dict]:
        """
        Perform full-text search.

        Args:
            label: Node label to search
            query_text: Search query
            organization_id: Filter by organization
            limit: Maximum results

        Returns:
            List of matching nodes with scores
        """
        try:
            # FalkorDB fulltext index query syntax:
            # db.idx.fulltext.queryNodes(index_name, query_text)
            index_name = f"{label.lower()}_search_idx"
            # Escape special characters
            escaped_query = query_text.replace("'", "\\'")
            query = f"""
            CALL db.idx.fulltext.queryNodes('{index_name}', '{escaped_query}')
            YIELD node, score
            WHERE node.organizationId = $orgId
            RETURN node, score
            ORDER BY score DESC
            LIMIT $limit
            """
            return await self.query(query, {"orgId": organization_id, "limit": limit})
        except Exception as e:
            # Fulltext index may not exist
            logger.warning(
                "Fulltext search failed, falling back to CONTAINS",
                label=label,
                error=str(e),
            )
            # Fallback to simple CONTAINS search
            fallback_query = f"""
            MATCH (n:{label})
            WHERE n.organizationId = $orgId
              AND (toLower(n.name) CONTAINS toLower($query)
                   OR toLower(n.title) CONTAINS toLower($query)
                   OR toLower(n.description) CONTAINS toLower($query))
            RETURN n as node, 1.0 as score
            LIMIT $limit
            """
            return await self.query(
                fallback_query,
                {"orgId": organization_id, "query": query_text, "limit": limit},
            )

    # =========================================================================
    # Utility Methods
    # =========================================================================

    def _dict_to_cypher(self, d: dict[str, Any]) -> str:
        """Convert a dictionary to Cypher property string."""
        if not d:
            return "{}"
        props = ", ".join(f"{k}: {self._value_to_cypher(v)}" for k, v in d.items() if v is not None)
        return f"{{{props}}}"

    def build_set_clause(self, var_name: str, props: dict[str, Any]) -> tuple[str, dict[str, Any]]:
        """
        Build a SET clause from a properties dict.

        FalkorDB doesn't support SET n += $props with a dict parameter.
        This method generates individual SET clauses for each property.

        Args:
            var_name: The variable name in the query (e.g., "u", "n")
            props: Dictionary of properties to set

        Returns:
            Tuple of (SET clause string, parameter dict)

        Example:
            clause, params = client.build_set_clause("u", {"name": "John", "age": 30})
            # clause = "u.name = $prop_name, u.age = $prop_age"
            # params = {"prop_name": "John", "prop_age": 30}
        """
        if not props:
            return "", {}

        clauses = []
        params = {}
        for key, value in props.items():
            if value is None:
                continue
            param_name = f"prop_{key}"
            clauses.append(f"{var_name}.{key} = ${param_name}")
            # Convert datetime to isoformat string
            if isinstance(value, datetime):
                params[param_name] = value.isoformat()
            elif isinstance(value, (list, dict)):
                params[param_name] = json.dumps(value)
            else:
                params[param_name] = value

        return ", ".join(clauses), params

    def build_create_properties(self, props: dict[str, Any]) -> tuple[str, dict[str, Any]]:
        """
        Build property clause for CREATE statement.

        FalkorDB doesn't support CREATE (n $props) with a dict parameter.
        This method generates explicit property assignments.

        Args:
            props: Dictionary of properties

        Returns:
            Tuple of (property clause string, parameter dict)

        Example:
            clause, params = client.build_create_properties({"name": "John", "age": 30})
            # clause = "name: $prop_name, age: $prop_age"
            # params = {"prop_name": "John", "prop_age": 30}
        """
        if not props:
            return "", {}

        clauses = []
        params = {}
        for key, value in props.items():
            if value is None:
                continue
            param_name = f"prop_{key}"
            clauses.append(f"{key}: ${param_name}")
            # Convert datetime to isoformat string
            if isinstance(value, datetime):
                params[param_name] = value.isoformat()
            elif isinstance(value, (list, dict)):
                params[param_name] = json.dumps(value)
            else:
                params[param_name] = value

        return ", ".join(clauses), params

    def _value_to_cypher(self, value: Any) -> str:
        """Convert a Python value to Cypher literal."""
        if value is None:
            return "null"
        if isinstance(value, bool):
            return "true" if value else "false"
        if isinstance(value, (int, float)):
            return str(value)
        if isinstance(value, str):
            return f"'{value.replace(chr(39), chr(92) + chr(39))}'"
        if isinstance(value, datetime):
            return f"'{value.isoformat()}'"
        if isinstance(value, list):
            return json.dumps(value)
        if isinstance(value, dict):
            return json.dumps(value)
        return f"'{str(value)}'"


# =============================================================================
# Factory Functions
# =============================================================================


async def get_graph_client() -> DroviGraph:
    """Get or create the global graph client instance."""
    global _graph_client

    if _graph_client is None:
        settings = get_settings()
        _graph_client = DroviGraph(
            host=settings.falkordb_host,
            port=settings.falkordb_port,
            graph_name=settings.falkordb_graph_name,
        )
        await _graph_client.connect()

    return _graph_client


async def close_graph_client() -> None:
    """Close the global graph client."""
    global _graph_client

    if _graph_client:
        await _graph_client.close()
        _graph_client = None
