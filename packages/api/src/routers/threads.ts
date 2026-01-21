// =============================================================================
// THREADS ROUTER
// =============================================================================
//
// API for accessing thread intelligence from the Thread Understanding Agent.
//

import { db } from "@memorystack/db";
import {
  claim,
  emailAccount,
  emailMessage,
  emailThread,
  member,
} from "@memorystack/db/schema";
import { TRPCError } from "@trpc/server";
import { and, asc, desc, eq, gte, inArray, lte, or, sql } from "drizzle-orm";
import { z } from "zod";
import { protectedProcedure, router } from "../index";

// =============================================================================
// HELPERS
// =============================================================================

/**
 * Extract a friendly display name from an email address.
 * Handles common patterns like "noreply@example.com", "john.doe@company.com", etc.
 */
function extractFriendlyName(email: string): string {
  const localPart = email.split("@")[0] ?? "";
  const domain = email.split("@")[1] ?? "";

  // Known service patterns - map to friendly names
  const servicePatterns: Record<string, string> = {
    "messaging-digest-noreply": "LinkedIn",
    "invitations-noreply": "LinkedIn",
    invitations: "LinkedIn",
    "jobalerts-noreply": "LinkedIn",
    "jobs-noreply": "LinkedIn",
    "notifications-noreply": "LinkedIn",
    "inmail-hit-reply": "LinkedIn",
    noreply: domain.includes("linkedin")
      ? "LinkedIn"
      : (domain.split(".")[0] ?? "Unknown"),
    "no-reply": domain.split(".")[0] ?? "Unknown",
    notification: domain.split(".")[0] ?? "Unknown",
    notifications: domain.split(".")[0] ?? "Unknown",
    newsletter: domain.split(".")[0] ?? "Newsletter",
    billing: domain.split(".")[0] ?? "Billing",
    support: domain.split(".")[0] ?? "Support",
    info: domain.split(".")[0] ?? "Info",
    hello: domain.split(".")[0] ?? "Hello",
    team: domain.split(".")[0] ?? "Team",
    mail: domain.split(".")[0] ?? "Mail",
  };

  // Check if local part matches a known service pattern
  for (const [pattern, name] of Object.entries(servicePatterns)) {
    if (localPart.toLowerCase().includes(pattern.toLowerCase())) {
      // Capitalize the name
      return name.charAt(0).toUpperCase() + name.slice(1);
    }
  }

  // Check domain for known services
  if (domain.includes("linkedin")) return "LinkedIn";
  if (domain.includes("github")) return "GitHub";
  if (domain.includes("google") || domain.includes("gmail")) return "Google";
  if (domain.includes("slack")) return "Slack";
  if (domain.includes("notion")) return "Notion";
  if (domain.includes("figma")) return "Figma";
  if (domain.includes("stripe")) return "Stripe";
  if (domain.includes("vercel")) return "Vercel";
  if (domain.includes("netlify")) return "Netlify";
  if (domain.includes("heroku")) return "Heroku";
  if (domain.includes("aws") || domain.includes("amazon")) return "AWS";
  if (domain.includes("microsoft") || domain.includes("outlook"))
    return "Microsoft";
  if (domain.includes("apple")) return "Apple";
  if (domain.includes("dropbox")) return "Dropbox";

  // For regular email addresses, try to format the local part nicely
  // Replace dots, underscores, and hyphens with spaces and capitalize
  const formatted = localPart
    .replace(/[._-]+/g, " ")
    .split(" ")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(" ");

  return formatted || localPart;
}

// =============================================================================
// INPUT SCHEMAS
// =============================================================================

const listThreadsSchema = z.object({
  organizationId: z.string().min(1),
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
  organizationId: z.string().min(1),
  threadId: z.string().uuid(),
});

