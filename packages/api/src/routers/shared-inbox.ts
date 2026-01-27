// =============================================================================
// SHARED INBOX ROUTER
// =============================================================================
//
// API routes for shared inbox management including:
// - Shared inbox CRUD
// - Member management with availability tracking
// - Round-robin assignment
// - Claim/release workflow
// - SLA tracking
//

import { db } from "@memorystack/db";
import {
  assignmentHistory,
  conversationAssignment,
  member,
  sharedInbox,
  sharedInboxMember,
  sourceAccount,
} from "@memorystack/db/schema";
import { TRPCError } from "@trpc/server";
import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { protectedProcedure, router } from "../index";

// =============================================================================
// INPUT SCHEMAS
// =============================================================================

const assignmentMethodSchema = z.enum([
  "round_robin",
  "load_balanced",
  "manual_only",
  "skills_based",
]);

const memberAvailabilitySchema = z.enum([
  "available",
  "busy",
  "away",
  "do_not_disturb",
  "offline",
]);

const assignmentStatusSchema = z.enum([
  "unassigned",
  "assigned",
  "claimed",
  "in_progress",
  "waiting",
  "resolved",
  "escalated",
]);

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

async function verifyAdminAccess(
  userId: string,
  organizationId: string
): Promise<void> {
  const { role } = await verifyOrgMembership(userId, organizationId);

  if (role !== "owner" && role !== "admin") {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Admin access required.",
    });
  }
}

async function verifySharedInboxAccess(
  organizationId: string,
  sharedInboxId: string
): Promise<typeof sharedInbox.$inferSelect> {
  const inbox = await db.query.sharedInbox.findFirst({
    where: eq(sharedInbox.id, sharedInboxId),
  });

  if (!inbox || inbox.organizationId !== organizationId) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Shared inbox not found.",
    });
  }

  return inbox;
}

async function verifySharedInboxMembership(
  sharedInboxId: string,
  userId: string
): Promise<typeof sharedInboxMember.$inferSelect | null> {
  const result = await db.query.sharedInboxMember.findFirst({
    where: and(
      eq(sharedInboxMember.sharedInboxId, sharedInboxId),
      eq(sharedInboxMember.userId, userId)
    ),
  });
  return result ?? null;
}

/**
 * Get next assignee using round-robin algorithm.
 * Respects availability and workload limits.
 */
