// =============================================================================
// SEARCH ROUTER
// =============================================================================
//
// API for semantic search and question answering (PRD-06).
//

import {
  calculateInputHash,
  generateQueryEmbedding,
} from "@memorystack/ai/embeddings";

// =============================================================================
// NOTE: Search AI functionality has been moved to Python backend.
// AI-powered search procedures now return migration errors.
// Use Python backend at /api/v1/search for AI-powered search.
// =============================================================================

// AI-powered search types now handled by Python backend at /api/v1/search
import { db } from "@memorystack/db";
import {
  claim,
  claimEmbedding,
  conversation,
  member,
  message,
  messageEmbedding,
  queryEmbeddingCache,
  sourceAccount,
  threadEmbedding,
} from "@memorystack/db/schema";
import { TRPCError } from "@trpc/server";
import {
  and,
  asc,
  desc,
  eq,
  gt,
  gte,
  inArray,
  lte,
  type SQL,
  sql,
} from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";
import { z } from "zod";
import { protectedProcedure, router } from "../index";

// =============================================================================
// VECTOR HELPERS
// =============================================================================

/**
 * Create a cosine distance SQL expression for pgvector.
 * pgvector cannot cast parameterized text values to vector type,
 * so we inject the vector as a raw SQL literal while keeping the column reference.
 *
 * Returns distance (lower = more similar).
 */
function pgCosineDistance(column: PgColumn, embedding: number[]): SQL<number> {
  const vecStr = `'[${embedding.join(",")}]'::vector`;
  // Use sql template to properly reference the column, then raw for the vector
  return sql<number>`${column} <=> ${sql.raw(vecStr)}`;
}

/**
 * Create a cosine similarity SQL expression (1 - distance).
 * Returns similarity score (higher = more similar, 0-1 range).
 */
function pgCosineSimilarity(
  column: PgColumn,
  embedding: number[]
): SQL<number> {
  const vecStr = `'[${embedding.join(",")}]'::vector`;
  return sql<number>`1 - (${column} <=> ${sql.raw(vecStr)})`;
}

// =============================================================================
// INPUT SCHEMAS
// =============================================================================

const searchSchema = z.object({
  organizationId: z.string().min(1),
  query: z.string().min(1).max(1000),
  limit: z.number().int().min(1).max(50).default(20),
  threshold: z.number().min(0).max(1).default(0.5),
  types: z
    .array(z.enum(["message", "thread", "claim"]))
    .optional()
    .default(["message", "thread", "claim"]),
  accountId: z.string().uuid().optional(),
  after: z.date().optional(),
  before: z.date().optional(),
});

const askSchema = z.object({
  organizationId: z.string().min(1),
  question: z.string().min(1).max(2000),
  accountId: z.string().uuid().optional(),
  after: z.date().optional(),
  before: z.date().optional(),
});

const findRelatedSchema = z.object({
  organizationId: z.string().min(1),
  threadId: z.string().uuid(),
  limit: z.number().int().min(1).max(20).default(10),
  threshold: z.number().min(0).max(1).default(0.7),
});

const summarizeTopicSchema = z.object({
  organizationId: z.string().min(1),
  topic: z.string().min(1).max(500),
  accountId: z.string().uuid().optional(),
  after: z.date().optional(),
  before: z.date().optional(),
});

const getInsightsSchema = z.object({
  organizationId: z.string().min(1),
  accountId: z.string().uuid().optional(),
  limit: z.number().int().min(1).max(10).default(5),
});

// =============================================================================
// HELPERS
// =============================================================================

/**
 * Cache TTL for query embeddings (15 minutes).
 */
const QUERY_CACHE_TTL_MS = 15 * 60 * 1000;

/**
 * Get query embedding from cache or generate new one.
 * Caches embeddings for 15 minutes to reduce API calls.
 */
