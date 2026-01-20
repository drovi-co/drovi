// =============================================================================
// SEARCH ROUTER
// =============================================================================
//
// API for semantic search and question answering (PRD-06).
//

import {
  createKnowledgeAgent,
  createSearchAgent,
  type EvidenceItem,
  type ParsedQuery,
} from "@memorystack/ai/agents";
import {
  calculateInputHash,
  generateQueryEmbedding,
} from "@memorystack/ai/embeddings";
import { db } from "@memorystack/db";
import {
  claim,
  claimEmbedding,
  emailAccount,
  emailMessage,
  emailThread,
  member,
  messageEmbedding,
  queryEmbeddingCache,
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
  const accounts = await db.query.emailAccount.findMany({
    where: eq(emailAccount.organizationId, organizationId),
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
    conditions.push(inArray(emailThread.accountId, accountIds));
  }
  if (options.after) {
    conditions.push(gte(emailMessage.sentAt, options.after));
  }
  if (options.before) {
    conditions.push(lte(emailMessage.sentAt, options.before));
  }

  const results = await db
    .select({
      id: messageEmbedding.messageId,
      score: similarity,
      content: emailMessage.bodyText,
      subject: emailMessage.subject,
      sentAt: emailMessage.sentAt,
      fromEmail: emailMessage.fromEmail,
      threadId: emailThread.id,
      threadSubject: emailThread.subject,
    })
    .from(messageEmbedding)
    .innerJoin(emailMessage, eq(messageEmbedding.messageId, emailMessage.id))
    .innerJoin(emailThread, eq(emailMessage.threadId, emailThread.id))
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
    conditions.push(inArray(emailThread.accountId, accountIds));
  }
  if (options.after) {
    conditions.push(gte(emailThread.lastMessageAt, options.after));
  }
  if (options.before) {
    conditions.push(lte(emailThread.lastMessageAt, options.before));
  }

  const results = await db
    .select({
      id: threadEmbedding.threadId,
      score: similarity,
      subject: emailThread.subject,
      snippet: emailThread.snippet,
      lastMessageAt: emailThread.lastMessageAt,
      messageCount: emailThread.messageCount,
      briefSummary: emailThread.briefSummary,
    })
    .from(threadEmbedding)
    .innerJoin(emailThread, eq(threadEmbedding.threadId, emailThread.id))
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
    conditions.push(inArray(emailThread.accountId, accountIds));
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
      threadId: claim.threadId,
      threadSubject: emailThread.subject,
      createdAt: claim.createdAt,
    })
    .from(claimEmbedding)
    .innerJoin(claim, eq(claimEmbedding.claimId, claim.id))
    .innerJoin(emailThread, eq(claim.threadId, emailThread.id))
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
        threadId: row.threadId,
        threadSubject: row.threadSubject,
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
  ask: protectedProcedure.input(askSchema).mutation(async ({ ctx, input }) => {
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

    const searchAgent = createSearchAgent();

    // Use the agent's search and answer pipeline
    const result = await searchAgent.searchAndAnswer(
      input.question,
      async (_parsedQuery: ParsedQuery, queryEmbedding: number[]) => {
        const searchOptions = {
          limit: 20,
          threshold: 0.5,
          after: input.after,
          before: input.before,
        };

        // Search all types
        const [messageResults, claimResults] = await Promise.all([
          searchMessages(queryEmbedding, accountIds, searchOptions),
          searchClaims(queryEmbedding, accountIds, searchOptions),
        ]);

        // Convert to EvidenceItem format
        const evidence: EvidenceItem[] = [
          ...messageResults.map((r) => ({
            id: r.id,
            type: "message" as const,
            content: r.content ?? "",
            metadata: {
              threadId: r.metadata.threadId as string | undefined,
              threadSubject: r.metadata.threadSubject as string | undefined,
              messageDate: r.metadata.sentAt
                ? new Date(r.metadata.sentAt as string)
                : undefined,
              sender: r.metadata.fromAddress as string | undefined,
            },
            relevanceScore: r.score,
          })),
          ...claimResults.map((r) => ({
            id: r.id,
            type: "claim" as const,
            content: r.content ?? "",
            metadata: {
              threadId: r.metadata.threadId as string | undefined,
              threadSubject: r.metadata.threadSubject as string | undefined,
              claimType: r.metadata.claimType as string | undefined,
              confidence: r.metadata.confidence as number | undefined,
            },
            relevanceScore: r.score,
          })),
        ];

        // Sort by relevance and take top results
        return evidence
          .sort((a, b) => b.relevanceScore - a.relevanceScore)
          .slice(0, 10);
      }
    );

    return result;
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
        where: eq(threadEmbedding.threadId, input.threadId),
      });

      if (!(sourceEmbedding && sourceEmbedding.embedding)) {
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
        sql`${threadEmbedding.threadId} != ${input.threadId}`,
      ];

      if (accountIds.length > 0) {
        conditions.push(inArray(emailThread.accountId, accountIds));
      }

      const results = await db
        .select({
          id: threadEmbedding.threadId,
          score: similarity,
          subject: emailThread.subject,
          snippet: emailThread.snippet,
          lastMessageAt: emailThread.lastMessageAt,
          messageCount: emailThread.messageCount,
        })
        .from(threadEmbedding)
        .innerJoin(emailThread, eq(threadEmbedding.threadId, emailThread.id))
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
      const messages = await db.query.emailMessage.findMany({
        where: inArray(emailMessage.id, messageIds),
        with: {
          thread: {
            columns: { id: true, subject: true },
          },
          participants: true,
        },
      });

      // Prepare evidence for knowledge agent
      const evidence = messages.map((m) => ({
        id: m.id,
        content: m.bodyText ?? m.snippet ?? "",
        threadId: m.threadId,
        threadSubject: m.thread?.subject ?? "",
        date: m.sentAt ?? new Date(),
        participants: m.participants.map((p) => p.email),
      }));

      const knowledgeAgent = createKnowledgeAgent();
      const summary = await knowledgeAgent.summarizeTopic(
        input.topic,
        evidence
      );

      return summary;
    }),

  /**
   * Get proactive insights based on patterns.
   */
  getInsights: protectedProcedure
    .input(getInsightsSchema)
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
            claim.threadId,
            db
              .select({ id: emailThread.id })
              .from(emailThread)
              .where(inArray(emailThread.accountId, accountIds))
          ),
          gte(claim.createdAt, new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)) // Last 30 days
        ),
        orderBy: desc(claim.createdAt),
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

      const knowledgeAgent = createKnowledgeAgent();

      // Detect patterns
      const patternInputs = claimsWithEmbeddings.map((c) => ({
        id: c.id,
        content: c.text,
        embedding: embeddingMap.get(c.id) as number[],
        metadata: {
          date: c.createdAt,
          threadId: c.threadId ?? "",
          threadSubject: "",
          participants: [],
          type: c.type,
        },
      }));

      const clusters = knowledgeAgent.detectPatterns(patternInputs);

      // Analyze patterns
      const patterns = await Promise.all(
        Array.from(clusters.entries())
          .slice(0, 5)
          .map(([id, items]) => knowledgeAgent.analyzePattern(id, items))
      );

      // Generate insights
      const recentActivity = claimsWithEmbeddings.slice(0, 10).map((c) => ({
        type: c.type,
        content: c.text,
        date: c.createdAt,
      }));

      const insights = await knowledgeAgent.generateInsights(
        patterns,
        recentActivity
      );

      return {
        insights: insights.slice(0, input.limit),
        patternCount: patterns.length,
      };
    }),
});

export type SearchRouter = typeof searchRouter;
