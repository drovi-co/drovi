// =============================================================================
// EMBEDDING GENERATOR
// =============================================================================
//
// Generates vector embeddings using OpenAI's embedding API.
// Supports single and batch processing with automatic chunking.
//

import { createHash } from "node:crypto";
import { getOpenAI } from "../providers/index.js";

// =============================================================================
// CONSTANTS
// =============================================================================

/**
 * Default embedding model
 */
export const DEFAULT_EMBEDDING_MODEL = "text-embedding-3-small";

/**
 * Dimensions for text-embedding-3-small
 */
export const EMBEDDING_DIMENSIONS = 1536;

/**
 * Maximum tokens per embedding request (8191 for text-embedding-3-small)
 */
export const MAX_TOKENS_PER_REQUEST = 8000;

/**
 * Maximum texts per batch request
 */
export const MAX_BATCH_SIZE = 100;

/**
 * Rate limiting: max requests per minute
 */
export const MAX_REQUESTS_PER_MINUTE = 500;

// =============================================================================
// TYPES
// =============================================================================

export interface EmbeddingResult {
  embedding: number[];
  tokenCount: number;
  model: string;
  inputHash: string;
}

export interface BatchEmbeddingResult {
  embeddings: EmbeddingResult[];
  totalTokens: number;
  model: string;
}

export interface EmbeddingOptions {
  model?: string;
  dimensions?: number;
}

// =============================================================================
// HELPERS
// =============================================================================

/**
 * Calculate hash of input text for caching/comparison.
 */
export function calculateInputHash(text: string): string {
  return createHash("sha256").update(text).digest("hex").slice(0, 32);
}

/**
 * Truncate text to fit within token limits (rough estimation).
 * Uses 4 characters per token as a conservative estimate.
 */
export function truncateForEmbedding(
  text: string,
  maxTokens = MAX_TOKENS_PER_REQUEST
): string {
  const maxChars = maxTokens * 4;
  if (text.length <= maxChars) {
    return text;
  }
  return text.slice(0, maxChars);
}

/**
 * Clean text for embedding (remove excessive whitespace, etc.).
 */
export function cleanTextForEmbedding(text: string): string {
  return text
    .replace(/\s+/g, " ") // Normalize whitespace
    .replace(/\n{3,}/g, "\n\n") // Limit consecutive newlines
    .trim();
}

/**
 * Prepare text for embedding by cleaning and truncating.
 */
export function prepareTextForEmbedding(text: string): string {
  const cleaned = cleanTextForEmbedding(text);
  return truncateForEmbedding(cleaned);
}

// =============================================================================
// EMBEDDING GENERATION
// =============================================================================

/**
 * Generate embedding for a single text.
 */
export async function generateEmbedding(
  text: string,
  options: EmbeddingOptions = {}
): Promise<EmbeddingResult> {
  const model = options.model ?? DEFAULT_EMBEDDING_MODEL;
  const preparedText = prepareTextForEmbedding(text);

  if (!preparedText) {
    throw new Error("Cannot generate embedding for empty text");
  }

  const openai = getOpenAI();
  // Note: In @ai-sdk/openai v3, dimensions are controlled by model selection
  // text-embedding-3-small defaults to 1536 dimensions
  const embeddingModel = openai.textEmbeddingModel(model);

  const response = await embeddingModel.doEmbed({
    values: [preparedText],
  });

  const embedding = response.embeddings[0];
  if (!embedding) {
    throw new Error("No embedding returned from API");
  }

  return {
    embedding,
    tokenCount: response.usage?.tokens ?? estimateTokenCount(preparedText),
    model,
    inputHash: calculateInputHash(preparedText),
  };
}

/**
 * Generate embeddings for multiple texts in a single batch.
 * Automatically chunks if the batch is too large.
 */
export async function batchGenerateEmbeddings(
  texts: string[],
  options: EmbeddingOptions = {}
): Promise<BatchEmbeddingResult> {
  if (texts.length === 0) {
    return {
      embeddings: [],
      totalTokens: 0,
      model: options.model ?? DEFAULT_EMBEDDING_MODEL,
    };
  }

  const model = options.model ?? DEFAULT_EMBEDDING_MODEL;
  const preparedTexts = texts.map(prepareTextForEmbedding);

  // Filter out empty texts
  const validIndices: number[] = [];
  const validTexts: string[] = [];
  for (let i = 0; i < preparedTexts.length; i++) {
    const text = preparedTexts[i];
    if (text && text.length > 0) {
      validIndices.push(i);
      validTexts.push(text);
    }
  }

  if (validTexts.length === 0) {
    return {
      embeddings: [],
      totalTokens: 0,
      model,
    };
  }

  // Split into chunks if needed
  const chunks = chunkArray(validTexts, MAX_BATCH_SIZE);
  const allEmbeddings: EmbeddingResult[] = [];
  let totalTokens = 0;

  const openai = getOpenAI();
  // Note: In @ai-sdk/openai v3, dimensions are controlled by model selection
  const embeddingModel = openai.textEmbeddingModel(model);

  for (const chunk of chunks) {
    const response = await embeddingModel.doEmbed({
      values: chunk,
    });

    const chunkTokens = response.usage?.tokens ?? 0;
    totalTokens += chunkTokens;

    for (let i = 0; i < chunk.length; i++) {
      const text = chunk[i];
      const embedding = response.embeddings[i];
      if (embedding && text) {
        allEmbeddings.push({
          embedding,
          tokenCount: Math.floor(chunkTokens / chunk.length), // Approximate per-text tokens
          model,
          inputHash: calculateInputHash(text),
        });
      }
    }
  }

  // Rebuild results array with original indices
  const results: EmbeddingResult[] = new Array(texts.length);
  for (let i = 0; i < validIndices.length; i++) {
    const originalIndex = validIndices[i];
    const result = allEmbeddings[i];
    if (originalIndex !== undefined && result) {
      results[originalIndex] = result;
    }
  }

  return {
    embeddings: results.filter((r): r is EmbeddingResult => r !== undefined),
    totalTokens,
    model,
  };
}

