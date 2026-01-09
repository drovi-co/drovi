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
} from "@saas-template/ai/agents";
import { generateQueryEmbedding } from "@saas-template/ai/embeddings";
import { db } from "@saas-template/db";
import {
  claim,
  emailAccount,
  emailMessage,
  emailThread,
  member,
  threadEmbedding,
} from "@saas-template/db/schema";
import { TRPCError } from "@trpc/server";
import { and, desc, eq, gte, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { protectedProcedure, router } from "../index";

// =============================================================================
// INPUT SCHEMAS
// =============================================================================

const searchSchema = z.object({
  organizationId: z.string().uuid(),
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
  organizationId: z.string().uuid(),
  question: z.string().min(1).max(2000),
  accountId: z.string().uuid().optional(),
  after: z.date().optional(),
  before: z.date().optional(),
});

const findRelatedSchema = z.object({
  organizationId: z.string().uuid(),
  threadId: z.string().uuid(),
  limit: z.number().int().min(1).max(20).default(10),
  threshold: z.number().min(0).max(1).default(0.7),
});

const summarizeTopicSchema = z.object({
  organizationId: z.string().uuid(),
  topic: z.string().min(1).max(500),
  accountId: z.string().uuid().optional(),
  after: z.date().optional(),
  before: z.date().optional(),
});

const getInsightsSchema = z.object({
  organizationId: z.string().uuid(),
  accountId: z.string().uuid().optional(),
  limit: z.number().int().min(1).max(10).default(5),
});

// =============================================================================
// HELPERS
// =============================================================================

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
  // Use pgvector cosine similarity
  const results = await db.execute(sql`
    SELECT
      me.message_id as id,
      1 - (me.embedding <=> ${JSON.stringify(queryEmbedding)}::vector) as score,
      em.body_text as content,
      em.subject,
      em.sent_at,
      em.from_address,
      et.id as thread_id,
      et.subject as thread_subject
    FROM message_embedding me
    JOIN email_message em ON me.message_id = em.id
    JOIN email_thread et ON em.thread_id = et.id
    WHERE
      et.account_id = ANY(${accountIds}::text[])
      AND me.status = 'completed'
      ${options.after ? sql`AND em.sent_at >= ${options.after}` : sql``}
      ${options.before ? sql`AND em.sent_at <= ${options.before}` : sql``}
      AND 1 - (me.embedding <=> ${JSON.stringify(queryEmbedding)}::vector) >= ${options.threshold}
    ORDER BY me.embedding <=> ${JSON.stringify(queryEmbedding)}::vector
    LIMIT ${options.limit}
  `);

  return (results.rows as Array<Record<string, unknown>>).map((row) => ({
    id: row.id as string,
    score: row.score as number,
    content: row.content as string,
    metadata: {
      subject: row.subject,
      sentAt: row.sent_at,
      fromAddress: row.from_address,
      threadId: row.thread_id,
      threadSubject: row.thread_subject,
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
  const results = await db.execute(sql`
    SELECT
      te.thread_id as id,
      1 - (te.embedding <=> ${JSON.stringify(queryEmbedding)}::vector) as score,
      et.subject as content,
      et.snippet,
      et.last_message_at,
      et.message_count,
      et.brief_summary
    FROM thread_embedding te
    JOIN email_thread et ON te.thread_id = et.id
    WHERE
      et.account_id = ANY(${accountIds}::text[])
      AND te.status = 'completed'
      ${options.after ? sql`AND et.last_message_at >= ${options.after}` : sql``}
      ${options.before ? sql`AND et.last_message_at <= ${options.before}` : sql``}
      AND 1 - (te.embedding <=> ${JSON.stringify(queryEmbedding)}::vector) >= ${options.threshold}
    ORDER BY te.embedding <=> ${JSON.stringify(queryEmbedding)}::vector
    LIMIT ${options.limit}
  `);

  return (results.rows as Array<Record<string, unknown>>).map((row) => ({
    id: row.id as string,
    score: row.score as number,
    content: `${row.content ?? ""}\n${row.snippet ?? ""}`,
    metadata: {
      subject: row.content,
      snippet: row.snippet,
      lastMessageAt: row.last_message_at,
      messageCount: row.message_count,
      briefSummary: row.brief_summary,
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
  const results = await db.execute(sql`
    SELECT
      ce.claim_id as id,
      1 - (ce.embedding <=> ${JSON.stringify(queryEmbedding)}::vector) as score,
      c.content,
      c.type as claim_type,
      c.confidence,
      c.thread_id,
      et.subject as thread_subject,
      c.created_at
    FROM claim_embedding ce
    JOIN claim c ON ce.claim_id = c.id
    JOIN email_thread et ON c.thread_id = et.id
    WHERE
      et.account_id = ANY(${accountIds}::text[])
      AND ce.status = 'completed'
      ${options.after ? sql`AND c.created_at >= ${options.after}` : sql``}
      ${options.before ? sql`AND c.created_at <= ${options.before}` : sql``}
      AND 1 - (ce.embedding <=> ${JSON.stringify(queryEmbedding)}::vector) >= ${options.threshold}
    ORDER BY ce.embedding <=> ${JSON.stringify(queryEmbedding)}::vector
    LIMIT ${options.limit}
  `);

  return (results.rows as Array<Record<string, unknown>>).map((row) => ({
    id: row.id as string,
    score: row.score as number,
    content: row.content as string,
    metadata: {
      claimType: row.claim_type,
      confidence: row.confidence,
      threadId: row.thread_id,
      threadSubject: row.thread_subject,
      createdAt: row.created_at,
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

      // Generate query embedding
      const embeddingResult = await generateQueryEmbedding(input.query);
      const queryEmbedding = embeddingResult.embedding;

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

      if (!sourceEmbedding) {
        return { relatedThreads: [] };
      }

      // Find similar threads
      const results = await db.execute(sql`
        SELECT
          te.thread_id as id,
          1 - (te.embedding <=> ${JSON.stringify(sourceEmbedding.embedding)}::vector) as score,
          et.subject,
          et.snippet,
          et.last_message_at,
          et.message_count
        FROM thread_embedding te
        JOIN email_thread et ON te.thread_id = et.id
        WHERE
          et.account_id = ANY(${accountIds}::text[])
          AND te.thread_id != ${input.threadId}
          AND te.status = 'completed'
          AND 1 - (te.embedding <=> ${JSON.stringify(sourceEmbedding.embedding)}::vector) >= ${input.threshold}
        ORDER BY te.embedding <=> ${JSON.stringify(sourceEmbedding.embedding)}::vector
        LIMIT ${input.limit}
      `);

      return {
        relatedThreads: (results.rows as Array<Record<string, unknown>>).map(
          (row) => ({
            id: row.id as string,
            similarity: row.score as number,
            subject: row.subject as string,
            snippet: row.snippet as string | null,
            lastMessageAt: row.last_message_at as Date,
            messageCount: row.message_count as number,
          })
        ),
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

      // Generate query embedding
      const embeddingResult = await generateQueryEmbedding(input.topic);
      const queryEmbedding = embeddingResult.embedding;

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
        participants: m.participants.map((p) => p.address),
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
        with: {
          claimEmbedding: true,
        },
      });

      // Filter claims with embeddings
      const claimsWithEmbeddings = recentClaims.filter(
        (c) => c.claimEmbedding?.status === "completed"
      );

      if (claimsWithEmbeddings.length < 5) {
        return { insights: [] };
      }

      const knowledgeAgent = createKnowledgeAgent();

      // Detect patterns
      const patternInputs = claimsWithEmbeddings.map((c) => ({
        id: c.id,
        content: c.content,
        embedding: c.claimEmbedding?.embedding as number[],
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
        content: c.content,
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
