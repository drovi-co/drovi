"""
LlamaIndex Knowledge Graph Integration

Provides document-to-knowledge-graph capabilities using LlamaIndex
with FalkorDB as the graph store backend.

Features:
- Automatic triplet extraction from documents
- Knowledge graph index with embeddings
- Hybrid query engine (graph + text)
- Integration with existing Drovi graph schema
"""

import os
from datetime import datetime, timezone
from typing import Any

import structlog

from src.config import get_settings

logger = structlog.get_logger()


def utc_now() -> datetime:
    """Get current UTC time."""
    return datetime.now(timezone.utc).replace(tzinfo=None)


class DroviLlamaIndex:
    """
    LlamaIndex integration for Drovi knowledge graphs.

    Provides document ingestion and knowledge graph querying
    using LlamaIndex with FalkorDB backend.
    """

    def __init__(self, organization_id: str):
        """
        Initialize LlamaIndex integration.

        Args:
            organization_id: Organization scope for multi-tenancy
        """
        self.organization_id = organization_id
        self._graph_store = None
        self._storage_context = None
        self._index = None
        self._llm = None
        self._embed_model = None

    async def _get_graph_store(self):
        """Get or create FalkorDB graph store."""
        if self._graph_store is None:
            try:
                from llama_index.graph_stores.falkordb import FalkorDBGraphStore
            except ImportError:
                raise ImportError(
                    "llama-index-graph-stores-falkordb not installed. "
                    "Install with: pip install llama-index-graph-stores-falkordb"
                )

            settings = get_settings()
            self._graph_store = FalkorDBGraphStore(
                url=f"redis://{settings.falkordb_host}:{settings.falkordb_port}",
                database=f"drovi_{self.organization_id}",
            )

        return self._graph_store

    async def _get_storage_context(self):
        """Get or create storage context."""
        if self._storage_context is None:
            try:
                from llama_index.core import StorageContext
            except ImportError:
                raise ImportError(
                    "llama-index not installed. "
                    "Install with: pip install llama-index"
                )

            graph_store = await self._get_graph_store()
            self._storage_context = StorageContext.from_defaults(
                graph_store=graph_store
            )

        return self._storage_context

    async def _get_llm(self):
        """Get LLM for knowledge extraction."""
        if self._llm is None:
            settings = get_settings()

            if settings.together_api_key:
                try:
                    from llama_index.llms.together import TogetherLLM

                    self._llm = TogetherLLM(
                        model=settings.default_model_balanced,
                        api_key=settings.together_api_key,
                    )
                except ImportError:
                    logger.warning("llama-index-llms-together not installed")

            if self._llm is None:
                # Fallback to default
                try:
                    from llama_index.llms.openai import OpenAI
                    self._llm = OpenAI(model="gpt-3.5-turbo")
                except ImportError:
                    pass

        return self._llm

    async def _get_embed_model(self):
        """Get embedding model."""
        if self._embed_model is None:
            try:
                from llama_index.embeddings.huggingface import HuggingFaceEmbedding

                self._embed_model = HuggingFaceEmbedding(
                    model_name="BAAI/bge-small-en-v1.5"
                )
            except ImportError:
                logger.warning("HuggingFace embeddings not available")

        return self._embed_model

    async def add_documents(
        self,
        documents: list[str],
        metadata: list[dict[str, Any]] | None = None,
        max_triplets_per_chunk: int = 10,
    ) -> dict[str, Any]:
        """
        Add documents to the knowledge graph.

        Extracts triplets (subject, predicate, object) from documents
        and stores them in the FalkorDB graph.

        Args:
            documents: List of document texts to process
            metadata: Optional metadata for each document
            max_triplets_per_chunk: Max triplets to extract per chunk

        Returns:
            Summary of ingestion results
        """
        try:
            from llama_index.core import Document, KnowledgeGraphIndex, Settings
        except ImportError:
            raise ImportError(
                "llama-index not installed. "
                "Install with: pip install llama-index"
            )

        logger.info(
            "Adding documents to knowledge graph",
            document_count=len(documents),
            organization_id=self.organization_id,
        )

        start_time = utc_now()

        # Prepare documents
        docs = []
        for i, text in enumerate(documents):
            doc_metadata = metadata[i] if metadata and i < len(metadata) else {}
            doc_metadata["organization_id"] = self.organization_id
            doc_metadata["ingested_at"] = utc_now().isoformat()

            docs.append(Document(text=text, metadata=doc_metadata))

        # Get components
        storage_context = await self._get_storage_context()
        llm = await self._get_llm()
        embed_model = await self._get_embed_model()

        # Configure settings
        if llm:
            Settings.llm = llm
        if embed_model:
            Settings.embed_model = embed_model

        # Build knowledge graph index
        self._index = KnowledgeGraphIndex.from_documents(
            docs,
            storage_context=storage_context,
            max_triplets_per_chunk=max_triplets_per_chunk,
            include_embeddings=True,
            show_progress=False,
        )

        duration = (utc_now() - start_time).total_seconds()

        logger.info(
            "Documents added to knowledge graph",
            document_count=len(documents),
            duration_seconds=duration,
            organization_id=self.organization_id,
        )

        return {
            "documents_processed": len(documents),
            "duration_seconds": duration,
            "organization_id": self.organization_id,
            "status": "success",
        }

    async def add_text(
        self,
        text: str,
        source: str | None = None,
        metadata: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        """
        Add a single text to the knowledge graph.

        Args:
            text: Text content to process
            source: Optional source identifier
            metadata: Optional metadata

        Returns:
            Ingestion result
        """
        doc_metadata = metadata or {}
        if source:
            doc_metadata["source"] = source

        return await self.add_documents([text], [doc_metadata])

    async def query(
        self,
        question: str,
        include_text: bool = True,
        response_mode: str = "tree_summarize",
        similarity_top_k: int = 10,
    ) -> dict[str, Any]:
        """
        Query the knowledge graph with natural language.

        Args:
            question: Natural language question
            include_text: Include source text in response
            response_mode: Response synthesis mode
            similarity_top_k: Number of similar nodes to retrieve

        Returns:
            Query results with answer and sources
        """
        if self._index is None:
            # Try to load existing index
            await self._load_index()

        if self._index is None:
            return {
                "answer": "No knowledge graph index available. Please add documents first.",
                "sources": [],
                "status": "no_index",
            }

        logger.info(
            "Querying knowledge graph",
            question=question[:50],
            organization_id=self.organization_id,
        )

        start_time = utc_now()

        try:
            query_engine = self._index.as_query_engine(
                include_text=include_text,
                response_mode=response_mode,
                similarity_top_k=similarity_top_k,
            )

            response = query_engine.query(question)

            duration = (utc_now() - start_time).total_seconds()

            # Extract source nodes
            sources = []
            if hasattr(response, "source_nodes"):
                for node in response.source_nodes:
                    sources.append({
                        "text": node.text[:200] if hasattr(node, "text") else "",
                        "score": node.score if hasattr(node, "score") else 0,
                        "metadata": node.metadata if hasattr(node, "metadata") else {},
                    })

            return {
                "answer": str(response),
                "sources": sources,
                "duration_seconds": duration,
                "organization_id": self.organization_id,
                "status": "success",
            }

        except Exception as e:
            logger.error("Knowledge graph query failed", error=str(e))
            return {
                "answer": f"Query failed: {str(e)}",
                "sources": [],
                "status": "error",
                "error": str(e),
            }

    async def _load_index(self) -> None:
        """Try to load existing index from graph store."""
        try:
            from llama_index.core import KnowledgeGraphIndex, Settings

            storage_context = await self._get_storage_context()
            llm = await self._get_llm()
            embed_model = await self._get_embed_model()

            if llm:
                Settings.llm = llm
            if embed_model:
                Settings.embed_model = embed_model

            # Try to load from storage
            self._index = KnowledgeGraphIndex.from_documents(
                [],  # Empty - just loads existing
                storage_context=storage_context,
                include_embeddings=True,
            )

        except Exception as e:
            logger.warning("Could not load existing index", error=str(e))
            self._index = None

    async def get_triplets(
        self,
        subject: str | None = None,
        limit: int = 100,
    ) -> list[dict[str, str]]:
        """
        Get triplets from the knowledge graph.

        Args:
            subject: Optional subject to filter by
            limit: Maximum triplets to return

        Returns:
            List of triplets as dicts
        """
        from src.graph.client import get_graph_client

        graph = await get_graph_client()

        if subject:
            result = await graph.query(
                """
                MATCH (s)-[r]->(o)
                WHERE s.name CONTAINS $subject
                RETURN s.name as subject, type(r) as predicate, o.name as object
                LIMIT $limit
                """,
                {"subject": subject, "limit": limit},
            )
        else:
            result = await graph.query(
                """
                MATCH (s)-[r]->(o)
                RETURN s.name as subject, type(r) as predicate, o.name as object
                LIMIT $limit
                """,
                {"limit": limit},
            )

        return [
            {
                "subject": row.get("subject", ""),
                "predicate": row.get("predicate", ""),
                "object": row.get("object", ""),
            }
            for row in (result or [])
        ]

    async def get_entity_context(
        self,
        entity_name: str,
        depth: int = 2,
    ) -> dict[str, Any]:
        """
        Get context around an entity from the knowledge graph.

        Args:
            entity_name: Name of entity to explore
            depth: How many hops to traverse

        Returns:
            Entity context with related nodes
        """
        from src.graph.client import get_graph_client

        graph = await get_graph_client()

        result = await graph.query(
            f"""
            MATCH (e)-[r*1..{depth}]-(related)
            WHERE e.name CONTAINS $name
            RETURN e.name as entity,
                   collect(DISTINCT {{
                       name: related.name,
                       type: labels(related)[0]
                   }})[0..20] as related_entities
            LIMIT 1
            """,
            {"name": entity_name},
        )

        if result:
            return {
                "entity": result[0].get("entity"),
                "related_entities": result[0].get("related_entities", []),
                "depth": depth,
            }

        return {
            "entity": entity_name,
            "related_entities": [],
            "depth": depth,
            "message": "Entity not found",
        }

    async def visualize_subgraph(
        self,
        center_entity: str,
        depth: int = 1,
    ) -> dict[str, Any]:
        """
        Get a subgraph for visualization.

        Args:
            center_entity: Entity to center the visualization on
            depth: Traversal depth

        Returns:
            Nodes and edges for visualization
        """
        from src.graph.client import get_graph_client

        graph = await get_graph_client()

        result = await graph.query(
            f"""
            MATCH path = (center)-[*1..{depth}]-(connected)
            WHERE center.name CONTAINS $name
            WITH nodes(path) as ns, relationships(path) as rs
            UNWIND ns as n
            WITH DISTINCT n, rs
            UNWIND rs as r
            RETURN DISTINCT
                collect(DISTINCT {{
                    id: n.id,
                    name: n.name,
                    type: labels(n)[0]
                }}) as nodes,
                collect(DISTINCT {{
                    source: startNode(r).id,
                    target: endNode(r).id,
                    type: type(r)
                }}) as edges
            """,
            {"name": center_entity},
        )

        if result:
            return {
                "center": center_entity,
                "nodes": result[0].get("nodes", []),
                "edges": result[0].get("edges", []),
                "depth": depth,
            }

        return {
            "center": center_entity,
            "nodes": [],
            "edges": [],
            "depth": depth,
        }


# =============================================================================
# Factory Functions
# =============================================================================

_llamaindex_instances: dict[str, DroviLlamaIndex] = {}


async def get_llamaindex(organization_id: str) -> DroviLlamaIndex:
    """Get LlamaIndex instance for an organization."""
    global _llamaindex_instances

    if organization_id not in _llamaindex_instances:
        _llamaindex_instances[organization_id] = DroviLlamaIndex(organization_id)

    return _llamaindex_instances[organization_id]
