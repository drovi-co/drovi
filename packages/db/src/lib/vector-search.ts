import { inArray, sql } from "drizzle-orm";
import type { PgDatabase } from "drizzle-orm/pg-core";
import { conversation, message } from "../schema/sources";

/**
 * Create a SQL literal for pgvector embedding.
 * Must use sql.raw() to prevent parameterization - pgvector can't cast text params to vector.
 */
function vectorLiteral(embedding: number[]) {
  const vectorStr = `[${embedding.join(",")}]`;
  return sql.raw(`'${vectorStr}'::vector`);
}

// =============================================================================
// TYPES
// =============================================================================

export interface SearchResult<T> {
  item: T;
  similarity: number;
  distance: number;
}

export type MessageSearchResult = SearchResult<{
  id: string;
  conversationId: string;
  senderEmail: string;
  senderName: string | null;
  subject: string | null;
  snippet: string | null;
  sentAt: Date | null;
  bodyText: string | null;
}>;

export type ConversationSearchResult = SearchResult<{
  id: string;
  sourceAccountId: string;
  subject: string | null;
  snippet: string | null;
  briefSummary: string | null;
  lastMessageAt: Date | null;
  messageCount: number;
}>;

export type ClaimSearchResult = SearchResult<{
  id: string;
  type: string;
  text: string;
  conversationId: string | null;
  confidence: number;
}>;

export interface HybridSearchOptions {
  vectorWeight?: number; // 0-1, default 0.5
  limit?: number;
  sourceAccountIds?: string[];
  threshold?: number;
}

// =============================================================================
// SIMILARITY SEARCH FUNCTIONS
// =============================================================================

/**
 * Search for similar messages using vector similarity.
 *
 * @param db - Drizzle database instance
 * @param queryEmbedding - Query vector (1536 dimensions for OpenAI)
 * @param options - Search options
 * @returns Array of messages sorted by similarity
 */
export async function searchSimilarMessages(
  db: PgDatabase<unknown>,
  queryEmbedding: number[],
  options: {
    limit?: number;
    threshold?: number;
    sourceAccountIds?: string[];
    conversationIds?: string[];
  } = {}
): Promise<MessageSearchResult[]> {
  const {
    limit = 10,
    threshold = 0.5,
    sourceAccountIds,
    conversationIds,
  } = options;
  const vec = vectorLiteral(queryEmbedding);

  // Build dynamic WHERE conditions
  const conditions: unknown[] = [];

  if (sourceAccountIds?.length) {
    conditions.push(inArray(conversation.sourceAccountId, sourceAccountIds));
  }
  if (conversationIds?.length) {
    conditions.push(inArray(message.conversationId, conversationIds));
  }

  const results = await db.execute<{
    id: string;
    conversation_id: string;
    sender_email: string;
    sender_name: string | null;
    subject: string | null;
    snippet: string | null;
    sent_at: Date | null;
    body_text: string | null;
    similarity: number;
    distance: number;
  }>(sql`
    SELECT
      m.id,
      m.conversation_id,
      m.sender_email,
      m.sender_name,
      m.subject,
      m.snippet,
      m.sent_at,
      m.body_text,
      1 - (me.embedding <=> ${vec}) as similarity,
      me.embedding <=> ${vec} as distance
    FROM message_embedding me
    JOIN message m ON m.id = me.message_id
    JOIN conversation c ON c.id = m.conversation_id
    WHERE 1 - (me.embedding <=> ${vec}) > ${threshold}
    ${sourceAccountIds?.length ? sql`AND c.source_account_id = ANY(${sourceAccountIds})` : sql``}
    ${conversationIds?.length ? sql`AND m.conversation_id = ANY(${conversationIds})` : sql``}
    ORDER BY me.embedding <=> ${vec}
    LIMIT ${limit}
  `);

  return results.rows.map((row) => ({
    item: {
      id: row.id,
      conversationId: row.conversation_id,
      senderEmail: row.sender_email,
      senderName: row.sender_name,
      subject: row.subject,
      snippet: row.snippet,
      sentAt: row.sent_at,
      bodyText: row.body_text,
    },
    similarity: row.similarity,
    distance: row.distance,
  }));
}

/**
 * Search for similar conversations using vector similarity.
 */
