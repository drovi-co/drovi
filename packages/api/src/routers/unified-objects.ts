// =============================================================================
// UNIFIED OBJECTS ROUTER
// =============================================================================
//
// API for managing Unified Intelligence Objects (UIOs).
// Provides cross-source commitment and decision tracking.
//

import { db, schema } from "@memorystack/db";
import { TRPCError } from "@trpc/server";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { protectedProcedure, router } from "../index";
import { unifiedObjectService } from "../services/unified-object";

// =============================================================================
// INPUT SCHEMAS
// =============================================================================

const listUIOsSchema = z.object({
  organizationId: z.string().min(1),
  type: z.enum(["commitment", "decision", "topic", "all"]).default("all"),
  status: z
    .enum(["active", "merged", "archived", "dismissed", "all"])
    .default("active"),
  limit: z.number().int().min(1).max(100).default(50),
  offset: z.number().int().min(0).default(0),
  // Filters
  ownerContactId: z.string().uuid().optional(),
  hasDueDate: z.boolean().optional(),
  isDueSoon: z.boolean().optional(),
  sourceType: z.string().optional(),
});

const getUIOSchema = z.object({
  organizationId: z.string().min(1),
  uioId: z.string().uuid(),
});

const getTimelineSchema = z.object({
  organizationId: z.string().min(1),
  uioId: z.string().uuid(),
  limit: z.number().int().min(1).max(100).default(50),
  offset: z.number().int().min(0).default(0),
});

const getPendingDeduplicationSchema = z.object({
  organizationId: z.string().min(1),
  limit: z.number().int().min(1).max(50).default(20),
  offset: z.number().int().min(0).default(0),
});

const resolveDeduplicationSchema = z.object({
  organizationId: z.string().min(1),
  candidateId: z.string().uuid(),
  action: z.enum(["merge", "reject"]),
});

const mergeUIOsSchema = z.object({
  organizationId: z.string().min(1),
  sourceUioId: z.string().uuid(),
  targetUioId: z.string().uuid(),
});

const updateUIOSchema = z.object({
  organizationId: z.string().min(1),
  uioId: z.string().uuid(),
  // User corrections
  userCorrectedTitle: z.string().optional(),
  isUserVerified: z.boolean().optional(),
  status: z.enum(["active", "archived", "dismissed"]).optional(),
});

// =============================================================================
// ROUTER
// =============================================================================

