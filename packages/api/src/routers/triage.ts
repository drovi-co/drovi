// =============================================================================
// TRIAGE ROUTER (PRD-07)
// =============================================================================
//
// API for triage automation - action suggestions, rules, and inbox summaries.
//

import { db } from "@memorystack/db";
import {
  emailAccount,
  emailThread,
  member,
  type TriageRuleTrigger,
  triageResult,
  triageRule,
} from "@memorystack/db/schema";
import { TRPCError } from "@trpc/server";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { protectedProcedure, router } from "../index";

// =============================================================================
// INPUT SCHEMAS
// =============================================================================

const listSuggestionsSchema = z.object({
  organizationId: z.string().min(1),
  accountId: z.string().uuid().optional(),
  limit: z.number().int().min(1).max(100).default(50),
  offset: z.number().int().min(0).default(0),
  action: z
    .enum([
      "respond",
      "archive",
      "delegate",
      "schedule",
      "wait",
      "escalate",
      "review",
    ])
    .optional(),
  priorityTier: z.enum(["urgent", "high", "medium", "low"]).optional(),
});

const getSuggestionSchema = z.object({
  organizationId: z.string().min(1),
  threadId: z.string().uuid(),
});

const applySuggestionSchema = z.object({
  organizationId: z.string().min(1),
  threadId: z.string().uuid(),
  accepted: z.boolean(),
  feedback: z.string().optional(),
  actionTaken: z.string().optional(),
});

const listRulesSchema = z.object({
  organizationId: z.string().min(1),
  accountId: z.string().uuid().optional(),
  enabled: z.boolean().optional(),
});

const createRuleSchema = z.object({
  organizationId: z.string().min(1),
  accountId: z.string().uuid(),
  name: z.string().min(1).max(100),
  description: z.string().optional(),
  trigger: z.object({
    type: z.enum(["sender", "subject", "content", "label"]),
    condition: z.enum(["contains", "equals", "matches"]),
    value: z.string().min(1),
  }),
  action: z.enum(["archive", "label", "forward", "priority"]),
  actionValue: z.string().optional(),
  priority: z.number().int().min(0).default(0),
});

const updateRuleSchema = z.object({
  organizationId: z.string().min(1),
  ruleId: z.string().uuid(),
  name: z.string().min(1).max(100).optional(),
  description: z.string().optional(),
  trigger: z
    .object({
      type: z.enum(["sender", "subject", "content", "label"]),
      condition: z.enum(["contains", "equals", "matches"]),
      value: z.string().min(1),
    })
    .optional(),
  action: z.enum(["archive", "label", "forward", "priority"]).optional(),
  actionValue: z.string().optional(),
  enabled: z.boolean().optional(),
  priority: z.number().int().min(0).optional(),
});

const deleteRuleSchema = z.object({
  organizationId: z.string().min(1),
  ruleId: z.string().uuid(),
});

const getInboxSummarySchema = z.object({
  organizationId: z.string().min(1),
  accountId: z.string().uuid().optional(),
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

async function verifyAccountAccess(
  organizationId: string,
  accountId: string
): Promise<typeof emailAccount.$inferSelect> {
  const account = await db.query.emailAccount.findFirst({
    where: and(
      eq(emailAccount.id, accountId),
      eq(emailAccount.organizationId, organizationId)
    ),
  });

  if (!account) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Email account not found.",
    });
  }

  return account;
}

async function getOrgAccountIds(organizationId: string): Promise<string[]> {
  const accounts = await db
    .select({ id: emailAccount.id })
    .from(emailAccount)
    .where(eq(emailAccount.organizationId, organizationId));

  return accounts.map((a) => a.id);
}

// =============================================================================
// ROUTER
// =============================================================================

