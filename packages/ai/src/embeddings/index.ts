// =============================================================================
// EMBEDDINGS MODULE
// =============================================================================
//
// Vector embedding generation and utilities for semantic search.
//

export {
  // Constants
  DEFAULT_EMBEDDING_MODEL,
  EMBEDDING_DIMENSIONS,
  MAX_TOKENS_PER_REQUEST,
  MAX_BATCH_SIZE,
  MAX_REQUESTS_PER_MINUTE,
  // Types
  type EmbeddingResult,
  type BatchEmbeddingResult,
  type EmbeddingOptions,
  // Helpers
  calculateInputHash,
  truncateForEmbedding,
  cleanTextForEmbedding,
  prepareTextForEmbedding,
  // Generation functions
  generateEmbedding,
  batchGenerateEmbeddings,
  generateMessageEmbedding,
  generateClaimEmbedding,
  generateQueryEmbedding,
  // Utilities
  aggregateEmbeddings,
  cosineSimilarity,
} from "./generator.js";
