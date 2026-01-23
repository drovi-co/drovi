// =============================================================================
// DECISIONS ROUTER
// =============================================================================
//
// API for managing decisions extracted from email threads.
// Supports CRUD operations, querying, and supersession tracking.
//

import { db } from "@memorystack/db";

// =============================================================================
// NOTE: Decision AI functionality has been moved to Python backend.
// AI-powered procedures return migration errors.
// =============================================================================
import { contact, decision, member, topic } from "@memorystack/db/schema";
import { TRPCError } from "@trpc/server";
import { and, desc, eq, gte, inArray, isNull, lte, or, sql } from "drizzle-orm";
import { z } from "zod";
import { protectedProcedure, router } from "../index";

// =============================================================================
// INPUT SCHEMAS
// =============================================================================

const listDecisionsSchema = z.object({
  organizationId: z.string().min(1),
  limit: z.number().int().min(1).max(100).default(50),
  offset: z.number().int().min(0).default(0),
  // Filters
  minConfidence: z.number().min(0).max(1).optional(),
  topicId: z.string().uuid().optional(),
  // Date filters
  decidedAfter: z.date().optional(),
  decidedBefore: z.date().optional(),
  // Supersession filter
  includeSuperseded: z.boolean().default(false),
  // Include dismissed
  includeDismissed: z.boolean().default(false),
  // Search
  search: z.string().optional(),
});

const getDecisionSchema = z.object({
  organizationId: z.string().min(1),
  decisionId: z.string().uuid(),
});

const updateDecisionSchema = z.object({
  organizationId: z.string().min(1),
  decisionId: z.string().uuid(),
  // Content updates
  title: z.string().optional(),
  statement: z.string().optional(),
  rationale: z.string().optional(),
  // User corrections
  isUserVerified: z.boolean().optional(),
  isUserDismissed: z.boolean().optional(),
  // Topics
  topicIds: z.array(z.string()).optional(),
});

const queryDecisionsSchema = z.object({
  organizationId: z.string().min(1),
  query: z.string().min(1).max(500),
  limit: z.number().int().min(1).max(20).default(10),
});

const getSupersessionChainSchema = z.object({
  organizationId: z.string().min(1),
  decisionId: z.string().uuid(),
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

async function verifyDecisionAccess(
  organizationId: string,
  decisionId: string
): Promise<typeof decision.$inferSelect> {
  const found = await db.query.decision.findFirst({
    where: eq(decision.id, decisionId),
  });

  if (!found || found.organizationId !== organizationId) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Decision not found.",
    });
  }

  return found;
}

// =============================================================================
// ROUTER
// =============================================================================

