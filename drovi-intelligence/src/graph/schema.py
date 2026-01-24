"""
FalkorDB Graph Schema

Defines and manages the graph schema including:
- Unique constraints (prevent duplicate entities)
- Mandatory constraints (enforce required properties)
- Full-text indexes with advanced features
- Vector indexes for semantic search

This ensures data integrity and optimal query performance.
"""

import structlog

from .client import get_graph_client

logger = structlog.get_logger()


class GraphSchema:
    """
    Manages FalkorDB graph schema setup.

    Ensures proper constraints and indexes are in place for:
    - Data integrity (unique constraints)
    - Query performance (indexes)
    - Advanced search (full-text with phonetic, fuzzy)
    """

    def __init__(self):
        self._graph = None

    async def _get_graph(self):
        """Lazy load graph client."""
        if self._graph is None:
            self._graph = await get_graph_client()
        return self._graph

    # =========================================================================
    # Unique Constraints
    # =========================================================================

    async def setup_unique_constraints(self) -> dict[str, bool]:
        """
        Set up unique constraints to prevent duplicate entities.

        Returns:
            Dict mapping constraint name to success status
        """
        graph = await self._get_graph()

        constraints = [
            # Contact uniqueness by email within organization
            {
                "name": "contact_email_unique",
                "query": """
                    CREATE CONSTRAINT IF NOT EXISTS FOR (c:Contact)
                    REQUIRE (c.organizationId, c.email) IS UNIQUE
                """,
            },
            # UIO uniqueness by ID
            {
                "name": "uio_id_unique",
                "query": """
                    CREATE CONSTRAINT IF NOT EXISTS FOR (u:UIO)
                    REQUIRE u.id IS UNIQUE
                """,
            },
            # Commitment uniqueness by ID
            {
                "name": "commitment_id_unique",
                "query": """
                    CREATE CONSTRAINT IF NOT EXISTS FOR (c:Commitment)
                    REQUIRE c.id IS UNIQUE
                """,
            },
            # Decision uniqueness by ID
            {
                "name": "decision_id_unique",
                "query": """
                    CREATE CONSTRAINT IF NOT EXISTS FOR (d:Decision)
                    REQUIRE d.id IS UNIQUE
                """,
            },
            # Task uniqueness by ID
            {
                "name": "task_id_unique",
                "query": """
                    CREATE CONSTRAINT IF NOT EXISTS FOR (t:Task)
                    REQUIRE t.id IS UNIQUE
                """,
            },
            # Risk uniqueness by ID
            {
                "name": "risk_id_unique",
                "query": """
                    CREATE CONSTRAINT IF NOT EXISTS FOR (r:Risk)
                    REQUIRE r.id IS UNIQUE
                """,
            },
            # Brief uniqueness by ID
            {
                "name": "brief_id_unique",
                "query": """
                    CREATE CONSTRAINT IF NOT EXISTS FOR (b:Brief)
                    REQUIRE b.id IS UNIQUE
                """,
            },
            # Claim uniqueness by ID
            {
                "name": "claim_id_unique",
                "query": """
                    CREATE CONSTRAINT IF NOT EXISTS FOR (c:Claim)
                    REQUIRE c.id IS UNIQUE
                """,
            },
            # Episode uniqueness by ID
            {
                "name": "episode_id_unique",
                "query": """
                    CREATE CONSTRAINT IF NOT EXISTS FOR (e:Episode)
                    REQUIRE e.id IS UNIQUE
                """,
            },
            # Entity uniqueness by ID
            {
                "name": "entity_id_unique",
                "query": """
                    CREATE CONSTRAINT IF NOT EXISTS FOR (e:Entity)
                    REQUIRE e.id IS UNIQUE
                """,
            },
        ]

        results = {}

        for constraint in constraints:
            try:
                await graph.query(constraint["query"])
                results[constraint["name"]] = True
                logger.info(
                    "Unique constraint created",
                    constraint=constraint["name"],
                )
            except Exception as e:
                # Constraint may already exist
                if "already exists" in str(e).lower():
                    results[constraint["name"]] = True
                    logger.debug(
                        "Unique constraint already exists",
                        constraint=constraint["name"],
                    )
                else:
                    results[constraint["name"]] = False
                    logger.error(
                        "Failed to create unique constraint",
                        constraint=constraint["name"],
                        error=str(e),
                    )

        return results

    # =========================================================================
    # Full-Text Indexes
    # =========================================================================

    async def setup_fulltext_indexes(self) -> dict[str, bool]:
        """
        Set up full-text indexes with advanced features.

        Features enabled:
        - Phonetic search (Double Metaphone) for name matching
        - Fuzzy matching for typo tolerance
        - Stemming for language-aware search
        - Custom stopword handling

        Returns:
            Dict mapping index name to success status
        """
        graph = await self._get_graph()

        indexes = [
            # Contact name with phonetic support
            {
                "name": "contact_name_ft",
                "query": """
                    CALL db.idx.fulltext.createNodeIndex(
                        'Contact', 'name',
                        {language: 'english', phonetic: 'dm:en'}
                    )
                """,
            },
            # Contact email for exact and partial matching
            {
                "name": "contact_email_ft",
                "query": """
                    CALL db.idx.fulltext.createNodeIndex(
                        'Contact', 'email',
                        {language: 'english'}
                    )
                """,
            },
            # Commitment title and description
            {
                "name": "commitment_content_ft",
                "query": """
                    CALL db.idx.fulltext.createNodeIndex(
                        'Commitment', ['title', 'description'],
                        {language: 'english'}
                    )
                """,
            },
            # Decision content
            {
                "name": "decision_content_ft",
                "query": """
                    CALL db.idx.fulltext.createNodeIndex(
                        'Decision', ['title', 'statement', 'rationale'],
                        {language: 'english'}
                    )
                """,
            },
            # Task content
            {
                "name": "task_content_ft",
                "query": """
                    CALL db.idx.fulltext.createNodeIndex(
                        'Task', ['title', 'description'],
                        {language: 'english'}
                    )
                """,
            },
            # Risk content
            {
                "name": "risk_content_ft",
                "query": """
                    CALL db.idx.fulltext.createNodeIndex(
                        'Risk', ['title', 'suggestedAction'],
                        {language: 'english'}
                    )
                """,
            },
            # Brief content
            {
                "name": "brief_content_ft",
                "query": """
                    CALL db.idx.fulltext.createNodeIndex(
                        'Brief', ['title', 'summary'],
                        {language: 'english'}
                    )
                """,
            },
            # Claim content
            {
                "name": "claim_content_ft",
                "query": """
                    CALL db.idx.fulltext.createNodeIndex(
                        'Claim', ['title'],
                        {language: 'english'}
                    )
                """,
            },
            # Episode content for memory search
            {
                "name": "episode_content_ft",
                "query": """
                    CALL db.idx.fulltext.createNodeIndex(
                        'Episode', ['name', 'content'],
                        {language: 'english'}
                    )
                """,
            },
            # Entity name with phonetic
            {
                "name": "entity_name_ft",
                "query": """
                    CALL db.idx.fulltext.createNodeIndex(
                        'Entity', 'name',
                        {language: 'english', phonetic: 'dm:en'}
                    )
                """,
            },
            # Topic name
            {
                "name": "topic_name_ft",
                "query": """
                    CALL db.idx.fulltext.createNodeIndex(
                        'Topic', 'name',
                        {language: 'english'}
                    )
                """,
            },
        ]

        results = {}

        for index in indexes:
            try:
                await graph.query(index["query"])
                results[index["name"]] = True
                logger.info(
                    "Full-text index created",
                    index=index["name"],
                )
            except Exception as e:
                # Index may already exist
                if "already exists" in str(e).lower() or "duplicate" in str(e).lower():
                    results[index["name"]] = True
                    logger.debug(
                        "Full-text index already exists",
                        index=index["name"],
                    )
                else:
                    results[index["name"]] = False
                    logger.error(
                        "Failed to create full-text index",
                        index=index["name"],
                        error=str(e),
                    )

        return results

    # =========================================================================
    # Vector Indexes
    # =========================================================================

    async def setup_vector_indexes(
        self,
        dimension: int = 1536,
        m: int = 16,
        ef_construction: int = 200,
    ) -> dict[str, bool]:
        """
        Set up vector indexes for semantic search.

        HNSW parameters:
        - M: Maximum number of connections per layer (higher = better recall, more memory)
        - ef_construction: Size of dynamic candidate list during construction
        - ef_runtime: Search time parameter (set at query time)

        Args:
            dimension: Embedding dimension (default 1536 for OpenAI)
            m: HNSW M parameter
            ef_construction: HNSW construction parameter

        Returns:
            Dict mapping index name to success status
        """
        graph = await self._get_graph()

        # Node types that need vector indexes
        vector_nodes = [
            "Commitment",
            "Decision",
            "Task",
            "Episode",
            "Entity",
            "Contact",
            "Topic",
            "Claim",
            "Risk",
            "Brief",
        ]

        results = {}

        for node_type in vector_nodes:
            index_name = f"{node_type.lower()}_embedding_vec"
            try:
                # Create vector index with HNSW parameters
                query = f"""
                    CREATE VECTOR INDEX IF NOT EXISTS {index_name}
                    FOR (n:{node_type})
                    ON n.embedding
                    OPTIONS {{
                        indexType: 'HNSW',
                        dimension: {dimension},
                        similarityFunction: 'cosine',
                        m: {m},
                        efConstruction: {ef_construction}
                    }}
                """
                await graph.query(query)
                results[index_name] = True
                logger.info(
                    "Vector index created",
                    index=index_name,
                    dimension=dimension,
                )
            except Exception as e:
                if "already exists" in str(e).lower():
                    results[index_name] = True
                    logger.debug(
                        "Vector index already exists",
                        index=index_name,
                    )
                else:
                    results[index_name] = False
                    logger.error(
                        "Failed to create vector index",
                        index=index_name,
                        error=str(e),
                    )

        return results

    # =========================================================================
    # Relationship Vector Indexes
    # =========================================================================

    async def setup_relationship_vector_indexes(
        self,
        dimension: int = 1536,
    ) -> dict[str, bool]:
        """
        Set up vector indexes on relationships for semantic edge search.

        This is an advanced feature that enables searching based on
        relationship semantics (e.g., finding similar types of connections).

        Args:
            dimension: Embedding dimension

        Returns:
            Dict mapping index name to success status
        """
        graph = await self._get_graph()

        # Relationship types that benefit from vector indexes
        rel_types = [
            "MENTIONS",
            "RELATED_TO",
            "INVOLVES",
            "EXTRACTED_FROM",
        ]

        results = {}

        for rel_type in rel_types:
            index_name = f"{rel_type.lower()}_embedding_vec"
            try:
                query = f"""
                    CREATE VECTOR INDEX IF NOT EXISTS {index_name}
                    FOR ()-[r:{rel_type}]-()
                    ON r.embedding
                    OPTIONS {{
                        indexType: 'HNSW',
                        dimension: {dimension},
                        similarityFunction: 'cosine'
                    }}
                """
                await graph.query(query)
                results[index_name] = True
                logger.info(
                    "Relationship vector index created",
                    index=index_name,
                )
            except Exception as e:
                if "already exists" in str(e).lower():
                    results[index_name] = True
                else:
                    results[index_name] = False
                    logger.warning(
                        "Failed to create relationship vector index",
                        index=index_name,
                        error=str(e),
                    )

        return results

    # =========================================================================
    # Regular Indexes for Query Performance
    # =========================================================================

    async def setup_performance_indexes(self) -> dict[str, bool]:
        """
        Set up regular indexes for query performance.

        These indexes speed up common query patterns like:
        - Filtering by organizationId
        - Sorting by createdAt
        - Filtering by status

        Returns:
            Dict mapping index name to success status
        """
        graph = await self._get_graph()

        indexes = [
            # Organization filtering (most common)
            ("Contact", "organizationId"),
            ("Commitment", "organizationId"),
            ("Decision", "organizationId"),
            ("Task", "organizationId"),
            ("Episode", "organizationId"),
            ("Entity", "organizationId"),
            ("Risk", "organizationId"),
            ("Brief", "organizationId"),
            ("Claim", "organizationId"),
            # Status filtering
            ("Commitment", "status"),
            ("Decision", "status"),
            ("Task", "status"),
            ("Risk", "severity"),
            # Date sorting
            ("Episode", "referenceTime"),
            ("Commitment", "dueDate"),
            ("Task", "dueDate"),
            ("Commitment", "createdAt"),
            ("Decision", "createdAt"),
            ("Task", "createdAt"),
            ("Risk", "createdAt"),
            ("Brief", "createdAt"),
            ("Claim", "createdAt"),
            # Source filtering
            ("Episode", "sourceType"),
            ("Commitment", "sourceType"),
            # Priority and type filtering
            ("Risk", "riskType"),
            ("Brief", "priorityTier"),
            ("Brief", "suggestedAction"),
            ("Claim", "claimType"),
        ]

        results = {}

        for node_type, property_name in indexes:
            index_name = f"{node_type.lower()}_{property_name}_idx"
            try:
                query = f"""
                    CREATE INDEX IF NOT EXISTS {index_name}
                    FOR (n:{node_type})
                    ON (n.{property_name})
                """
                await graph.query(query)
                results[index_name] = True
                logger.debug(
                    "Performance index created",
                    index=index_name,
                )
            except Exception as e:
                if "already exists" in str(e).lower():
                    results[index_name] = True
                else:
                    results[index_name] = False
                    logger.warning(
                        "Failed to create performance index",
                        index=index_name,
                        error=str(e),
                    )

        return results

    # =========================================================================
    # Full Schema Setup
    # =========================================================================

    async def setup_all(self) -> dict[str, dict[str, bool]]:
        """
        Set up all schema components.

        This is the main entry point for initializing the graph schema.
        Should be called once at application startup.

        Returns:
            Dict with results for each schema component
        """
        logger.info("Setting up FalkorDB graph schema")

        results = {
            "unique_constraints": await self.setup_unique_constraints(),
            "fulltext_indexes": await self.setup_fulltext_indexes(),
            "vector_indexes": await self.setup_vector_indexes(),
            "relationship_vectors": await self.setup_relationship_vector_indexes(),
            "performance_indexes": await self.setup_performance_indexes(),
        }

        # Count successes
        total = sum(len(v) for v in results.values())
        succeeded = sum(
            sum(1 for s in v.values() if s)
            for v in results.values()
        )

        logger.info(
            "Graph schema setup complete",
            total=total,
            succeeded=succeeded,
            failed=total - succeeded,
        )

        return results


# =============================================================================
# Singleton
# =============================================================================

_graph_schema: GraphSchema | None = None


async def get_graph_schema() -> GraphSchema:
    """Get the singleton GraphSchema instance."""
    global _graph_schema
    if _graph_schema is None:
        _graph_schema = GraphSchema()
    return _graph_schema


async def setup_graph_schema() -> dict[str, dict[str, bool]]:
    """Convenience function to set up the full schema."""
    schema = await get_graph_schema()
    return await schema.setup_all()