const getThreadClaimsSchema = z.object({
  organizationId: z.string().min(1),
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
  organizationId: z.string().min(1),
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

// Additional schemas for inbox functionality
const listThreadsInboxSchema = z.object({
  accountId: z.string().uuid().optional(),
  filter: z
    .enum([
      "all",
      "unread",
      "starred",
      "snoozed",
      "sent",
      "drafts",
      "archived",
      "trash",
    ])
    .default("all"),
  sort: z.enum(["date", "priority", "sender", "subject"]).default("date"),
  sortDirection: z.enum(["asc", "desc"]).default("desc"),
  intelligenceFilter: z
    .enum([
      "all",
      "has_commitments",
      "has_decisions",
      "needs_response",
      "has_risk",
    ])
    .default("all"),
  limit: z.number().int().min(1).max(100).default(50),
  offset: z.number().int().min(0).default(0),
});

// Helper to get organization ID from session
async function getActiveOrgId(ctx: {
  session: { session: { activeOrganizationId?: string | null } };
}): Promise<string> {
  const orgId = ctx.session.session.activeOrganizationId;
  if (!orgId) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "No organization selected. Please select an organization first.",
    });
  }
  return orgId;
}

const threadIdSchema = z.object({
  threadId: z.string().uuid(),
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
   * List threads for inbox UI - uses session's active organization.
   */
  listInbox: protectedProcedure
    .input(listThreadsInboxSchema)
    .query(async ({ ctx, input }) => {
      const orgId = await getActiveOrgId(ctx);

      // Get account IDs for this organization
      const accountIds = await db
        .select({ id: emailAccount.id })
        .from(emailAccount)
        .where(
          and(
            eq(emailAccount.organizationId, orgId),
            input.accountId ? eq(emailAccount.id, input.accountId) : undefined
          )
        );

      if (accountIds.length === 0) {
        return { threads: [], total: 0, hasMore: false };
      }

      // Build conditions
      const conditions = [
        inArray(
          emailThread.accountId,
          accountIds.map((a) => a.id)
        ),
      ];

      // Apply filter
      switch (input.filter) {
        case "unread":
          conditions.push(eq(emailThread.isRead, false));
          break;
        case "starred":
          conditions.push(eq(emailThread.isStarred, true));
          break;
        case "archived":
          conditions.push(eq(emailThread.isArchived, true));
          break;
        case "sent":
          // Sent emails are threads where the user sent at least one message
          conditions.push(
            sql`EXISTS (
              SELECT 1 FROM "email_message" em
              WHERE em."thread_id" = ${emailThread.id}
              AND em."is_from_user" = true
            )`
          );
          break;
      }

      // Apply intelligence filter
      switch (input.intelligenceFilter) {
        case "has_commitments":
          // Would need a claim count column or subquery
          break;
        case "has_decisions":
          // Would need a claim count column or subquery
          break;
        case "needs_response":
          conditions.push(eq(emailThread.suggestedAction, "respond"));
          break;
        case "has_risk":
          // Would need risk warning detection
          break;
      }

      // Filter out archived by default unless explicitly requested
      if (input.filter !== "archived" && input.filter !== "trash") {
        conditions.push(eq(emailThread.isArchived, false));
      }

      // Count total
      const [countResult] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(emailThread)
        .where(and(...conditions));

      const total = countResult?.count ?? 0;

      // Build order by
      const orderByColumns = [];
      switch (input.sort) {
        case "date":
          orderByColumns.push(
            input.sortDirection === "desc"
              ? desc(emailThread.lastMessageAt)
              : emailThread.lastMessageAt
          );
          break;
        case "priority":
          orderByColumns.push(
            input.sortDirection === "desc"
              ? desc(emailThread.urgencyScore)
              : emailThread.urgencyScore
          );
          break;
        default:
          orderByColumns.push(desc(emailThread.lastMessageAt));
      }

      // Get threads WITHOUT nested messages to avoid N+1 query
      // The `with: { messages: { limit: 5 } }` pattern causes a separate query per thread
      const threads = await db.query.emailThread.findMany({
        where: and(...conditions),
        limit: input.limit,
        offset: input.offset,
        orderBy: orderByColumns,
        columns: {
          id: true,
          accountId: true,
          subject: true,
          snippet: true,
          participantEmails: true,
          messageCount: true,
          hasAttachments: true,
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
        },
      });

      // Batch load messages for all threads (single query instead of N queries)
      const threadIds = threads.map((t) => t.id);
      const allMessages =
        threadIds.length > 0
          ? await db.query.emailMessage.findMany({
              where: inArray(emailMessage.threadId, threadIds),
              columns: {
                threadId: true,
                fromEmail: true,
                fromName: true,
                messageIndex: true,
              },
              orderBy: [asc(emailMessage.messageIndex)],
            })
          : [];

      // Group messages by threadId and limit to 5 per thread (in memory)
      const messagesByThread = new Map<string, typeof allMessages>();
      for (const msg of allMessages) {
        const existing = messagesByThread.get(msg.threadId) ?? [];
        if (existing.length < 5) {
          existing.push(msg);
          messagesByThread.set(msg.threadId, existing);
        }
      }

      // Transform to inbox format
      const transformedThreads = threads.map((t) => {
        // Get pre-loaded messages for this thread
        const threadMessages = messagesByThread.get(t.id) ?? [];

        // Build participant list from messages with actual names
        const participantMap = new Map<string, string>();
        for (const msg of threadMessages) {
          if (msg.fromEmail && !participantMap.has(msg.fromEmail)) {
            // Use fromName if available, otherwise try to extract a friendly name
            const name = msg.fromName || extractFriendlyName(msg.fromEmail);
            participantMap.set(msg.fromEmail, name);
          }
        }

        // Add any remaining emails from participantEmails that weren't in messages
        for (const email of t.participantEmails ?? []) {
          if (!participantMap.has(email as string)) {
            participantMap.set(
              email as string,
              extractFriendlyName(email as string)
            );
          }
        }

        const participants = Array.from(participantMap.entries()).map(
          ([email, name]) => ({ email, name })
        );

        return {
          id: t.id,
          subject: t.subject ?? "No subject",
          brief: t.briefSummary ?? t.snippet ?? "",
          snippet: t.snippet ?? "",
          lastMessageDate: t.lastMessageAt ?? new Date(),
          messageCount: t.messageCount ?? 1,
          isUnread: !t.isRead,
          isStarred: t.isStarred ?? false,
          isSnoozed: false,
          snoozeUntil: undefined,
          participants,
          priority: t.priorityTier ?? "medium",
          suggestedAction: t.suggestedAction,
          commitmentCount: 0,
          decisionCount: 0,
          openQuestionCount: t.openLoopCount ?? 0,
          hasRiskWarning: false,
          riskLevel: undefined,
          labels: [],
          briefConfidence: 0.8,
        };
      });

      return {
        threads: transformedThreads,
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
        organizationId: z.string().min(1),
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
        organizationId: z.string().min(1),
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
        organizationId: z.string().min(1),
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
        organizationId: z.string().min(1),
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

  // ==========================================================================
  // INBOX UI PROCEDURES
  // ==========================================================================

  /**
   * Get thread by ID (for inbox UI).
   */
  getById: protectedProcedure
    .input(threadIdSchema)
    .query(async ({ ctx: _ctx, input }) => {
      const thread = await db.query.emailThread.findFirst({
        where: eq(emailThread.id, input.threadId),
        with: {
          account: {
            columns: { organizationId: true },
          },
        },
      });

      if (!thread) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Thread not found.",
        });
      }

      return {
        thread: {
          id: thread.id,
          subject: thread.subject,
          brief: thread.briefSummary,
          isStarred: thread.isStarred,
          isArchived: thread.isArchived,
          isRead: thread.isRead,
          priorityTier: thread.priorityTier,
        },
      };
    }),

  /**
   * Get messages for a thread (for inbox UI).
   */
  getMessages: protectedProcedure
    .input(threadIdSchema)
    .query(async ({ ctx: _ctx, input }) => {
      const thread = await db.query.emailThread.findFirst({
        where: eq(emailThread.id, input.threadId),
        with: {
          messages: {
            orderBy: (m, { asc }) => [asc(m.messageIndex)],
          },
        },
      });

      if (!thread) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Thread not found.",
        });
      }

      return {
        messages: thread.messages.map((m) => {
          // Extract text from HTML if no plain text body
          const plainBody = m.bodyText ?? "";
          const htmlBody = m.bodyHtml;

          // Create snippet from plain text or extract from HTML
          let snippet = plainBody.slice(0, 200);
          if (!snippet && htmlBody) {
            // Basic HTML to text extraction for snippet
            snippet = htmlBody
              .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
              .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
              .replace(/<[^>]+>/g, " ")
              .replace(/&nbsp;/g, " ")
              .replace(/&amp;/g, "&")
              .replace(/&lt;/g, "<")
              .replace(/&gt;/g, ">")
              .replace(/&quot;/g, '"')
              .replace(/\s+/g, " ")
              .trim()
              .slice(0, 200);
          }

          return {
            id: m.id,
            threadId: input.threadId,
            subject: m.subject,
            from: {
              email: m.fromEmail,
              name: m.fromName ?? extractFriendlyName(m.fromEmail),
            },
            to:
              (m.toRecipients as Array<{ email: string; name?: string }>) ?? [],
            cc: m.ccRecipients as
              | Array<{ email: string; name?: string }>
              | undefined,
            date: m.sentAt ?? m.receivedAt ?? new Date(),
            body: plainBody || snippet, // Use extracted text as fallback body
            bodyHtml: htmlBody,
            snippet,
            isUnread: !thread.isRead,
            attachments: [],
          };
        }),
      };
    }),

  /**
   * Get intelligence for a thread (for inbox UI).
   */
  getIntelligence: protectedProcedure
    .input(threadIdSchema)
    .query(async ({ ctx: _ctx, input }) => {
      // Get claims for this thread
      const claims = await db.query.claim.findMany({
        where: and(
          eq(claim.threadId, input.threadId),
          eq(claim.isUserDismissed, false)
        ),
        orderBy: [desc(claim.confidence)],
      });

      // Transform claims to commitments, decisions, and questions
      const commitments = claims
        .filter((c) => c.type === "promise")
        .map((c) => {
          const meta = c.metadata as {
            dueDate?: string;
            attributedTo?: string;
          } | null;
          return {
            id: c.id,
            title: c.text,
            description: c.quotedText ?? undefined,
            debtor: {
              email: meta?.attributedTo ?? "",
              name: meta?.attributedTo ?? "Unknown",
            },
            dueDate: meta?.dueDate,
            status: "pending" as const,
            priority: "medium" as const,
            confidence: c.confidence,
            evidence: [],
            extractedFrom: c.messageId ?? "",
            reasoning: c.quotedText ?? undefined,
          };
        });

      const decisions = claims
        .filter((c) => c.type === "decision")
        .map((c) => {
          const meta = c.metadata as { attributedTo?: string } | null;
          return {
            id: c.id,
            title: c.text,
            statement: c.text,
            rationale: c.quotedText ?? undefined,
            maker: {
              email: meta?.attributedTo ?? "",
              name: meta?.attributedTo ?? "Unknown",
            },
            date: c.extractedAt ?? new Date(),
            confidence: c.confidence,
            evidence: [],
            extractedFrom: c.messageId ?? "",
          };
        });

      const openQuestions = claims
        .filter((c) => c.type === "question")
        .map((c) => {
          const meta = c.metadata as {
            isAnswered?: boolean;
            attributedTo?: string;
          } | null;
          return {
            id: c.id,
            question: c.text,
            askedBy: {
              email: meta?.attributedTo ?? "",
              name: meta?.attributedTo ?? "Unknown",
            },
            askedAt: c.extractedAt ?? new Date(),
            isAnswered: meta?.isAnswered ?? false,
            confidence: c.confidence,
          };
        });

      return {
        commitments,
        decisions,
        openQuestions,
        riskWarnings: [],
      };
    }),

  /**
   * Get related context for a thread (for memory panel).
   */
  getRelatedContext: protectedProcedure
    .input(threadIdSchema)
    .query(async ({ ctx: _ctx, input: _input }) => {
      // For now, return empty context - can be enhanced later
      return {
        relatedThreads: [],
        relatedDecisions: [],
        relatedCommitments: [],
        contactContexts: [],
        timeline: [],
      };
    }),

  /**
   * Get unread count.
   */
  getUnreadCount: protectedProcedure
    .input(z.object({ accountId: z.string().uuid().optional() }))
    .query(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;

      // Get user's organizations
      const memberships = await db.query.member.findMany({
        where: eq(member.userId, userId),
        columns: { organizationId: true },
      });

      if (memberships.length === 0) {
        return { count: 0 };
      }

      const orgIds = memberships.map((m) => m.organizationId);

      // Get accounts
      const accounts = await db.query.emailAccount.findMany({
        where: and(
          inArray(emailAccount.organizationId, orgIds),
          input.accountId ? eq(emailAccount.id, input.accountId) : undefined
        ),
        columns: { id: true },
      });

      if (accounts.length === 0) {
        return { count: 0 };
      }

      const [result] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(emailThread)
        .where(
          and(
            inArray(
              emailThread.accountId,
              accounts.map((a) => a.id)
            ),
            eq(emailThread.isRead, false),
            eq(emailThread.isArchived, false)
          )
        );

      return { count: result?.count ?? 0 };
    }),

  /**
   * Archive a thread.
   */
  archive: protectedProcedure
    .input(threadIdSchema)
    .mutation(async ({ ctx: _ctx, input }) => {
      await db
        .update(emailThread)
        .set({ isArchived: true, updatedAt: new Date() })
        .where(eq(emailThread.id, input.threadId));

      return { success: true };
    }),

  /**
   * Star/unstar a thread.
   */
  star: protectedProcedure
    .input(
      z.object({
        threadId: z.string().uuid(),
        starred: z.boolean(),
      })
    )
    .mutation(async ({ ctx: _ctx, input }) => {
      await db
        .update(emailThread)
        .set({ isStarred: input.starred, updatedAt: new Date() })
        .where(eq(emailThread.id, input.threadId));

      return { success: true };
    }),

  /**
   * Mark thread as read/unread.
   */
  markRead: protectedProcedure
    .input(
      z.object({
        threadId: z.string().uuid(),
        read: z.boolean(),
      })
    )
    .mutation(async ({ ctx: _ctx, input }) => {
      await db
        .update(emailThread)
        .set({ isRead: input.read, updatedAt: new Date() })
        .where(eq(emailThread.id, input.threadId));

      return { success: true };
    }),

  /**
   * Delete a thread.
   */
  delete: protectedProcedure
    .input(threadIdSchema)
    .mutation(async ({ ctx: _ctx, input }) => {
      // Soft delete by marking as trashed
      await db
        .update(emailThread)
        .set({
          isArchived: true,
          updatedAt: new Date(),
        })
        .where(eq(emailThread.id, input.threadId));

      return { success: true };
    }),

  /**
   * Snooze a thread.
   */
  snooze: protectedProcedure
    .input(
      z.object({
        threadId: z.string().uuid(),
        until: z.date(),
      })
    )
    .mutation(async ({ ctx: _ctx, input }) => {
      await db
        .update(emailThread)
        .set({
          isArchived: true, // Hide from inbox
          updatedAt: new Date(),
          // Note: Would need to add snoozeUntil column to schema
        })
        .where(eq(emailThread.id, input.threadId));

      return { success: true };
    }),

  /**
   * Get thread statistics for dashboard.
   */
  getStats: protectedProcedure
    .input(
      z.object({
        organizationId: z.string().min(1),
      })
    )
    .query(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      await verifyOrgMembership(userId, input.organizationId);

      // Get account IDs for this organization
      const accountIds = await db
        .select({ id: emailAccount.id })
        .from(emailAccount)
        .where(eq(emailAccount.organizationId, input.organizationId));

      if (accountIds.length === 0) {
        return {
          total: 0,
          unread: 0,
          starred: 0,
          archived: 0,
        };
      }

      const accountIdList = accountIds.map((a) => a.id);

      // Get counts in parallel
      const [totalResult, unreadResult, starredResult, archivedResult] =
        await Promise.all([
          db
            .select({ count: sql<number>`count(*)::int` })
            .from(emailThread)
            .where(
              and(
                inArray(emailThread.accountId, accountIdList),
                eq(emailThread.isArchived, false)
              )
            ),
          db
            .select({ count: sql<number>`count(*)::int` })
            .from(emailThread)
            .where(
              and(
                inArray(emailThread.accountId, accountIdList),
                eq(emailThread.isArchived, false),
                eq(emailThread.isRead, false)
              )
            ),
          db
            .select({ count: sql<number>`count(*)::int` })
            .from(emailThread)
            .where(
              and(
                inArray(emailThread.accountId, accountIdList),
                eq(emailThread.isStarred, true)
              )
            ),
          db
            .select({ count: sql<number>`count(*)::int` })
            .from(emailThread)
            .where(
              and(
                inArray(emailThread.accountId, accountIdList),
                eq(emailThread.isArchived, true)
              )
            ),
        ]);

      return {
        total: totalResult[0]?.count ?? 0,
        unread: unreadResult[0]?.count ?? 0,
        starred: starredResult[0]?.count ?? 0,
        archived: archivedResult[0]?.count ?? 0,
      };
    }),
});