/**
 * Estimate token count for a text (rough estimate).
 */
function estimateTokenCount(text: string): number {
  // Rough estimate: ~4 characters per token
  return Math.ceil(text.length / 4);
}

/**
 * Split array into chunks of specified size.
 */
function chunkArray<T>(array: T[], chunkSize: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < array.length; i += chunkSize) {
    chunks.push(array.slice(i, i + chunkSize));
  }
  return chunks;
}

// =============================================================================
// SPECIALIZED EMBEDDING FUNCTIONS
// =============================================================================

/**
 * Generate embedding for an email message.
 * Combines subject and body with appropriate formatting.
 */
export function generateMessageEmbedding(
  subject: string | null,
  body: string,
  options: EmbeddingOptions = {}
): Promise<EmbeddingResult> {
  const parts: string[] = [];

  if (subject) {
    parts.push(`Subject: ${subject}`);
  }

  parts.push(body);

  const text = parts.join("\n\n");
  return generateEmbedding(text, options);
}

/**
 * Generate embedding for a claim (decision, commitment, etc.).
 * Includes claim type and context for better retrieval.
 */
export function generateClaimEmbedding(
  claimType: string,
  content: string,
  context?: string,
  options: EmbeddingOptions = {}
): Promise<EmbeddingResult> {
  const parts: string[] = [`[${claimType.toUpperCase()}]`, content];

  if (context) {
    parts.push(`Context: ${context}`);
  }

  const text = parts.join("\n");
  return generateEmbedding(text, options);
}

/**
 * Generate embedding for a multi-source conversation message.
 * Works for WhatsApp, Slack, and other non-email sources.
 */
export function generateGenericMessageEmbedding(
  senderName: string | null,
  body: string,
  options: EmbeddingOptions = {}
): Promise<EmbeddingResult> {
  const parts: string[] = [];

  if (senderName) {
    parts.push(`From: ${senderName}`);
  }

  parts.push(body);

  const text = parts.join("\n\n");
  return generateEmbedding(text, options);
}

/**
 * Generate embedding for a conversation (multi-source).
 * Combines title and message content with source context.
 */
export function generateConversationEmbedding(
  title: string | null,
  messages: Array<{ sender?: string; body: string }>,
  sourceType: string,
  options: EmbeddingOptions = {}
): Promise<EmbeddingResult> {
  const parts: string[] = [];

  // Add source context
  parts.push(`[${sourceType.toUpperCase()} Conversation]`);

  if (title) {
    parts.push(`Title: ${title}`);
  }

  // Add messages (limit to avoid token overflow)
  const messagesToInclude = messages.slice(-20); // Last 20 messages
  for (const msg of messagesToInclude) {
    if (msg.sender) {
      parts.push(`${msg.sender}: ${msg.body}`);
    } else {
      parts.push(msg.body);
    }
  }

  const text = parts.join("\n");
  return generateEmbedding(text, options);
}

/**
 * Generate embedding for a search query.
 * Optimized for query-style text.
 */
export function generateQueryEmbedding(
  query: string,
  options: EmbeddingOptions = {}
): Promise<EmbeddingResult> {
  // Queries are typically shorter, no need for special formatting
  return generateEmbedding(query, options);
}

/**
 * Aggregate multiple embeddings into one (mean pooling).
 */
export function aggregateEmbeddings(
  embeddings: number[][],
  method: "mean" | "max_pool" = "mean"
): number[] {
  if (embeddings.length === 0) {
    throw new Error("Cannot aggregate empty embeddings array");
  }

  if (embeddings.length === 1) {
    return embeddings[0] ?? [];
  }

  const dimensions = embeddings[0]?.length ?? 0;
  const result = new Array<number>(dimensions).fill(0);

  if (method === "mean") {
    for (const embedding of embeddings) {
      for (let i = 0; i < dimensions; i++) {
        result[i] = (result[i] ?? 0) + (embedding[i] ?? 0) / embeddings.length;
      }
    }
  } else if (method === "max_pool") {
    // Initialize with first embedding
    const firstEmbedding = embeddings[0];
    if (firstEmbedding) {
      for (let i = 0; i < dimensions; i++) {
        result[i] = firstEmbedding[i] ?? 0;
      }
    }
    // Max pool
    for (let j = 1; j < embeddings.length; j++) {
      const embedding = embeddings[j];
      if (embedding) {
        for (let i = 0; i < dimensions; i++) {
          result[i] = Math.max(result[i] ?? 0, embedding[i] ?? 0);
        }
      }
    }
  }

  return result;
}

/**
 * Calculate cosine similarity between two embeddings.
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new Error("Embeddings must have the same dimensions");
  }

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    const valA = a[i] ?? 0;
    const valB = b[i] ?? 0;
    dotProduct += valA * valB;
    normA += valA * valA;
    normB += valB * valB;
  }

  if (normA === 0 || normB === 0) {
    return 0;
  }

  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}
