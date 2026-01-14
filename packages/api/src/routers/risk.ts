// =============================================================================
// RISK ROUTER (PRD-09)
// =============================================================================
//
// API for risk analysis - contradiction detection, fraud signals, sensitive data,
// and policy enforcement.
//

import { db } from "@memorystack/db";
import {
  emailAccount,
  emailMessage,
  emailThread,
  member,
  riskAnalysis,
  policyRule,
  auditLog,
} from "@memorystack/db/schema";
import { TRPCError } from "@trpc/server";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { protectedProcedure, router } from "../index";

// =============================================================================
// INPUT SCHEMAS
// =============================================================================

const analyzeEmailSchema = z.object({
  organizationId: z.string().min(1),
  messageId: z.string().uuid(),
});

const analyzeDraftSchema = z.object({
  organizationId: z.string().min(1),
  accountId: z.string().uuid(),
  content: z.string().min(1),
  subject: z.string().optional(),
  recipients: z.array(
    z.object({
      email: z.string().email(),
      name: z.string().optional(),
    })
  ),
  threadId: z.string().uuid().optional(),
});

const listAnalysesSchema = z.object({
  organizationId: z.string().min(1),
  accountId: z.string().uuid().optional(),
  riskLevel: z.enum(["low", "medium", "high", "critical"]).optional(),
  category: z
    .enum(["contradiction", "sensitive_data", "fraud", "policy"])
    .optional(),
  limit: z.number().int().min(1).max(100).default(50),
  offset: z.number().int().min(0).default(0),
});

const getAnalysisSchema = z.object({
  organizationId: z.string().min(1),
  analysisId: z.string().uuid(),
});

const listPoliciesSchema = z.object({
  organizationId: z.string().min(1),
  category: z
    .enum([
      "communication",
      "data_handling",
      "financial",
      "compliance",
      "security",
      "custom",
    ])
    .optional(),
  enabled: z.boolean().optional(),
});

const createPolicySchema = z.object({
  organizationId: z.string().min(1),
  name: z.string().min(1).max(100),
  description: z.string().optional(),
  category: z.enum([
    "communication",
    "data_handling",
    "financial",
    "compliance",
    "security",
    "custom",
  ]),
  conditions: z.array(
    z.object({
      type: z.string(),
      field: z.string(),
      operator: z.string(),
      value: z.union([z.string(), z.number(), z.array(z.string())]),
      caseSensitive: z.boolean().optional(),
    })
  ),
  actions: z.array(
    z.object({
      type: z.enum([
        "block",
        "warn",
        "require_approval",
        "notify",
        "audit_log",
        "redact",
        "encrypt",
      ]),
      config: z.record(z.unknown()).optional(),
    })
  ),
  severity: z.enum(["info", "warning", "violation", "critical"]),
});

const updatePolicySchema = z.object({
  organizationId: z.string().min(1),
  policyId: z.string().uuid(),
  name: z.string().min(1).max(100).optional(),
  description: z.string().optional(),
  conditions: z
    .array(
      z.object({
        type: z.string(),
        field: z.string(),
        operator: z.string(),
        value: z.union([z.string(), z.number(), z.array(z.string())]),
        caseSensitive: z.boolean().optional(),
      })
    )
    .optional(),
  actions: z
    .array(
      z.object({
        type: z.enum([
          "block",
          "warn",
          "require_approval",
          "notify",
          "audit_log",
          "redact",
          "encrypt",
        ]),
        config: z.record(z.unknown()).optional(),
      })
    )
    .optional(),
  severity: z.enum(["info", "warning", "violation", "critical"]).optional(),
  enabled: z.boolean().optional(),
});

const deletePolicySchema = z.object({
  organizationId: z.string().min(1),
  policyId: z.string().uuid(),
});

const getAuditLogSchema = z.object({
  organizationId: z.string().min(1),
  from: z.date().optional(),
  to: z.date().optional(),
  action: z.string().optional(),
  limit: z.number().int().min(1).max(100).default(50),
  offset: z.number().int().min(0).default(0),
});

const requestApprovalSchema = z.object({
  organizationId: z.string().min(1),
  analysisId: z.string().uuid(),
  reason: z.string().min(1),
});

const processApprovalSchema = z.object({
  organizationId: z.string().min(1),
  analysisId: z.string().uuid(),
  approved: z.boolean(),
  comments: z.string().optional(),
});

// =============================================================================
// HELPERS
// =============================================================================