export const triageRouter = router({
  /**
   * List triage suggestions for organization threads.
   */
  listSuggestions: protectedProcedure
    .input(listSuggestionsSchema)
    .query(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      await verifyOrgMembership(userId, input.organizationId);

      // Get account IDs
      let accountIds: string[];
      if (input.accountId) {
        await verifyAccountAccess(input.organizationId, input.accountId);
        accountIds = [input.accountId];
      } else {
        accountIds = await getOrgAccountIds(input.organizationId);
      }

      if (accountIds.length === 0) {
        return { suggestions: [], total: 0, hasMore: false };
      }

      // Build conditions
      const conditions = [inArray(triageResult.accountId, accountIds)];

      if (input.action) {
        conditions.push(eq(triageResult.suggestedAction, input.action));
      }

      if (input.priorityTier) {
        conditions.push(eq(triageResult.priorityTier, input.priorityTier));
      }

      // Count total
      const [countResult] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(triageResult)
        .where(and(...conditions));

      const total = countResult?.count ?? 0;

      // Get suggestions with thread info
      const suggestions = await db
        .select({
          id: triageResult.id,
          threadId: triageResult.threadId,
          suggestedAction: triageResult.suggestedAction,
          confidence: triageResult.confidence,
          reasoning: triageResult.reasoning,
          priorityTier: triageResult.priorityTier,
          urgencyScore: triageResult.urgencyScore,
          importanceScore: triageResult.importanceScore,
          usedLlm: triageResult.usedLlm,
          userAccepted: triageResult.userAccepted,
          createdAt: triageResult.createdAt,
          // Thread info
          threadSubject: emailThread.subject,
          threadSnippet: emailThread.snippet,
          threadLastMessageAt: emailThread.lastMessageAt,
        })
        .from(triageResult)
        .innerJoin(emailThread, eq(triageResult.threadId, emailThread.id))
        .where(and(...conditions))
        .orderBy(desc(triageResult.urgencyScore), desc(triageResult.createdAt))
        .limit(input.limit)
        .offset(input.offset);

      return {
        suggestions,
        total,
        hasMore: input.offset + suggestions.length < total,
      };
    }),

  /**
   * Get triage suggestion for a specific thread.
   */
  getSuggestion: protectedProcedure
    .input(getSuggestionSchema)
    .query(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      await verifyOrgMembership(userId, input.organizationId);

      const suggestion = await db.query.triageResult.findFirst({
        where: eq(triageResult.threadId, input.threadId),
      });

      if (!suggestion) {
        return null;
      }

      // Verify thread belongs to organization
      const thread = await db.query.emailThread.findFirst({
        where: eq(emailThread.id, input.threadId),
        with: {
          account: {
            columns: { organizationId: true },
          },
        },
      });

      if (!thread || thread.account.organizationId !== input.organizationId) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Thread not found.",
        });
      }

      return suggestion;
    }),

  /**
   * Apply (accept/reject) a triage suggestion.
   */
  applySuggestion: protectedProcedure
    .input(applySuggestionSchema)
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      await verifyOrgMembership(userId, input.organizationId);

      // Verify thread belongs to organization
      const thread = await db.query.emailThread.findFirst({
        where: eq(emailThread.id, input.threadId),
        with: {
          account: {
            columns: { organizationId: true },
          },
        },
      });

      if (!thread || thread.account.organizationId !== input.organizationId) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Thread not found.",
        });
      }

      // Update the triage result with user feedback
      await db
        .update(triageResult)
        .set({
          userAccepted: input.accepted,
          userFeedback: input.feedback,
          userActionTaken: input.actionTaken,
          updatedAt: new Date(),
        })
        .where(eq(triageResult.threadId, input.threadId));

      return { success: true };
    }),

  /**
   * Get inbox summary with triage statistics.
   */
  getInboxSummary: protectedProcedure
    .input(getInboxSummarySchema)
    .query(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      await verifyOrgMembership(userId, input.organizationId);

      // Get account IDs
      let accountIds: string[];
      if (input.accountId) {
        await verifyAccountAccess(input.organizationId, input.accountId);
        accountIds = [input.accountId];
      } else {
        accountIds = await getOrgAccountIds(input.organizationId);
      }

      if (accountIds.length === 0) {
        return {
          total: 0,
          byAction: {},
          byPriority: {},
          pendingReview: 0,
        };
      }

      // Get action counts
      const actionCounts = await db
        .select({
          action: triageResult.suggestedAction,
          count: sql<number>`count(*)::int`,
        })
        .from(triageResult)
        .where(inArray(triageResult.accountId, accountIds))
        .groupBy(triageResult.suggestedAction);

      // Get priority counts
      const priorityCounts = await db
        .select({
          priority: triageResult.priorityTier,
          count: sql<number>`count(*)::int`,
        })
        .from(triageResult)
        .where(inArray(triageResult.accountId, accountIds))
        .groupBy(triageResult.priorityTier);

      // Get pending review count (not yet accepted/rejected)
      const [pendingResult] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(triageResult)
        .where(
          and(
            inArray(triageResult.accountId, accountIds),
            sql`${triageResult.userAccepted} IS NULL`
          )
        );

      const total = actionCounts.reduce((sum, a) => sum + a.count, 0);

      return {
        total,
        byAction: Object.fromEntries(
          actionCounts.map((a) => [a.action, a.count])
        ),
        byPriority: Object.fromEntries(
          priorityCounts.map((p) => [p.priority, p.count])
        ),
        pendingReview: pendingResult?.count ?? 0,
      };
    }),

  // =========================================================================
  // RULES MANAGEMENT
  // =========================================================================

  /**
   * List triage rules.
   */
  listRules: protectedProcedure
    .input(listRulesSchema)
    .query(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      await verifyOrgMembership(userId, input.organizationId);

      // Get account IDs
      let accountIds: string[];
      if (input.accountId) {
        await verifyAccountAccess(input.organizationId, input.accountId);
        accountIds = [input.accountId];
      } else {
        accountIds = await getOrgAccountIds(input.organizationId);
      }

      if (accountIds.length === 0) {
        return { rules: [] };
      }

      const conditions = [inArray(triageRule.accountId, accountIds)];

      if (input.enabled !== undefined) {
        conditions.push(eq(triageRule.enabled, input.enabled));
      }

      const rules = await db.query.triageRule.findMany({
        where: and(...conditions),
        orderBy: [desc(triageRule.priority), desc(triageRule.createdAt)],
      });

      return { rules };
    }),

  /**
   * Get a specific rule.
   */
  getRule: protectedProcedure
    .input(
      z.object({
        organizationId: z.string().min(1),
        ruleId: z.string().uuid(),
      })
    )
    .query(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      await verifyOrgMembership(userId, input.organizationId);

      const rule = await db.query.triageRule.findFirst({
        where: eq(triageRule.id, input.ruleId),
      });

      if (!rule) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Rule not found.",
        });
      }

      // Verify rule belongs to organization
      await verifyAccountAccess(input.organizationId, rule.accountId);

      return rule;
    }),

  /**
   * Create a new triage rule.
   */
  createRule: protectedProcedure
    .input(createRuleSchema)
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      await verifyOrgMembership(userId, input.organizationId);
      await verifyAccountAccess(input.organizationId, input.accountId);

      const [rule] = await db
        .insert(triageRule)
        .values({
          accountId: input.accountId,
          name: input.name,
          description: input.description,
          trigger: input.trigger as TriageRuleTrigger,
          action: input.action,
          actionValue: input.actionValue,
          priority: input.priority,
          isUserCreated: true,
          suggestedByAi: false,
        })
        .returning();

      return rule;
    }),

  /**
   * Update a triage rule.
   */
  updateRule: protectedProcedure
    .input(updateRuleSchema)
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      await verifyOrgMembership(userId, input.organizationId);

      // Verify rule exists and belongs to organization
      const existingRule = await db.query.triageRule.findFirst({
        where: eq(triageRule.id, input.ruleId),
      });

      if (!existingRule) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Rule not found.",
        });
      }

      await verifyAccountAccess(input.organizationId, existingRule.accountId);

      // Build updates
      const updates: Partial<typeof triageRule.$inferInsert> = {
        updatedAt: new Date(),
      };

      if (input.name !== undefined) updates.name = input.name;
      if (input.description !== undefined)
        updates.description = input.description;
      if (input.trigger !== undefined)
        updates.trigger = input.trigger as TriageRuleTrigger;
      if (input.action !== undefined) updates.action = input.action;
      if (input.actionValue !== undefined)
        updates.actionValue = input.actionValue;
      if (input.enabled !== undefined) updates.enabled = input.enabled;
      if (input.priority !== undefined) updates.priority = input.priority;

      const [updatedRule] = await db
        .update(triageRule)
        .set(updates)
        .where(eq(triageRule.id, input.ruleId))
        .returning();

      return updatedRule;
    }),

  /**
   * Delete a triage rule.
   */
  deleteRule: protectedProcedure
    .input(deleteRuleSchema)
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      await verifyOrgMembership(userId, input.organizationId);

      // Verify rule exists and belongs to organization
      const existingRule = await db.query.triageRule.findFirst({
        where: eq(triageRule.id, input.ruleId),
      });

      if (!existingRule) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Rule not found.",
        });
      }

      await verifyAccountAccess(input.organizationId, existingRule.accountId);

      await db.delete(triageRule).where(eq(triageRule.id, input.ruleId));

      return { success: true };
    }),

  /**
   * Toggle rule enabled state.
   */
  toggleRule: protectedProcedure
    .input(
      z.object({
        organizationId: z.string().min(1),
        ruleId: z.string().uuid(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      await verifyOrgMembership(userId, input.organizationId);

      const existingRule = await db.query.triageRule.findFirst({
        where: eq(triageRule.id, input.ruleId),
      });

      if (!existingRule) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Rule not found.",
        });
      }

      await verifyAccountAccess(input.organizationId, existingRule.accountId);

      const [updatedRule] = await db
        .update(triageRule)
        .set({
          enabled: !existingRule.enabled,
          updatedAt: new Date(),
        })
        .where(eq(triageRule.id, input.ruleId))
        .returning();

      return updatedRule;
    }),

  /**
   * Get suggested rules based on user behavior patterns.
   */
  getSuggestedRules: protectedProcedure
    .input(
      z.object({
        organizationId: z.string().min(1),
        accountId: z.string().uuid(),
      })
    )
    .query(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      await verifyOrgMembership(userId, input.organizationId);
      await verifyAccountAccess(input.organizationId, input.accountId);

      // Get AI-suggested rules that haven't been created yet
      const suggestedRules = await db.query.triageRule.findMany({
        where: and(
          eq(triageRule.accountId, input.accountId),
          eq(triageRule.suggestedByAi, true),
          eq(triageRule.isUserCreated, false)
        ),
        orderBy: [desc(triageRule.suggestionConfidence)],
        limit: 10,
      });

      return { suggestedRules };
    }),

  /**
   * Accept a suggested rule (mark as user-created).
   */
  acceptSuggestedRule: protectedProcedure
    .input(
      z.object({
        organizationId: z.string().min(1),
        ruleId: z.string().uuid(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      await verifyOrgMembership(userId, input.organizationId);

      const existingRule = await db.query.triageRule.findFirst({
        where: eq(triageRule.id, input.ruleId),
      });

      if (!existingRule) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Rule not found.",
        });
      }

      await verifyAccountAccess(input.organizationId, existingRule.accountId);

      const [updatedRule] = await db
        .update(triageRule)
        .set({
          isUserCreated: true,
          enabled: true,
          updatedAt: new Date(),
        })
        .where(eq(triageRule.id, input.ruleId))
        .returning();

      return updatedRule;
    }),
});
