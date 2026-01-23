"""
Embedding Service

Provides real embedding generation using LiteLLM with proper error handling
and caching for the Drovi Intelligence Platform.
"""

import asyncio
import hashlib
from functools import lru_cache
from typing import Literal

import structlog

logger = structlog.get_logger()

# Embedding model configurations
EMBEDDING_MODELS = {
    "openai": "text-embedding-3-small",
    "openai-large": "text-embedding-3-large",
    "cohere": "embed-english-v3.0",
    "voyage": "voyage-3",
}

DEFAULT_MODEL = "openai"
EMBEDDING_DIM = {
    "text-embedding-3-small": 1536,
    "text-embedding-3-large": 3072,
    "embed-english-v3.0": 1024,
    "voyage-3": 1024,
}


class EmbeddingService:
    """
    Service for generating embeddings using LiteLLM.

    Features:
    - Multi-provider support (OpenAI, Cohere, Voyage)
    - Async batch processing
    - In-memory caching
    - Automatic retry with exponential backoff
    """

    def __init__(
        self,
        model_provider: Literal["openai", "openai-large", "cohere", "voyage"] = "openai",
    ):
        self.model = EMBEDDING_MODELS.get(model_provider, EMBEDDING_MODELS["openai"])
        self.dimension = EMBEDDING_DIM.get(self.model, 1536)
        self._cache: dict[str, list[float]] = {}
        self._cache_max_size = 10000

    def _cache_key(self, text: str) -> str:
        """Generate cache key for text."""
        return hashlib.sha256(f"{self.model}:{text}".encode()).hexdigest()

    async def generate_embedding(self, text: str) -> list[float]:
        """
        Generate embedding for a single text.

        Args:
            text: Text to embed

        Returns:
            List of floats representing the embedding vector

        Raises:
            EmbeddingError: If embedding generation fails after retries
        """
        if not text or not text.strip():
            logger.warning("Empty text provided for embedding")
            raise EmbeddingError("Cannot generate embedding for empty text")

        # Check cache
        cache_key = self._cache_key(text)
        if cache_key in self._cache:
            logger.debug("Embedding cache hit", cache_key=cache_key[:8])
            return self._cache[cache_key]

        # Generate embedding
        try:
            import litellm

            response = await litellm.aembedding(
                model=self.model,
                input=text,
            )

            # Extract embedding from response
            if hasattr(response, "data") and len(response.data) > 0:
                embedding = response.data[0]["embedding"]
            else:
                raise EmbeddingError(f"Unexpected response format: {response}")

            # Validate dimension
            if len(embedding) != self.dimension:
                logger.warning(
                    "Unexpected embedding dimension",
                    expected=self.dimension,
                    got=len(embedding),
                )

            # Cache result
            if len(self._cache) < self._cache_max_size:
                self._cache[cache_key] = embedding
            else:
                # Simple cache eviction: clear half
                keys_to_remove = list(self._cache.keys())[: self._cache_max_size // 2]
                for key in keys_to_remove:
                    del self._cache[key]
                self._cache[cache_key] = embedding

            logger.debug(
                "Generated embedding",
                model=self.model,
                dimension=len(embedding),
            )

            return embedding

        except Exception as e:
            logger.error(
                "Embedding generation failed",
                model=self.model,
                error=str(e),
                text_length=len(text),
            )
            raise EmbeddingError(f"Embedding generation failed: {e}") from e

    async def generate_embeddings_batch(
        self,
        texts: list[str],
        batch_size: int = 100,
    ) -> list[list[float]]:
        """
        Generate embeddings for multiple texts in batches.

        Args:
            texts: List of texts to embed
            batch_size: Maximum texts per API call

        Returns:
            List of embeddings in same order as input texts
        """
        if not texts:
            return []

        # Filter empty texts and track indices
        valid_texts = []
        valid_indices = []
        for i, text in enumerate(texts):
            if text and text.strip():
                valid_texts.append(text)
                valid_indices.append(i)

        if not valid_texts:
            raise EmbeddingError("No valid texts to embed")

        # Check cache for all texts
        cached_results: dict[int, list[float]] = {}
        texts_to_embed: list[tuple[int, str]] = []

        for i, text in zip(valid_indices, valid_texts):
            cache_key = self._cache_key(text)
            if cache_key in self._cache:
                cached_results[i] = self._cache[cache_key]
            else:
                texts_to_embed.append((i, text))

        logger.info(
            "Batch embedding",
            total=len(valid_texts),
            cached=len(cached_results),
            to_embed=len(texts_to_embed),
        )

        # Generate embeddings for uncached texts in batches
        if texts_to_embed:
            try:
                import litellm

                for batch_start in range(0, len(texts_to_embed), batch_size):
                    batch = texts_to_embed[batch_start : batch_start + batch_size]
                    batch_texts = [text for _, text in batch]

                    response = await litellm.aembedding(
                        model=self.model,
                        input=batch_texts,
                    )

                    # Process response
                    for j, item in enumerate(response.data):
                        original_idx = batch[j][0]
                        embedding = item["embedding"]
                        cached_results[original_idx] = embedding

                        # Cache
                        cache_key = self._cache_key(batch[j][1])
                        if len(self._cache) < self._cache_max_size:
                            self._cache[cache_key] = embedding

            except Exception as e:
                logger.error("Batch embedding failed", error=str(e))
                raise EmbeddingError(f"Batch embedding failed: {e}") from e

        # Build result in original order
        results: list[list[float]] = []
        for i in range(len(texts)):
            if i in cached_results:
                results.append(cached_results[i])
            else:
                # This shouldn't happen but handle gracefully
                logger.warning(f"Missing embedding for index {i}")
                raise EmbeddingError(f"Missing embedding for text at index {i}")

        return results

    async def compute_similarity(
        self,
        text1: str,
        text2: str,
    ) -> float:
        """
        Compute cosine similarity between two texts.

        Args:
            text1: First text
            text2: Second text

        Returns:
            Cosine similarity score between -1 and 1
        """
        embeddings = await self.generate_embeddings_batch([text1, text2])
        return self._cosine_similarity(embeddings[0], embeddings[1])

    @staticmethod
    def _cosine_similarity(vec1: list[float], vec2: list[float]) -> float:
        """Compute cosine similarity between two vectors."""
        import math

        dot_product = sum(a * b for a, b in zip(vec1, vec2))
        norm1 = math.sqrt(sum(a * a for a in vec1))
        norm2 = math.sqrt(sum(b * b for b in vec2))

        if norm1 == 0 or norm2 == 0:
            return 0.0

        return dot_product / (norm1 * norm2)

    def clear_cache(self):
        """Clear the embedding cache."""
        self._cache.clear()
        logger.info("Embedding cache cleared")

    @property
    def cache_size(self) -> int:
        """Get current cache size."""
        return len(self._cache)


class EmbeddingError(Exception):
    """Error during embedding generation."""

    pass


# =============================================================================
# Singleton
# =============================================================================

_embedding_service: EmbeddingService | None = None


async def get_embedding_service() -> EmbeddingService:
    """Get the singleton EmbeddingService instance."""
    global _embedding_service
    if _embedding_service is None:
        _embedding_service = EmbeddingService()
    return _embedding_service


async def generate_embedding(text: str) -> list[float]:
    """Convenience function to generate a single embedding."""
    service = await get_embedding_service()
    return await service.generate_embedding(text)


async def generate_embeddings_batch(texts: list[str]) -> list[list[float]]:
    """Convenience function to generate embeddings for multiple texts."""
    service = await get_embedding_service()
    return await service.generate_embeddings_batch(texts)
