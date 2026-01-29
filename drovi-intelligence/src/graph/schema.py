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
            # Memory System constraints (NEW)
            # UserProfile uniqueness by ID
            {
                "name": "userprofile_id_unique",
                "query": """
                    CREATE CONSTRAINT IF NOT EXISTS FOR (u:UserProfile)
                    REQUIRE u.id IS UNIQUE
                """,
            },
            # UserProfile uniqueness by user within organization
            {
                "name": "userprofile_user_unique",
                "query": """
                    CREATE CONSTRAINT IF NOT EXISTS FOR (u:UserProfile)
                    REQUIRE (u.organizationId, u.userId) IS UNIQUE
                """,
            },
            # OrganizationBaseline uniqueness (one per org)
            {
                "name": "orgbaseline_id_unique",
                "query": """
                    CREATE CONSTRAINT IF NOT EXISTS FOR (o:OrganizationBaseline)
                    REQUIRE o.id IS UNIQUE
                """,
            },
            # Pattern uniqueness by ID
            {
                "name": "pattern_id_unique",
                "query": """
                    CREATE CONSTRAINT IF NOT EXISTS FOR (p:Pattern)
                    REQUIRE p.id IS UNIQUE
                """,
            },
            # Raw Content Layer constraints (Phase 1 - Deeper Graph)
            # RawMessage uniqueness by ID
            {
                "name": "rawmessage_id_unique",
                "query": """
                    CREATE CONSTRAINT IF NOT EXISTS FOR (m:RawMessage)
                    REQUIRE m.id IS UNIQUE
                """,
            },
            # ThreadContext uniqueness by ID
            {
                "name": "threadcontext_id_unique",
                "query": """
                    CREATE CONSTRAINT IF NOT EXISTS FOR (t:ThreadContext)
                    REQUIRE t.id IS UNIQUE
                """,
            },
            # ThreadContext uniqueness by threadId within organization
            {
                "name": "threadcontext_thread_unique",
                "query": """
                    CREATE CONSTRAINT IF NOT EXISTS FOR (t:ThreadContext)
                    REQUIRE (t.organizationId, t.threadId) IS UNIQUE
                """,
            },
            # CommunicationEvent uniqueness by ID
            {
                "name": "communicationevent_id_unique",
                "query": """
                    CREATE CONSTRAINT IF NOT EXISTS FOR (e:CommunicationEvent)
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

        # FalkorDB fulltext indexes use the 2-argument syntax:
        # CALL db.idx.fulltext.createNodeIndex('Label', 'property')
        # The 3-argument syntax with options is not supported.
        # Each property needs its own createNodeIndex call.
        indexes = [
            # Contact fields
            {"name": "contact_name_ft", "query": "CALL db.idx.fulltext.createNodeIndex('Contact', 'name')"},
            {"name": "contact_email_ft", "query": "CALL db.idx.fulltext.createNodeIndex('Contact', 'email')"},
            {"name": "contact_company_ft", "query": "CALL db.idx.fulltext.createNodeIndex('Contact', 'company')"},
            # Commitment fields
            {"name": "commitment_title_ft", "query": "CALL db.idx.fulltext.createNodeIndex('Commitment', 'title')"},
            {"name": "commitment_desc_ft", "query": "CALL db.idx.fulltext.createNodeIndex('Commitment', 'description')"},
            # Decision fields
            {"name": "decision_title_ft", "query": "CALL db.idx.fulltext.createNodeIndex('Decision', 'title')"},
            {"name": "decision_rationale_ft", "query": "CALL db.idx.fulltext.createNodeIndex('Decision', 'rationale')"},
            # Task fields
            {"name": "task_title_ft", "query": "CALL db.idx.fulltext.createNodeIndex('Task', 'title')"},
            {"name": "task_desc_ft", "query": "CALL db.idx.fulltext.createNodeIndex('Task', 'description')"},
            # Risk fields
            {"name": "risk_title_ft", "query": "CALL db.idx.fulltext.createNodeIndex('Risk', 'title')"},
            {"name": "risk_impact_ft", "query": "CALL db.idx.fulltext.createNodeIndex('Risk', 'impact')"},
            # Entity fields
            {"name": "entity_name_ft", "query": "CALL db.idx.fulltext.createNodeIndex('Entity', 'name')"},
            {"name": "entity_summary_ft", "query": "CALL db.idx.fulltext.createNodeIndex('Entity', 'summary')"},
            # Episode fields
            {"name": "episode_name_ft", "query": "CALL db.idx.fulltext.createNodeIndex('Episode', 'name')"},
            {"name": "episode_content_ft", "query": "CALL db.idx.fulltext.createNodeIndex('Episode', 'content')"},
            {"name": "episode_summary_ft", "query": "CALL db.idx.fulltext.createNodeIndex('Episode', 'summary')"},
            # Brief fields
            {"name": "brief_title_ft", "query": "CALL db.idx.fulltext.createNodeIndex('Brief', 'title')"},
            {"name": "brief_summary_ft", "query": "CALL db.idx.fulltext.createNodeIndex('Brief', 'summary')"},
            # Claim fields
            {"name": "claim_title_ft", "query": "CALL db.idx.fulltext.createNodeIndex('Claim', 'title')"},
            # RawMessage fields
            {"name": "rawmessage_content_ft", "query": "CALL db.idx.fulltext.createNodeIndex('RawMessage', 'content')"},
            {"name": "rawmessage_subject_ft", "query": "CALL db.idx.fulltext.createNodeIndex('RawMessage', 'subject')"},
            # ThreadContext fields
            {"name": "threadcontext_subject_ft", "query": "CALL db.idx.fulltext.createNodeIndex('ThreadContext', 'subject')"},
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
            # Memory System nodes (NEW)
            "Pattern",  # trigger_embedding for semantic pattern matching
            "UserProfile",  # static_embedding and dynamic_embedding
            # Raw Content Layer nodes (Phase 1 - Deeper Graph)
            "RawMessage",  # embedding for semantic search over raw content
            "ThreadContext",  # embedding for semantic thread search
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

        # Special handling for UserProfile which has multiple embeddings
        userprofile_embeddings = [
            ("static_embedding", "userprofile_static_embedding_vec"),
            ("dynamic_embedding", "userprofile_dynamic_embedding_vec"),
        ]
        for field, index_name in userprofile_embeddings:
            try:
                query = f"""
                    CREATE VECTOR INDEX IF NOT EXISTS {index_name}
                    FOR (n:UserProfile)
                    ON n.{field}
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
                    "UserProfile vector index created",
                    index=index_name,
                    field=field,
                )
            except Exception as e:
                if "already exists" in str(e).lower():
                    results[index_name] = True
                else:
                    results[index_name] = False
                    logger.warning(
                        "Failed to create UserProfile vector index",
                        index=index_name,
                        error=str(e),
                    )

        # Pattern trigger_embedding index
        try:
            query = f"""
                CREATE VECTOR INDEX IF NOT EXISTS pattern_trigger_embedding_vec
                FOR (n:Pattern)
                ON n.triggerEmbedding
                OPTIONS {{
                    indexType: 'HNSW',
                    dimension: {dimension},
                    similarityFunction: 'cosine',
                    m: {m},
                    efConstruction: {ef_construction}
                }}
            """
            await graph.query(query)
            results["pattern_trigger_embedding_vec"] = True
            logger.info("Pattern trigger_embedding vector index created")
        except Exception as e:
            if "already exists" in str(e).lower():
                results["pattern_trigger_embedding_vec"] = True
            else:
                results["pattern_trigger_embedding_vec"] = False
                logger.warning(
                    "Failed to create Pattern trigger_embedding vector index",
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
            # Communication Graph relationships (Phase 2 - Wider Graph)
            "COMMUNICATED_WITH",
            "IN_THREAD",
            "REPLIES_TO",
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
            # Memory System indexes (NEW - from Supermemory research)
            # Entity knowledge evolution
            ("Entity", "validTo"),  # Find currently valid entities (validTo IS NULL)
            ("Entity", "supersededById"),  # Find superseded entities
            ("Entity", "relevanceScore"),  # Find high-relevance entities
            ("Entity", "lastAccessedAt"),  # Find recently accessed entities
            # UserProfile
            ("UserProfile", "organizationId"),
            ("UserProfile", "userId"),
            ("UserProfile", "dynamicRefreshNeeded"),  # Find profiles needing refresh
            # OrganizationBaseline
            ("OrganizationBaseline", "organizationId"),
            # Pattern
            ("Pattern", "organizationId"),
            ("Pattern", "domain"),  # Filter by domain
            ("Pattern", "isActive"),  # Find active patterns only
            ("Pattern", "accuracyRate"),  # Find high-accuracy patterns
            # Raw Content Layer indexes (Phase 1 - Deeper Graph)
            # RawMessage indexes
            ("RawMessage", "organizationId"),
            ("RawMessage", "sourceType"),
            ("RawMessage", "threadId"),  # Link to ThreadContext
            ("RawMessage", "senderEmail"),
            ("RawMessage", "sentAt"),
            ("RawMessage", "isProcessed"),
            ("RawMessage", "createdAt"),
            # ThreadContext indexes
            ("ThreadContext", "organizationId"),
            ("ThreadContext", "threadId"),  # External thread ID
            ("ThreadContext", "sourceType"),
            ("ThreadContext", "status"),
            ("ThreadContext", "lastMessageAt"),
            ("ThreadContext", "firstMessageAt"),
            ("ThreadContext", "createdAt"),
            # CommunicationEvent indexes
            ("CommunicationEvent", "organizationId"),
            ("CommunicationEvent", "fromContactId"),
            ("CommunicationEvent", "eventType"),
            ("CommunicationEvent", "occurredAt"),
            ("CommunicationEvent", "channel"),
            # Confidence tier index (tiered confidence system)
            ("Commitment", "confidenceTier"),
            ("Decision", "confidenceTier"),
            # Graph Analytics indexes (Phase 4 - Smart Graph)
            # PageRank results
            ("Contact", "pagerankScore"),
            ("Contact", "importanceScore"),
            # Community detection results
            ("Contact", "communityId"),
            # Betweenness centrality results
            ("Contact", "betweennessScore"),
            # Analytics metadata
            ("Contact", "analyticsUpdatedAt"),
            # Entity analytics
            ("Entity", "pagerankScore"),
            ("Entity", "importanceScore"),
            ("Entity", "communityId"),
            # Claim indexes (additional)
            ("Claim", "confidenceTier"),
            # Task indexes (additional)
            ("Task", "confidenceTier"),
            # Risk indexes (additional)
            ("Risk", "confidenceTier"),
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
    # Relationship Property Indexes (Communication Graph)
    # =========================================================================

    async def setup_relationship_property_indexes(self) -> dict[str, bool]:
        """
        Set up indexes on relationship properties for communication graph queries.

        These indexes optimize queries on relationship properties like:
        - Communication frequency (count)
        - Last interaction time (last_at)
        - Sentiment average (sentiment_avg)

        Returns:
            Dict mapping index name to success status
        """
        graph = await self._get_graph()

        # Relationship property indexes for communication graph
        rel_indexes = [
            # COMMUNICATED_WITH properties (Contact-to-Contact communication)
            ("COMMUNICATED_WITH", "count"),
            ("COMMUNICATED_WITH", "lastAt"),
            ("COMMUNICATED_WITH", "sentimentAvg"),
            ("COMMUNICATED_WITH", "channel"),
            # IN_THREAD properties (Message threading)
            ("IN_THREAD", "position"),
            # REPLIES_TO properties (Message replies)
            ("REPLIES_TO", "responseTimeSeconds"),
            # EXTRACTED_FROM properties (Intelligence provenance)
            ("EXTRACTED_FROM", "confidence"),
            ("EXTRACTED_FROM", "extractedAt"),
            # IMPACTS properties (Decision → Commitment cross-link)
            ("IMPACTS", "impactScore"),
            # THREATENS properties (Risk → Decision/Commitment)
            ("THREATENS", "severity"),
            # FULFILLS properties (Task → Commitment)
            ("FULFILLS", "completionPercentage"),
        ]

        results = {}

        for rel_type, property_name in rel_indexes:
            index_name = f"{rel_type.lower()}_{property_name}_idx"
            try:
                query = f"""
                    CREATE INDEX IF NOT EXISTS {index_name}
                    FOR ()-[r:{rel_type}]-()
                    ON (r.{property_name})
                """
                await graph.query(query)
                results[index_name] = True
                logger.debug(
                    "Relationship property index created",
                    index=index_name,
                )
            except Exception as e:
                if "already exists" in str(e).lower():
                    results[index_name] = True
                else:
                    results[index_name] = False
                    logger.warning(
                        "Failed to create relationship property index",
                        index=index_name,
                        error=str(e),
                    )

        return results

    # =========================================================================
    # Composite Indexes for Common Query Patterns
    # =========================================================================

    async def setup_composite_indexes(self) -> dict[str, bool]:
        """
        Set up composite indexes for common multi-property query patterns.

        These indexes optimize queries that filter on multiple properties,
        such as organization + status + date combinations.

        Returns:
            Dict mapping index name to success status
        """
        graph = await self._get_graph()

        # Composite indexes for common query patterns
        composite_indexes = [
            # Organization + Status queries (most common pattern)
            {
                "name": "commitment_org_status_idx",
                "node": "Commitment",
                "properties": ["organizationId", "status"],
            },
            {
                "name": "decision_org_status_idx",
                "node": "Decision",
                "properties": ["organizationId", "status"],
            },
            {
                "name": "task_org_status_idx",
                "node": "Task",
                "properties": ["organizationId", "status"],
            },
            # Organization + Date range queries
            {
                "name": "commitment_org_due_idx",
                "node": "Commitment",
                "properties": ["organizationId", "dueDate"],
            },
            {
                "name": "episode_org_time_idx",
                "node": "Episode",
                "properties": ["organizationId", "referenceTime"],
            },
            # Organization + Confidence tier queries
            {
                "name": "commitment_org_tier_idx",
                "node": "Commitment",
                "properties": ["organizationId", "confidenceTier"],
            },
            {
                "name": "decision_org_tier_idx",
                "node": "Decision",
                "properties": ["organizationId", "confidenceTier"],
            },
            # Organization + Source type queries
            {
                "name": "rawmessage_org_source_idx",
                "node": "RawMessage",
                "properties": ["organizationId", "sourceType"],
            },
            {
                "name": "episode_org_source_idx",
                "node": "Episode",
                "properties": ["organizationId", "sourceType"],
            },
            # Thread queries
            {
                "name": "rawmessage_org_thread_idx",
                "node": "RawMessage",
                "properties": ["organizationId", "threadId"],
            },
            {
                "name": "threadcontext_org_status_idx",
                "node": "ThreadContext",
                "properties": ["organizationId", "status"],
            },
            # Communication event queries
            {
                "name": "commevent_org_type_idx",
                "node": "CommunicationEvent",
                "properties": ["organizationId", "eventType"],
            },
            {
                "name": "commevent_org_channel_idx",
                "node": "CommunicationEvent",
                "properties": ["organizationId", "channel"],
            },
            # Analytics queries
            {
                "name": "contact_org_importance_idx",
                "node": "Contact",
                "properties": ["organizationId", "importanceScore"],
            },
            {
                "name": "contact_org_community_idx",
                "node": "Contact",
                "properties": ["organizationId", "communityId"],
            },
        ]

        results = {}

        for index in composite_indexes:
            try:
                props = ", ".join(f"n.{p}" for p in index["properties"])
                query = f"""
                    CREATE INDEX IF NOT EXISTS {index["name"]}
                    FOR (n:{index["node"]})
                    ON ({props})
                """
                await graph.query(query)
                results[index["name"]] = True
                logger.debug(
                    "Composite index created",
                    index=index["name"],
                )
            except Exception as e:
                if "already exists" in str(e).lower():
                    results[index["name"]] = True
                else:
                    results[index["name"]] = False
                    logger.warning(
                        "Failed to create composite index",
                        index=index["name"],
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
            "relationship_property_indexes": await self.setup_relationship_property_indexes(),
            "composite_indexes": await self.setup_composite_indexes(),
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