export const decisionsRouter = router({
  /**
   * List decisions with filters.
   */
  list: protectedProcedure
    .input(listDecisionsSchema)
    .query(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      await verifyOrgMembership(userId, input.organizationId);

      const conditions = [eq(decision.organizationId, input.organizationId)];

      // Confidence filter
      if (input.minConfidence !== undefined) {
        conditions.push(gte(decision.confidence, input.minConfidence));
      }

      // Topic filter
      if (input.topicId) {
        conditions.push(sql`${input.topicId} = ANY(${decision.topicIds})`);
      }

      // Date filters
      if (input.decidedAfter) {
        conditions.push(gte(decision.decidedAt, input.decidedAfter));
      }

      if (input.decidedBefore) {
        conditions.push(lte(decision.decidedAt, input.decidedBefore));
      }

      // Supersession filter
      if (!input.includeSuperseded) {
        conditions.push(isNull(decision.supersededById));
      }

      // Dismissed filter
      if (!input.includeDismissed) {
        conditions.push(eq(decision.isUserDismissed, false));
      }

      // Search in title and statement
      if (input.search) {
        const searchPattern = `%${input.search}%`;
        const searchCondition = or(
          sql`${decision.title} ILIKE ${searchPattern}`,
          sql`${decision.statement} ILIKE ${searchPattern}`,
          sql`${decision.rationale} ILIKE ${searchPattern}`
        );
        if (searchCondition) {
          conditions.push(searchCondition);
        }
      }

      // Count total
      const [countResult] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(decision)
        .where(and(...conditions));

      const total = countResult?.count ?? 0;

      // Get decisions
      const decisions = await db.query.decision.findMany({
        where: and(...conditions),
        limit: input.limit,
        offset: input.offset,
        orderBy: [desc(decision.decidedAt)],
        with: {
          sourceConversation: {
            columns: {
              id: true,
              title: true,
              snippet: true,
            },
          },
        },
      });

      // Resolve owner contacts
      const ownerContactIds = decisions.flatMap((d) => d.ownerContactIds ?? []);
      const uniqueOwnerIds = [...new Set(ownerContactIds)];

      let ownerContacts: (typeof contact.$inferSelect)[] = [];
      if (uniqueOwnerIds.length > 0) {
        ownerContacts = await db.query.contact.findMany({
          where: inArray(contact.id, uniqueOwnerIds),
        });
      }

      const contactMap = new Map(ownerContacts.map((c) => [c.id, c]));

      const decisionsWithOwners = decisions.map((d) => ({
        ...d,
        owners: (d.ownerContactIds ?? [])
          .map((id) => contactMap.get(id))
          .filter(Boolean),
      }));

      return {
        decisions: decisionsWithOwners,
        total,
        hasMore: input.offset + decisions.length < total,
      };
    }),

  /**
   * Get decision details.
   */
  get: protectedProcedure
    .input(getDecisionSchema)
    .query(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      await verifyOrgMembership(userId, input.organizationId);

      const found = await db.query.decision.findFirst({
        where: eq(decision.id, input.decisionId),
        with: {
          sourceConversation: {
            with: {
              messages: {
                limit: 10,
              },
            },
          },
          claim: true,
        },
      });

      if (!found || found.organizationId !== input.organizationId) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Decision not found.",
        });
      }

      // Get owners and participants
      const allContactIds = [
        ...(found.ownerContactIds ?? []),
        ...(found.participantContactIds ?? []),
      ];

      let contacts: (typeof contact.$inferSelect)[] = [];
      if (allContactIds.length > 0) {
        contacts = await db.query.contact.findMany({
          where: inArray(contact.id, allContactIds),
        });
      }

      const contactMap = new Map(contacts.map((c) => [c.id, c]));

      // Get supersession info
      let supersededBy = null;
      let supersedes = null;

      if (found.supersededById) {
        supersededBy = await db.query.decision.findFirst({
          where: eq(decision.id, found.supersededById),
          columns: {
            id: true,
            title: true,
            statement: true,
            decidedAt: true,
          },
        });
      }

      if (found.supersedes) {
        supersedes = await db.query.decision.findFirst({
          where: eq(decision.id, found.supersedes),
          columns: {
            id: true,
            title: true,
            statement: true,
            decidedAt: true,
          },
        });
      }

      // Get topics
      let topics: (typeof topic.$inferSelect)[] = [];
      if (found.topicIds && found.topicIds.length > 0) {
        topics = await db.query.topic.findMany({
          where: inArray(topic.id, found.topicIds),
        });
      }

      return {
        ...found,
        owners: (found.ownerContactIds ?? [])
          .map((id) => contactMap.get(id))
          .filter(Boolean),
        participants: (found.participantContactIds ?? [])
          .map((id) => contactMap.get(id))
          .filter(Boolean),
        supersededBy,
        supersedes,
        topics,
      };
    }),

  /**
   * Update a decision.
   */
  update: protectedProcedure
    .input(updateDecisionSchema)
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      await verifyOrgMembership(userId, input.organizationId);
      await verifyDecisionAccess(input.organizationId, input.decisionId);

      const updates: Partial<typeof decision.$inferInsert> = {
        updatedAt: new Date(),
      };

      if (input.title !== undefined) {
        updates.title = input.title;
        updates.isUserVerified = true;
      }

      if (input.statement !== undefined) {
        updates.statement = input.statement;
        updates.isUserVerified = true;
      }

      if (input.rationale !== undefined) {
        updates.rationale = input.rationale;
      }

      if (input.isUserVerified !== undefined) {
        updates.isUserVerified = input.isUserVerified;
      }

      if (input.isUserDismissed !== undefined) {
        updates.isUserDismissed = input.isUserDismissed;
      }

      if (input.topicIds !== undefined) {
        updates.topicIds = input.topicIds;
      }

      await db
        .update(decision)
        .set(updates)
        .where(eq(decision.id, input.decisionId));

      return { success: true };
    }),

  /**
   * Dismiss a decision (mark as incorrect extraction).
   */
  dismiss: protectedProcedure
    .input(getDecisionSchema)
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      await verifyOrgMembership(userId, input.organizationId);
      await verifyDecisionAccess(input.organizationId, input.decisionId);

      await db
        .update(decision)
        .set({
          isUserDismissed: true,
          updatedAt: new Date(),
        })
        .where(eq(decision.id, input.decisionId));

      return { success: true };
    }),

  /**
   * Verify a decision (mark as correct extraction).
   */
  verify: protectedProcedure
    .input(getDecisionSchema)
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      await verifyOrgMembership(userId, input.organizationId);
      await verifyDecisionAccess(input.organizationId, input.decisionId);

      await db
        .update(decision)
        .set({
          isUserVerified: true,
          isUserDismissed: false,
          updatedAt: new Date(),
        })
        .where(eq(decision.id, input.decisionId));

      return { success: true };
    }),

  /**
   * Query decisions using natural language.
   * E.g., "What did we decide about pricing?"
   */
  query: protectedProcedure
    .input(queryDecisionsSchema)
    .output(
      z.object({
        relevantDecisions: z.array(
          z.object({
            id: z.string(),
            title: z.string(),
            statement: z.string(),
            rationale: z.string().nullable().optional(),
            confidence: z.number(),
            decidedAt: z.date(),
            relevanceScore: z.number().optional(),
          })
        ),
        answer: z.string(),
      })
    )
    .query(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      await verifyOrgMembership(userId, input.organizationId);

      // Get recent decisions for the organization
      const recentDecisions = await db.query.decision.findMany({
        where: and(
          eq(decision.organizationId, input.organizationId),
          eq(decision.isUserDismissed, false),
          isNull(decision.supersededById)
        ),
        limit: 100, // Search within recent 100 decisions
        orderBy: [desc(decision.decidedAt)],
      });

      if (recentDecisions.length === 0) {
        return {
          relevantDecisions: [],
          answer: "No decisions have been recorded yet.",
        };
      }

      // NOTE: AI-powered decision query has been migrated to Python backend
      throw new TRPCError({
        code: "NOT_IMPLEMENTED",
        message:
          "AI-powered decision querying is being migrated to Python backend. " +
          "Use /api/v1/memory/search for decision search.",
      });
    }),

  /**
   * Get the supersession chain for a decision.
   */
  getSupersessionChain: protectedProcedure
    .input(getSupersessionChainSchema)
    .query(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      await verifyOrgMembership(userId, input.organizationId);

      const found = await verifyDecisionAccess(
        input.organizationId,
        input.decisionId
      );

      const chain: Array<{
        id: string;
        title: string;
        statement: string;
        decidedAt: Date;
        isCurrent: boolean;
        supersededAt?: Date;
      }> = [];

      // Walk backwards to find earliest
      let currentId: string | null = found.supersedes;
      while (currentId) {
        const older = await db.query.decision.findFirst({
          where: eq(decision.id, currentId),
        });
        if (older && older.organizationId === input.organizationId) {
          chain.unshift({
            id: older.id,
            title: older.title,
            statement: older.statement,
            decidedAt: older.decidedAt,
            isCurrent: false,
            supersededAt: older.supersededAt ?? undefined,
          });
          currentId = older.supersedes;
        } else {
          break;
        }
      }

      // Add the requested decision
      chain.push({
        id: found.id,
        title: found.title,
        statement: found.statement,
        decidedAt: found.decidedAt,
        isCurrent: !found.supersededById,
        supersededAt: found.supersededAt ?? undefined,
      });

      // Walk forward to find latest
      currentId = found.supersededById;
      while (currentId) {
        const newer = await db.query.decision.findFirst({
          where: eq(decision.id, currentId),
        });
        if (newer && newer.organizationId === input.organizationId) {
          chain.push({
            id: newer.id,
            title: newer.title,
            statement: newer.statement,
            decidedAt: newer.decidedAt,
            isCurrent: !newer.supersededById,
            supersededAt: newer.supersededAt ?? undefined,
          });
          currentId = newer.supersededById;
        } else {
          break;
        }
      }

      return { chain };
    }),

  /**
   * Get decisions by topic.
   */
  getByTopic: protectedProcedure
    .input(
      z.object({
        organizationId: z.string().min(1),
        topicId: z.string().uuid(),
        limit: z.number().int().min(1).max(50).default(20),
      })
    )
    .query(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      await verifyOrgMembership(userId, input.organizationId);

      // Verify topic belongs to organization
      const topicRecord = await db.query.topic.findFirst({
        where: eq(topic.id, input.topicId),
      });

      if (!topicRecord || topicRecord.organizationId !== input.organizationId) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Topic not found.",
        });
      }

      const decisions = await db.query.decision.findMany({
        where: and(
          eq(decision.organizationId, input.organizationId),
          eq(decision.isUserDismissed, false),
          isNull(decision.supersededById),
          sql`${input.topicId} = ANY(${decision.topicIds})`
        ),
        limit: input.limit,
        orderBy: [desc(decision.decidedAt)],
      });

      return {
        topic: topicRecord,
        decisions,
      };
    }),

  /**
   * Get recent decisions for dashboard.
   */
  getRecent: protectedProcedure
    .input(
      z.object({
        organizationId: z.string().min(1),
        limit: z.number().int().min(1).max(20).default(10),
      })
    )
    .query(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      await verifyOrgMembership(userId, input.organizationId);

      const decisions = await db.query.decision.findMany({
        where: and(
          eq(decision.organizationId, input.organizationId),
          eq(decision.isUserDismissed, false),
          isNull(decision.supersededById)
        ),
        limit: input.limit,
        orderBy: [desc(decision.decidedAt)],
        with: {
          sourceConversation: {
            columns: {
              id: true,
              title: true,
            },
          },
        },
      });

      return { decisions };
    }),

  /**
   * Get decision statistics for dashboard.
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

      const monthAgo = new Date();
      monthAgo.setMonth(monthAgo.getMonth() - 1);

      const weekAgo = new Date();
      weekAgo.setDate(weekAgo.getDate() - 7);

      // Get all decisions
      const allDecisions = await db.query.decision.findMany({
        where: and(
          eq(decision.organizationId, input.organizationId),
          eq(decision.isUserDismissed, false)
        ),
      });

      const active = allDecisions.filter((d) => !d.supersededById);
      const superseded = allDecisions.filter((d) => d.supersededById);

      const thisMonth = allDecisions.filter((d) => d.decidedAt >= monthAgo);
      const thisWeek = allDecisions.filter((d) => d.decidedAt >= weekAgo);

      // Group by topic
      const topicCounts = new Map<string, number>();
      for (const d of active) {
        for (const topicId of d.topicIds ?? []) {
          topicCounts.set(topicId, (topicCounts.get(topicId) ?? 0) + 1);
        }
      }

      // Get top topics
      const topTopicIds = [...topicCounts.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([id]) => id);

      let topTopics: Array<{ id: string; name: string; count: number }> = [];
      if (topTopicIds.length > 0) {
        const topics = await db.query.topic.findMany({
          where: inArray(topic.id, topTopicIds),
        });
        topTopics = topics.map((t) => ({
          id: t.id,
          name: t.name,
          count: topicCounts.get(t.id) ?? 0,
        }));
      }

      // Average confidence
      const avgConfidence =
        active.length > 0
          ? active.reduce((sum, d) => sum + d.confidence, 0) / active.length
          : 0;

      return {
        total: active.length,
        superseded: superseded.length,
        thisMonth: thisMonth.length,
        thisWeek: thisWeek.length,
        avgConfidence: Math.round(avgConfidence * 100) / 100,
        topTopics,
        verifiedCount: active.filter((d) => d.isUserVerified).length,
      };
    }),
});