async function getCachedQueryEmbedding(query: string): Promise<number[]> {
  const queryHash = calculateInputHash(query);

  // Check cache first
  const cached = await db.query.queryEmbeddingCache.findFirst({
    where: and(
      eq(queryEmbeddingCache.queryHash, queryHash),
      gt(queryEmbeddingCache.expiresAt, new Date())
    ),
  });

  if (cached?.embedding) {
    // Update hit count
    await db
      .update(queryEmbeddingCache)
      .set({
        hitCount: (cached.hitCount ?? 0) + 1,
        lastUsedAt: new Date(),
      })
      .where(eq(queryEmbeddingCache.id, cached.id));

    return cached.embedding as number[];
  }

  // Generate new embedding
  const embeddingResult = await generateQueryEmbedding(query);
  const expiresAt = new Date(Date.now() + QUERY_CACHE_TTL_MS);

  // Cache it (upsert)
  await db
    .insert(queryEmbeddingCache)
    .values({
      queryHash,
      queryText: query,
      embedding: embeddingResult.embedding,
      model: embeddingResult.model,
      hitCount: 1,
      lastUsedAt: new Date(),
      expiresAt,
    })
    .onConflictDoUpdate({
      target: queryEmbeddingCache.queryHash,
      set: {
        embedding: embeddingResult.embedding,
        model: embeddingResult.model,
        hitCount: 1,
        lastUsedAt: new Date(),
        expiresAt,
      },
    });

  return embeddingResult.embedding;
}

/**
 * Get account IDs for an organization that the user has access to.
 */
async function getAccountIds(
  userId: string,
  organizationId: string,
  specificAccountId?: string
): Promise<string[]> {
  // Verify user membership
  const membership = await db.query.member.findFirst({
    where: and(
      eq(member.userId, userId),
      eq(member.organizationId, organizationId)
    ),
  });

  if (!membership) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Not a member of this organization",
    });
  }

  // Get accounts
  const accounts = await db.query.sourceAccount.findMany({
    where: and(
      eq(sourceAccount.organizationId, organizationId),
      eq(sourceAccount.type, "email")
    ),
    columns: { id: true },
  });

  const accountIds = accounts.map((a) => a.id);

  if (specificAccountId) {
    if (!accountIds.includes(specificAccountId)) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "Account not found in organization",
      });
    }
    return [specificAccountId];
  }

  return accountIds;
}

/**
 * Perform vector similarity search on messages.
 */
async function searchMessages(
  queryEmbedding: number[],
  accountIds: string[],
  options: {
    limit: number;
    threshold: number;
    after?: Date;
    before?: Date;
  }
): Promise<
  Array<{
    id: string;
    score: number;
    content: string;
    metadata: Record<string, unknown>;
  }>
> {
  // Use custom pgvector helpers that inject vector as raw SQL literal
  const distance = pgCosineDistance(messageEmbedding.embedding, queryEmbedding);
  const similarity = pgCosineSimilarity(
    messageEmbedding.embedding,
    queryEmbedding
  );

  // Build conditions
  const conditions = [eq(messageEmbedding.status, "completed")];

  if (accountIds.length > 0) {
    conditions.push(inArray(conversation.sourceAccountId, accountIds));
  }
  if (options.after) {
    conditions.push(gte(message.sentAt, options.after));
  }
  if (options.before) {
    conditions.push(lte(message.sentAt, options.before));
  }

  const results = await db
    .select({
      id: messageEmbedding.messageId,
      score: similarity,
      content: message.bodyText,
      subject: conversation.title,
      sentAt: message.sentAt,
      fromEmail: message.senderEmail,
      threadId: conversation.id,
      threadSubject: conversation.title,
    })
    .from(messageEmbedding)
    .innerJoin(message, eq(messageEmbedding.messageId, message.id))
    .innerJoin(conversation, eq(message.conversationId, conversation.id))
    .where(and(...conditions))
    .orderBy(asc(distance))
    .limit(options.limit);

  // Filter by threshold after query (Drizzle doesn't support computed column in WHERE)
  return results
    .filter((row) => (row.score ?? 0) >= options.threshold)
    .map((row) => ({
      id: row.id,
      score: row.score ?? 0,
      content: row.content ?? "",
      metadata: {
        subject: row.subject,
        sentAt: row.sentAt,
        fromAddress: row.fromEmail,
        threadId: row.threadId,
        threadSubject: row.threadSubject,
      },
    }));
}

/**
 * Perform vector similarity search on threads.
 */
async function searchThreads(
  queryEmbedding: number[],
  accountIds: string[],
  options: {
    limit: number;
    threshold: number;
    after?: Date;
    before?: Date;
  }
): Promise<
  Array<{
    id: string;
    score: number;
    content: string;
    metadata: Record<string, unknown>;
  }>
