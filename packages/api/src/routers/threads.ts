// =============================================================================
// THREADS ROUTER
// =============================================================================
//
// API for accessing thread intelligence from the Thread Understanding Agent.
//

import { db } from "@saas-template/db";
import {
  claim,
  emailAccount,
  emailThread,
  member,
} from "@saas-template/db/schema";
import { TRPCError } from "@trpc/server";
import { and, desc, eq, gte, inArray, lte, or, sql } from "drizzle-orm";
import { z } from "zod";
import { protectedProcedure, router } from "../index";

// =============================================================================
// INPUT SCHEMAS
// =============================================================================

const listThreadsSchema = z.object({
  organizationId: z.string().uuid(),
  accountId: z.string().uuid().optional(),
  limit: z.number().int().min(1).max(100).default(50),
  offset: z.number().int().min(0).default(0),
  // Filters
  hasOpenLoops: z.boolean().optional(),
  priorityTier: z.enum(["urgent", "high", "medium", "low"]).optional(),
  intentClassification: z.string().optional(),
  isUnread: z.boolean().optional(),
  search: z.string().optional(),
  // Date range
  after: z.date().optional(),
  before: z.date().optional(),
});

const getThreadSchema = z.object({
  organizationId: z.string().uuid(),
  threadId: z.string().uuid(),
});

const getThreadClaimsSchema = z.object({
  organizationId: z.string().uuid(),
  threadId: z.string().uuid(),
  type: z
    .enum([
      "fact",
      "promise",
      "request",
      "question",
      "decision",
      "opinion",
      "deadline",
      "price",
      "contact_info",
      "reference",
      "action_item",
    ])
    .optional(),
  minConfidence: z.number().min(0).max(1).optional(),
});

const updateClaimSchema = z.object({
  organizationId: z.string().uuid(),
  claimId: z.string().uuid(),
  // User verification
  isUserVerified: z.boolean().optional(),
  isUserDismissed: z.boolean().optional(),
  // User corrections
  userCorrectedText: z.string().optional(),
  userCorrectedType: z
    .enum([
      "fact",
      "promise",
      "request",
      "question",
      "decision",
      "opinion",
      "deadline",
      "price",
      "contact_info",
      "reference",
      "action_item",
    ])
    .optional(),
});

const triggerAnalysisSchema = z.object({
  organizationId: z.string().uuid(),
  threadId: z.string().uuid(),
  force: z.boolean().default(false),
});

// =============================================================================
// HELPERS
// =============================================================================

async function verifyOrgMembership(
  userId: string,
  organizationId: string
): Promise<void> {
  const membership = await db.query.member.findFirst({
    where: and(
      eq(member.userId, userId),
      eq(member.organizationId, organizationId)
    ),
  });

  if (!membership) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "You are not a member of this organization.",
    });
  }
}

async function verifyThreadAccess(
  organizationId: string,
  threadId: string
): Promise<typeof emailThread.$inferSelect> {
  const thread = await db.query.emailThread.findFirst({
    where: eq(emailThread.id, threadId),
    with: {
      account: {
        columns: { organizationId: true },
      },
    },
  });

  if (!thread || thread.account.organizationId !== organizationId) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Thread not found.",
    });
  }

  return thread;
}

// =============================================================================
// ROUTER
// =============================================================================