export async function searchSimilarConversations(
  db: PgDatabase<unknown>,
  queryEmbedding: number[],
  options: {
    limit?: number;
    threshold?: number;
    sourceAccountIds?: string[];
  } = {}
): Promise<ConversationSearchResult[]> {
  const { limit = 10, threshold = 0.5, sourceAccountIds } = options;
  const vec = vectorLiteral(queryEmbedding);

  const results = await db.execute<{
    id: string;
    source_account_id: string;
    subject: string | null;
    snippet: string | null;
    brief_summary: string | null;
    last_message_at: Date | null;
    message_count: number;
    similarity: number;
    distance: number;
  }>(sql`
    SELECT
      c.id,
      c.source_account_id,
      c.subject,
      c.snippet,
      c.brief_summary,
      c.last_message_at,
      c.message_count,
      1 - (te.embedding <=> ${vec}) as similarity,
      te.embedding <=> ${vec} as distance
    FROM thread_embedding te
    JOIN conversation c ON c.id = te.conversation_id
    WHERE 1 - (te.embedding <=> ${vec}) > ${threshold}
    ${sourceAccountIds?.length ? sql`AND c.source_account_id = ANY(${sourceAccountIds})` : sql``}
    ORDER BY te.embedding <=> ${vec}
    LIMIT ${limit}
  `);

  return results.rows.map((row) => ({
    item: {
      id: row.id,
      sourceAccountId: row.source_account_id,
      subject: row.subject,
      snippet: row.snippet,
      briefSummary: row.brief_summary,
      lastMessageAt: row.last_message_at,
      messageCount: row.message_count,
    },
    similarity: row.similarity,
    distance: row.distance,
  }));
}

/**
 * Search for similar claims using vector similarity.
 * Useful for "What did we decide about X?" queries.
 */
export async function searchSimilarClaims(
  db: PgDatabase<unknown>,
  queryEmbedding: number[],
  options: {
    limit?: number;
    threshold?: number;
    organizationId?: string;
    claimTypes?: string[];
  } = {}
): Promise<ClaimSearchResult[]> {
  const { limit = 10, threshold = 0.5, organizationId, claimTypes } = options;
  const vec = vectorLiteral(queryEmbedding);

  const results = await db.execute<{
    id: string;
    type: string;
    text: string;
    conversation_id: string | null;
    confidence: number;
    similarity: number;
    distance: number;
  }>(sql`
    SELECT
      c.id,
      c.type,
      c.text,
      c.conversation_id,
      c.confidence,
      1 - (ce.embedding <=> ${vec}) as similarity,
      ce.embedding <=> ${vec} as distance
    FROM claim_embedding ce
    JOIN claim c ON c.id = ce.claim_id
    WHERE 1 - (ce.embedding <=> ${vec}) > ${threshold}
    ${organizationId ? sql`AND c.organization_id = ${organizationId}` : sql``}
    ${claimTypes?.length ? sql`AND c.type = ANY(${claimTypes})` : sql``}
    ORDER BY ce.embedding <=> ${vec}
    LIMIT ${limit}
  `);

  return results.rows.map((row) => ({
    item: {
      id: row.id,
      type: row.type,
      text: row.text,
      conversationId: row.conversation_id,
      confidence: row.confidence,
    },
    similarity: row.similarity,
    distance: row.distance,
  }));
}

// =============================================================================
// HYBRID SEARCH (Vector + Keyword)
// =============================================================================

/**
 * Hybrid search combining vector similarity and keyword matching.
 * Uses Reciprocal Rank Fusion (RRF) to combine rankings.
 *
 * @param db - Drizzle database instance
 * @param query - Text query for keyword search
 * @param queryEmbedding - Vector embedding for semantic search
 * @param options - Search options
 */