> {
  const distance = pgCosineDistance(threadEmbedding.embedding, queryEmbedding);
  const similarity = pgCosineSimilarity(
    threadEmbedding.embedding,
    queryEmbedding
  );

  const conditions = [eq(threadEmbedding.status, "completed")];

  if (accountIds.length > 0) {
    conditions.push(inArray(conversation.sourceAccountId, accountIds));
  }
  if (options.after) {
    conditions.push(gte(conversation.lastMessageAt, options.after));
  }
  if (options.before) {
    conditions.push(lte(conversation.lastMessageAt, options.before));
  }

  const results = await db
    .select({
      id: threadEmbedding.conversationId,
      score: similarity,
      subject: conversation.title,
      snippet: conversation.snippet,
      lastMessageAt: conversation.lastMessageAt,
      messageCount: conversation.messageCount,
      briefSummary: conversation.briefSummary,
    })
    .from(threadEmbedding)
    .innerJoin(
      conversation,
      eq(threadEmbedding.conversationId, conversation.id)
    )
    .where(and(...conditions))
    .orderBy(asc(distance))
    .limit(options.limit);

  return results
    .filter((row) => (row.score ?? 0) >= options.threshold)
    .map((row) => ({
      id: row.id,
      score: row.score ?? 0,
      content: `${row.subject ?? ""}\n${row.snippet ?? ""}`,
      metadata: {
        subject: row.subject,
        snippet: row.snippet,
        lastMessageAt: row.lastMessageAt,
        messageCount: row.messageCount,
        briefSummary: row.briefSummary,
      },
    }));
}

/**
 * Perform vector similarity search on claims.
 */
async function searchClaims(
  queryEmbedding: number[],
  accountIds: string[],
  options: {
    limit: number;
    threshold: number;
    after?: Date;
    before?: Date;
  }
): Promise<
  Array<{
    id: string;
    score: number;
    content: string;
    metadata: Record<string, unknown>;
  }>
> {
  const distance = pgCosineDistance(claimEmbedding.embedding, queryEmbedding);
  const similarity = pgCosineSimilarity(
    claimEmbedding.embedding,
    queryEmbedding
  );

  const conditions = [eq(claimEmbedding.status, "completed")];

  if (accountIds.length > 0) {
    conditions.push(inArray(conversation.sourceAccountId, accountIds));
  }
  if (options.after) {
    conditions.push(gte(claim.createdAt, options.after));
  }
  if (options.before) {
    conditions.push(lte(claim.createdAt, options.before));
  }

  const results = await db
    .select({
      id: claimEmbedding.claimId,
      score: similarity,
      text: claim.text,
      claimType: claim.type,
      confidence: claim.confidence,
      conversationId: claim.conversationId,
      conversationTitle: conversation.title,
      createdAt: claim.createdAt,
    })
    .from(claimEmbedding)
    .innerJoin(claim, eq(claimEmbedding.claimId, claim.id))
    .innerJoin(conversation, eq(claim.conversationId, conversation.id))
    .where(and(...conditions))
    .orderBy(asc(distance))
    .limit(options.limit);

  return results
    .filter((row) => (row.score ?? 0) >= options.threshold)
    .map((row) => ({
      id: row.id,
      score: row.score ?? 0,
      content: row.text ?? "",
      metadata: {
        claimType: row.claimType,
        confidence: row.confidence,
        threadId: row.conversationId,
        threadSubject: row.conversationTitle,
        createdAt: row.createdAt,
      },
    }));
}

// =============================================================================
// ROUTER
// =============================================================================

