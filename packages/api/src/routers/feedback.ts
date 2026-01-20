// =============================================================================
// FEEDBACK ROUTER
// =============================================================================
//
// User feedback collection for AI extractions - the foundation for improving
// accuracy over time. Every verify/dismiss action is tracked and aggregated.
//

import { db } from "@memorystack/db";
import { claim, commitment, decision, member } from "@memorystack/db/schema";
import { TRPCError } from "@trpc/server";
import { and, desc, eq, gte, sql } from "drizzle-orm";
import { z } from "zod";
import { protectedProcedure, router } from "../index";

// =============================================================================
// INPUT SCHEMAS
// =============================================================================

const feedbackTargetSchema = z.object({
  organizationId: z.string().min(1),
  targetId: z.string().uuid(),
  targetType: z.enum(["commitment", "decision", "claim"]),
});

const verifySchema = feedbackTargetSchema.extend({
  reason: z.string().optional(),
});

const dismissSchema = feedbackTargetSchema.extend({
  reason: z.string().min(1, "Please provide a reason for dismissing"),
});

const correctSchema = feedbackTargetSchema.extend({
  correctedText: z.string().min(1),
  correctionType: z.enum(["title", "description", "statement", "text"]),
  reason: z.string().optional(),
});

const metricsSchema = z.object({
  organizationId: z.string().min(1),
  days: z.number().int().min(1).max(365).default(30),
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

export const feedbackRouter = router({
  // =========================================================================
  // VERIFY EXTRACTION (Mark as correct)
  // =========================================================================

  /**
   * Mark an extraction as verified by the user.
   */
  verify: protectedProcedure
    .input(verifySchema)
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      await verifyOrgMembership(userId, input.organizationId);

      const now = new Date();

      switch (input.targetType) {
        case "commitment": {
          const [updated] = await db
            .update(commitment)
            .set({
              isUserVerified: true,
              isUserDismissed: false,
              updatedAt: now,
            })
            .where(
              and(
                eq(commitment.id, input.targetId),
                eq(commitment.organizationId, input.organizationId)
              )
            )
            .returning();

          if (!updated) {
            throw new TRPCError({
              code: "NOT_FOUND",
              message: "Commitment not found.",
            });
          }

          return {
            success: true,
            targetType: "commitment",
            targetId: input.targetId,
          };
        }

        case "decision": {
          const [updated] = await db
            .update(decision)
            .set({
              isUserVerified: true,
              isUserDismissed: false,
              updatedAt: now,
            })
            .where(
              and(
                eq(decision.id, input.targetId),
                eq(decision.organizationId, input.organizationId)
              )
            )
            .returning();

          if (!updated) {
            throw new TRPCError({
              code: "NOT_FOUND",
              message: "Decision not found.",
            });
          }

          return {
            success: true,
            targetType: "decision",
            targetId: input.targetId,
          };
        }

        case "claim": {
          const [updated] = await db
            .update(claim)
            .set({
              isUserVerified: true,
              isUserDismissed: false,
              updatedAt: now,
            })
            .where(
              and(
                eq(claim.id, input.targetId),
                eq(claim.organizationId, input.organizationId)
              )
            )
            .returning();

          if (!updated) {
            throw new TRPCError({
              code: "NOT_FOUND",
              message: "Claim not found.",
            });
          }

          return {
            success: true,
            targetType: "claim",
            targetId: input.targetId,
          };
        }
      }
    }),

  // =========================================================================
  // DISMISS EXTRACTION (Mark as incorrect)
  // =========================================================================

  /**
   * Mark an extraction as dismissed/incorrect.
   */
  dismiss: protectedProcedure
    .input(dismissSchema)
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      await verifyOrgMembership(userId, input.organizationId);

      const now = new Date();

      switch (input.targetType) {
        case "commitment": {
          const [updated] = await db
            .update(commitment)
            .set({
              isUserDismissed: true,
              isUserVerified: false,
              status: "cancelled",
              updatedAt: now,
            })
            .where(
              and(
                eq(commitment.id, input.targetId),
                eq(commitment.organizationId, input.organizationId)
              )
            )
            .returning();

          if (!updated) {
            throw new TRPCError({
              code: "NOT_FOUND",
              message: "Commitment not found.",
            });
          }

          return {
            success: true,
            targetType: "commitment",
            targetId: input.targetId,
          };
        }

        case "decision": {
          const [updated] = await db
            .update(decision)
            .set({
              isUserDismissed: true,
              isUserVerified: false,
              updatedAt: now,
            })
            .where(
              and(
                eq(decision.id, input.targetId),
                eq(decision.organizationId, input.organizationId)
              )
            )
            .returning();

          if (!updated) {
            throw new TRPCError({
              code: "NOT_FOUND",
              message: "Decision not found.",
            });
          }

          return {
            success: true,
            targetType: "decision",
            targetId: input.targetId,
          };
        }

        case "claim": {
          const [updated] = await db
            .update(claim)
            .set({
              isUserDismissed: true,
              isUserVerified: false,
              updatedAt: now,
            })
            .where(
              and(
                eq(claim.id, input.targetId),
                eq(claim.organizationId, input.organizationId)
              )
            )
            .returning();

          if (!updated) {
            throw new TRPCError({
              code: "NOT_FOUND",
              message: "Claim not found.",
            });
          }

          return {
            success: true,
            targetType: "claim",
            targetId: input.targetId,
          };
        }
      }
    }),

  // =========================================================================
  // CORRECT EXTRACTION (Provide corrected text)
  // =========================================================================

  /**
   * Provide corrected text for an extraction.
   */
  correct: protectedProcedure
    .input(correctSchema)
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      await verifyOrgMembership(userId, input.organizationId);

      const now = new Date();

      switch (input.targetType) {
        case "commitment": {
          const updateData: Record<string, unknown> = {
            isUserVerified: true,
            isUserDismissed: false,
            updatedAt: now,
          };

          if (input.correctionType === "title") {
            updateData.title = input.correctedText;
          } else if (input.correctionType === "description") {
            updateData.description = input.correctedText;
          }

          const [updated] = await db
            .update(commitment)
            .set(updateData)
            .where(
              and(
                eq(commitment.id, input.targetId),
                eq(commitment.organizationId, input.organizationId)
              )
            )
            .returning();

          if (!updated) {
            throw new TRPCError({
              code: "NOT_FOUND",
              message: "Commitment not found.",
            });
          }

          return {
            success: true,
            targetType: "commitment",
            targetId: input.targetId,
          };
        }

        case "decision": {
          const updateData: Record<string, unknown> = {
            isUserVerified: true,
            isUserDismissed: false,
            updatedAt: now,
          };

          if (input.correctionType === "title") {
            updateData.title = input.correctedText;
          } else if (input.correctionType === "statement") {
            updateData.statement = input.correctedText;
          }

          const [updated] = await db
            .update(decision)
            .set(updateData)
            .where(
              and(
                eq(decision.id, input.targetId),
                eq(decision.organizationId, input.organizationId)
              )
            )
            .returning();

          if (!updated) {
            throw new TRPCError({
              code: "NOT_FOUND",
              message: "Decision not found.",
            });
          }

          return {
            success: true,
            targetType: "decision",
            targetId: input.targetId,
          };
        }

        case "claim": {
          const [updated] = await db
            .update(claim)
            .set({
              isUserVerified: true,
              isUserDismissed: false,
              userCorrectedText: input.correctedText,
              updatedAt: now,
            })
            .where(
              and(
                eq(claim.id, input.targetId),
                eq(claim.organizationId, input.organizationId)
              )
            )
            .returning();

          if (!updated) {
            throw new TRPCError({
              code: "NOT_FOUND",
              message: "Claim not found.",
            });
          }

          return {
            success: true,
            targetType: "claim",
            targetId: input.targetId,
          };
        }
      }
    }),

  // =========================================================================
  // ACCURACY METRICS
  // =========================================================================

  /**
   * Get accuracy metrics for the organization.
   */
  getMetrics: protectedProcedure
    .input(metricsSchema)
    .query(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      await verifyOrgMembership(userId, input.organizationId);

      const since = new Date();
      since.setDate(since.getDate() - input.days);

      // Commitment metrics
      const [commitmentMetrics] = await db
        .select({
          total: sql<number>`count(*)::int`,
          verified: sql<number>`count(*) filter (where ${commitment.isUserVerified})::int`,
          dismissed: sql<number>`count(*) filter (where ${commitment.isUserDismissed})::int`,
          unreviewed: sql<number>`count(*) filter (where not ${commitment.isUserVerified} and not ${commitment.isUserDismissed})::int`,
          avgConfidence: sql<number>`avg(${commitment.confidence})::real`,
          verifiedAvgConfidence: sql<number>`avg(case when ${commitment.isUserVerified} then ${commitment.confidence} end)::real`,
          dismissedAvgConfidence: sql<number>`avg(case when ${commitment.isUserDismissed} then ${commitment.confidence} end)::real`,
        })
        .from(commitment)
        .where(
          and(
            eq(commitment.organizationId, input.organizationId),
            gte(commitment.createdAt, since)
          )
        );

      // Decision metrics
      const [decisionMetrics] = await db
        .select({
          total: sql<number>`count(*)::int`,
          verified: sql<number>`count(*) filter (where ${decision.isUserVerified})::int`,
          dismissed: sql<number>`count(*) filter (where ${decision.isUserDismissed})::int`,
          unreviewed: sql<number>`count(*) filter (where not ${decision.isUserVerified} and not ${decision.isUserDismissed})::int`,
          avgConfidence: sql<number>`avg(${decision.confidence})::real`,
          verifiedAvgConfidence: sql<number>`avg(case when ${decision.isUserVerified} then ${decision.confidence} end)::real`,
          dismissedAvgConfidence: sql<number>`avg(case when ${decision.isUserDismissed} then ${decision.confidence} end)::real`,
        })
        .from(decision)
        .where(
          and(
            eq(decision.organizationId, input.organizationId),
            gte(decision.decidedAt, since)
          )
        );

      // Claim metrics
      const [claimMetrics] = await db
        .select({
          total: sql<number>`count(*)::int`,
          verified: sql<number>`count(*) filter (where ${claim.isUserVerified})::int`,
          dismissed: sql<number>`count(*) filter (where ${claim.isUserDismissed})::int`,
          corrected: sql<number>`count(*) filter (where ${claim.userCorrectedText} is not null)::int`,
          unreviewed: sql<number>`count(*) filter (where not ${claim.isUserVerified} and not ${claim.isUserDismissed})::int`,
          avgConfidence: sql<number>`avg(${claim.confidence})::real`,
        })
        .from(claim)
        .where(
          and(
            eq(claim.organizationId, input.organizationId),
            gte(claim.extractedAt, since)
          )
        );

      // Calculate accuracy rates
      const commitmentAccuracy = commitmentMetrics?.total
        ? ((commitmentMetrics.verified ?? 0) /
            Math.max(
              1,
              (commitmentMetrics.verified ?? 0) +
                (commitmentMetrics.dismissed ?? 0)
            )) *
          100
        : null;

      const decisionAccuracy = decisionMetrics?.total
        ? ((decisionMetrics.verified ?? 0) /
            Math.max(
              1,
              (decisionMetrics.verified ?? 0) + (decisionMetrics.dismissed ?? 0)
            )) *
          100
        : null;

      const claimAccuracy = claimMetrics?.total
        ? ((claimMetrics.verified ?? 0) /
            Math.max(
              1,
              (claimMetrics.verified ?? 0) + (claimMetrics.dismissed ?? 0)
            )) *
          100
        : null;

      // Overall metrics
      const totalReviewed =
        (commitmentMetrics?.verified ?? 0) +
        (commitmentMetrics?.dismissed ?? 0) +
        (decisionMetrics?.verified ?? 0) +
        (decisionMetrics?.dismissed ?? 0) +
        (claimMetrics?.verified ?? 0) +
        (claimMetrics?.dismissed ?? 0);

      const totalVerified =
        (commitmentMetrics?.verified ?? 0) +
        (decisionMetrics?.verified ?? 0) +
        (claimMetrics?.verified ?? 0);

      const overallAccuracy =
        totalReviewed > 0 ? (totalVerified / totalReviewed) * 100 : null;

      return {
        period: { days: input.days, since },
        commitments: {
          ...commitmentMetrics,
          accuracy: commitmentAccuracy,
        },
        decisions: {
          ...decisionMetrics,
          accuracy: decisionAccuracy,
        },
        claims: {
          ...claimMetrics,
          accuracy: claimAccuracy,
        },
        overall: {
          totalExtractions:
            (commitmentMetrics?.total ?? 0) +
            (decisionMetrics?.total ?? 0) +
            (claimMetrics?.total ?? 0),
          totalReviewed,
          totalVerified,
          totalDismissed:
            (commitmentMetrics?.dismissed ?? 0) +
            (decisionMetrics?.dismissed ?? 0) +
            (claimMetrics?.dismissed ?? 0),
          accuracy: overallAccuracy,
        },
      };
    }),

  // =========================================================================
  // FEEDBACK HISTORY
  // =========================================================================

  /**
   * Get recent feedback actions for review.
   */
  getRecentFeedback: protectedProcedure
    .input(
      z.object({
        organizationId: z.string().min(1),
        limit: z.number().int().min(1).max(100).default(50),
        targetType: z
          .enum(["commitment", "decision", "claim", "all"])
          .default("all"),
      })
    )
    .query(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      await verifyOrgMembership(userId, input.organizationId);

      const results: Array<{
        id: string;
        type: "commitment" | "decision" | "claim";
        title: string;
        isVerified: boolean;
        isDismissed: boolean;
        confidence: number;
        updatedAt: Date;
      }> = [];

      // Get commitments
      if (input.targetType === "all" || input.targetType === "commitment") {
        const commitments = await db
          .select({
            id: commitment.id,
            title: commitment.title,
            isVerified: commitment.isUserVerified,
            isDismissed: commitment.isUserDismissed,
            confidence: commitment.confidence,
            updatedAt: commitment.updatedAt,
          })
          .from(commitment)
          .where(
            and(
              eq(commitment.organizationId, input.organizationId),
              sql`(${commitment.isUserVerified} = true or ${commitment.isUserDismissed} = true)`
            )
          )
          .orderBy(desc(commitment.updatedAt))
          .limit(
            input.targetType === "commitment"
              ? input.limit
              : Math.floor(input.limit / 3)
          );

        for (const c of commitments) {
          results.push({
            ...c,
            type: "commitment",
            isVerified: c.isVerified ?? false,
            isDismissed: c.isDismissed ?? false,
          });
        }
      }

      // Get decisions
      if (input.targetType === "all" || input.targetType === "decision") {
        const decisions = await db
          .select({
            id: decision.id,
            title: decision.title,
            isVerified: decision.isUserVerified,
            isDismissed: decision.isUserDismissed,
            confidence: decision.confidence,
            updatedAt: decision.updatedAt,
          })
          .from(decision)
          .where(
            and(
              eq(decision.organizationId, input.organizationId),
              sql`(${decision.isUserVerified} = true or ${decision.isUserDismissed} = true)`
            )
          )
          .orderBy(desc(decision.updatedAt))
          .limit(
            input.targetType === "decision"
              ? input.limit
              : Math.floor(input.limit / 3)
          );

        for (const d of decisions) {
          results.push({
            ...d,
            type: "decision",
            isVerified: d.isVerified ?? false,
            isDismissed: d.isDismissed ?? false,
          });
        }
      }

      // Get claims
      if (input.targetType === "all" || input.targetType === "claim") {
        const claims = await db
          .select({
            id: claim.id,
            title: claim.text,
            isVerified: claim.isUserVerified,
            isDismissed: claim.isUserDismissed,
            confidence: claim.confidence,
            updatedAt: claim.updatedAt,
          })
          .from(claim)
          .where(
            and(
              eq(claim.organizationId, input.organizationId),
              sql`(${claim.isUserVerified} = true or ${claim.isUserDismissed} = true)`
            )
          )
          .orderBy(desc(claim.updatedAt))
          .limit(
            input.targetType === "claim"
              ? input.limit
              : Math.floor(input.limit / 3)
          );

        for (const c of claims) {
          results.push({
            id: c.id,
            type: "claim",
            title: c.title,
            isVerified: c.isVerified ?? false,
            isDismissed: c.isDismissed ?? false,
            confidence: c.confidence,
            updatedAt: c.updatedAt,
          });
        }
      }

      // Sort by updatedAt descending
      results.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());

      return {
        feedback: results.slice(0, input.limit),
        total: results.length,
      };
    }),
});