export async function hybridSearchMessages(
  db: PgDatabase<unknown>,
  query: string,
  queryEmbedding: number[],
  options: HybridSearchOptions = {}
): Promise<MessageSearchResult[]> {
  const {
    vectorWeight = 0.5,
    limit = 10,
    sourceAccountIds,
    threshold = 0.3,
  } = options;
  const keywordWeight = 1 - vectorWeight;
  const vec = vectorLiteral(queryEmbedding);

  // RRF constant (commonly 60)
  const k = 60;

  const results = await db.execute<{
    id: string;
    conversation_id: string;
    sender_email: string;
    sender_name: string | null;
    subject: string | null;
    snippet: string | null;
    sent_at: Date | null;
    body_text: string | null;
    rrf_score: number;
    vector_similarity: number;
  }>(sql`
    WITH vector_results AS (
      SELECT
        m.id,
        ROW_NUMBER() OVER (ORDER BY me.embedding <=> ${vec}) as v_rank,
        1 - (me.embedding <=> ${vec}) as similarity
      FROM message_embedding me
      JOIN message m ON m.id = me.message_id
      JOIN conversation c ON c.id = m.conversation_id
      WHERE 1 - (me.embedding <=> ${vec}) > ${threshold}
      ${sourceAccountIds?.length ? sql`AND c.source_account_id = ANY(${sourceAccountIds})` : sql``}
      LIMIT 100
    ),
    keyword_results AS (
      SELECT
        m.id,
        ROW_NUMBER() OVER (
          ORDER BY ts_rank(
            to_tsvector('english', COALESCE(m.body_text, '') || ' ' || COALESCE(m.subject, '')),
            plainto_tsquery('english', ${query})
          ) DESC
        ) as k_rank
      FROM message m
      JOIN conversation c ON c.id = m.conversation_id
      WHERE to_tsvector('english', COALESCE(m.body_text, '') || ' ' || COALESCE(m.subject, ''))
            @@ plainto_tsquery('english', ${query})
      ${sourceAccountIds?.length ? sql`AND c.source_account_id = ANY(${sourceAccountIds})` : sql``}
      LIMIT 100
    ),
    combined AS (
      SELECT
        COALESCE(v.id, k.id) as id,
        (${vectorWeight}::float / (${k} + COALESCE(v.v_rank, 1000))) +
        (${keywordWeight}::float / (${k} + COALESCE(k.k_rank, 1000))) as rrf_score,
        COALESCE(v.similarity, 0) as vector_similarity
      FROM vector_results v
      FULL OUTER JOIN keyword_results k ON v.id = k.id
    )
    SELECT
      m.id,
      m.conversation_id,
      m.sender_email,
      m.sender_name,
      m.subject,
      m.snippet,
      m.sent_at,
      m.body_text,
      cb.rrf_score,
      cb.vector_similarity
    FROM combined cb
    JOIN message m ON m.id = cb.id
    ORDER BY cb.rrf_score DESC
    LIMIT ${limit}
  `);

  return results.rows.map((row) => ({
    item: {
      id: row.id,
      conversationId: row.conversation_id,
      senderEmail: row.sender_email,
      senderName: row.sender_name,
      subject: row.subject,
      snippet: row.snippet,
      sentAt: row.sent_at,
      bodyText: row.body_text,
    },
    similarity: row.vector_similarity,
    distance: 1 - row.vector_similarity,
  }));
}

// =============================================================================
// UTILITY FUNCTIONS
// =============================================================================

/**
 * Find K nearest neighbors for a given embedding.
 */
export async function findKNN<T extends "message" | "conversation" | "claim">(
  db: PgDatabase<unknown>,
  type: T,
  queryEmbedding: number[],
  k = 10
): Promise<Array<{ id: string; distance: number }>> {
  const vec = vectorLiteral(queryEmbedding);

  const tableMap = {
    message: { table: "message_embedding", idCol: "message_id" },
    conversation: { table: "thread_embedding", idCol: "conversation_id" },
    claim: { table: "claim_embedding", idCol: "claim_id" },
  } as const;

  const { table, idCol } = tableMap[type];

  const results = await db.execute<{ id: string; distance: number }>(sql`
    SELECT
      ${sql.identifier(idCol)} as id,
      embedding <=> ${vec} as distance
    FROM ${sql.identifier(table)}
    ORDER BY embedding <=> ${vec}
    LIMIT ${k}
  `);

  return results.rows;
}

/**
 * Calculate cosine similarity between two vectors.
 * Useful for comparing embeddings without database round-trip.
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new Error("Vectors must have same dimensions");
  }

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  if (denominator === 0) {
    return 0;
  }

  return dotProduct / denominator;
}

/**
 * Normalize a vector to unit length (for inner product search).
 */
export function normalizeVector(vector: number[]): number[] {
  const norm = Math.sqrt(vector.reduce((sum, val) => sum + val * val, 0));
  if (norm === 0) {
    return vector;
  }
  return vector.map((val) => val / norm);
}
