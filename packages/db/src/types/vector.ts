import { sql } from "drizzle-orm";
import { customType } from "drizzle-orm/pg-core";

/**
 * Custom Drizzle type for pgvector vector columns
 *
 * Usage:
 * ```typescript
 * import { vector } from './types/vector';
 *
 * const myTable = pgTable('my_table', {
 *   embedding: vector('embedding', { dimensions: 1536 }).notNull(),
 * });
 * ```
 */
export const vector = customType<{
  data: number[];
  driverData: string;
  config: { dimensions: number };
}>({
  dataType(config) {
    return `vector(${config?.dimensions ?? 1536})`;
  },
  toDriver(value: number[]): string {
    return `[${value.join(",")}]`;
  },
  fromDriver(value: string): number[] {
    // Handle both string format "[1,2,3]" and potential array format
    if (typeof value === "string") {
      const cleaned = value.replace(/^\[|\]$/g, "");
      return cleaned.split(",").map(Number);
    }
    return value as unknown as number[];
  },
});

/**
 * SQL helper for cosine similarity distance
 * Returns distance (lower = more similar), use 1 - result for similarity score
 *
 * IMPORTANT: Uses sql.raw() to inject vector literal directly into SQL.
 * pgvector cannot cast parameterized text values to vector type.
 *
 * Usage:
 * ```typescript
 * db.select({
 *   similarity: sql`1 - (${messageEmbedding.embedding} <=> ${cosineDistance(queryVector)})`
 * })
 * ```
 */
export function cosineDistance(queryVector: number[]) {
  // Must use sql.raw() - pgvector can't cast text parameters to vector
  const vecStr = `[${queryVector.join(",")}]`;
  return sql.raw(`'${vecStr}'::vector`);
}

/**
 * SQL helper for L2 (Euclidean) distance
 */
export function l2Distance(queryVector: number[]) {
  return sql`${JSON.stringify(queryVector)}::vector`;
}

/**
 * SQL helper for inner product distance (for normalized vectors)
 */
export function innerProductDistance(queryVector: number[]) {
  return sql`${JSON.stringify(queryVector)}::vector`;
}

/**
 * SQL operator helpers for vector similarity search
 */
export const vectorOps = {
  /**
   * Cosine distance operator (<=>)
   * Lower values = more similar
   */
  cosineDistance: (column: unknown, queryVector: number[]) =>
    sql`${column} <=> ${JSON.stringify(queryVector)}::vector`,

  /**
   * L2 (Euclidean) distance operator (<->)
   * Lower values = more similar
   */
  l2Distance: (column: unknown, queryVector: number[]) =>
    sql`${column} <-> ${JSON.stringify(queryVector)}::vector`,

  /**
   * Inner product distance operator (<#>)
   * For normalized vectors, higher values = more similar
   * Note: Returns negative inner product, so lower = more similar
   */
  innerProduct: (column: unknown, queryVector: number[]) =>
    sql`${column} <#> ${JSON.stringify(queryVector)}::vector`,

  /**
   * Cosine similarity (1 - cosine distance)
   * Higher values = more similar (0-1 range)
   */
  cosineSimilarity: (column: unknown, queryVector: number[]) =>
    sql`1 - (${column} <=> ${JSON.stringify(queryVector)}::vector)`,
};

/**
 * Default embedding dimensions for common models
 */
export const EMBEDDING_DIMENSIONS = {
  // OpenAI models
  "text-embedding-3-small": 1536,
  "text-embedding-3-large": 3072,
  "text-embedding-ada-002": 1536,

  // Open source models
  "e5-small-v2": 384,
  "e5-base-v2": 768,
  "e5-large-v2": 1024,
  "bge-small-en": 384,
  "bge-base-en": 768,
  "bge-large-en": 1024,

  // Default
  default: 1536,
} as const;

export type EmbeddingModel = keyof typeof EMBEDDING_DIMENSIONS;
