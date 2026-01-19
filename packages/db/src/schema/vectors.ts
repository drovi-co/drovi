import { randomUUID } from "node:crypto";
import { relations } from "drizzle-orm";
import {
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  vector,
} from "drizzle-orm/pg-core";
import { emailMessage, emailThread } from "./email";
import { claim } from "./intelligence";
import { conversation, message } from "./sources";

// =============================================================================
// CONSTANTS
// =============================================================================

/**
 * Default embedding dimensions for OpenAI text-embedding-3-small
 */
export const DEFAULT_EMBEDDING_DIMENSIONS = 1536;

// =============================================================================
// ENUMS
// =============================================================================

export const threadEmbeddingAggregationEnum = pgEnum(
  "thread_embedding_aggregation",
  ["mean", "first", "weighted", "max_pool", "cls"]
);

export const embeddingStatusEnum = pgEnum("embedding_status", [
  "pending",
  "processing",
  "completed",
  "failed",
]);

// =============================================================================
// MESSAGE EMBEDDING TABLE
// =============================================================================

/**
 * Stores vector embeddings for individual email messages.
 * Used for semantic search within and across threads.
 *
 * Index recommendation:
 * CREATE INDEX ON message_embedding USING hnsw (embedding vector_cosine_ops)
 *   WITH (m = 16, ef_construction = 64);
 */
export const messageEmbedding = pgTable(
  "message_embedding",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => randomUUID()),
    messageId: text("message_id")
      .notNull()
      .references(() => emailMessage.id, { onDelete: "cascade" })
      .unique(),

    // Vector embedding
    embedding: vector("embedding", {
      dimensions: DEFAULT_EMBEDDING_DIMENSIONS,
    }).notNull(),

    // Model metadata
    model: text("model").notNull(), // e.g., 'text-embedding-3-small'
    modelVersion: text("model_version"),

    // Token info for cost tracking
    tokenCount: integer("token_count"),

    // Input hash for detecting re-embedding needs
    inputHash: text("input_hash"),

    // Processing status
    status: embeddingStatusEnum("status").default("completed"),
    errorMessage: text("error_message"),

    // Timestamps
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index("message_embedding_message_idx").on(table.messageId),
    index("message_embedding_model_idx").on(table.model),
    index("message_embedding_status_idx").on(table.status),
    // Note: HNSW index should be created via migration for vector column
    // Example: CREATE INDEX message_embedding_vector_idx ON message_embedding
    //          USING hnsw (embedding vector_cosine_ops) WITH (m = 16, ef_construction = 64);
  ]
);

// =============================================================================
// THREAD EMBEDDING TABLE
// =============================================================================

/**
 * Stores aggregated vector embeddings for email threads.
 * Enables thread-level semantic search and similarity.
 *
 * Index recommendation:
 * CREATE INDEX ON thread_embedding USING hnsw (embedding vector_cosine_ops)
 *   WITH (m = 16, ef_construction = 64);
 */
export const threadEmbedding = pgTable(
  "thread_embedding",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => randomUUID()),
    threadId: text("thread_id")
      .notNull()
      .references(() => emailThread.id, { onDelete: "cascade" })
      .unique(),

    // Vector embedding
    embedding: vector("embedding", {
      dimensions: DEFAULT_EMBEDDING_DIMENSIONS,
    }).notNull(),

    // Aggregation method used
    aggregationMethod: threadEmbeddingAggregationEnum("aggregation_method")
      .notNull()
      .default("mean"),

    // Model metadata
    model: text("model").notNull(),
    modelVersion: text("model_version"),

    // Stats about aggregation
    messageCount: integer("message_count").notNull(),
    totalTokens: integer("total_tokens"),

    // Input hash for detecting re-embedding needs
    inputHash: text("input_hash"),

    // Processing status
    status: embeddingStatusEnum("status").default("completed"),
    errorMessage: text("error_message"),

    // Timestamps
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index("thread_embedding_thread_idx").on(table.threadId),
    index("thread_embedding_model_idx").on(table.model),
    index("thread_embedding_status_idx").on(table.status),
  ]
);