async function getNextRoundRobinAssignee(
  sharedInboxId: string
): Promise<string | null> {
  const inbox = await db.query.sharedInbox.findFirst({
    where: eq(sharedInbox.id, sharedInboxId),
  });

  if (!inbox) {
    return null;
  }

  // Get all active members ordered by round-robin position
  const members = await db.query.sharedInboxMember.findMany({
    where: and(
      eq(sharedInboxMember.sharedInboxId, sharedInboxId),
      eq(sharedInboxMember.isActive, true)
    ),
    orderBy: [asc(sharedInboxMember.roundRobinPosition)],
  });

  if (members.length === 0) {
    return null;
  }

  // Find first eligible member
  for (const m of members) {
    // Skip if not available (when configured to skip)
    if (inbox.skipAwayMembers && m.availability !== "available") {
      continue;
    }

    // Skip if at max capacity
    if (m.maxAssignments !== null && m.currentAssignments >= m.maxAssignments) {
      continue;
    }

    // Found eligible member - update their position to end of queue
    const maxPosition = Math.max(
      ...members.map((mem) => mem.roundRobinPosition)
    );

    await db
      .update(sharedInboxMember)
      .set({
        roundRobinPosition: maxPosition + 1,
        currentAssignments: m.currentAssignments + 1,
        totalAssigned: m.totalAssigned + 1,
        lastAssignedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(sharedInboxMember.id, m.id));

    return m.userId;
  }

  // No eligible member found
  return null;
}

/**
 * Get next assignee using load-balanced algorithm.
 * Assigns to member with lowest current workload.
 */
async function getNextLoadBalancedAssignee(
  sharedInboxId: string
): Promise<string | null> {
  const inbox = await db.query.sharedInbox.findFirst({
    where: eq(sharedInbox.id, sharedInboxId),
  });

  if (!inbox) {
    return null;
  }

  // Get all active members ordered by current assignments (ascending)
  const members = await db.query.sharedInboxMember.findMany({
    where: and(
      eq(sharedInboxMember.sharedInboxId, sharedInboxId),
      eq(sharedInboxMember.isActive, true)
    ),
    orderBy: [asc(sharedInboxMember.currentAssignments)],
  });

  if (members.length === 0) {
    return null;
  }

  // Find first eligible member (lowest workload)
  for (const m of members) {
    // Skip if not available (when configured to skip)
    if (inbox.skipAwayMembers && m.availability !== "available") {
      continue;
    }

    // Skip if at max capacity
    if (m.maxAssignments !== null && m.currentAssignments >= m.maxAssignments) {
      continue;
    }

    // Found eligible member
    await db
      .update(sharedInboxMember)
      .set({
        currentAssignments: m.currentAssignments + 1,
        totalAssigned: m.totalAssigned + 1,
        lastAssignedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(sharedInboxMember.id, m.id));

    return m.userId;
  }

  return null;
}

/**
 * Decrement member's current assignment count.
 */
async function decrementMemberAssignments(
  sharedInboxId: string,
  userId: string
): Promise<void> {
  const memberRecord = await verifySharedInboxMembership(sharedInboxId, userId);
  if (memberRecord && memberRecord.currentAssignments > 0) {
    await db
      .update(sharedInboxMember)
      .set({
        currentAssignments: memberRecord.currentAssignments - 1,
        updatedAt: new Date(),
      })
      .where(eq(sharedInboxMember.id, memberRecord.id));
  }
}

/**
 * Log assignment history event.
 */
async function logAssignmentHistory(
  conversationAssignmentId: string,
  action: string,
  performedBy: string,
  fromUserId: string | null,
  toUserId: string | null,
  reason: string | null = null
): Promise<void> {
  await db.insert(assignmentHistory).values({
    conversationAssignmentId,
    action,
    performedBy,
    fromUserId,
    toUserId,
    reason,
  });
}

// =============================================================================
// ROUTER
// =============================================================================

export const sharedInboxRouter = router({
  // ===========================================================================
  // SHARED INBOX CRUD
  // ===========================================================================

  /**
   * List shared inboxes for the organization.
   */
  list: protectedProcedure
    .input(z.object({ organizationId: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      await verifyOrgMembership(userId, input.organizationId);

      const inboxes = await db.query.sharedInbox.findMany({
        where: and(
          eq(sharedInbox.organizationId, input.organizationId),
          eq(sharedInbox.isActive, true)
        ),
        with: {
          members: {
            where: eq(sharedInboxMember.isActive, true),
            with: {
              user: {
                columns: {
                  id: true,
                  name: true,
                  email: true,
                  image: true,
                },
              },
            },
          },
        },
      });

      return { inboxes };
    }),

  /**
   * Get shared inbox by ID.
   */
  getById: protectedProcedure
    .input(
      z.object({
        organizationId: z.string().min(1),
        sharedInboxId: z.string().min(1),
      })
    )
    .query(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      await verifyOrgMembership(userId, input.organizationId);

      const inbox = await db.query.sharedInbox.findFirst({
        where: eq(sharedInbox.id, input.sharedInboxId),
        with: {
          members: {
            with: {
              user: {
                columns: {
                  id: true,
                  name: true,
                  email: true,
                  image: true,
                },
              },
            },
          },
        },
      });

      if (!inbox || inbox.organizationId !== input.organizationId) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Shared inbox not found.",
        });
      }

      return { inbox };
    }),

  /**
   * Create a new shared inbox (admin only).
   */
  create: protectedProcedure
    .input(
      z.object({
        organizationId: z.string().min(1),
        name: z.string().min(1).max(100),
        slug: z.string().min(1).max(50),
        description: z.string().max(500).optional(),
        sourceAccountIds: z.array(z.string()).default([]),
        assignmentMethod: assignmentMethodSchema.default("round_robin"),
        autoAssignEnabled: z.boolean().default(true),
        skipAwayMembers: z.boolean().default(true),
        firstResponseSlaMinutes: z.number().int().min(1).max(10_080).optional(),
        resolutionSlaMinutes: z.number().int().min(1).max(43_200).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      await verifyAdminAccess(userId, input.organizationId);

      // Verify source accounts exist and belong to org
      if (input.sourceAccountIds.length > 0) {
        for (const accountId of input.sourceAccountIds) {
          const account = await db.query.sourceAccount.findFirst({
            where: eq(sourceAccount.id, accountId),
          });

          if (!account || account.organizationId !== input.organizationId) {
            throw new TRPCError({
              code: "NOT_FOUND",
              message: `Source account ${accountId} not found.`,
            });
          }

          // Mark source account as shared inbox
          await db
            .update(sourceAccount)
            .set({ isSharedInbox: true })
            .where(eq(sourceAccount.id, accountId));
        }
      }

      const [newInbox] = await db
        .insert(sharedInbox)
        .values({
          organizationId: input.organizationId,
          name: input.name,
          slug: input.slug,
          description: input.description,
          sourceAccountIds: input.sourceAccountIds,
          assignmentMethod: input.assignmentMethod,
          autoAssignEnabled: input.autoAssignEnabled,
          skipAwayMembers: input.skipAwayMembers,
          firstResponseSlaMinutes: input.firstResponseSlaMinutes,
          resolutionSlaMinutes: input.resolutionSlaMinutes,
        })
        .returning();

      return { inbox: newInbox };
    }),

  /**
   * Update shared inbox settings (admin only).
   */
  update: protectedProcedure
    .input(
      z.object({
        organizationId: z.string().min(1),
        sharedInboxId: z.string().min(1),
        name: z.string().min(1).max(100).optional(),
        description: z.string().max(500).optional(),
        assignmentMethod: assignmentMethodSchema.optional(),
        autoAssignEnabled: z.boolean().optional(),
        skipAwayMembers: z.boolean().optional(),
        firstResponseSlaMinutes: z
          .number()
          .int()
          .min(1)
          .max(10_080)
          .nullable()
          .optional(),
        resolutionSlaMinutes: z
          .number()
          .int()
          .min(1)
          .max(43_200)
          .nullable()
          .optional(),
        isActive: z.boolean().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      await verifyAdminAccess(userId, input.organizationId);
      await verifySharedInboxAccess(input.organizationId, input.sharedInboxId);

      const updates: Partial<typeof sharedInbox.$inferInsert> = {
        updatedAt: new Date(),
      };

      if (input.name !== undefined) {
        updates.name = input.name;
      }
      if (input.description !== undefined) {
        updates.description = input.description;
      }
      if (input.assignmentMethod !== undefined) {
        updates.assignmentMethod = input.assignmentMethod;
      }
      if (input.autoAssignEnabled !== undefined) {
        updates.autoAssignEnabled = input.autoAssignEnabled;
      }
      if (input.skipAwayMembers !== undefined) {
        updates.skipAwayMembers = input.skipAwayMembers;
      }
      if (input.firstResponseSlaMinutes !== undefined) {
        updates.firstResponseSlaMinutes = input.firstResponseSlaMinutes;
      }
      if (input.resolutionSlaMinutes !== undefined) {
        updates.resolutionSlaMinutes = input.resolutionSlaMinutes;
      }
      if (input.isActive !== undefined) {
        updates.isActive = input.isActive;
      }

      await db
        .update(sharedInbox)
        .set(updates)
        .where(eq(sharedInbox.id, input.sharedInboxId));

      return { success: true };
    }),

  /**
   * Delete shared inbox (admin only).
   */
  delete: protectedProcedure
    .input(
      z.object({
        organizationId: z.string().min(1),
        sharedInboxId: z.string().min(1),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      await verifyAdminAccess(userId, input.organizationId);
      const inbox = await verifySharedInboxAccess(
        input.organizationId,
        input.sharedInboxId
      );

      // Remove shared inbox flag from source accounts
      if (inbox.sourceAccountIds && inbox.sourceAccountIds.length > 0) {
        for (const accountId of inbox.sourceAccountIds) {
          await db
            .update(sourceAccount)
            .set({ isSharedInbox: false })
            .where(eq(sourceAccount.id, accountId));
        }
      }

      // Soft delete by marking inactive
      await db
        .update(sharedInbox)
        .set({ isActive: false, updatedAt: new Date() })
        .where(eq(sharedInbox.id, input.sharedInboxId));

      return { success: true };
    }),

  // ===========================================================================
  // MEMBER MANAGEMENT
  // ===========================================================================

  /**
   * Add member to shared inbox (admin only).
   */
  addMember: protectedProcedure
    .input(
      z.object({
        organizationId: z.string().min(1),
        sharedInboxId: z.string().min(1),
        userId: z.string().min(1),
        maxAssignments: z.number().int().min(1).max(100).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const currentUserId = ctx.session.user.id;
      await verifyAdminAccess(currentUserId, input.organizationId);
      await verifySharedInboxAccess(input.organizationId, input.sharedInboxId);

      // Verify user is org member
      await verifyOrgMembership(input.userId, input.organizationId);

      // Check if already a member
      const existing = await verifySharedInboxMembership(
        input.sharedInboxId,
        input.userId
      );

      if (existing) {
        // Reactivate if inactive
        if (!existing.isActive) {
          await db
            .update(sharedInboxMember)
            .set({ isActive: true, updatedAt: new Date() })
            .where(eq(sharedInboxMember.id, existing.id));
          return { success: true, reactivated: true };
        }
        return { success: true, alreadyMember: true };
      }

      // Get max round-robin position
      const [maxPos] = await db
        .select({ max: sql<number>`COALESCE(MAX(round_robin_position), 0)` })
        .from(sharedInboxMember)
        .where(eq(sharedInboxMember.sharedInboxId, input.sharedInboxId));

      await db.insert(sharedInboxMember).values({
        sharedInboxId: input.sharedInboxId,
        userId: input.userId,
        roundRobinPosition: (maxPos?.max ?? 0) + 1,
        maxAssignments: input.maxAssignments,
      });

      return { success: true };
    }),

  /**
   * Remove member from shared inbox (admin only).
   */
  removeMember: protectedProcedure
    .input(
      z.object({
        organizationId: z.string().min(1),
        sharedInboxId: z.string().min(1),
        userId: z.string().min(1),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const currentUserId = ctx.session.user.id;
      await verifyAdminAccess(currentUserId, input.organizationId);
      await verifySharedInboxAccess(input.organizationId, input.sharedInboxId);

      const memberRecord = await verifySharedInboxMembership(
        input.sharedInboxId,
        input.userId
      );

      if (!memberRecord) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Member not found in shared inbox.",
        });
      }

      // Soft delete
      await db
        .update(sharedInboxMember)
        .set({ isActive: false, updatedAt: new Date() })
        .where(eq(sharedInboxMember.id, memberRecord.id));

      return { success: true };
    }),

  /**
   * Update member settings.
   */
  updateMember: protectedProcedure
    .input(
      z.object({
        organizationId: z.string().min(1),
        sharedInboxId: z.string().min(1),
        userId: z.string().min(1),
        availability: memberAvailabilitySchema.optional(),
        maxAssignments: z.number().int().min(1).max(100).nullable().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const currentUserId = ctx.session.user.id;
      await verifyOrgMembership(currentUserId, input.organizationId);
      await verifySharedInboxAccess(input.organizationId, input.sharedInboxId);

      // Users can update their own settings, admins can update anyone's
      const { role } = await verifyOrgMembership(
        currentUserId,
        input.organizationId
      );
      if (
        currentUserId !== input.userId &&
        role !== "owner" &&
        role !== "admin"
      ) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Cannot update other members' settings.",
        });
      }

      const memberRecord = await verifySharedInboxMembership(
        input.sharedInboxId,
        input.userId
      );

      if (!memberRecord) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Member not found in shared inbox.",
        });
      }

      const updates: Partial<typeof sharedInboxMember.$inferInsert> = {
        updatedAt: new Date(),
      };

      if (input.availability !== undefined) {
        updates.availability = input.availability;
      }
      if (input.maxAssignments !== undefined) {
        updates.maxAssignments = input.maxAssignments;
      }

      await db
        .update(sharedInboxMember)
        .set(updates)
        .where(eq(sharedInboxMember.id, memberRecord.id));

      return { success: true };
    }),

  /**
   * Set member availability (for self).
   */
  setMyAvailability: protectedProcedure
    .input(
      z.object({
        organizationId: z.string().min(1),
        sharedInboxId: z.string().min(1),
        availability: memberAvailabilitySchema,
      })
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      await verifyOrgMembership(userId, input.organizationId);
      await verifySharedInboxAccess(input.organizationId, input.sharedInboxId);

      const memberRecord = await verifySharedInboxMembership(
        input.sharedInboxId,
        userId
      );

      if (!memberRecord) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "You are not a member of this shared inbox.",
        });
      }

      await db
        .update(sharedInboxMember)
        .set({ availability: input.availability, updatedAt: new Date() })
        .where(eq(sharedInboxMember.id, memberRecord.id));

      return { success: true };
    }),

  // ===========================================================================
  // ASSIGNMENT MANAGEMENT
  // ===========================================================================

  /**
   * Get assignments for a shared inbox.
   */
  getAssignments: protectedProcedure
    .input(
      z.object({
        organizationId: z.string().min(1),
        sharedInboxId: z.string().min(1),
        status: assignmentStatusSchema.optional(),
        assigneeUserId: z.string().optional(),
        limit: z.number().int().min(1).max(100).default(50),
        offset: z.number().int().min(0).default(0),
      })
    )
    .query(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      await verifyOrgMembership(userId, input.organizationId);
      await verifySharedInboxAccess(input.organizationId, input.sharedInboxId);

      const conditions = [
        eq(conversationAssignment.sharedInboxId, input.sharedInboxId),
      ];

      if (input.status) {
        conditions.push(eq(conversationAssignment.status, input.status));
      }

      if (input.assigneeUserId) {
        conditions.push(
          eq(conversationAssignment.assigneeUserId, input.assigneeUserId)
        );
      }

      const [countResult] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(conversationAssignment)
        .where(and(...conditions));

      const assignments = await db.query.conversationAssignment.findMany({
        where: and(...conditions),
        limit: input.limit,
        offset: input.offset,
        orderBy: [desc(conversationAssignment.createdAt)],
        with: {
          conversation: {
            columns: {
              id: true,
              title: true,
              snippet: true,
              lastMessageAt: true,
            },
          },
          assignee: {
            columns: {
              id: true,
              name: true,
              email: true,
              image: true,
            },
          },
        },
      });

      return {
        assignments,
        total: countResult?.count ?? 0,
        hasMore: (countResult?.count ?? 0) > input.offset + input.limit,
      };
    }),

  /**
   * Get unassigned items in shared inbox.
   */
  getUnassigned: protectedProcedure
    .input(
      z.object({
        organizationId: z.string().min(1),
        sharedInboxId: z.string().min(1),
        limit: z.number().int().min(1).max(100).default(50),
        offset: z.number().int().min(0).default(0),
      })
    )
    .query(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      await verifyOrgMembership(userId, input.organizationId);
      await verifySharedInboxAccess(input.organizationId, input.sharedInboxId);

      const conditions = [
        eq(conversationAssignment.sharedInboxId, input.sharedInboxId),
        eq(conversationAssignment.status, "unassigned"),
        isNull(conversationAssignment.assigneeUserId),
      ];

      const assignments = await db.query.conversationAssignment.findMany({
        where: and(...conditions),
        limit: input.limit,
        offset: input.offset,
        orderBy: [asc(conversationAssignment.createdAt)], // Oldest first
        with: {
          conversation: {
            columns: {
              id: true,
              title: true,
              snippet: true,
              lastMessageAt: true,
            },
          },
        },
      });

      return { assignments };
    }),

  /**
   * Assign conversation to a user.
   */
  assign: protectedProcedure
    .input(
      z.object({
        organizationId: z.string().min(1),
        sharedInboxId: z.string().min(1),
        assignmentId: z.string().min(1),
        assignToUserId: z.string().min(1),
        note: z.string().max(500).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const currentUserId = ctx.session.user.id;
      await verifyOrgMembership(currentUserId, input.organizationId);
      await verifySharedInboxAccess(input.organizationId, input.sharedInboxId);

      // Verify target user is shared inbox member
      const targetMember = await verifySharedInboxMembership(
        input.sharedInboxId,
        input.assignToUserId
      );

      if (!targetMember?.isActive) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Target user is not an active member of this shared inbox.",
        });
      }

      const assignment = await db.query.conversationAssignment.findFirst({
        where: eq(conversationAssignment.id, input.assignmentId),
      });

      if (!assignment || assignment.sharedInboxId !== input.sharedInboxId) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Assignment not found.",
        });
      }

      const previousUserId = assignment.assigneeUserId;

      // Decrement previous assignee's count if there was one
      if (previousUserId) {
        await decrementMemberAssignments(input.sharedInboxId, previousUserId);
      }

      // Increment new assignee's count
      await db
        .update(sharedInboxMember)
        .set({
          currentAssignments: targetMember.currentAssignments + 1,
          totalAssigned: targetMember.totalAssigned + 1,
          lastAssignedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(sharedInboxMember.id, targetMember.id));

      // Update assignment
      await db
        .update(conversationAssignment)
        .set({
          assigneeUserId: input.assignToUserId,
          assignedAt: new Date(),
          assignedBy: currentUserId,
          status: "assigned",
          updatedAt: new Date(),
        })
        .where(eq(conversationAssignment.id, input.assignmentId));

      // Log history
      await logAssignmentHistory(
        input.assignmentId,
        "assigned",
        currentUserId,
        previousUserId,
        input.assignToUserId,
        input.note
      );

      return { success: true };
    }),

  /**
   * Claim a conversation (self-assign).
   */
  claim: protectedProcedure
    .input(
      z.object({
        organizationId: z.string().min(1),
        sharedInboxId: z.string().min(1),
        assignmentId: z.string().min(1),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      await verifyOrgMembership(userId, input.organizationId);
      await verifySharedInboxAccess(input.organizationId, input.sharedInboxId);

      // Verify user is shared inbox member
      const memberRecord = await verifySharedInboxMembership(
        input.sharedInboxId,
        userId
      );

      if (!memberRecord?.isActive) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "You are not an active member of this shared inbox.",
        });
      }

      const assignment = await db.query.conversationAssignment.findFirst({
        where: eq(conversationAssignment.id, input.assignmentId),
      });

      if (!assignment || assignment.sharedInboxId !== input.sharedInboxId) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Assignment not found.",
        });
      }

      // Can only claim unassigned items
      if (assignment.status !== "unassigned" && assignment.assigneeUserId) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "This item is already assigned.",
        });
      }

      // Increment member's assignment count
      await db
        .update(sharedInboxMember)
        .set({
          currentAssignments: memberRecord.currentAssignments + 1,
          totalAssigned: memberRecord.totalAssigned + 1,
          lastAssignedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(sharedInboxMember.id, memberRecord.id));

      // Update assignment
      await db
        .update(conversationAssignment)
        .set({
          assigneeUserId: userId,
          claimedAt: new Date(),
          claimedBy: userId,
          status: "claimed",
          updatedAt: new Date(),
        })
        .where(eq(conversationAssignment.id, input.assignmentId));

      // Log history
      await logAssignmentHistory(
        input.assignmentId,
        "claimed",
        userId,
        null,
        userId,
        null
      );

      return { success: true };
    }),

  /**
   * Release a claimed/assigned conversation.
   */
  release: protectedProcedure
    .input(
      z.object({
        organizationId: z.string().min(1),
        sharedInboxId: z.string().min(1),
        assignmentId: z.string().min(1),
        reassign: z.boolean().default(true), // Auto-reassign to next person
      })
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      await verifyOrgMembership(userId, input.organizationId);
      const inbox = await verifySharedInboxAccess(
        input.organizationId,
        input.sharedInboxId
      );

      const assignment = await db.query.conversationAssignment.findFirst({
        where: eq(conversationAssignment.id, input.assignmentId),
      });

      if (!assignment || assignment.sharedInboxId !== input.sharedInboxId) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Assignment not found.",
        });
      }

      // Can only release your own assignments (unless admin)
      const { role } = await verifyOrgMembership(userId, input.organizationId);
      if (
        assignment.assigneeUserId !== userId &&
        role !== "owner" &&
        role !== "admin"
      ) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Cannot release another user's assignment.",
        });
      }

      const previousUserId = assignment.assigneeUserId;

      // Decrement current assignee's count
      if (previousUserId) {
        await decrementMemberAssignments(input.sharedInboxId, previousUserId);
      }

      // Try to reassign if requested
      let newAssigneeId: string | null = null;
      if (input.reassign) {
        if (inbox.assignmentMethod === "round_robin") {
          newAssigneeId = await getNextRoundRobinAssignee(input.sharedInboxId);
        } else if (inbox.assignmentMethod === "load_balanced") {
          newAssigneeId = await getNextLoadBalancedAssignee(
            input.sharedInboxId
          );
        }
      }

      // Update assignment
      await db
        .update(conversationAssignment)
        .set({
          assigneeUserId: newAssigneeId,
          assignedAt: newAssigneeId ? new Date() : null,
          assignedBy: newAssigneeId ? "system" : null, // System assignment
          claimedAt: null,
          claimedBy: null,
          status: newAssigneeId ? "assigned" : "unassigned",
          updatedAt: new Date(),
        })
        .where(eq(conversationAssignment.id, input.assignmentId));

      // Log history
      await logAssignmentHistory(
        input.assignmentId,
        "released",
        userId,
        previousUserId,
        newAssigneeId,
        null
      );

      return { success: true, reassignedTo: newAssigneeId };
    }),

  /**
   * Mark assignment as resolved.
   */
  resolve: protectedProcedure
    .input(
      z.object({
        organizationId: z.string().min(1),
        sharedInboxId: z.string().min(1),
        assignmentId: z.string().min(1),
        resolutionNote: z.string().max(500).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      await verifyOrgMembership(userId, input.organizationId);
      await verifySharedInboxAccess(input.organizationId, input.sharedInboxId);

      const assignment = await db.query.conversationAssignment.findFirst({
        where: eq(conversationAssignment.id, input.assignmentId),
      });

      if (!assignment || assignment.sharedInboxId !== input.sharedInboxId) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Assignment not found.",
        });
      }

      // Only assignee or admin can resolve
      const { role } = await verifyOrgMembership(userId, input.organizationId);
      if (
        assignment.assigneeUserId !== userId &&
        role !== "owner" &&
        role !== "admin"
      ) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Only the assignee or admin can resolve.",
        });
      }

      // Decrement assignee's count
      if (assignment.assigneeUserId) {
        await decrementMemberAssignments(
          input.sharedInboxId,
          assignment.assigneeUserId
        );
      }

      // Update assignment
      await db
        .update(conversationAssignment)
        .set({
          status: "resolved",
          resolvedAt: new Date(),
          resolvedBy: userId,
          resolutionNote: input.resolutionNote,
          updatedAt: new Date(),
        })
        .where(eq(conversationAssignment.id, input.assignmentId));

      // Log history
      await logAssignmentHistory(
        input.assignmentId,
        "resolved",
        userId,
        assignment.assigneeUserId,
        assignment.assigneeUserId,
        input.resolutionNote
      );

      return { success: true };
    }),

  // ===========================================================================
  // STATISTICS
  // ===========================================================================

  /**
   * Get shared inbox statistics.
   */
  getStats: protectedProcedure
    .input(
      z.object({
        organizationId: z.string().min(1),
        sharedInboxId: z.string().min(1),
      })
    )
    .query(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      await verifyOrgMembership(userId, input.organizationId);
      await verifySharedInboxAccess(input.organizationId, input.sharedInboxId);

      // Count by status
      const statusCounts = await db
        .select({
          status: conversationAssignment.status,
          count: sql<number>`count(*)::int`,
        })
        .from(conversationAssignment)
        .where(eq(conversationAssignment.sharedInboxId, input.sharedInboxId))
        .groupBy(conversationAssignment.status);

      // Get member workloads
      const memberWorkloads = await db.query.sharedInboxMember.findMany({
        where: and(
          eq(sharedInboxMember.sharedInboxId, input.sharedInboxId),
          eq(sharedInboxMember.isActive, true)
        ),
        with: {
          user: {
            columns: {
              id: true,
              name: true,
              email: true,
              image: true,
            },
          },
        },
      });

      const stats = {
        unassigned: 0,
        assigned: 0,
        claimed: 0,
        in_progress: 0,
        waiting: 0,
        resolved: 0,
        escalated: 0,
      };

      for (const s of statusCounts) {
        if (s.status in stats) {
          stats[s.status as keyof typeof stats] = s.count;
        }
      }

      return {
        ...stats,
        total: Object.values(stats).reduce((a, b) => a + b, 0),
        activeMembers: memberWorkloads.filter(
          (m) => m.availability === "available"
        ).length,
        memberWorkloads: memberWorkloads.map((m) => ({
          userId: m.userId,
          user: m.user,
          availability: m.availability,
          currentAssignments: m.currentAssignments,
          maxAssignments: m.maxAssignments,
          totalAssigned: m.totalAssigned,
        })),
      };
    }),
});
