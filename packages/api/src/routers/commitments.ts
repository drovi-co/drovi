// =============================================================================
// COMMITMENTS ROUTER
// =============================================================================
//
// API for managing commitments extracted from email threads.
// Supports CRUD operations, status updates, and digest generation.
//

import { db } from "@memorystack/db";

// =============================================================================
// NOTE: Commitment AI functionality has been moved to Python backend.
// Digest generation is now simplified local logic.
// AI-powered procedures return migration errors.
// =============================================================================
import { commitment, member } from "@memorystack/db/schema";
import { TRPCError } from "@trpc/server";
import { and, desc, eq, gte, inArray, isNotNull, lte, sql } from "drizzle-orm";
import { z } from "zod";
import { protectedProcedure, router } from "../index";

// =============================================================================
// INPUT SCHEMAS
// =============================================================================

const listCommitmentsSchema = z.object({
  organizationId: z.string().min(1),
  limit: z.number().int().min(1).max(100).default(50),
  offset: z.number().int().min(0).default(0),
  // Filters
  status: z
    .enum([
      "pending",
      "in_progress",
      "completed",
      "cancelled",
      "overdue",
      "waiting",
      "snoozed",
    ])
    .optional(),
  direction: z.enum(["owed_by_me", "owed_to_me"]).optional(),
  priority: z.enum(["low", "medium", "high", "urgent"]).optional(),
  minConfidence: z.number().min(0).max(1).optional(),
  // Date filters
  dueAfter: z.date().optional(),
  dueBefore: z.date().optional(),
  // Include dismissed
  includeDismissed: z.boolean().default(false),
});

const getCommitmentSchema = z.object({
  organizationId: z.string().min(1),
  commitmentId: z.string().uuid(),
});

const updateCommitmentSchema = z.object({
  organizationId: z.string().min(1),
  commitmentId: z.string().uuid(),
  // Status
  status: z
    .enum([
      "pending",
      "in_progress",
      "completed",
      "cancelled",
      "overdue",
      "waiting",
      "snoozed",
    ])
    .optional(),
  priority: z.enum(["low", "medium", "high", "urgent"]).optional(),
  // Due date
  dueDate: z.date().optional(),
  dueDateSource: z.string().optional(),
  // Snooze
  snoozedUntil: z.date().optional(),
  // User corrections
  title: z.string().optional(),
  description: z.string().optional(),
  isUserVerified: z.boolean().optional(),
  isUserDismissed: z.boolean().optional(),
});

const generateFollowUpSchema = z.object({
  organizationId: z.string().min(1),
  commitmentId: z.string().uuid(),
});

const getDigestSchema = z.object({
  organizationId: z.string().min(1),
});

const getOverdueSchema = z.object({
  organizationId: z.string().min(1),
  direction: z.enum(["owed_by_me", "owed_to_me"]).optional(),
  limit: z.number().int().min(1).max(50).default(20),
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

async function verifyCommitmentAccess(
  organizationId: string,
  commitmentId: string
): Promise<typeof commitment.$inferSelect> {
  const found = await db.query.commitment.findFirst({
    where: eq(commitment.id, commitmentId),
  });

  if (!found || found.organizationId !== organizationId) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Commitment not found.",
    });
  }

  return found;
}

// =============================================================================
// ROUTER
// =============================================================================