export const threadsRouter = router({
  /**
   * List threads with intelligence metadata.
   */
  list: protectedProcedure
    .input(listThreadsSchema)
    .query(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      await verifyOrgMembership(userId, input.organizationId);

      // Build conditions
      const conditions = [];

      // Get account IDs for this organization
      const accountIds = await db
        .select({ id: emailAccount.id })
        .from(emailAccount)
        .where(
          and(
            eq(emailAccount.organizationId, input.organizationId),
            input.accountId ? eq(emailAccount.id, input.accountId) : undefined
          )
        );

      if (accountIds.length === 0) {
        return { threads: [], total: 0, hasMore: false };
      }

      conditions.push(
        inArray(
          emailThread.accountId,
          accountIds.map((a) => a.id)
        )
      );

      // Apply filters
      if (input.hasOpenLoops !== undefined) {
        conditions.push(eq(emailThread.hasOpenLoops, input.hasOpenLoops));
      }

      if (input.priorityTier) {
        conditions.push(eq(emailThread.priorityTier, input.priorityTier));
      }

      if (input.intentClassification) {
        conditions.push(
          eq(emailThread.intentClassification, input.intentClassification)
        );
      }

      if (input.isUnread !== undefined) {
        conditions.push(eq(emailThread.isRead, !input.isUnread));
      }

      if (input.after) {
        conditions.push(gte(emailThread.lastMessageAt, input.after));
      }

      if (input.before) {
        conditions.push(lte(emailThread.lastMessageAt, input.before));
      }

      // Search in subject and snippet
      if (input.search) {
        const searchPattern = `%${input.search}%`;
        conditions.push(
          or(
            sql`${emailThread.subject} ILIKE ${searchPattern}`,
            sql`${emailThread.snippet} ILIKE ${searchPattern}`
          )
        );
      }

      // Count total
      const [countResult] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(emailThread)
        .where(and(...conditions));

      const total = countResult?.count ?? 0;

      // Get threads
      const threads = await db.query.emailThread.findMany({
        where: and(...conditions),
        limit: input.limit,
        offset: input.offset,
        orderBy: [desc(emailThread.lastMessageAt)],
        columns: {
          id: true,
          accountId: true,
          providerThreadId: true,
          subject: true,
          snippet: true,
          participantEmails: true,
          messageCount: true,
          hasAttachments: true,
          firstMessageAt: true,
          lastMessageAt: true,
          isRead: true,
          isStarred: true,
          isArchived: true,
          // Intelligence
          briefSummary: true,
          intentClassification: true,
          urgencyScore: true,
          importanceScore: true,
          sentimentScore: true,
          hasOpenLoops: true,
          openLoopCount: true,
          suggestedAction: true,
          priorityTier: true,
          lastAnalyzedAt: true,
        },
      });

      return {
        threads,
        total,
        hasMore: input.offset + threads.length < total,
      };
    }),

  /**
   * Get thread details with messages and intelligence.
   */
  get: protectedProcedure
    .input(getThreadSchema)
    .query(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      await verifyOrgMembership(userId, input.organizationId);

      const thread = await db.query.emailThread.findFirst({
        where: eq(emailThread.id, input.threadId),
        with: {
          account: {
            columns: { organizationId: true, email: true },
          },
          messages: {
            orderBy: (m, { asc }) => [asc(m.messageIndex)],
            columns: {
              id: true,
              providerMessageId: true,
              fromEmail: true,
              fromName: true,
              toRecipients: true,
              ccRecipients: true,
              subject: true,
              bodyText: true,
              bodyHtml: true,
              sentAt: true,
              receivedAt: true,
              isFromUser: true,
              messageIndex: true,
            },
          },
        },
      });

      if (!thread || thread.account.organizationId !== input.organizationId) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Thread not found.",
        });
      }

      // Get claims for this thread
      const threadClaims = await db.query.claim.findMany({
        where: and(
          eq(claim.threadId, input.threadId),
          eq(claim.isUserDismissed, false)
        ),
        orderBy: [desc(claim.confidence)],
      });

      return {
        ...thread,
        claims: threadClaims,
      };
    }),

  /**
   * Get brief summary only (for list view).
   */
  getBrief: protectedProcedure
    .input(getThreadSchema)
    .query(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      await verifyOrgMembership(userId, input.organizationId);

      const thread = await verifyThreadAccess(
        input.organizationId,
        input.threadId
      );

      return {
        threadId: thread.id,
        briefSummary: thread.briefSummary,
        intentClassification: thread.intentClassification,
        urgencyScore: thread.urgencyScore,
        priorityTier: thread.priorityTier,
        hasOpenLoops: thread.hasOpenLoops,
        openLoopCount: thread.openLoopCount,
        suggestedAction: thread.suggestedAction,
        lastAnalyzedAt: thread.lastAnalyzedAt,
      };
    }),

  /**
   * Get claims for a thread.
   */
  getClaims: protectedProcedure
    .input(getThreadClaimsSchema)
    .query(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      await verifyOrgMembership(userId, input.organizationId);
      await verifyThreadAccess(input.organizationId, input.threadId);

      const conditions = [
        eq(claim.threadId, input.threadId),
        eq(claim.isUserDismissed, false),
      ];

      if (input.type) {
        conditions.push(eq(claim.type, input.type));
      }

      if (input.minConfidence !== undefined) {
        conditions.push(gte(claim.confidence, input.minConfidence));
      }

      const claims = await db.query.claim.findMany({
        where: and(...conditions),
        orderBy: [desc(claim.confidence), desc(claim.extractedAt)],
      });

      // Group by type
      const byType = {
        facts: claims.filter((c) => c.type === "fact"),
        promises: claims.filter((c) => c.type === "promise"),
        requests: claims.filter((c) => c.type === "request"),
        questions: claims.filter((c) => c.type === "question"),
        decisions: claims.filter((c) => c.type === "decision"),
        other: claims.filter(
          (c) =>
            !["fact", "promise", "request", "question", "decision"].includes(
              c.type
            )
        ),
      };

      return {
        claims,
        byType,
        total: claims.length,
      };
    }),

  /**
   * Get open loops for a thread.
   */
  getOpenLoops: protectedProcedure
    .input(getThreadSchema)
    .query(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      await verifyOrgMembership(userId, input.organizationId);
      await verifyThreadAccess(input.organizationId, input.threadId);

      // Get unanswered questions
      const questions = await db.query.claim.findMany({
        where: and(
          eq(claim.threadId, input.threadId),
          eq(claim.type, "question"),
          eq(claim.isUserDismissed, false)
        ),
      });

      // Filter to unanswered (using metadata)
      const unansweredQuestions = questions.filter((q) => {
        const metadata = q.metadata as { isAnswered?: boolean } | null;
        return !metadata?.isAnswered;
      });

      // Get pending requests (promises that aren't fulfilled)
      const requests = await db.query.claim.findMany({
        where: and(
          eq(claim.threadId, input.threadId),
          or(eq(claim.type, "request"), eq(claim.type, "promise")),
          eq(claim.isUserDismissed, false)
        ),
      });

      return {
        unansweredQuestions,
        pendingRequests: requests,
        total: unansweredQuestions.length + requests.length,
      };
    }),

  /**
   * Update/correct a claim.
   */
  updateClaim: protectedProcedure
    .input(updateClaimSchema)
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      await verifyOrgMembership(userId, input.organizationId);

      // Verify claim belongs to this organization
      const existingClaim = await db.query.claim.findFirst({
        where: eq(claim.id, input.claimId),
      });

      if (
        !existingClaim ||
        existingClaim.organizationId !== input.organizationId
      ) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Claim not found.",
        });
      }

      // Update claim
      const updates: Partial<typeof claim.$inferInsert> = {
        updatedAt: new Date(),
      };

      if (input.isUserVerified !== undefined) {
        updates.isUserVerified = input.isUserVerified;
      }

      if (input.isUserDismissed !== undefined) {
        updates.isUserDismissed = input.isUserDismissed;
      }

      if (input.userCorrectedText !== undefined) {
        updates.userCorrectedText = input.userCorrectedText;
        updates.isUserVerified = true; // Auto-verify on correction
      }

      if (input.userCorrectedType !== undefined) {
        updates.userCorrectedType = input.userCorrectedType;
        updates.isUserVerified = true; // Auto-verify on correction
      }

      await db.update(claim).set(updates).where(eq(claim.id, input.claimId));

      return { success: true };
    }),

  /**
   * Dismiss a claim (mark as incorrect).
   */
  dismissClaim: protectedProcedure
    .input(
      z.object({
        organizationId: z.string().uuid(),
        claimId: z.string().uuid(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      await verifyOrgMembership(userId, input.organizationId);

      const existingClaim = await db.query.claim.findFirst({
        where: eq(claim.id, input.claimId),
      });

      if (
        !existingClaim ||
        existingClaim.organizationId !== input.organizationId
      ) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Claim not found.",
        });
      }

      await db
        .update(claim)
        .set({
          isUserDismissed: true,
          updatedAt: new Date(),
        })
        .where(eq(claim.id, input.claimId));

      return { success: true };
    }),

  /**
   * Verify a claim (mark as correct).
   */
  verifyClaim: protectedProcedure
    .input(
      z.object({
        organizationId: z.string().uuid(),
        claimId: z.string().uuid(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      await verifyOrgMembership(userId, input.organizationId);

      const existingClaim = await db.query.claim.findFirst({
        where: eq(claim.id, input.claimId),
      });

      if (
        !existingClaim ||
        existingClaim.organizationId !== input.organizationId
      ) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Claim not found.",
        });
      }

      await db
        .update(claim)
        .set({
          isUserVerified: true,
          isUserDismissed: false,
          updatedAt: new Date(),
        })
        .where(eq(claim.id, input.claimId));

      return { success: true };
    }),

  /**
   * Get threads by suggested action.
   */
  getByAction: protectedProcedure
    .input(
      z.object({
        organizationId: z.string().uuid(),
        action: z.enum([
          "respond",
          "review",
          "follow_up",
          "archive",
          "delegate",
        ]),
        limit: z.number().int().min(1).max(50).default(20),
      })
    )
    .query(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      await verifyOrgMembership(userId, input.organizationId);

      // Get account IDs
      const accountIds = await db
        .select({ id: emailAccount.id })
        .from(emailAccount)
        .where(eq(emailAccount.organizationId, input.organizationId));

      if (accountIds.length === 0) {
        return { threads: [] };
      }

      const threads = await db.query.emailThread.findMany({
        where: and(
          inArray(
            emailThread.accountId,
            accountIds.map((a) => a.id)
          ),
          eq(emailThread.suggestedAction, input.action),
          eq(emailThread.isArchived, false)
        ),
        limit: input.limit,
        orderBy: [
          desc(emailThread.urgencyScore),
          desc(emailThread.lastMessageAt),
        ],
        columns: {
          id: true,
          subject: true,
          snippet: true,
          briefSummary: true,
          urgencyScore: true,
          priorityTier: true,
          hasOpenLoops: true,
          lastMessageAt: true,
        },
      });

      return { threads };
    }),

  /**
   * Get threads with open loops (for follow-up dashboard).
   */
  getWithOpenLoops: protectedProcedure
    .input(
      z.object({
        organizationId: z.string().uuid(),
        limit: z.number().int().min(1).max(50).default(20),
      })
    )
    .query(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      await verifyOrgMembership(userId, input.organizationId);

      // Get account IDs
      const accountIds = await db
        .select({ id: emailAccount.id })
        .from(emailAccount)
        .where(eq(emailAccount.organizationId, input.organizationId));

      if (accountIds.length === 0) {
        return { threads: [], totalOpenLoops: 0 };
      }

      const threads = await db.query.emailThread.findMany({
        where: and(
          inArray(
            emailThread.accountId,
            accountIds.map((a) => a.id)
          ),
          eq(emailThread.hasOpenLoops, true),
          eq(emailThread.isArchived, false)
        ),
        limit: input.limit,
        orderBy: [
          desc(emailThread.openLoopCount),
          desc(emailThread.lastMessageAt),
        ],
        columns: {
          id: true,
          subject: true,
          snippet: true,
          briefSummary: true,
          openLoopCount: true,
          urgencyScore: true,
          lastMessageAt: true,
        },
      });

      const totalOpenLoops = threads.reduce(
        (sum, t) => sum + (t.openLoopCount || 0),
        0
      );

      return { threads, totalOpenLoops };
    }),
});