// =============================================================================
// CONVERSATION EMBEDDING TABLE (Multi-source: WhatsApp, Slack, etc.)
// =============================================================================

/**
 * Stores vector embeddings for multi-source conversations.
 * Used for semantic search across WhatsApp, Slack, Calendar, etc.
 *
 * Index recommendation:
 * CREATE INDEX ON conversation_embedding USING hnsw (embedding vector_cosine_ops)
 *   WITH (m = 16, ef_construction = 64);
 */
export const conversationEmbedding = pgTable(
  "conversation_embedding",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => randomUUID()),
    conversationId: text("conversation_id")
      .notNull()
      .references(() => conversation.id, { onDelete: "cascade" })
      .unique(),

    // Vector embedding
    embedding: vector("embedding", {
      dimensions: DEFAULT_EMBEDDING_DIMENSIONS,
    }).notNull(),

    // Aggregation method used
    aggregationMethod: threadEmbeddingAggregationEnum("aggregation_method")
      .notNull()
      .default("mean"),

    // Model metadata
    model: text("model").notNull(),
    modelVersion: text("model_version"),

    // Stats about aggregation
    messageCount: integer("message_count").notNull(),
    totalTokens: integer("total_tokens"),

    // Input hash for detecting re-embedding needs
    inputHash: text("input_hash"),

    // Processing status
    status: embeddingStatusEnum("status").default("completed"),
    errorMessage: text("error_message"),

    // Timestamps
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index("conversation_embedding_conv_idx").on(table.conversationId),
    index("conversation_embedding_model_idx").on(table.model),
    index("conversation_embedding_status_idx").on(table.status),
  ]
);

// =============================================================================
// GENERIC MESSAGE EMBEDDING TABLE (Multi-source messages)
// =============================================================================

/**
 * Stores vector embeddings for individual messages from multi-source conversations.
 * Used for semantic search within WhatsApp, Slack, Calendar, etc.
 *
 * Index recommendation:
 * CREATE INDEX ON generic_message_embedding USING hnsw (embedding vector_cosine_ops)
 *   WITH (m = 16, ef_construction = 64);
 */
export const genericMessageEmbedding = pgTable(
  "generic_message_embedding",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => randomUUID()),
    messageId: text("message_id")
      .notNull()
      .references(() => message.id, { onDelete: "cascade" })
      .unique(),

    // Vector embedding
    embedding: vector("embedding", {
      dimensions: DEFAULT_EMBEDDING_DIMENSIONS,
    }).notNull(),

    // Model metadata
    model: text("model").notNull(),
    modelVersion: text("model_version"),

    // Token info for cost tracking
    tokenCount: integer("token_count"),

    // Input hash for detecting re-embedding needs
    inputHash: text("input_hash"),

    // Processing status
    status: embeddingStatusEnum("status").default("completed"),
    errorMessage: text("error_message"),

    // Timestamps
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index("generic_message_embedding_msg_idx").on(table.messageId),
    index("generic_message_embedding_model_idx").on(table.model),
    index("generic_message_embedding_status_idx").on(table.status),
  ]
);

// =============================================================================
// CLAIM EMBEDDING TABLE
// =============================================================================

/**
 * Stores vector embeddings for extracted claims.
 * Enables semantic search over claims, decisions, and commitments.
 *
 * Index recommendation:
 * CREATE INDEX ON claim_embedding USING hnsw (embedding vector_cosine_ops)
 *   WITH (m = 16, ef_construction = 64);
 */
