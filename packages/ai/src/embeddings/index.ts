// =============================================================================
// EMBEDDINGS MODULE
// =============================================================================
//
// Vector embedding generation and utilities for semantic search.
//

export {
  // Utilities
  aggregateEmbeddings,
  type BatchEmbeddingResult,
  batchGenerateEmbeddings,
  // Helpers
  calculateInputHash,
  cleanTextForEmbedding,
  cosineSimilarity,
  // Constants
  DEFAULT_EMBEDDING_MODEL,
  EMBEDDING_DIMENSIONS,
  type EmbeddingOptions,
  // Types
  type EmbeddingResult,
  generateClaimEmbedding,
  // Multi-source generation functions
  generateConversationEmbedding,
  // Generation functions
  generateEmbedding,
  generateGenericMessageEmbedding,
  generateMessageEmbedding,
  generateQueryEmbedding,
  MAX_BATCH_SIZE,
  MAX_REQUESTS_PER_MINUTE,
  MAX_TOKENS_PER_REQUEST,
  prepareTextForEmbedding,
  truncateForEmbedding,
} from "./generator.js";