export const searchRouter = router({
  /**
   * Semantic search across messages, threads, and claims.
   */
  search: protectedProcedure
    .input(searchSchema)
    .query(async ({ ctx, input }) => {
      const accountIds = await getAccountIds(
        ctx.session.user.id,
        input.organizationId,
        input.accountId
      );

      if (accountIds.length === 0) {
        return { results: [], total: 0 };
      }

      // Get cached or generate query embedding
      const queryEmbedding = await getCachedQueryEmbedding(input.query);

      const searchOptions = {
        limit: input.limit,
        threshold: input.threshold,
        after: input.after,
        before: input.before,
      };

      // Search each type in parallel
      const [messageResults, threadResults, claimResults] = await Promise.all([
        input.types.includes("message")
          ? searchMessages(queryEmbedding, accountIds, searchOptions)
          : [],
        input.types.includes("thread")
          ? searchThreads(queryEmbedding, accountIds, searchOptions)
          : [],
        input.types.includes("claim")
          ? searchClaims(queryEmbedding, accountIds, searchOptions)
          : [],
      ]);

      // Combine and sort results
      const allResults = [
        ...messageResults.map((r) => ({ ...r, type: "message" as const })),
        ...threadResults.map((r) => ({ ...r, type: "thread" as const })),
        ...claimResults.map((r) => ({ ...r, type: "claim" as const })),
      ].sort((a, b) => b.score - a.score);

      return {
        results: allResults.slice(0, input.limit),
        total: allResults.length,
      };
    }),

  /**
   * Ask a question and get an answer with citations.
   */
  ask: protectedProcedure
    .input(askSchema)
    .output(
      z.object({
        answer: z.string(),
        citations: z.array(
          z.object({
            id: z.string(),
            text: z.string(),
            sourceType: z.string(),
            sourceId: z.string(),
            relevanceScore: z.number().optional(),
          })
        ),
        confidence: z.number(),
        sources: z.array(
          z.object({
            id: z.string(),
            type: z.string(),
            title: z.string().optional(),
          })
        ),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const accountIds = await getAccountIds(
        ctx.session.user.id,
        input.organizationId,
        input.accountId
      );

      if (accountIds.length === 0) {
        return {
          answer: "No email accounts found to search.",
          citations: [],
          confidence: 0,
          sources: [],
        };
      }

      // NOTE: AI-powered search/ask has been migrated to Python backend
      // Use Python backend at /api/v1/search for AI-powered search
      throw new TRPCError({
        code: "NOT_IMPLEMENTED",
        message:
          "AI-powered search functionality is being migrated to Python backend. " +
          "Use /api/v1/search endpoint directly.",
      });
    }),

  /**
   * Find threads related to a given thread.
   */
  findRelated: protectedProcedure
    .input(findRelatedSchema)
    .query(async ({ ctx, input }) => {
      const accountIds = await getAccountIds(
        ctx.session.user.id,
        input.organizationId
      );

      // Get the source thread's embedding
      const sourceEmbedding = await db.query.threadEmbedding.findFirst({
        where: eq(threadEmbedding.conversationId, input.threadId),
      });

      if (!sourceEmbedding?.embedding) {
        return { relatedThreads: [] };
      }

      const sourceVector = sourceEmbedding.embedding as number[];
      const distance = pgCosineDistance(
        threadEmbedding.embedding,
        sourceVector
      );
      const similarity = pgCosineSimilarity(
        threadEmbedding.embedding,
        sourceVector
      );

      const conditions = [
        eq(threadEmbedding.status, "completed"),
        sql`${threadEmbedding.conversationId} != ${input.threadId}`,
      ];

      if (accountIds.length > 0) {
        conditions.push(inArray(conversation.sourceAccountId, accountIds));
      }

      const results = await db
        .select({
          id: threadEmbedding.conversationId,
          score: similarity,
          subject: conversation.title,
          snippet: conversation.snippet,
          lastMessageAt: conversation.lastMessageAt,
          messageCount: conversation.messageCount,
        })
        .from(threadEmbedding)
        .innerJoin(
          conversation,
          eq(threadEmbedding.conversationId, conversation.id)
        )
        .where(and(...conditions))
        .orderBy(asc(distance))
        .limit(input.limit);

      return {
        relatedThreads: results
          .filter((row) => (row.score ?? 0) >= input.threshold)
          .map((row) => ({
            id: row.id,
            similarity: row.score ?? 0,
            subject: row.subject ?? "",
            snippet: row.snippet,
            lastMessageAt: row.lastMessageAt,
            messageCount: row.messageCount ?? 0,
          })),
      };
    }),

  /**
   * Get a summary of a topic across all emails.
   */
  summarizeTopic: protectedProcedure
    .input(summarizeTopicSchema)
    .output(
      z.object({
        topic: z.string(),
        summary: z.string(),
        keyPoints: z.array(z.string()),
        timeline: z.array(
          z.object({
            date: z.date(),
            event: z.string(),
            sourceId: z.string().optional(),
          })
        ),
        participants: z.array(z.string()),
        status: z.enum(["active", "resolved", "stale"]),
        relatedTopics: z.array(z.string()),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const accountIds = await getAccountIds(
        ctx.session.user.id,
        input.organizationId,
        input.accountId
      );

      if (accountIds.length === 0) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "No email accounts found",
        });
      }

      // Get cached or generate query embedding
      const queryEmbedding = await getCachedQueryEmbedding(input.topic);

      // Search for relevant messages
      const messageResults = await searchMessages(queryEmbedding, accountIds, {
        limit: 30,
        threshold: 0.6,
        after: input.after,
        before: input.before,
      });

      if (messageResults.length === 0) {
        return {
          topic: input.topic,
          summary: "No relevant emails found for this topic.",
          keyPoints: [],
          timeline: [],
          participants: [],
          status: "stale" as const,
          relatedTopics: [],
        };
      }

      // Get full message details
      const messageIds = messageResults.map((r) => r.id);
      const messages = await db.query.message.findMany({
        where: inArray(message.id, messageIds),
        with: {
          conversation: {
            columns: { id: true, title: true },
          },
        },
      });

      // Prepare evidence for knowledge agent
      const evidence = messages.map((m) => ({
        id: m.id,
        content: m.bodyText ?? m.snippet ?? "",
        threadId: m.conversationId,
        threadSubject: m.conversation?.title ?? "",
        date: m.sentAt ?? new Date(),
        participants: ((m.recipients as Array<{ email: string }>) ?? []).map(
          (p) => p.email
        ),
      }));

      // NOTE: AI-powered topic summarization has been migrated to Python backend
      // Evidence kept for future Python backend integration
      void evidence;
      throw new TRPCError({
        code: "NOT_IMPLEMENTED",
        message:
          "AI-powered topic summarization is being migrated to Python backend. " +
          "Use /api/v1/memory/search endpoint directly.",
      });
    }),

  /**
   * Get proactive insights based on patterns.
   */
  getInsights: protectedProcedure
    .input(getInsightsSchema)
    .output(
      z.object({
        insights: z.array(
          z.object({
            type: z.string(),
            title: z.string(),
            description: z.string(),
            confidence: z.number().optional(),
            relatedIds: z.array(z.string()).optional(),
          })
        ),
        patternCount: z.number().optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      const accountIds = await getAccountIds(
        ctx.session.user.id,
        input.organizationId,
        input.accountId
      );

      if (accountIds.length === 0) {
        return { insights: [] };
      }

      // Get recent claims for pattern detection
      const recentClaims = await db.query.claim.findMany({
        where: and(
          inArray(
            claim.conversationId,
            db
              .select({ id: conversation.id })
              .from(conversation)
              .where(inArray(conversation.sourceAccountId, accountIds))
          ),
          gte(claim.createdAt, new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)) // Last 30 days
        ),
        orderBy: [desc(claim.createdAt)],
        limit: 100,
      });

      if (recentClaims.length < 5) {
        return { insights: [] };
      }

      // Fetch embeddings for these claims
      const claimIds = recentClaims.map((c) => c.id);
      const embeddings = await db.query.claimEmbedding.findMany({
        where: and(
          inArray(claimEmbedding.claimId, claimIds),
          eq(claimEmbedding.status, "completed")
        ),
      });

      // Create a map of claimId -> embedding
      const embeddingMap = new Map(
        embeddings.map((e) => [e.claimId, e.embedding as number[]])
      );

      // Filter claims with embeddings
      const claimsWithEmbeddings = recentClaims.filter((c) =>
        embeddingMap.has(c.id)
      );

      if (claimsWithEmbeddings.length < 5) {
        return { insights: [] };
      }

      // NOTE: AI-powered insights has been migrated to Python backend
      throw new TRPCError({
        code: "NOT_IMPLEMENTED",
        message:
          "AI-powered insights generation is being migrated to Python backend. " +
          "Use /api/v1/graph/query endpoint for pattern analysis.",
      });
    }),
});

export type SearchRouter = typeof searchRouter;