export const unifiedObjectsRouter = router({
  /**
   * List UIOs for an organization.
   */
  list: protectedProcedure
    .input(listUIOsSchema)
    .query(async ({ ctx, input }) => {
      // Verify organization access
      const member = await db.query.member.findFirst({
        where: and(
          eq(schema.member.organizationId, input.organizationId),
          eq(schema.member.userId, ctx.session.user.id)
        ),
      });

      if (!member) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "You do not have access to this organization",
        });
      }

      // Build conditions
      const conditions = [
        eq(
          schema.unifiedIntelligenceObject.organizationId,
          input.organizationId
        ),
      ];

      if (input.type !== "all") {
        conditions.push(eq(schema.unifiedIntelligenceObject.type, input.type));
      }

      if (input.status !== "all") {
        conditions.push(
          eq(schema.unifiedIntelligenceObject.status, input.status)
        );
      }

      if (input.ownerContactId) {
        conditions.push(
          eq(
            schema.unifiedIntelligenceObject.ownerContactId,
            input.ownerContactId
          )
        );
      }

      if (input.hasDueDate !== undefined) {
        if (input.hasDueDate) {
          conditions.push(
            sql`${schema.unifiedIntelligenceObject.dueDate} IS NOT NULL`
          );
        } else {
          conditions.push(
            sql`${schema.unifiedIntelligenceObject.dueDate} IS NULL`
          );
        }
      }

      if (input.isDueSoon) {
        const threeDaysFromNow = new Date();
        threeDaysFromNow.setDate(threeDaysFromNow.getDate() + 3);
        conditions.push(
          sql`${schema.unifiedIntelligenceObject.dueDate} <= ${threeDaysFromNow} AND ${schema.unifiedIntelligenceObject.dueDate} >= NOW()`
        );
      }

      // Query with sources for breadcrumbs
      const [uios, countResult] = await Promise.all([
        db.query.unifiedIntelligenceObject.findMany({
          where: and(...conditions),
          limit: input.limit,
          offset: input.offset,
          orderBy: [desc(schema.unifiedIntelligenceObject.lastUpdatedAt)],
          with: {
            sources: {
              orderBy: [desc(schema.unifiedObjectSource.sourceTimestamp)],
            },
            owner: true,
          },
        }),
        db
          .select({ count: sql<number>`count(*)` })
          .from(schema.unifiedIntelligenceObject)
          .where(and(...conditions)),
      ]);

      // Filter by source type if specified
      let filteredUios = uios;
      if (input.sourceType) {
        filteredUios = uios.filter((uio) =>
          uio.sources.some((s) => s.sourceType === input.sourceType)
        );
      }

      return {
        items: filteredUios.map((uio) => ({
          ...uio,
          sourceBreadcrumbs: unifiedObjectService.buildSourceBreadcrumbs(
            uio.sources
          ),
        })),
        total: countResult[0]?.count ?? 0,
        hasMore: input.offset + input.limit < (countResult[0]?.count ?? 0),
      };
    }),

  /**
   * Get a single UIO with full details.
   */
  get: protectedProcedure.input(getUIOSchema).query(async ({ ctx, input }) => {
    // Verify organization access
    const member = await db.query.member.findFirst({
      where: and(
        eq(schema.member.organizationId, input.organizationId),
        eq(schema.member.userId, ctx.session.user.id)
      ),
    });

    if (!member) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "You do not have access to this organization",
      });
    }

    const uio = await db.query.unifiedIntelligenceObject.findFirst({
      where: and(
        eq(schema.unifiedIntelligenceObject.id, input.uioId),
        eq(
          schema.unifiedIntelligenceObject.organizationId,
          input.organizationId
        )
      ),
      with: {
        sources: {
          orderBy: [desc(schema.unifiedObjectSource.sourceTimestamp)],
        },
        timeline: {
          orderBy: [desc(schema.unifiedObjectTimeline.eventAt)],
          limit: 50,
        },
        owner: true,
      },
    });

    if (!uio) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "Unified object not found",
      });
    }

    // If this UIO was merged, return the target instead
    if (uio.status === "merged" && uio.mergedIntoId) {
      const targetUio = await db.query.unifiedIntelligenceObject.findFirst({
        where: eq(schema.unifiedIntelligenceObject.id, uio.mergedIntoId),
        with: {
          sources: {
            orderBy: [desc(schema.unifiedObjectSource.sourceTimestamp)],
          },
          timeline: {
            orderBy: [desc(schema.unifiedObjectTimeline.eventAt)],
            limit: 50,
          },
          owner: true,
        },
      });

      if (targetUio) {
        return {
          ...targetUio,
          sourceBreadcrumbs: unifiedObjectService.buildSourceBreadcrumbs(
            targetUio.sources
          ),
          wasRedirected: true,
          originalId: input.uioId,
        };
      }
    }

    return {
      ...uio,
      sourceBreadcrumbs: unifiedObjectService.buildSourceBreadcrumbs(
        uio.sources
      ),
      wasRedirected: false,
    };
  }),

  /**
   * Get timeline events for a UIO.
   */
  getTimeline: protectedProcedure
    .input(getTimelineSchema)
    .query(async ({ ctx, input }) => {
      // Verify organization access
      const member = await db.query.member.findFirst({
        where: and(
          eq(schema.member.organizationId, input.organizationId),
          eq(schema.member.userId, ctx.session.user.id)
        ),
      });

      if (!member) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "You do not have access to this organization",
        });
      }

      // Verify UIO belongs to organization
      const uio = await db.query.unifiedIntelligenceObject.findFirst({
        where: and(
          eq(schema.unifiedIntelligenceObject.id, input.uioId),
          eq(
            schema.unifiedIntelligenceObject.organizationId,
            input.organizationId
          )
        ),
      });

      if (!uio) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Unified object not found",
        });
      }

      const [events, countResult] = await Promise.all([
        db.query.unifiedObjectTimeline.findMany({
          where: eq(schema.unifiedObjectTimeline.unifiedObjectId, input.uioId),
          orderBy: [desc(schema.unifiedObjectTimeline.eventAt)],
          limit: input.limit,
          offset: input.offset,
        }),
        db
          .select({ count: sql<number>`count(*)` })
          .from(schema.unifiedObjectTimeline)
          .where(eq(schema.unifiedObjectTimeline.unifiedObjectId, input.uioId)),
      ]);

      return {
        events,
        total: countResult[0]?.count ?? 0,
        hasMore: input.offset + input.limit < (countResult[0]?.count ?? 0),
      };
    }),

  /**
   * Get pending deduplication candidates for review.
   */
  getPendingDeduplication: protectedProcedure
    .input(getPendingDeduplicationSchema)
    .query(async ({ ctx, input }) => {
      // Verify organization access
      const member = await db.query.member.findFirst({
        where: and(
          eq(schema.member.organizationId, input.organizationId),
          eq(schema.member.userId, ctx.session.user.id)
        ),
      });

      if (!member) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "You do not have access to this organization",
        });
      }

      const [candidates, countResult] = await Promise.all([
        db.query.deduplicationCandidate.findMany({
          where: and(
            eq(
              schema.deduplicationCandidate.organizationId,
              input.organizationId
            ),
            eq(schema.deduplicationCandidate.status, "pending_review")
          ),
          orderBy: [desc(schema.deduplicationCandidate.overallScore)],
          limit: input.limit,
          offset: input.offset,
        }),
        db
          .select({ count: sql<number>`count(*)` })
          .from(schema.deduplicationCandidate)
          .where(
            and(
              eq(
                schema.deduplicationCandidate.organizationId,
                input.organizationId
              ),
              eq(schema.deduplicationCandidate.status, "pending_review")
            )
          ),
      ]);

      // Fetch UIO details for each candidate
      const uioIds = [
        ...new Set([
          ...candidates.map((c) => c.sourceObjectId),
          ...candidates.map((c) => c.targetObjectId),
        ]),
      ];

      const uios = await db.query.unifiedIntelligenceObject.findMany({
        where: inArray(schema.unifiedIntelligenceObject.id, uioIds),
        with: {
          sources: {
            orderBy: [desc(schema.unifiedObjectSource.sourceTimestamp)],
          },
        },
      });

      const uioMap = new Map(uios.map((u) => [u.id, u]));

      return {
        candidates: candidates.map((candidate) => {
          const sourceUio = uioMap.get(candidate.sourceObjectId);
          const targetUio = uioMap.get(candidate.targetObjectId);

          return {
            ...candidate,
            sourceUio: sourceUio
              ? {
                  ...sourceUio,
                  sourceBreadcrumbs:
                    unifiedObjectService.buildSourceBreadcrumbs(
                      sourceUio.sources
                    ),
                }
              : null,
            targetUio: targetUio
              ? {
                  ...targetUio,
                  sourceBreadcrumbs:
                    unifiedObjectService.buildSourceBreadcrumbs(
                      targetUio.sources
                    ),
                }
              : null,
          };
        }),
        total: countResult[0]?.count ?? 0,
        hasMore: input.offset + input.limit < (countResult[0]?.count ?? 0),
      };
    }),

  /**
   * Resolve a deduplication candidate (merge or reject).
   */
  resolveDeduplication: protectedProcedure
    .input(resolveDeduplicationSchema)
    .mutation(async ({ ctx, input }) => {
      // Verify organization access
      const member = await db.query.member.findFirst({
        where: and(
          eq(schema.member.organizationId, input.organizationId),
          eq(schema.member.userId, ctx.session.user.id)
        ),
      });

      if (!member) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "You do not have access to this organization",
        });
      }

      // Get the candidate
      const candidate = await db.query.deduplicationCandidate.findFirst({
        where: and(
          eq(schema.deduplicationCandidate.id, input.candidateId),
          eq(schema.deduplicationCandidate.organizationId, input.organizationId)
        ),
      });

      if (!candidate) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Deduplication candidate not found",
        });
      }

      if (candidate.status !== "pending_review") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Candidate has already been resolved",
        });
      }

      if (input.action === "merge") {
        // Merge the UIOs
        await unifiedObjectService.mergeUIOs(
          candidate.sourceObjectId,
          candidate.targetObjectId,
          ctx.session.user.id
        );

        // Update candidate status
        await db
          .update(schema.deduplicationCandidate)
          .set({
            status: "user_merged",
            resolvedBy: ctx.session.user.id,
            resolvedAt: new Date(),
          })
          .where(eq(schema.deduplicationCandidate.id, input.candidateId));

        return {
          success: true,
          action: "merged",
          targetUioId: candidate.targetObjectId,
        };
      }

      // Reject - update candidate status
      await db
        .update(schema.deduplicationCandidate)
        .set({
          status: "user_rejected",
          resolvedBy: ctx.session.user.id,
          resolvedAt: new Date(),
        })
        .where(eq(schema.deduplicationCandidate.id, input.candidateId));

      return {
        success: true,
        action: "rejected",
      };
    }),

  /**
   * Manually merge two UIOs.
   */
  merge: protectedProcedure
    .input(mergeUIOsSchema)
    .mutation(async ({ ctx, input }) => {
      // Verify organization access
      const member = await db.query.member.findFirst({
        where: and(
          eq(schema.member.organizationId, input.organizationId),
          eq(schema.member.userId, ctx.session.user.id)
        ),
      });

      if (!member) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "You do not have access to this organization",
        });
      }

      // Verify both UIOs belong to the organization
      const [sourceUio, targetUio] = await Promise.all([
        db.query.unifiedIntelligenceObject.findFirst({
          where: and(
            eq(schema.unifiedIntelligenceObject.id, input.sourceUioId),
            eq(
              schema.unifiedIntelligenceObject.organizationId,
              input.organizationId
            )
          ),
        }),
        db.query.unifiedIntelligenceObject.findFirst({
          where: and(
            eq(schema.unifiedIntelligenceObject.id, input.targetUioId),
            eq(
              schema.unifiedIntelligenceObject.organizationId,
              input.organizationId
            )
          ),
        }),
      ]);

      if (!(sourceUio && targetUio)) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "One or both unified objects not found",
        });
      }

      if (sourceUio.status === "merged") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Source UIO has already been merged",
        });
      }

      const mergedUio = await unifiedObjectService.mergeUIOs(
        input.sourceUioId,
        input.targetUioId,
        ctx.session.user.id
      );

      return {
        success: true,
        mergedUio: {
          ...mergedUio,
          sourceBreadcrumbs: [],
        },
      };
    }),

  /**
   * Update a UIO (user corrections).
   */
  update: protectedProcedure
    .input(updateUIOSchema)
    .mutation(async ({ ctx, input }) => {
      // Verify organization access
      const member = await db.query.member.findFirst({
        where: and(
          eq(schema.member.organizationId, input.organizationId),
          eq(schema.member.userId, ctx.session.user.id)
        ),
      });

      if (!member) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "You do not have access to this organization",
        });
      }

      // Get the UIO
      const uio = await db.query.unifiedIntelligenceObject.findFirst({
        where: and(
          eq(schema.unifiedIntelligenceObject.id, input.uioId),
          eq(
            schema.unifiedIntelligenceObject.organizationId,
            input.organizationId
          )
        ),
      });

      if (!uio) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Unified object not found",
        });
      }

      // Build updates
      const updates: Partial<
        typeof schema.unifiedIntelligenceObject.$inferInsert
      > = {
        updatedAt: new Date(),
        lastUpdatedAt: new Date(),
      };

      const timelineEvents: Array<{
        type: "user_verified" | "user_corrected" | "status_changed";
        description: string;
        previousValue?: Record<string, unknown>;
        newValue?: Record<string, unknown>;
      }> = [];

      if (input.userCorrectedTitle !== undefined) {
        updates.userCorrectedTitle = input.userCorrectedTitle || null;
        timelineEvents.push({
          type: "user_corrected",
          description: input.userCorrectedTitle
            ? `Title corrected to "${input.userCorrectedTitle}"`
            : "Title correction removed",
          previousValue: {
            title: uio.userCorrectedTitle || uio.canonicalTitle,
          },
          newValue: { title: input.userCorrectedTitle || uio.canonicalTitle },
        });
      }

      if (input.isUserVerified !== undefined) {
        updates.isUserVerified = input.isUserVerified;
        timelineEvents.push({
          type: "user_verified",
          description: input.isUserVerified
            ? "Marked as verified by user"
            : "Verification removed",
        });
      }

      if (input.status !== undefined) {
        updates.status = input.status;
        timelineEvents.push({
          type: "status_changed",
          description: `Status changed to ${input.status}`,
          previousValue: { status: uio.status },
          newValue: { status: input.status },
        });
      }

      // Update the UIO
      await db
        .update(schema.unifiedIntelligenceObject)
        .set(updates)
        .where(eq(schema.unifiedIntelligenceObject.id, input.uioId));

      // Add timeline events
      for (const event of timelineEvents) {
        await unifiedObjectService.addTimelineEvent(input.uioId, {
          eventType: event.type,
          eventDescription: event.description,
          previousValue: event.previousValue,
          newValue: event.newValue,
          triggeredBy: ctx.session.user.id,
        });
      }

      // Return updated UIO
      const updatedUio = await db.query.unifiedIntelligenceObject.findFirst({
        where: eq(schema.unifiedIntelligenceObject.id, input.uioId),
        with: {
          sources: {
            orderBy: [desc(schema.unifiedObjectSource.sourceTimestamp)],
          },
          owner: true,
        },
      });

      return {
        success: true,
        uio: updatedUio
          ? {
              ...updatedUio,
              sourceBreadcrumbs: unifiedObjectService.buildSourceBreadcrumbs(
                updatedUio.sources
              ),
            }
          : null,
      };
    }),

  /**
   * Get deduplication statistics for the organization.
   */
  getDeduplicationStats: protectedProcedure
    .input(z.object({ organizationId: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      // Verify organization access
      const member = await db.query.member.findFirst({
        where: and(
          eq(schema.member.organizationId, input.organizationId),
          eq(schema.member.userId, ctx.session.user.id)
        ),
      });

      if (!member) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "You do not have access to this organization",
        });
      }

      const [
        totalUIOs,
        activeUIOs,
        mergedUIOs,
        pendingCandidates,
        autoMerged,
        userMerged,
        userRejected,
      ] = await Promise.all([
        db
          .select({ count: sql<number>`count(*)` })
          .from(schema.unifiedIntelligenceObject)
          .where(
            eq(
              schema.unifiedIntelligenceObject.organizationId,
              input.organizationId
            )
          ),
        db
          .select({ count: sql<number>`count(*)` })
          .from(schema.unifiedIntelligenceObject)
          .where(
            and(
              eq(
                schema.unifiedIntelligenceObject.organizationId,
                input.organizationId
              ),
              eq(schema.unifiedIntelligenceObject.status, "active")
            )
          ),
        db
          .select({ count: sql<number>`count(*)` })
          .from(schema.unifiedIntelligenceObject)
          .where(
            and(
              eq(
                schema.unifiedIntelligenceObject.organizationId,
                input.organizationId
              ),
              eq(schema.unifiedIntelligenceObject.status, "merged")
            )
          ),
        db
          .select({ count: sql<number>`count(*)` })
          .from(schema.deduplicationCandidate)
          .where(
            and(
              eq(
                schema.deduplicationCandidate.organizationId,
                input.organizationId
              ),
              eq(schema.deduplicationCandidate.status, "pending_review")
            )
          ),
        db
          .select({ count: sql<number>`count(*)` })
          .from(schema.deduplicationCandidate)
          .where(
            and(
              eq(
                schema.deduplicationCandidate.organizationId,
                input.organizationId
              ),
              eq(schema.deduplicationCandidate.status, "auto_merged")
            )
          ),
        db
          .select({ count: sql<number>`count(*)` })
          .from(schema.deduplicationCandidate)
          .where(
            and(
              eq(
                schema.deduplicationCandidate.organizationId,
                input.organizationId
              ),
              eq(schema.deduplicationCandidate.status, "user_merged")
            )
          ),
        db
          .select({ count: sql<number>`count(*)` })
          .from(schema.deduplicationCandidate)
          .where(
            and(
              eq(
                schema.deduplicationCandidate.organizationId,
                input.organizationId
              ),
              eq(schema.deduplicationCandidate.status, "user_rejected")
            )
          ),
      ]);

      return {
        totalUIOs: totalUIOs[0]?.count ?? 0,
        activeUIOs: activeUIOs[0]?.count ?? 0,
        mergedUIOs: mergedUIOs[0]?.count ?? 0,
        deduplication: {
          pendingReview: pendingCandidates[0]?.count ?? 0,
          autoMerged: autoMerged[0]?.count ?? 0,
          userMerged: userMerged[0]?.count ?? 0,
          userRejected: userRejected[0]?.count ?? 0,
        },
      };
    }),
});
