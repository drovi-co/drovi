// =============================================================================
// UNIFIED INTELLIGENCE OBJECT (UIO) ROUTER
// =============================================================================
//
// Single API for all intelligence types: commitments, decisions, topics, etc.
// Uses unified_intelligence_object table as single source of truth.
//

import { db } from "@memorystack/db";
import { unifiedIntelligenceObject, member } from "@memorystack/db/schema";
import { TRPCError } from "@trpc/server";
import { and, desc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { z } from "zod";
import { protectedProcedure, router } from "../index";

// =============================================================================
// INPUT SCHEMAS
// =============================================================================

const uioTypeEnum = z.enum([
  "commitment",
  "decision",
  "topic",
  "project",
  "claim",
  "task",
  "risk",
  "brief",
]);
const uioStatusEnum = z.enum(["active", "merged", "archived", "dismissed"]);

const listUIOsSchema = z.object({
  organizationId: z.string().min(1),
  type: uioTypeEnum.optional(),
  types: z.array(uioTypeEnum).optional(),
  status: uioStatusEnum.optional(),
  statuses: z.array(uioStatusEnum).optional(),
  limit: z.number().int().min(1).max(100).default(50),
  offset: z.number().int().min(0).default(0),
  // Filters
  minConfidence: z.number().min(0).max(1).optional(),
  hasOwner: z.boolean().optional(),
  ownerId: z.string().optional(),
  // Date filters
  dueDateAfter: z.date().optional(),
  dueDateBefore: z.date().optional(),
  createdAfter: z.date().optional(),
  createdBefore: z.date().optional(),
  // Include dismissed
  includeDismissed: z.boolean().default(false),
  // Search
  search: z.string().optional(),
});

const getUIOSchema = z.object({
  organizationId: z.string().min(1),
  id: z.string().uuid(),
});

const updateUIOSchema = z.object({
  organizationId: z.string().min(1),
  id: z.string().uuid(),
  // Status
  status: uioStatusEnum.optional(),
  // Content
  title: z.string().optional(),
  description: z.string().optional(),
  // Due date
  dueDate: z.date().nullable().optional(),
  // User corrections
  isUserVerified: z.boolean().optional(),
  isUserDismissed: z.boolean().optional(),
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

// =============================================================================
// ROUTER
// =============================================================================

export const uioRouter = router({
  /**
   * List UIOs with filters.
   * Use type filter for commitments, decisions, etc.
   */
  list: protectedProcedure
    .input(listUIOsSchema)
    .query(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      await verifyOrgMembership(userId, input.organizationId);

      const conditions = [
        eq(unifiedIntelligenceObject.organizationId, input.organizationId),
      ];

      // Type filter (single or multiple)
      if (input.type) {
        conditions.push(eq(unifiedIntelligenceObject.type, input.type));
      } else if (input.types && input.types.length > 0) {
        conditions.push(inArray(unifiedIntelligenceObject.type, input.types));
      }

      // Status filter
      if (input.status) {
        conditions.push(eq(unifiedIntelligenceObject.status, input.status));
      } else if (input.statuses && input.statuses.length > 0) {
        conditions.push(
          inArray(unifiedIntelligenceObject.status, input.statuses)
        );
      } else if (!input.includeDismissed) {
        // By default, exclude dismissed
        conditions.push(
          eq(unifiedIntelligenceObject.isUserDismissed, false)
        );
      }

      // Confidence filter
      if (input.minConfidence !== undefined) {
        conditions.push(
          gte(unifiedIntelligenceObject.overallConfidence, input.minConfidence)
        );
      }

      // Owner filter
      if (input.hasOwner !== undefined) {
        if (input.hasOwner) {
          conditions.push(
            sql`${unifiedIntelligenceObject.ownerContactId} IS NOT NULL`
          );
        } else {
          conditions.push(
            sql`${unifiedIntelligenceObject.ownerContactId} IS NULL`
          );
        }
      }
      if (input.ownerId) {
        conditions.push(
          eq(unifiedIntelligenceObject.ownerContactId, input.ownerId)
        );
      }

      // Due date filters
      if (input.dueDateAfter) {
        conditions.push(gte(unifiedIntelligenceObject.dueDate, input.dueDateAfter));
      }
      if (input.dueDateBefore) {
        conditions.push(lte(unifiedIntelligenceObject.dueDate, input.dueDateBefore));
      }

      // Created date filters
      if (input.createdAfter) {
        conditions.push(gte(unifiedIntelligenceObject.createdAt, input.createdAfter));
      }
      if (input.createdBefore) {
        conditions.push(lte(unifiedIntelligenceObject.createdAt, input.createdBefore));
      }

      // Search
      if (input.search) {
        conditions.push(
          sql`(
            ${unifiedIntelligenceObject.canonicalTitle} ILIKE ${'%' + input.search + '%'}
            OR ${unifiedIntelligenceObject.canonicalDescription} ILIKE ${'%' + input.search + '%'}
          )`
        );
      }

      // Count total
      const [countResult] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(unifiedIntelligenceObject)
        .where(and(...conditions));

      const total = countResult?.count ?? 0;

      // Get UIOs with related data
      const items = await db.query.unifiedIntelligenceObject.findMany({
        where: and(...conditions),
        limit: input.limit,
        offset: input.offset,
        orderBy: [
          // Due date (urgent first, then by date)
          desc(
            sql`CASE WHEN ${unifiedIntelligenceObject.dueDate} < NOW() THEN 1 ELSE 0 END`
          ),
          desc(unifiedIntelligenceObject.dueDate),
          desc(unifiedIntelligenceObject.overallConfidence),
          desc(unifiedIntelligenceObject.lastUpdatedAt),
        ],
        with: {
          owner: {
            columns: {
              id: true,
              primaryEmail: true,
              displayName: true,
              avatarUrl: true,
            },
          },
          sources: {
            limit: 3,
            orderBy: (s, { desc }) => [desc(s.sourceTimestamp)],
            with: {
              conversation: {
                columns: {
                  id: true,
                  title: true,
                  snippet: true,
                },
              },
            },
          },
        },
      });

      return {
        items,
        total,
        hasMore: input.offset + items.length < total,
      };
    }),

  /**
   * Get a single UIO with full details.
   */
  get: protectedProcedure.input(getUIOSchema).query(async ({ ctx, input }) => {
    const userId = ctx.session.user.id;
    await verifyOrgMembership(userId, input.organizationId);

    const item = await db.query.unifiedIntelligenceObject.findFirst({
      where: and(
        eq(unifiedIntelligenceObject.id, input.id),
        eq(unifiedIntelligenceObject.organizationId, input.organizationId)
      ),
      with: {
        owner: true,
        sources: {
          orderBy: (s, { desc }) => [desc(s.sourceTimestamp)],
          with: {
            conversation: {
              with: {
                messages: {
                  orderBy: (m, { asc }) => [asc(m.messageIndex)],
                  limit: 10,
                },
              },
            },
          },
        },
        timeline: {
          orderBy: (t, { desc }) => [desc(t.eventAt)],
          limit: 20,
        },
      },
    });

    if (!item) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "Intelligence object not found.",
      });
    }

    return item;
  }),

  /**
   * Get a single UIO with its type-specific extension details.
   */
  getWithDetails: protectedProcedure
    .input(getUIOSchema)
    .query(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      await verifyOrgMembership(userId, input.organizationId);

      // Get base UIO
      const item = await db.query.unifiedIntelligenceObject.findFirst({
        where: and(
          eq(unifiedIntelligenceObject.id, input.id),
          eq(unifiedIntelligenceObject.organizationId, input.organizationId)
        ),
        with: {
          owner: true,
          sources: {
            orderBy: (s, { desc }) => [desc(s.sourceTimestamp)],
            limit: 5,
            with: {
              conversation: {
                columns: {
                  id: true,
                  title: true,
                  snippet: true,
                },
              },
            },
          },
          timeline: {
            orderBy: (t, { desc }) => [desc(t.eventAt)],
            limit: 10,
          },
          commitmentDetails: true,
          decisionDetails: true,
          claimDetails: true,
          taskDetails: true,
          riskDetails: true,
          briefDetails: true,
        },
      });

      if (!item) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Intelligence object not found.",
        });
      }

      // Return with type-specific details based on type
      return item;
    }),

  /**
   * List commitment UIOs with extension details.
   */
  listCommitments: protectedProcedure
    .input(
      z.object({
        organizationId: z.string().min(1),
        status: z.enum(["pending", "in_progress", "completed", "cancelled", "overdue", "waiting", "snoozed"]).optional(),
        direction: z.enum(["owed_by_me", "owed_to_me"]).optional(),
        priority: z.enum(["low", "medium", "high", "urgent"]).optional(),
        dueBefore: z.date().optional(),
        dueAfter: z.date().optional(),
        limit: z.number().int().min(1).max(100).default(50),
        offset: z.number().int().min(0).default(0),
      })
    )
    .query(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      await verifyOrgMembership(userId, input.organizationId);

      // Build conditions for base UIO
      const baseConditions = [
        eq(unifiedIntelligenceObject.organizationId, input.organizationId),
        eq(unifiedIntelligenceObject.type, "commitment"),
        eq(unifiedIntelligenceObject.isUserDismissed, false),
      ];

      if (input.dueBefore) {
        baseConditions.push(lte(unifiedIntelligenceObject.dueDate, input.dueBefore));
      }
      if (input.dueAfter) {
        baseConditions.push(gte(unifiedIntelligenceObject.dueDate, input.dueAfter));
      }

      // Get UIOs with commitment details
      const items = await db.query.unifiedIntelligenceObject.findMany({
        where: and(...baseConditions),
        limit: input.limit,
        offset: input.offset,
        orderBy: [
          desc(sql`CASE WHEN ${unifiedIntelligenceObject.dueDate} < NOW() THEN 1 ELSE 0 END`),
          desc(unifiedIntelligenceObject.dueDate),
          desc(unifiedIntelligenceObject.overallConfidence),
        ],
        with: {
          owner: {
            columns: {
              id: true,
              primaryEmail: true,
              displayName: true,
              avatarUrl: true,
            },
          },
          commitmentDetails: true,
          sources: {
            limit: 1,
            orderBy: (s, { desc }) => [desc(s.sourceTimestamp)],
          },
        },
      });

      // Filter by extension details if needed
      let filteredItems = items;
      if (input.status || input.direction || input.priority) {
        filteredItems = items.filter((item) => {
          const details = item.commitmentDetails;
          if (!details) return false;
          if (input.status && details.status !== input.status) return false;
          if (input.direction && details.direction !== input.direction) return false;
          if (input.priority && details.priority !== input.priority) return false;
          return true;
        });
      }

      // Count total
      const [countResult] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(unifiedIntelligenceObject)
        .where(and(...baseConditions));

      const total = countResult?.count ?? 0;

      return {
        items: filteredItems,
        total,
        hasMore: input.offset + items.length < total,
      };
    }),

  /**
   * List decision UIOs with extension details.
   */
  listDecisions: protectedProcedure
    .input(
      z.object({
        organizationId: z.string().min(1),
        status: z.enum(["made", "pending", "deferred", "reversed"]).optional(),
        limit: z.number().int().min(1).max(100).default(50),
        offset: z.number().int().min(0).default(0),
      })
    )
    .query(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      await verifyOrgMembership(userId, input.organizationId);

      const items = await db.query.unifiedIntelligenceObject.findMany({
        where: and(
          eq(unifiedIntelligenceObject.organizationId, input.organizationId),
          eq(unifiedIntelligenceObject.type, "decision"),
          eq(unifiedIntelligenceObject.isUserDismissed, false)
        ),
        limit: input.limit,
        offset: input.offset,
        orderBy: [desc(unifiedIntelligenceObject.lastUpdatedAt)],
        with: {
          owner: {
            columns: {
              id: true,
              primaryEmail: true,
              displayName: true,
            },
          },
          decisionDetails: true,
          sources: {
            limit: 1,
            orderBy: (s, { desc }) => [desc(s.sourceTimestamp)],
          },
        },
      });

      // Filter by status if provided
      const filteredItems = input.status
        ? items.filter((item) => item.decisionDetails?.status === input.status)
        : items;

      return {
        items: filteredItems,
        total: filteredItems.length,
      };
    }),

  /**
   * List task UIOs with extension details.
   */
  listTasks: protectedProcedure
    .input(
      z.object({
        organizationId: z.string().min(1),
        status: z.enum(["backlog", "todo", "in_progress", "in_review", "done", "cancelled"]).optional(),
        priority: z.enum(["no_priority", "low", "medium", "high", "urgent"]).optional(),
        assigneeId: z.string().optional(),
        project: z.string().optional(),
        limit: z.number().int().min(1).max(100).default(50),
        offset: z.number().int().min(0).default(0),
      })
    )
    .query(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      await verifyOrgMembership(userId, input.organizationId);

      const items = await db.query.unifiedIntelligenceObject.findMany({
        where: and(
          eq(unifiedIntelligenceObject.organizationId, input.organizationId),
          eq(unifiedIntelligenceObject.type, "task"),
          eq(unifiedIntelligenceObject.isUserDismissed, false)
        ),
        limit: input.limit,
        offset: input.offset,
        orderBy: [desc(unifiedIntelligenceObject.lastUpdatedAt)],
        with: {
          owner: {
            columns: {
              id: true,
              primaryEmail: true,
              displayName: true,
            },
          },
          taskDetails: true,
          sources: {
            limit: 1,
            orderBy: (s, { desc }) => [desc(s.sourceTimestamp)],
          },
        },
      });

      // Filter by details
      let filteredItems = items;
      if (input.status || input.priority || input.project || input.assigneeId) {
        filteredItems = items.filter((item) => {
          const details = item.taskDetails;
          if (!details) return false;
          if (input.status && details.status !== input.status) return false;
          if (input.priority && details.priority !== input.priority) return false;
          if (input.project && details.project !== input.project) return false;
          if (input.assigneeId && details.assigneeContactId !== input.assigneeId) return false;
          return true;
        });
      }

      return {
        items: filteredItems,
        total: filteredItems.length,
      };
    }),

  /**
   * List risk UIOs with extension details.
   */
  listRisks: protectedProcedure
    .input(
      z.object({
        organizationId: z.string().min(1),
        severity: z.enum(["low", "medium", "high", "critical"]).optional(),
        riskType: z.string().optional(),
        limit: z.number().int().min(1).max(100).default(50),
        offset: z.number().int().min(0).default(0),
      })
    )
    .query(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      await verifyOrgMembership(userId, input.organizationId);

      const items = await db.query.unifiedIntelligenceObject.findMany({
        where: and(
          eq(unifiedIntelligenceObject.organizationId, input.organizationId),
          eq(unifiedIntelligenceObject.type, "risk"),
          eq(unifiedIntelligenceObject.isUserDismissed, false)
        ),
        limit: input.limit,
        offset: input.offset,
        orderBy: [desc(unifiedIntelligenceObject.overallConfidence)],
        with: {
          riskDetails: true,
          sources: {
            limit: 1,
            orderBy: (s, { desc }) => [desc(s.sourceTimestamp)],
          },
        },
      });

      // Filter by details
      let filteredItems = items;
      if (input.severity || input.riskType) {
        filteredItems = items.filter((item) => {
          const details = item.riskDetails;
          if (!details) return false;
          if (input.severity && details.severity !== input.severity) return false;
          if (input.riskType && details.riskType !== input.riskType) return false;
          return true;
        });
      }

      return {
        items: filteredItems,
        total: filteredItems.length,
      };
    }),

  /**
   * List brief UIOs with extension details.
   */
  listBriefs: protectedProcedure
    .input(
      z.object({
        organizationId: z.string().min(1),
        priorityTier: z.enum(["urgent", "high", "medium", "low"]).optional(),
        suggestedAction: z.string().optional(),
        conversationId: z.string().optional(),
        limit: z.number().int().min(1).max(100).default(50),
        offset: z.number().int().min(0).default(0),
      })
    )
    .query(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      await verifyOrgMembership(userId, input.organizationId);

      const items = await db.query.unifiedIntelligenceObject.findMany({
        where: and(
          eq(unifiedIntelligenceObject.organizationId, input.organizationId),
          eq(unifiedIntelligenceObject.type, "brief"),
          eq(unifiedIntelligenceObject.isUserDismissed, false)
        ),
        limit: input.limit,
        offset: input.offset,
        orderBy: [desc(unifiedIntelligenceObject.lastUpdatedAt)],
        with: {
          briefDetails: true,
          sources: {
            limit: 1,
            orderBy: (s, { desc }) => [desc(s.sourceTimestamp)],
          },
        },
      });

      // Filter by details
      let filteredItems = items;
      if (input.priorityTier || input.suggestedAction || input.conversationId) {
        filteredItems = items.filter((item) => {
          const details = item.briefDetails;
          if (!details) return false;
          if (input.priorityTier && details.priorityTier !== input.priorityTier) return false;
          if (input.suggestedAction && details.suggestedAction !== input.suggestedAction) return false;
          if (input.conversationId && details.conversationId !== input.conversationId) return false;
          return true;
        });
      }

      return {
        items: filteredItems,
        total: filteredItems.length,
      };
    }),

  /**
   * Update a UIO.
   */
  update: protectedProcedure
    .input(updateUIOSchema)
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      await verifyOrgMembership(userId, input.organizationId);

      // Verify UIO exists and belongs to org
      const existing = await db.query.unifiedIntelligenceObject.findFirst({
        where: and(
          eq(unifiedIntelligenceObject.id, input.id),
          eq(unifiedIntelligenceObject.organizationId, input.organizationId)
        ),
      });

      if (!existing) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Intelligence object not found.",
        });
      }

      const updates: Partial<typeof unifiedIntelligenceObject.$inferInsert> = {
        updatedAt: new Date(),
      };

      if (input.status !== undefined) {
        updates.status = input.status;
      }
      if (input.title !== undefined) {
        updates.userCorrectedTitle = input.title;
        updates.isUserVerified = true;
      }
      if (input.description !== undefined) {
        updates.canonicalDescription = input.description;
      }
      if (input.dueDate !== undefined) {
        updates.dueDate = input.dueDate;
        updates.dueDateLastUpdatedAt = new Date();
      }
      if (input.isUserVerified !== undefined) {
        updates.isUserVerified = input.isUserVerified;
      }
      if (input.isUserDismissed !== undefined) {
        updates.isUserDismissed = input.isUserDismissed;
      }

      await db
        .update(unifiedIntelligenceObject)
        .set(updates)
        .where(eq(unifiedIntelligenceObject.id, input.id));

      return { success: true };
    }),

  /**
   * Dismiss a UIO (mark as incorrect extraction).
   */
  dismiss: protectedProcedure
    .input(getUIOSchema)
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      await verifyOrgMembership(userId, input.organizationId);

      await db
        .update(unifiedIntelligenceObject)
        .set({
          isUserDismissed: true,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(unifiedIntelligenceObject.id, input.id),
            eq(unifiedIntelligenceObject.organizationId, input.organizationId)
          )
        );

      return { success: true };
    }),

  /**
   * Verify a UIO (mark as correct extraction).
   */
  verify: protectedProcedure
    .input(getUIOSchema)
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      await verifyOrgMembership(userId, input.organizationId);

      await db
        .update(unifiedIntelligenceObject)
        .set({
          isUserVerified: true,
          isUserDismissed: false,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(unifiedIntelligenceObject.id, input.id),
            eq(unifiedIntelligenceObject.organizationId, input.organizationId)
          )
        );

      return { success: true };
    }),

  /**
   * Archive a UIO.
   */
  archive: protectedProcedure
    .input(getUIOSchema)
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      await verifyOrgMembership(userId, input.organizationId);

      await db
        .update(unifiedIntelligenceObject)
        .set({
          status: "archived",
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(unifiedIntelligenceObject.id, input.id),
            eq(unifiedIntelligenceObject.organizationId, input.organizationId)
          )
        );

      return { success: true };
    }),

  /**
   * Get statistics for dashboard.
   */
  getStats: protectedProcedure
    .input(z.object({ organizationId: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      await verifyOrgMembership(userId, input.organizationId);

      const now = new Date();
      const weekFromNow = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

      // Get all active UIOs
      const allUIOs = await db.query.unifiedIntelligenceObject.findMany({
        where: and(
          eq(unifiedIntelligenceObject.organizationId, input.organizationId),
          eq(unifiedIntelligenceObject.isUserDismissed, false),
          eq(unifiedIntelligenceObject.status, "active")
        ),
      });

      const commitments = allUIOs.filter((u) => u.type === "commitment");
      const decisions = allUIOs.filter((u) => u.type === "decision");
      const topics = allUIOs.filter((u) => u.type === "topic");
      const claims = allUIOs.filter((u) => u.type === "claim");
      const tasks = allUIOs.filter((u) => u.type === "task");
      const risks = allUIOs.filter((u) => u.type === "risk");
      const briefs = allUIOs.filter((u) => u.type === "brief");

      const overdue = commitments.filter(
        (c) => c.dueDate && c.dueDate < now
      );
      const dueThisWeek = commitments.filter((c) => {
        if (!c.dueDate) return false;
        return c.dueDate >= now && c.dueDate <= weekFromNow;
      });

      const recentDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

      return {
        total: allUIOs.length,
        byType: {
          commitment: commitments.length,
          decision: decisions.length,
          topic: topics.length,
          claim: claims.length,
          task: tasks.length,
          risk: risks.length,
          brief: briefs.length,
        },
        commitments: {
          total: commitments.length,
          overdue: overdue.length,
          dueThisWeek: dueThisWeek.length,
        },
        decisions: {
          total: decisions.length,
          recentCount: decisions.filter((d) => d.createdAt > recentDate).length,
        },
        tasks: {
          total: tasks.length,
          recentCount: tasks.filter((t) => t.createdAt > recentDate).length,
        },
        risks: {
          total: risks.length,
          highSeverityCount: 0, // Would need to join with extension table
        },
        claims: {
          total: claims.length,
        },
        briefs: {
          total: briefs.length,
        },
      };
    }),

  /**
   * Get overdue commitments.
   */
  getOverdue: protectedProcedure
    .input(
      z.object({
        organizationId: z.string().min(1),
        limit: z.number().int().min(1).max(50).default(20),
      })
    )
    .query(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      await verifyOrgMembership(userId, input.organizationId);

      const now = new Date();

      const overdueItems = await db.query.unifiedIntelligenceObject.findMany({
        where: and(
          eq(unifiedIntelligenceObject.organizationId, input.organizationId),
          eq(unifiedIntelligenceObject.type, "commitment"),
          eq(unifiedIntelligenceObject.status, "active"),
          eq(unifiedIntelligenceObject.isUserDismissed, false),
          lte(unifiedIntelligenceObject.dueDate, now),
          sql`${unifiedIntelligenceObject.dueDate} IS NOT NULL`
        ),
        limit: input.limit,
        orderBy: [desc(unifiedIntelligenceObject.dueDate)],
        with: {
          owner: {
            columns: {
              id: true,
              primaryEmail: true,
              displayName: true,
            },
          },
        },
      });

      // Calculate days overdue
      const withDaysOverdue = overdueItems.map((item) => ({
        ...item,
        daysOverdue: item.dueDate
          ? Math.floor(
              (now.getTime() - item.dueDate.getTime()) / (1000 * 60 * 60 * 24)
            )
          : 0,
      }));

      return {
        items: withDaysOverdue,
        total: withDaysOverdue.length,
      };
    }),
});