export const commitmentsRouter = router({
  /**
   * List commitments with filters.
   */
  list: protectedProcedure
    .input(listCommitmentsSchema)
    .query(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      await verifyOrgMembership(userId, input.organizationId);

      const conditions = [eq(commitment.organizationId, input.organizationId)];

      // Status filter
      if (input.status) {
        conditions.push(eq(commitment.status, input.status));
      }

      // Direction filter
      if (input.direction) {
        conditions.push(eq(commitment.direction, input.direction));
      }

      // Priority filter
      if (input.priority) {
        conditions.push(eq(commitment.priority, input.priority));
      }

      // Confidence filter
      if (input.minConfidence !== undefined) {
        conditions.push(gte(commitment.confidence, input.minConfidence));
      }

      // Due date filters
      if (input.dueAfter) {
        conditions.push(gte(commitment.dueDate, input.dueAfter));
      }

      if (input.dueBefore) {
        conditions.push(lte(commitment.dueDate, input.dueBefore));
      }

      // Dismissed filter
      if (!input.includeDismissed) {
        conditions.push(eq(commitment.isUserDismissed, false));
      }

      // Count total
      const [countResult] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(commitment)
        .where(and(...conditions));

      const total = countResult?.count ?? 0;

      // Get commitments with related data
      const commitments = await db.query.commitment.findMany({
        where: and(...conditions),
        limit: input.limit,
        offset: input.offset,
        orderBy: [
          // Sort by: priority (urgent > high > medium > low), then overdue, then due date
          desc(
            sql`CASE
              WHEN ${commitment.priority} = 'urgent' THEN 4
              WHEN ${commitment.priority} = 'high' THEN 3
              WHEN ${commitment.priority} = 'medium' THEN 2
              WHEN ${commitment.priority} = 'low' THEN 1
              ELSE 0
            END`
          ),
          desc(
            sql`CASE WHEN ${commitment.status} = 'overdue' THEN 1 ELSE 0 END`
          ),
          desc(commitment.dueDate),
          desc(commitment.createdAt),
        ],
        with: {
          debtor: {
            columns: {
              id: true,
              primaryEmail: true,
              displayName: true,
              avatarUrl: true,
            },
          },
          creditor: {
            columns: {
              id: true,
              primaryEmail: true,
              displayName: true,
              avatarUrl: true,
            },
          },
          sourceConversation: {
            columns: {
              id: true,
              title: true,
              snippet: true,
            },
          },
        },
      });

      return {
        commitments,
        total,
        hasMore: input.offset + commitments.length < total,
      };
    }),

  /**
   * Get commitment details.
   */
  get: protectedProcedure
    .input(getCommitmentSchema)
    .query(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      await verifyOrgMembership(userId, input.organizationId);

      const found = await db.query.commitment.findFirst({
        where: eq(commitment.id, input.commitmentId),
        with: {
          debtor: true,
          creditor: true,
          sourceConversation: {
            with: {
              messages: {
                orderBy: (m, { asc }) => [asc(m.messageIndex)],
                limit: 10, // Limit messages for context
              },
            },
          },
          claim: true,
        },
      });

      if (!found || found.organizationId !== input.organizationId) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Commitment not found.",
        });
      }

      return found;
    }),

  /**
   * Update a commitment.
   */
  update: protectedProcedure
    .input(updateCommitmentSchema)
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      await verifyOrgMembership(userId, input.organizationId);
      await verifyCommitmentAccess(input.organizationId, input.commitmentId);

      const updates: Partial<typeof commitment.$inferInsert> = {
        updatedAt: new Date(),
      };

      if (input.status !== undefined) {
        updates.status = input.status;
        if (input.status === "completed") {
          updates.completedAt = new Date();
          updates.completedVia = "user_action";
        }
      }

      if (input.priority !== undefined) {
        updates.priority = input.priority;
      }

      if (input.dueDate !== undefined) {
        updates.dueDate = input.dueDate;
        updates.dueDateSource = input.dueDateSource ?? "user_set";
      }

      if (input.snoozedUntil !== undefined) {
        updates.snoozedUntil = input.snoozedUntil;
        if (input.snoozedUntil) {
          updates.status = "snoozed";
        }
      }

      if (input.title !== undefined) {
        updates.title = input.title;
        updates.isUserVerified = true;
      }

      if (input.description !== undefined) {
        updates.description = input.description;
      }

      if (input.isUserVerified !== undefined) {
        updates.isUserVerified = input.isUserVerified;
      }

      if (input.isUserDismissed !== undefined) {
        updates.isUserDismissed = input.isUserDismissed;
      }

      await db
        .update(commitment)
        .set(updates)
        .where(eq(commitment.id, input.commitmentId));

      return { success: true };
    }),

  /**
   * Mark a commitment as completed.
   */
  complete: protectedProcedure
    .input(getCommitmentSchema)
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      await verifyOrgMembership(userId, input.organizationId);
      await verifyCommitmentAccess(input.organizationId, input.commitmentId);

      await db
        .update(commitment)
        .set({
          status: "completed",
          completedAt: new Date(),
          completedVia: "user_action",
          updatedAt: new Date(),
        })
        .where(eq(commitment.id, input.commitmentId));

      return { success: true };
    }),

  /**
   * Snooze a commitment.
   */
  snooze: protectedProcedure
    .input(
      z.object({
        organizationId: z.string().min(1),
        commitmentId: z.string().uuid(),
        until: z.date(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      await verifyOrgMembership(userId, input.organizationId);
      await verifyCommitmentAccess(input.organizationId, input.commitmentId);

      await db
        .update(commitment)
        .set({
          status: "snoozed",
          snoozedUntil: input.until,
          updatedAt: new Date(),
        })
        .where(eq(commitment.id, input.commitmentId));

      return { success: true };
    }),

  /**
   * Dismiss a commitment (mark as incorrect extraction).
   */
  dismiss: protectedProcedure
    .input(getCommitmentSchema)
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      await verifyOrgMembership(userId, input.organizationId);
      await verifyCommitmentAccess(input.organizationId, input.commitmentId);

      await db
        .update(commitment)
        .set({
          isUserDismissed: true,
          updatedAt: new Date(),
        })
        .where(eq(commitment.id, input.commitmentId));

      return { success: true };
    }),

  /**
   * Verify a commitment (mark as correct extraction).
   */
  verify: protectedProcedure
    .input(getCommitmentSchema)
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      await verifyOrgMembership(userId, input.organizationId);
      await verifyCommitmentAccess(input.organizationId, input.commitmentId);

      await db
        .update(commitment)
        .set({
          isUserVerified: true,
          isUserDismissed: false,
          updatedAt: new Date(),
        })
        .where(eq(commitment.id, input.commitmentId));

      return { success: true };
    }),

  /**
   * Get overdue commitments.
   */
  getOverdue: protectedProcedure
    .input(getOverdueSchema)
    .query(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      await verifyOrgMembership(userId, input.organizationId);

      const now = new Date();
      const conditions = [
        eq(commitment.organizationId, input.organizationId),
        eq(commitment.isUserDismissed, false),
        inArray(commitment.status, ["pending", "in_progress", "waiting"]),
        lte(commitment.dueDate, now),
        isNotNull(commitment.dueDate),
      ];

      if (input.direction) {
        conditions.push(eq(commitment.direction, input.direction));
      }

      const overdueCommitments = await db.query.commitment.findMany({
        where: and(...conditions),
        limit: input.limit,
        orderBy: [
          // Sort by priority first
          desc(
            sql`CASE
              WHEN ${commitment.priority} = 'urgent' THEN 4
              WHEN ${commitment.priority} = 'high' THEN 3
              WHEN ${commitment.priority} = 'medium' THEN 2
              WHEN ${commitment.priority} = 'low' THEN 1
              ELSE 0
            END`
          ),
          desc(commitment.dueDate),
        ],
        with: {
          debtor: {
            columns: {
              id: true,
              primaryEmail: true,
              displayName: true,
            },
          },
          creditor: {
            columns: {
              id: true,
              primaryEmail: true,
              displayName: true,
            },
          },
        },
      });

      // Calculate days overdue for each
      const withDaysOverdue = overdueCommitments.map((c) => ({
        ...c,
        daysOverdue: c.dueDate
          ? Math.floor(
              (now.getTime() - c.dueDate.getTime()) / (1000 * 60 * 60 * 24)
            )
          : 0,
      }));

      return {
        commitments: withDaysOverdue,
        total: withDaysOverdue.length,
      };
    }),

  /**
   * Get daily digest for the organization.
   */
  getDigest: protectedProcedure
    .input(getDigestSchema)
    .query(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      await verifyOrgMembership(userId, input.organizationId);

      // Get all active commitments
      const commitments = await db.query.commitment.findMany({
        where: and(
          eq(commitment.organizationId, input.organizationId),
          eq(commitment.isUserDismissed, false),
          inArray(commitment.status, ["pending", "in_progress", "waiting"])
        ),
      });

      // Generate digest (simplified local logic - no AI agent)
      const now = new Date();
      const startOfToday = new Date(
        now.getFullYear(),
        now.getMonth(),
        now.getDate()
      );
      const endOfToday = new Date(startOfToday.getTime() + 24 * 60 * 60 * 1000);
      const endOfWeek = new Date(
        startOfToday.getTime() + 7 * 24 * 60 * 60 * 1000
      );

      interface DigestItem {
        title: string;
        dueDate: Date;
        daysOverdue: number;
      }

      const owedByMe = {
        overdue: [] as DigestItem[],
        dueToday: [] as DigestItem[],
        upcoming: [] as DigestItem[],
      };
      const owedToMe = {
        overdue: [] as DigestItem[],
        dueToday: [] as DigestItem[],
        upcoming: [] as DigestItem[],
      };

      for (const c of commitments) {
        if (!c.dueDate) {
          continue;
        }
        const dueDate = new Date(c.dueDate);
        const daysOverdue = Math.max(
          0,
          Math.floor(
            (startOfToday.getTime() - dueDate.getTime()) / (24 * 60 * 60 * 1000)
          )
        );
        const item: DigestItem = { title: c.title, dueDate, daysOverdue };
        const category = c.direction === "owed_by_me" ? owedByMe : owedToMe;

        if (dueDate < startOfToday) {
          category.overdue.push(item);
        } else if (dueDate >= startOfToday && dueDate < endOfToday) {
          category.dueToday.push(item);
        } else if (dueDate < endOfWeek) {
          category.upcoming.push(item);
        }
      }

      const totalOpen =
        owedByMe.overdue.length +
        owedByMe.dueToday.length +
        owedByMe.upcoming.length +
        owedToMe.overdue.length +
        owedToMe.dueToday.length +
        owedToMe.upcoming.length;

      return { owedByMe, owedToMe, totalOpen, generatedAt: now };
    }),

  /**
   * Generate follow-up draft for an overdue commitment.
   * @deprecated Migrated to Python backend
   */
  generateFollowUp: protectedProcedure
    .input(generateFollowUpSchema)
    .output(
      z.object({
        subject: z.string(),
        body: z.string(),
        tone: z.string().optional(),
        urgencyLevel: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      await verifyOrgMembership(userId, input.organizationId);

      const found = await db.query.commitment.findFirst({
        where: eq(commitment.id, input.commitmentId),
        with: {
          debtor: true,
          sourceConversation: {
            with: {
              messages: {
                orderBy: (m, { desc: d }) => [d(m.sentAt)],
                limit: 3,
              },
            },
          },
        },
      });

      if (!found || found.organizationId !== input.organizationId) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Commitment not found.",
        });
      }

      // Calculate days overdue
      const now = new Date();
      const daysOverdue = found.dueDate
        ? Math.max(
            0,
            Math.floor(
              (now.getTime() - found.dueDate.getTime()) / (1000 * 60 * 60 * 24)
            )
          )
        : 0;

      // Build context from recent messages
      const originalContext = found.sourceConversation?.messages
        .map((m) => m.bodyText)
        .filter(Boolean)
        .join("\n\n---\n\n");

      // Get the current user's info as the sender
      const senderName = ctx.session.user.name ?? undefined;
      const senderEmail = ctx.session.user.email ?? undefined;

      // NOTE: AI-powered follow-up generation has been migrated to Python backend
      // Context kept for future Python backend integration
      void daysOverdue;
      void originalContext;
      void senderName;
      void senderEmail;
      throw new TRPCError({
        code: "NOT_IMPLEMENTED",
        message:
          "AI-powered follow-up generation is being migrated to Python backend. " +
          "Use the Python drafting endpoint instead.",
      });
    }),

  /**
   * Get commitments by direction with stats.
   */
  getByDirection: protectedProcedure
    .input(
      z.object({
        organizationId: z.string().min(1),
        direction: z.enum(["owed_by_me", "owed_to_me"]),
        limit: z.number().int().min(1).max(50).default(20),
      })
    )
    .query(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      await verifyOrgMembership(userId, input.organizationId);

      const now = new Date();

      const commitments = await db.query.commitment.findMany({
        where: and(
          eq(commitment.organizationId, input.organizationId),
          eq(commitment.direction, input.direction),
          eq(commitment.isUserDismissed, false),
          inArray(commitment.status, ["pending", "in_progress", "waiting"])
        ),
        limit: input.limit,
        orderBy: [
          // Sort by priority first
          desc(
            sql`CASE
              WHEN ${commitment.priority} = 'urgent' THEN 4
              WHEN ${commitment.priority} = 'high' THEN 3
              WHEN ${commitment.priority} = 'medium' THEN 2
              WHEN ${commitment.priority} = 'low' THEN 1
              ELSE 0
            END`
          ),
          desc(commitment.dueDate),
        ],
        with: {
          debtor: {
            columns: {
              id: true,
              primaryEmail: true,
              displayName: true,
            },
          },
          creditor: {
            columns: {
              id: true,
              primaryEmail: true,
              displayName: true,
            },
          },
        },
      });

      // Calculate stats
      const overdue = commitments.filter(
        (c) => c.dueDate && c.dueDate < now
      ).length;
      const dueThisWeek = commitments.filter((c) => {
        if (!c.dueDate) {
          return false;
        }
        const weekFromNow = new Date();
        weekFromNow.setDate(weekFromNow.getDate() + 7);
        return c.dueDate >= now && c.dueDate <= weekFromNow;
      }).length;

      return {
        commitments,
        stats: {
          total: commitments.length,
          overdue,
          dueThisWeek,
        },
      };
    }),

  /**
   * Get commitment statistics for dashboard.
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

      const now = new Date();
      const weekFromNow = new Date();
      weekFromNow.setDate(weekFromNow.getDate() + 7);

      // Get all active commitments
      const allCommitments = await db.query.commitment.findMany({
        where: and(
          eq(commitment.organizationId, input.organizationId),
          eq(commitment.isUserDismissed, false)
        ),
      });

      const active = allCommitments.filter((c) =>
        ["pending", "in_progress", "waiting"].includes(c.status)
      );

      const overdue = active.filter((c) => c.dueDate && c.dueDate < now);

      const dueThisWeek = active.filter((c) => {
        if (!c.dueDate) {
          return false;
        }
        return c.dueDate >= now && c.dueDate <= weekFromNow;
      });

      const owedByMe = active.filter((c) => c.direction === "owed_by_me");
      const owedToMe = active.filter((c) => c.direction === "owed_to_me");

      const completedThisMonth = allCommitments.filter((c) => {
        if (c.status !== "completed" || !c.completedAt) {
          return false;
        }
        const monthAgo = new Date();
        monthAgo.setMonth(monthAgo.getMonth() - 1);
        return c.completedAt >= monthAgo;
      });

      return {
        total: active.length,
        overdue: overdue.length,
        dueThisWeek: dueThisWeek.length,
        owedByMe: owedByMe.length,
        owedToMe: owedToMe.length,
        completedThisMonth: completedThisMonth.length,
        byStatus: {
          pending: active.filter((c) => c.status === "pending").length,
          inProgress: active.filter((c) => c.status === "in_progress").length,
          waiting: active.filter((c) => c.status === "waiting").length,
        },
        byPriority: {
          urgent: active.filter((c) => c.priority === "urgent").length,
          high: active.filter((c) => c.priority === "high").length,
          medium: active.filter((c) => c.priority === "medium").length,
          low: active.filter((c) => c.priority === "low").length,
        },
      };
    }),
});
