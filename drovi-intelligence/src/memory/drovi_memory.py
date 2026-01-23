"""
Drovi Agentic Memory

A Graphiti-inspired temporal memory system that provides:
- Episodes: Temporal snapshots of events/interactions
- Entities: Semantic concepts extracted from episodes
- Bi-temporal queries: Search as of a specific point in time
- Cross-source aggregation: Unified memory across all sources

This is the core memory layer for the intelligence platform.
"""

from datetime import datetime
from typing import Literal
from uuid import uuid4

import structlog

from src.graph.client import get_graph_client
from src.graph.types import SourceType

logger = structlog.get_logger()


class DroviMemory:
    """
    Agentic Memory System.

    Provides temporal, cross-source memory capabilities for AI agents.
    Inspired by Graphiti but optimized for the Drovi use case.
    """

    def __init__(self, organization_id: str):
        self.organization_id = organization_id
        self._graph = None

    async def _get_graph(self):
        """Lazy load graph client."""
        if self._graph is None:
            self._graph = await get_graph_client()
        return self._graph

    # =========================================================================
    # Episode Management
    # =========================================================================

    async def add_episode(
        self,
        name: str,
        content: str,
        source_type: SourceType,
        source_id: str | None = None,
        source_account_id: str | None = None,
        reference_time: datetime | None = None,
        participants: list[str] | None = None,
        metadata: dict | None = None,
    ) -> str:
        """
        Add an episode to memory.

        Episodes are temporal snapshots of events/interactions.
        They form the foundation of the memory graph.

        Args:
            name: Short name/title for the episode
            content: Full content of the episode
            source_type: Type of source (email, slack, etc.)
            source_id: Optional source identifier
            source_account_id: Optional source account ID
            reference_time: When the episode occurred (defaults to now)
            participants: List of participant identifiers
            metadata: Additional metadata

        Returns:
            The created episode ID
        """
        graph = await self._get_graph()
        episode_id = str(uuid4())
        ref_time = reference_time or datetime.utcnow()

        logger.info(
            "Adding episode to memory",
            organization_id=self.organization_id,
            episode_id=episode_id,
            source_type=source_type,
        )

        # Create episode node
        await graph.query(
            """
            CREATE (e:Episode {
                id: $id,
                organizationId: $orgId,
                name: $name,
                content: $content,
                sourceType: $sourceType,
                sourceId: $sourceId,
                sourceAccountId: $sourceAccountId,
                referenceTime: $refTime,
                validFrom: $validFrom,
                metadata: $metadata
            })
            RETURN e
            """,
            {
                "id": episode_id,
                "orgId": self.organization_id,
                "name": name,
                "content": content,
                "sourceType": source_type,
                "sourceId": source_id or "",
                "sourceAccountId": source_account_id or "",
                "refTime": ref_time.isoformat(),
                "validFrom": datetime.utcnow().isoformat(),
                "metadata": str(metadata or {}),
            },
        )

        # Link to participants if provided
        if participants:
            for participant in participants:
                await graph.query(
                    """
                    MATCH (e:Episode {id: $episodeId})
                    MERGE (p:Participant {identifier: $participant, organizationId: $orgId})
                    CREATE (p)-[:PARTICIPATED_IN]->(e)
                    """,
                    {
                        "episodeId": episode_id,
                        "participant": participant,
                        "orgId": self.organization_id,
                    },
                )

        return episode_id

    async def get_episode(self, episode_id: str) -> dict | None:
        """Get an episode by ID."""
        graph = await self._get_graph()

        result = await graph.query(
            """
            MATCH (e:Episode {id: $id, organizationId: $orgId})
            RETURN e
            """,
            {"id": episode_id, "orgId": self.organization_id},
        )

        return result[0] if result else None

    async def get_recent_episodes(
        self,
        limit: int = 50,
        source_types: list[str] | None = None,
    ) -> list[dict]:
        """Get the most recent episodes."""
        graph = await self._get_graph()

        source_filter = ""
        if source_types:
            source_filter = f"AND e.sourceType IN {source_types}"

        result = await graph.query(
            f"""
            MATCH (e:Episode)
            WHERE e.organizationId = $orgId {source_filter}
            RETURN e
            ORDER BY e.referenceTime DESC
            LIMIT $limit
            """,
            {"orgId": self.organization_id, "limit": limit},
        )

        return result

    # =========================================================================
    # Entity Management
    # =========================================================================

    async def add_entity(
        self,
        name: str,
        entity_type: str,
        properties: dict | None = None,
        episode_id: str | None = None,
    ) -> str:
        """
        Add or update an entity in memory.

        Entities are semantic concepts extracted from episodes.
        They can represent people, topics, projects, etc.

        Args:
            name: Entity name
            entity_type: Type of entity (person, topic, project, etc.)
            properties: Additional properties
            episode_id: Optional episode to link to

        Returns:
            The entity ID
        """
        graph = await self._get_graph()
        entity_id = str(uuid4())

        logger.debug(
            "Adding entity to memory",
            organization_id=self.organization_id,
            entity_name=name,
            entity_type=entity_type,
        )

        # Create or merge entity
        now = datetime.utcnow().isoformat()
        await graph.query(
            """
            MERGE (e:Entity {name: $name, type: $type, organizationId: $orgId})
            ON CREATE SET e.id = $id, e.createdAt = $now
            ON MATCH SET e.updatedAt = $now
            SET e += $properties
            RETURN e
            """,
            {
                "id": entity_id,
                "name": name,
                "type": entity_type,
                "orgId": self.organization_id,
                "properties": properties or {},
                "now": now,
            },
        )

        # Link to episode if provided
        if episode_id:
            await graph.query(
                """
                MATCH (e:Entity {name: $name, organizationId: $orgId})
                MATCH (ep:Episode {id: $episodeId})
                MERGE (e)-[:MENTIONED_IN]->(ep)
                """,
                {
                    "name": name,
                    "orgId": self.organization_id,
                    "episodeId": episode_id,
                },
            )

        return entity_id

    async def get_entity(self, name: str, entity_type: str | None = None) -> dict | None:
        """Get an entity by name."""
        graph = await self._get_graph()

        type_filter = f"AND e.type = '{entity_type}'" if entity_type else ""

        result = await graph.query(
            f"""
            MATCH (e:Entity)
            WHERE e.name = $name AND e.organizationId = $orgId {type_filter}
            RETURN e
            """,
            {"name": name, "orgId": self.organization_id},
        )

        return result[0] if result else None

    # =========================================================================
    # Temporal Queries
    # =========================================================================

    async def search(
        self,
        query: str,
        source_types: list[str] | None = None,
        limit: int = 50,
    ) -> list[dict]:
        """
        Search memory for matching episodes and entities.

        Uses vector similarity for semantic search.
        """
        graph = await self._get_graph()

        logger.info(
            "Searching memory",
            organization_id=self.organization_id,
            query=query[:50],
        )

        # For now, do fulltext search
        # In production, would use vector search with embeddings
        source_filter = ""
        if source_types:
            source_filter = f"AND e.sourceType IN {source_types}"

        results = await graph.query(
            f"""
            MATCH (e:Episode)
            WHERE e.organizationId = $orgId
            AND (e.name CONTAINS $query OR e.content CONTAINS $query)
            {source_filter}
            RETURN e
            ORDER BY e.referenceTime DESC
            LIMIT $limit
            """,
            {
                "orgId": self.organization_id,
                "query": query,
                "limit": limit,
            },
        )

        return results

    async def search_as_of(
        self,
        query: str,
        as_of_date: datetime,
        source_types: list[str] | None = None,
        limit: int = 50,
    ) -> list[dict]:
        """
        Search memory as it was at a specific point in time.

        This is bi-temporal querying - returns results that:
        1. Existed at as_of_date (validFrom <= as_of_date)
        2. Match the search query

        Args:
            query: Search query
            as_of_date: The point in time to query as of
            source_types: Optional filter by source types
            limit: Maximum results

        Returns:
            List of matching episodes as they existed at as_of_date
        """
        graph = await self._get_graph()

        logger.info(
            "Searching memory as of date",
            organization_id=self.organization_id,
            query=query[:50],
            as_of_date=as_of_date.isoformat(),
        )

        source_filter = ""
        if source_types:
            source_filter = f"AND e.sourceType IN {source_types}"

        results = await graph.query(
            f"""
            MATCH (e:Episode)
            WHERE e.organizationId = $orgId
            AND e.validFrom <= $asOfDate
            AND (e.name CONTAINS $query OR e.content CONTAINS $query)
            {source_filter}
            RETURN e
            ORDER BY e.referenceTime DESC
            LIMIT $limit
            """,
            {
                "orgId": self.organization_id,
                "query": query,
                "asOfDate": as_of_date.isoformat(),
                "limit": limit,
            },
        )

        return results

    async def search_across_sources(
        self,
        query: str,
        limit: int = 50,
    ) -> dict[str, list[dict]]:
        """
        Search memory across all sources, grouped by source type.

        Returns:
            Dict mapping source type to list of matching episodes
        """
        graph = await self._get_graph()

        logger.info(
            "Cross-source memory search",
            organization_id=self.organization_id,
            query=query[:50],
        )

        results = await graph.query(
            """
            MATCH (e:Episode)
            WHERE e.organizationId = $orgId
            AND (e.name CONTAINS $query OR e.content CONTAINS $query)
            RETURN e.sourceType as sourceType, collect(e) as episodes
            """,
            {
                "orgId": self.organization_id,
                "query": query,
            },
        )

        # Group by source type
        grouped = {}
        for row in results:
            source_type = row.get("sourceType", "unknown")
            episodes = row.get("episodes", [])
            grouped[source_type] = episodes[:limit]

        return grouped

    # =========================================================================
    # Timeline Queries
    # =========================================================================

    async def get_entity_timeline(
        self,
        entity_name: str,
        limit: int = 100,
    ) -> list[dict]:
        """
        Get all episodes mentioning an entity, chronologically.

        Args:
            entity_name: Name of the entity
            limit: Maximum episodes to return

        Returns:
            List of episodes mentioning the entity
        """
        graph = await self._get_graph()

        logger.info(
            "Getting entity timeline",
            organization_id=self.organization_id,
            entity=entity_name,
        )

        results = await graph.query(
            """
            MATCH (e:Entity {name: $name, organizationId: $orgId})-[:MENTIONED_IN]->(ep:Episode)
            RETURN ep
            ORDER BY ep.referenceTime ASC
            LIMIT $limit
            """,
            {
                "name": entity_name,
                "orgId": self.organization_id,
                "limit": limit,
            },
        )

        return results

    async def get_contact_timeline(
        self,
        contact_id: str,
        source_types: list[str] | None = None,
        limit: int = 100,
    ) -> list[dict]:
        """
        Get all episodes involving a contact, chronologically.

        Args:
            contact_id: Contact identifier (email, name, etc.)
            source_types: Optional filter by source types
            limit: Maximum episodes to return

        Returns:
            List of episodes involving the contact
        """
        graph = await self._get_graph()

        logger.info(
            "Getting contact timeline",
            organization_id=self.organization_id,
            contact_id=contact_id,
        )

        source_filter = ""
        if source_types:
            source_filter = f"AND ep.sourceType IN {source_types}"

        results = await graph.query(
            f"""
            MATCH (p:Participant {{identifier: $contactId, organizationId: $orgId}})
            -[:PARTICIPATED_IN]->(ep:Episode)
            WHERE 1=1 {source_filter}
            RETURN ep
            ORDER BY ep.referenceTime ASC
            LIMIT $limit
            """,
            {
                "contactId": contact_id,
                "orgId": self.organization_id,
                "limit": limit,
            },
        )

        return results

    # =========================================================================
    # Relationship Queries
    # =========================================================================

    async def get_related_entities(
        self,
        entity_name: str,
        relationship_types: list[str] | None = None,
        limit: int = 20,
    ) -> list[dict]:
        """
        Get entities related to a given entity.

        Args:
            entity_name: Name of the entity
            relationship_types: Optional filter by relationship types
            limit: Maximum entities to return

        Returns:
            List of related entities with relationship info
        """
        graph = await self._get_graph()

        rel_filter = ""
        if relationship_types:
            types_str = "|".join(relationship_types)
            rel_filter = f":{types_str}"

        results = await graph.query(
            f"""
            MATCH (e:Entity {{name: $name, organizationId: $orgId}})-[r{rel_filter}]-(related:Entity)
            RETURN related, type(r) as relationshipType, r as relationship
            LIMIT $limit
            """,
            {
                "name": entity_name,
                "orgId": self.organization_id,
                "limit": limit,
            },
        )

        return results

    async def add_entity_relationship(
        self,
        source_name: str,
        target_name: str,
        relationship_type: str,
        properties: dict | None = None,
        episode_id: str | None = None,
    ):
        """
        Add a relationship between two entities.

        Args:
            source_name: Source entity name
            target_name: Target entity name
            relationship_type: Type of relationship (e.g., KNOWS, WORKS_WITH)
            properties: Optional relationship properties
            episode_id: Optional episode where this relationship was observed
        """
        graph = await self._get_graph()

        logger.debug(
            "Adding entity relationship",
            source=source_name,
            target=target_name,
            type=relationship_type,
        )

        # Create relationship
        now = datetime.utcnow().isoformat()
        await graph.query(
            f"""
            MATCH (s:Entity {{name: $source, organizationId: $orgId}})
            MATCH (t:Entity {{name: $target, organizationId: $orgId}})
            MERGE (s)-[r:{relationship_type}]->(t)
            SET r += $properties
            SET r.updatedAt = $now
            """,
            {
                "source": source_name,
                "target": target_name,
                "orgId": self.organization_id,
                "properties": properties or {},
                "now": now,
            },
        )

        # Link to episode if provided
        if episode_id:
            await graph.query(
                f"""
                MATCH (s:Entity {{name: $source, organizationId: $orgId}})
                -[r:{relationship_type}]->(t:Entity {{name: $target, organizationId: $orgId}})
                MATCH (ep:Episode {{id: $episodeId}})
                MERGE (r)-[:OBSERVED_IN]->(ep)
                """,
                {
                    "source": source_name,
                    "target": target_name,
                    "orgId": self.organization_id,
                    "episodeId": episode_id,
                },
            )


# =============================================================================
# Singleton
# =============================================================================

_memory_instances: dict[str, DroviMemory] = {}


async def get_memory(organization_id: str) -> DroviMemory:
    """Get a DroviMemory instance for an organization."""
    if organization_id not in _memory_instances:
        _memory_instances[organization_id] = DroviMemory(organization_id)
    return _memory_instances[organization_id]