export const claimEmbedding = pgTable(
  "claim_embedding",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => randomUUID()),
    claimId: text("claim_id")
      .notNull()
      .references(() => claim.id, { onDelete: "cascade" })
      .unique(),

    // Vector embedding
    embedding: vector("embedding", {
      dimensions: DEFAULT_EMBEDDING_DIMENSIONS,
    }).notNull(),

    // Model metadata
    model: text("model").notNull(),
    modelVersion: text("model_version"),

    // Token info
    tokenCount: integer("token_count"),

    // Input hash
    inputHash: text("input_hash"),

    // Processing status
    status: embeddingStatusEnum("status").default("completed"),
    errorMessage: text("error_message"),

    // Timestamps
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("claim_embedding_claim_idx").on(table.claimId),
    index("claim_embedding_model_idx").on(table.model),
    index("claim_embedding_status_idx").on(table.status),
  ]
);

// =============================================================================
// QUERY EMBEDDING CACHE TABLE (Optional optimization)
// =============================================================================

/**
 * Caches embeddings for frequently used queries.
 * Reduces API calls and improves response time.
 */
export const queryEmbeddingCache = pgTable(
  "query_embedding_cache",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => randomUUID()),

    // Query text (hashed for lookup)
    queryHash: text("query_hash").notNull().unique(),
    queryText: text("query_text").notNull(),

    // Vector embedding
    embedding: vector("embedding", {
      dimensions: DEFAULT_EMBEDDING_DIMENSIONS,
    }).notNull(),

    // Model metadata
    model: text("model").notNull(),

    // Usage tracking
    hitCount: integer("hit_count").notNull().default(1),
    lastUsedAt: timestamp("last_used_at").defaultNow().notNull(),

    // TTL
    expiresAt: timestamp("expires_at"),

    // Timestamps
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("query_embedding_cache_hash_idx").on(table.queryHash),
    index("query_embedding_cache_expires_idx").on(table.expiresAt),
    index("query_embedding_cache_last_used_idx").on(table.lastUsedAt),
  ]
);

// =============================================================================
// RELATIONS
// =============================================================================

export const messageEmbeddingRelations = relations(
  messageEmbedding,
  ({ one }) => ({
    message: one(emailMessage, {
      fields: [messageEmbedding.messageId],
      references: [emailMessage.id],
    }),
  })
);

export const threadEmbeddingRelations = relations(
  threadEmbedding,
  ({ one }) => ({
    thread: one(emailThread, {
      fields: [threadEmbedding.threadId],
      references: [emailThread.id],
    }),
  })
);

export const claimEmbeddingRelations = relations(claimEmbedding, ({ one }) => ({
  claim: one(claim, {
    fields: [claimEmbedding.claimId],
    references: [claim.id],
  }),
}));

export const conversationEmbeddingRelations = relations(
  conversationEmbedding,
  ({ one }) => ({
    conversation: one(conversation, {
      fields: [conversationEmbedding.conversationId],
      references: [conversation.id],
    }),
  })
);

export const genericMessageEmbeddingRelations = relations(
  genericMessageEmbedding,
  ({ one }) => ({
    message: one(message, {
      fields: [genericMessageEmbedding.messageId],
      references: [message.id],
    }),
  })
);

// =============================================================================
// TYPE EXPORTS
// =============================================================================

export type MessageEmbedding = typeof messageEmbedding.$inferSelect;
export type NewMessageEmbedding = typeof messageEmbedding.$inferInsert;
export type ThreadEmbedding = typeof threadEmbedding.$inferSelect;
export type NewThreadEmbedding = typeof threadEmbedding.$inferInsert;
export type ClaimEmbedding = typeof claimEmbedding.$inferSelect;
export type NewClaimEmbedding = typeof claimEmbedding.$inferInsert;
export type QueryEmbeddingCache = typeof queryEmbeddingCache.$inferSelect;
export type NewQueryEmbeddingCache = typeof queryEmbeddingCache.$inferInsert;
export type ConversationEmbedding = typeof conversationEmbedding.$inferSelect;
export type NewConversationEmbedding = typeof conversationEmbedding.$inferInsert;
export type GenericMessageEmbedding = typeof genericMessageEmbedding.$inferSelect;
export type NewGenericMessageEmbedding = typeof genericMessageEmbedding.$inferInsert;