async function verifyOrgMembership(
  userId: string,
  organizationId: string
): Promise<{ role: string }> {
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

  return { role: membership.role };
}

/**
 * Verify user can approve risk analyses (owner, admin, or approver role)
 */
async function verifyApproverRole(
  userId: string,
  organizationId: string
): Promise<void> {
  const { role } = await verifyOrgMembership(userId, organizationId);

  // Approvers can be: owners, admins, or users with explicit "approver" role
  const approverRoles = ["owner", "admin", "approver"];
  if (!approverRoles.includes(role)) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Only organization owners, admins, and designated approvers can process risk approvals.",
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

function extractDomain(email: string): string {
  const parts = email.split("@");
  return parts[1]?.toLowerCase() ?? "";
}

// =============================================================================
// ROUTER
// =============================================================================

export const riskRouter = router({
  // =========================================================================
  // RISK ANALYSIS
  // =========================================================================

  /**
   * Analyze an incoming email for risks.
   */
  analyzeEmail: protectedProcedure
    .input(analyzeEmailSchema)
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      await verifyOrgMembership(userId, input.organizationId);

      // Get message with thread and account
      const message = await db.query.emailMessage.findFirst({
        where: eq(emailMessage.id, input.messageId),
        with: {
          thread: {
            with: {
              account: {
                columns: { id: true, organizationId: true, email: true },
              },
            },
          },
        },
      });

      if (!message || message.thread.account.organizationId !== input.organizationId) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Message not found.",
        });
      }

      // Check if analysis already exists
      const existingAnalysis = await db.query.riskAnalysis.findFirst({
        where: eq(riskAnalysis.messageId, input.messageId),
      });

      if (existingAnalysis) {
        return existingAnalysis;
      }

      // Create analysis record (actual analysis runs via trigger task)
      const [analysis] = await db
        .insert(riskAnalysis)
        .values({
          accountId: message.thread.account.id,
          threadId: message.threadId,
          messageId: input.messageId,
          analysisType: "incoming",
          status: "pending",
        })
        .returning();

      return analysis;
    }),

  /**
   * Analyze a draft before sending.
   */
  analyzeDraft: protectedProcedure
    .input(analyzeDraftSchema)
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      await verifyOrgMembership(userId, input.organizationId);
      const account = await verifyAccountAccess(
        input.organizationId,
        input.accountId
      );

      // Determine recipient domains and external status
      const accountDomain = extractDomain(account.email);
      const recipients = input.recipients.map((r) => ({
        ...r,
        domain: extractDomain(r.email),
        isExternal: extractDomain(r.email) !== accountDomain,
      }));

      // Create analysis record (actual analysis runs inline or via task)
      const [analysis] = await db
        .insert(riskAnalysis)
        .values({
          accountId: input.accountId,
          threadId: input.threadId ?? null,
          analysisType: "draft",
          status: "pending",
          draftContent: input.content,
          draftSubject: input.subject,
          draftRecipients: recipients,
        })
        .returning();

      return analysis;
    }),

  /**
   * List risk analyses.
   */
  listAnalyses: protectedProcedure
    .input(listAnalysesSchema)
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
        return { analyses: [], total: 0, hasMore: false };
      }

      // Build conditions
      const conditions = [inArray(riskAnalysis.accountId, accountIds)];

      if (input.riskLevel) {
        conditions.push(eq(riskAnalysis.overallRiskLevel, input.riskLevel));
      }

      // Count total
      const [countResult] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(riskAnalysis)
        .where(and(...conditions));

      const total = countResult?.count ?? 0;

      // Get analyses
      const analyses = await db
        .select({
          id: riskAnalysis.id,
          accountId: riskAnalysis.accountId,
          threadId: riskAnalysis.threadId,
          messageId: riskAnalysis.messageId,
          analysisType: riskAnalysis.analysisType,
          status: riskAnalysis.status,
          overallRiskScore: riskAnalysis.overallRiskScore,
          overallRiskLevel: riskAnalysis.overallRiskLevel,
          hasContradictions: riskAnalysis.hasContradictions,
          hasSensitiveData: riskAnalysis.hasSensitiveData,
          hasFraudSignals: riskAnalysis.hasFraudSignals,
          hasPolicyViolations: riskAnalysis.hasPolicyViolations,
          requiresApproval: riskAnalysis.requiresApproval,
          approvalStatus: riskAnalysis.approvalStatus,
          createdAt: riskAnalysis.createdAt,
        })
        .from(riskAnalysis)
        .where(and(...conditions))
        .orderBy(desc(riskAnalysis.overallRiskScore), desc(riskAnalysis.createdAt))
        .limit(input.limit)
        .offset(input.offset);

      return {
        analyses,
        total,
        hasMore: input.offset + analyses.length < total,
      };
    }),

  /**
   * Get detailed risk analysis.
   */
  getAnalysis: protectedProcedure
    .input(getAnalysisSchema)
    .query(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      await verifyOrgMembership(userId, input.organizationId);

      const analysis = await db.query.riskAnalysis.findFirst({
        where: eq(riskAnalysis.id, input.analysisId),
      });

      if (!analysis) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Analysis not found.",
        });
      }

      // Verify access
      await verifyAccountAccess(input.organizationId, analysis.accountId);

      return analysis;
    }),

  /**
   * Get risk summary for organization.
   */
  getRiskSummary: protectedProcedure
    .input(
      z.object({
        organizationId: z.string().min(1),
        accountId: z.string().uuid().optional(),
        days: z.number().int().min(1).max(90).default(7),
      })
    )
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
          totalAnalyses: 0,
          byRiskLevel: {},
          byCategory: {},
          pendingApprovals: 0,
          blockedMessages: 0,
        };
      }

      const since = new Date();
      since.setDate(since.getDate() - input.days);

      // Get risk level counts
      const riskLevelCounts = await db
        .select({
          level: riskAnalysis.overallRiskLevel,
          count: sql<number>`count(*)::int`,
        })
        .from(riskAnalysis)
        .where(
          and(
            inArray(riskAnalysis.accountId, accountIds),
            sql`${riskAnalysis.createdAt} >= ${since}`
          )
        )
        .groupBy(riskAnalysis.overallRiskLevel);

      // Get category flags counts
      const [categoryResult] = await db
        .select({
          contradictions: sql<number>`count(*) filter (where ${riskAnalysis.hasContradictions})::int`,
          sensitiveData: sql<number>`count(*) filter (where ${riskAnalysis.hasSensitiveData})::int`,
          fraudSignals: sql<number>`count(*) filter (where ${riskAnalysis.hasFraudSignals})::int`,
          policyViolations: sql<number>`count(*) filter (where ${riskAnalysis.hasPolicyViolations})::int`,
        })
        .from(riskAnalysis)
        .where(
          and(
            inArray(riskAnalysis.accountId, accountIds),
            sql`${riskAnalysis.createdAt} >= ${since}`
          )
        );

      // Get pending approvals
      const [pendingResult] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(riskAnalysis)
        .where(
          and(
            inArray(riskAnalysis.accountId, accountIds),
            eq(riskAnalysis.requiresApproval, true),
            eq(riskAnalysis.approvalStatus, "pending")
          )
        );

      // Get blocked count
      const [blockedResult] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(riskAnalysis)
        .where(
          and(
            inArray(riskAnalysis.accountId, accountIds),
            eq(riskAnalysis.status, "blocked"),
            sql`${riskAnalysis.createdAt} >= ${since}`
          )
        );

      const total = riskLevelCounts.reduce((sum, r) => sum + r.count, 0);

      return {
        totalAnalyses: total,
        byRiskLevel: Object.fromEntries(
          riskLevelCounts.map((r) => [r.level, r.count])
        ),
        byCategory: {
          contradiction: categoryResult?.contradictions ?? 0,
          sensitive_data: categoryResult?.sensitiveData ?? 0,
          fraud: categoryResult?.fraudSignals ?? 0,
          policy: categoryResult?.policyViolations ?? 0,
        },
        pendingApprovals: pendingResult?.count ?? 0,
        blockedMessages: blockedResult?.count ?? 0,
      };
    }),

  // =========================================================================
  // POLICY MANAGEMENT
  // =========================================================================

  /**
   * List organization policies.
   */
  listPolicies: protectedProcedure
    .input(listPoliciesSchema)
    .query(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      await verifyOrgMembership(userId, input.organizationId);

      const conditions = [eq(policyRule.organizationId, input.organizationId)];

      if (input.category) {
        conditions.push(eq(policyRule.category, input.category));
      }

      if (input.enabled !== undefined) {
        conditions.push(eq(policyRule.enabled, input.enabled));
      }

      const policies = await db.query.policyRule.findMany({
        where: and(...conditions),
        orderBy: [desc(policyRule.severity), desc(policyRule.createdAt)],
      });

      return { policies };
    }),

  /**
   * Get a specific policy.
   */
  getPolicy: protectedProcedure
    .input(
      z.object({
        organizationId: z.string().min(1),
        policyId: z.string().uuid(),
      })
    )
    .query(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      await verifyOrgMembership(userId, input.organizationId);

      const policy = await db.query.policyRule.findFirst({
        where: and(
          eq(policyRule.id, input.policyId),
          eq(policyRule.organizationId, input.organizationId)
        ),
      });

      if (!policy) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Policy not found.",
        });
      }

      return policy;
    }),

  /**
   * Create a new policy.
   */
  createPolicy: protectedProcedure
    .input(createPolicySchema)
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      await verifyOrgMembership(userId, input.organizationId);

      const [policy] = await db
        .insert(policyRule)
        .values({
          organizationId: input.organizationId,
          name: input.name,
          description: input.description,
          category: input.category,
          conditions: input.conditions,
          actions: input.actions,
          severity: input.severity,
          createdBy: userId,
        })
        .returning();

      // Log policy creation
      await db.insert(auditLog).values({
        organizationId: input.organizationId,
        userId,
        action: "policy.created",
        resourceType: "policy",
        resourceId: policy.id,
        details: { policyName: input.name, category: input.category },
      });

      return policy;
    }),

  /**
   * Update a policy.
   */
  updatePolicy: protectedProcedure
    .input(updatePolicySchema)
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      await verifyOrgMembership(userId, input.organizationId);

      const existingPolicy = await db.query.policyRule.findFirst({
        where: and(
          eq(policyRule.id, input.policyId),
          eq(policyRule.organizationId, input.organizationId)
        ),
      });

      if (!existingPolicy) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Policy not found.",
        });
      }

      const updates: Partial<typeof policyRule.$inferInsert> = {
        updatedAt: new Date(),
      };

      if (input.name !== undefined) updates.name = input.name;
      if (input.description !== undefined) updates.description = input.description;
      if (input.conditions !== undefined) updates.conditions = input.conditions;
      if (input.actions !== undefined) updates.actions = input.actions;
      if (input.severity !== undefined) updates.severity = input.severity;
      if (input.enabled !== undefined) updates.enabled = input.enabled;

      const [updatedPolicy] = await db
        .update(policyRule)
        .set(updates)
        .where(eq(policyRule.id, input.policyId))
        .returning();

      // Log policy update
      await db.insert(auditLog).values({
        organizationId: input.organizationId,
        userId,
        action: "policy.updated",
        resourceType: "policy",
        resourceId: input.policyId,
        details: { updates: Object.keys(updates) },
      });

      return updatedPolicy;
    }),

  /**
   * Delete a policy.
   */
  deletePolicy: protectedProcedure
    .input(deletePolicySchema)
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      await verifyOrgMembership(userId, input.organizationId);

      const existingPolicy = await db.query.policyRule.findFirst({
        where: and(
          eq(policyRule.id, input.policyId),
          eq(policyRule.organizationId, input.organizationId)
        ),
      });

      if (!existingPolicy) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Policy not found.",
        });
      }

      await db.delete(policyRule).where(eq(policyRule.id, input.policyId));

      // Log policy deletion
      await db.insert(auditLog).values({
        organizationId: input.organizationId,
        userId,
        action: "policy.deleted",
        resourceType: "policy",
        resourceId: input.policyId,
        details: { policyName: existingPolicy.name },
      });

      return { success: true };
    }),

  /**
   * Toggle policy enabled state.
   */
  togglePolicy: protectedProcedure
    .input(
      z.object({
        organizationId: z.string().min(1),
        policyId: z.string().uuid(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      await verifyOrgMembership(userId, input.organizationId);

      const existingPolicy = await db.query.policyRule.findFirst({
        where: and(
          eq(policyRule.id, input.policyId),
          eq(policyRule.organizationId, input.organizationId)
        ),
      });

      if (!existingPolicy) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Policy not found.",
        });
      }

      const [updatedPolicy] = await db
        .update(policyRule)
        .set({
          enabled: !existingPolicy.enabled,
          updatedAt: new Date(),
        })
        .where(eq(policyRule.id, input.policyId))
        .returning();

      return updatedPolicy;
    }),

  // =========================================================================
  // APPROVALS
  // =========================================================================

  /**
   * Request approval for a blocked action.
   */
  requestApproval: protectedProcedure
    .input(requestApprovalSchema)
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      await verifyOrgMembership(userId, input.organizationId);

      const analysis = await db.query.riskAnalysis.findFirst({
        where: eq(riskAnalysis.id, input.analysisId),
      });

      if (!analysis) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Analysis not found.",
        });
      }

      await verifyAccountAccess(input.organizationId, analysis.accountId);

      if (!analysis.requiresApproval) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "This analysis does not require approval.",
        });
      }

      const [updated] = await db
        .update(riskAnalysis)
        .set({
          approvalStatus: "pending",
          approvalRequestedBy: userId,
          approvalRequestedAt: new Date(),
          approvalReason: input.reason,
          updatedAt: new Date(),
        })
        .where(eq(riskAnalysis.id, input.analysisId))
        .returning();

      // Log approval request
      await db.insert(auditLog).values({
        organizationId: input.organizationId,
        userId,
        action: "risk.approval_requested",
        resourceType: "risk_analysis",
        resourceId: input.analysisId,
        details: { reason: input.reason },
      });

      return updated;
    }),

  /**
   * Process an approval request.
   * Only organization owners, admins, and designated approvers can process approvals.
   */
  processApproval: protectedProcedure
    .input(processApprovalSchema)
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;

      // Verify user has approver permissions
      await verifyApproverRole(userId, input.organizationId);

      const analysis = await db.query.riskAnalysis.findFirst({
        where: eq(riskAnalysis.id, input.analysisId),
      });

      if (!analysis) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Analysis not found.",
        });
      }

      await verifyAccountAccess(input.organizationId, analysis.accountId);

      if (analysis.approvalStatus !== "pending") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "This analysis is not pending approval.",
        });
      }

      const [updated] = await db
        .update(riskAnalysis)
        .set({
          approvalStatus: input.approved ? "approved" : "rejected",
          approvedBy: userId,
          approvedAt: new Date(),
          approvalComments: input.comments,
          status: input.approved ? "approved" : "blocked",
          updatedAt: new Date(),
        })
        .where(eq(riskAnalysis.id, input.analysisId))
        .returning();

      // Log approval decision
      await db.insert(auditLog).values({
        organizationId: input.organizationId,
        userId,
        action: input.approved ? "risk.approval_granted" : "risk.approval_denied",
        resourceType: "risk_analysis",
        resourceId: input.analysisId,
        details: { comments: input.comments },
      });

      return updated;
    }),

  /**
   * List pending approvals.
   */
  listPendingApprovals: protectedProcedure
    .input(
      z.object({
        organizationId: z.string().min(1),
        limit: z.number().int().min(1).max(100).default(50),
        offset: z.number().int().min(0).default(0),
      })
    )
    .query(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      await verifyOrgMembership(userId, input.organizationId);

      const accountIds = await getOrgAccountIds(input.organizationId);

      if (accountIds.length === 0) {
        return { approvals: [], total: 0, hasMore: false };
      }

      const conditions = [
        inArray(riskAnalysis.accountId, accountIds),
        eq(riskAnalysis.requiresApproval, true),
        eq(riskAnalysis.approvalStatus, "pending"),
      ];

      const [countResult] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(riskAnalysis)
        .where(and(...conditions));

      const total = countResult?.count ?? 0;

      const approvals = await db
        .select()
        .from(riskAnalysis)
        .where(and(...conditions))
        .orderBy(desc(riskAnalysis.approvalRequestedAt))
        .limit(input.limit)
        .offset(input.offset);

      return {
        approvals,
        total,
        hasMore: input.offset + approvals.length < total,
      };
    }),

  // =========================================================================
  // AUDIT LOG
  // =========================================================================

  /**
   * Get audit log for risk-related actions.
   */
  getAuditLog: protectedProcedure
    .input(getAuditLogSchema)
    .query(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      await verifyOrgMembership(userId, input.organizationId);

      const conditions = [eq(auditLog.organizationId, input.organizationId)];

      if (input.from) {
        conditions.push(sql`${auditLog.createdAt} >= ${input.from}`);
      }

      if (input.to) {
        conditions.push(sql`${auditLog.createdAt} <= ${input.to}`);
      }

      if (input.action) {
        conditions.push(eq(auditLog.action, input.action));
      }

      const [countResult] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(auditLog)
        .where(and(...conditions));

      const total = countResult?.count ?? 0;

      const logs = await db
        .select()
        .from(auditLog)
        .where(and(...conditions))
        .orderBy(desc(auditLog.createdAt))
        .limit(input.limit)
        .offset(input.offset);

      return {
        logs,
        total,
        hasMore: input.offset + logs.length < total,
      };
    }),
});
