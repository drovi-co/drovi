"""
Graphiti-Based Agentic Memory

Uses the official Graphiti SDK (graphiti-core[falkordb]) to provide:
- Automatic LLM-powered entity extraction
- Built-in temporal reasoning
- Multi-agent memory isolation
- Community summaries
- Proven patterns for agentic memory

This replaces the custom DroviMemory implementation with the battle-tested
Graphiti library for production use.
"""

from datetime import datetime
from typing import Literal

import structlog

from pydantic_settings import BaseSettings

logger = structlog.get_logger()


class GraphitiSettings(BaseSettings):
    """Graphiti configuration settings."""

    falkordb_host: str = "localhost"
    falkordb_port: int = 6379
    falkordb_password: str | None = None

    # LLM settings for entity extraction
    openai_api_key: str | None = None
    anthropic_api_key: str | None = None
    llm_model: str = "gpt-4o-mini"  # Default model for entity extraction

    class Config:
        env_prefix = ""
        extra = "ignore"


class DroviGraphitiMemory:
    """
    Agentic memory using the official Graphiti SDK.

    Features:
    - Automatic entity extraction (no custom LLM prompts needed)
    - Bi-temporal queries (as-of and transaction time)
    - Multi-tenant isolation via graph_name
    - Built-in deduplication and entity resolution
    - Community detection and summarization
    """

    def __init__(self, organization_id: str, settings: GraphitiSettings | None = None):
        self.organization_id = organization_id
        self.settings = settings or GraphitiSettings()
        self._graphiti = None
        self._initialized = False

    async def _get_graphiti(self):
        """Lazy load Graphiti client with FalkorDB driver."""
        if self._graphiti is None:
            try:
                from graphiti_core import Graphiti
                from graphiti_core.llm_client import OpenAIClient, AnthropicClient
                from graphiti_core.embedder import OpenAIEmbedder

                # Import FalkorDB driver - this is the key integration
                try:
                    from graphiti_core.driver.falkordb_driver import FalkorDriver
                except ImportError:
                    # Fallback if driver not available
                    logger.warning("FalkorDB driver not available, using Neo4j driver")
                    from graphiti_core.driver.neo4j_driver import Neo4jDriver as FalkorDriver

                # Create FalkorDB driver
                driver = FalkorDriver(
                    host=self.settings.falkordb_host,
                    port=self.settings.falkordb_port,
                    password=self.settings.falkordb_password,
                )

                # Select LLM client based on available API keys
                if self.settings.anthropic_api_key:
                    llm_client = AnthropicClient(
                        api_key=self.settings.anthropic_api_key,
                        model=self.settings.llm_model if "claude" in self.settings.llm_model else "claude-3-haiku-20240307",
                    )
                elif self.settings.openai_api_key:
                    llm_client = OpenAIClient(
                        api_key=self.settings.openai_api_key,
                        model=self.settings.llm_model,
                    )
                else:
                    # Use LiteLLM as fallback (requires OPENAI_API_KEY or ANTHROPIC_API_KEY env var)
                    llm_client = OpenAIClient(model=self.settings.llm_model)

                # Create embedder
                embedder = OpenAIEmbedder(
                    api_key=self.settings.openai_api_key,
                )

                # Create Graphiti instance with multi-tenant graph name
                self._graphiti = Graphiti(
                    driver=driver,
                    llm_client=llm_client,
                    embedder=embedder,
                    graph_name=f"drovi_{self.organization_id}",  # Multi-tenant isolation
                )

                logger.info(
                    "Graphiti client initialized",
                    organization_id=self.organization_id,
                    graph_name=f"drovi_{self.organization_id}",
                )

            except ImportError as e:
                logger.error(
                    "Graphiti SDK not installed. Install with: pip install graphiti-core[falkordb]",
                    error=str(e),
                )
                raise ImportError(
                    "Graphiti SDK not installed. Run: pip install graphiti-core[falkordb]"
                ) from e

        return self._graphiti

    async def initialize(self):
        """
        One-time setup for the Graphiti graph.

        Creates indexes and constraints for optimal performance.
        Should be called once when the organization is first created.
        """
        if self._initialized:
            return

        graphiti = await self._get_graphiti()

        logger.info(
            "Initializing Graphiti indices and constraints",
            organization_id=self.organization_id,
        )

        try:
            # Build indices and constraints
            await graphiti.build_indices_and_constraints()
            self._initialized = True

            logger.info(
                "Graphiti initialization complete",
                organization_id=self.organization_id,
            )

        except Exception as e:
            logger.error(
                "Graphiti initialization failed",
                organization_id=self.organization_id,
                error=str(e),
            )
            raise

    async def add_episode(
        self,
        name: str,
        content: str,
        source_type: str,
        reference_time: datetime | None = None,
        source_id: str | None = None,
        source_description: str | None = None,
    ) -> str:
        """
        Add an episode to memory using Graphiti.

        Graphiti automatically:
        - Extracts entities using LLM
        - Creates relationships between entities
        - Handles temporal validity
        - Performs entity resolution
        - Generates embeddings

        Args:
            name: Short name/title for the episode
            content: Full content of the episode
            source_type: Type of source (email, slack, etc.)
            reference_time: When the episode occurred (defaults to now)
            source_id: Optional source identifier
            source_description: Optional description of the source

        Returns:
            The created episode ID
        """
        graphiti = await self._get_graphiti()

        ref_time = reference_time or datetime.utcnow()
        source_desc = source_description or f"{source_type}:{source_id or 'unknown'}"

        logger.info(
            "Adding episode via Graphiti",
            organization_id=self.organization_id,
            name=name[:50],
            source_type=source_type,
        )

        try:
            from graphiti_core.types import EpisodeType

            # Add episode - Graphiti handles all the magic!
            episode = await graphiti.add_episode(
                name=name,
                episode_body=content,
                episode_type=EpisodeType.text,
                reference_time=ref_time,
                source_description=source_desc,
            )

            logger.info(
                "Episode added via Graphiti",
                organization_id=self.organization_id,
                episode_uuid=episode.uuid,
            )

            return episode.uuid

        except Exception as e:
            logger.error(
                "Failed to add episode via Graphiti",
                organization_id=self.organization_id,
                error=str(e),
            )
            raise

    async def search(
        self,
        query: str,
        num_results: int = 10,
        center_node_uuid: str | None = None,
    ) -> list[dict]:
        """
        Search memory using Graphiti's hybrid search.

        Combines:
        - Vector similarity search
        - Full-text search
        - Graph-based relevance

        Args:
            query: Search query
            num_results: Maximum results to return
            center_node_uuid: Optional node to center search around

        Returns:
            List of search results with scores
        """
        graphiti = await self._get_graphiti()

        logger.info(
            "Searching via Graphiti",
            organization_id=self.organization_id,
            query=query[:50],
            num_results=num_results,
        )

        try:
            results = await graphiti.search(
                query=query,
                num_results=num_results,
                center_node_uuid=center_node_uuid,
            )

            # Convert to dict format for consistency
            return [
                {
                    "uuid": r.uuid,
                    "name": r.name,
                    "content": getattr(r, "summary", None) or getattr(r, "content", ""),
                    "score": r.score if hasattr(r, "score") else 1.0,
                    "type": type(r).__name__,
                }
                for r in results
            ]

        except Exception as e:
            logger.error(
                "Graphiti search failed",
                organization_id=self.organization_id,
                error=str(e),
            )
            raise

    async def search_as_of(
        self,
        query: str,
        as_of_date: datetime,
        num_results: int = 10,
    ) -> list[dict]:
        """
        Temporal search - get memory state as of a specific point in time.

        This is one of Graphiti's killer features - bi-temporal queries
        that let you see what was known at any point in history.

        Args:
            query: Search query
            as_of_date: Point in time to query
            num_results: Maximum results

        Returns:
            List of search results valid at the specified time
        """
        graphiti = await self._get_graphiti()

        logger.info(
            "Temporal search via Graphiti",
            organization_id=self.organization_id,
            query=query[:50],
            as_of_date=as_of_date.isoformat(),
        )

        try:
            results = await graphiti.search(
                query=query,
                num_results=num_results,
                reference_time=as_of_date,
            )

            return [
                {
                    "uuid": r.uuid,
                    "name": r.name,
                    "content": getattr(r, "summary", None) or getattr(r, "content", ""),
                    "score": r.score if hasattr(r, "score") else 1.0,
                    "type": type(r).__name__,
                    "valid_at": as_of_date.isoformat(),
                }
                for r in results
            ]

        except Exception as e:
            logger.error(
                "Graphiti temporal search failed",
                organization_id=self.organization_id,
                error=str(e),
            )
            raise

    async def get_entity(self, entity_uuid: str) -> dict | None:
        """Get a specific entity by UUID."""
        graphiti = await self._get_graphiti()

        try:
            entity = await graphiti.get_entity(entity_uuid)
            if entity:
                return {
                    "uuid": entity.uuid,
                    "name": entity.name,
                    "summary": getattr(entity, "summary", None),
                    "type": type(entity).__name__,
                }
            return None

        except Exception as e:
            logger.error(
                "Failed to get entity",
                entity_uuid=entity_uuid,
                error=str(e),
            )
            return None

    async def get_episode(self, episode_uuid: str) -> dict | None:
        """Get a specific episode by UUID."""
        graphiti = await self._get_graphiti()

        try:
            episode = await graphiti.get_episode(episode_uuid)
            if episode:
                return {
                    "uuid": episode.uuid,
                    "name": episode.name,
                    "content": episode.content,
                    "reference_time": episode.reference_time.isoformat() if episode.reference_time else None,
                    "source_description": episode.source_description,
                }
            return None

        except Exception as e:
            logger.error(
                "Failed to get episode",
                episode_uuid=episode_uuid,
                error=str(e),
            )
            return None

    async def get_edges_for_entity(self, entity_uuid: str) -> list[dict]:
        """Get all relationships for an entity."""
        graphiti = await self._get_graphiti()

        try:
            edges = await graphiti.get_edges_by_node(entity_uuid)
            return [
                {
                    "uuid": e.uuid,
                    "name": e.name,
                    "fact": getattr(e, "fact", None),
                    "source_node_uuid": e.source_node_uuid,
                    "target_node_uuid": e.target_node_uuid,
                }
                for e in edges
            ]

        except Exception as e:
            logger.error(
                "Failed to get edges for entity",
                entity_uuid=entity_uuid,
                error=str(e),
            )
            return []

    async def close(self):
        """Close the Graphiti connection."""
        if self._graphiti:
            try:
                await self._graphiti.close()
                self._graphiti = None
                logger.info(
                    "Graphiti connection closed",
                    organization_id=self.organization_id,
                )
            except Exception as e:
                logger.error(
                    "Error closing Graphiti connection",
                    error=str(e),
                )


# =============================================================================
# Singleton Management
# =============================================================================

_graphiti_memories: dict[str, DroviGraphitiMemory] = {}


async def get_graphiti_memory(organization_id: str) -> DroviGraphitiMemory:
    """
    Get a Graphiti memory instance for an organization.

    Creates a new instance if one doesn't exist for the organization.
    """
    global _graphiti_memories

    if organization_id not in _graphiti_memories:
        memory = DroviGraphitiMemory(organization_id)
        await memory.initialize()
        _graphiti_memories[organization_id] = memory

    return _graphiti_memories[organization_id]


async def close_all_graphiti_connections():
    """Close all Graphiti connections. Call on application shutdown."""
    global _graphiti_memories

    for org_id, memory in _graphiti_memories.items():
        try:
            await memory.close()
        except Exception as e:
            logger.error(
                "Error closing Graphiti connection",
                organization_id=org_id,
                error=str(e),
            )

    _graphiti_memories.clear()
