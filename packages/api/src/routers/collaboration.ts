// =============================================================================
// COLLABORATION ROUTER
// =============================================================================
//
// API routes for collaboration features including:
// - @mentions
// - Comments & discussions
// - Activity feed
// - Delegation
//

import { db } from "@memorystack/db";
import {
  type ActivityMetadata,
  activity,
  activityReadStatus,
  comment,
  delegation,
  member,
  mention,
  type Reaction,
  team,
} from "@memorystack/db/schema";
import { TRPCError } from "@trpc/server";
import { and, desc, eq, gt, gte, inArray, isNull, or, sql } from "drizzle-orm";
import { z } from "zod";
import { protectedProcedure, router } from "../index";

// =============================================================================
// INPUT SCHEMAS
// =============================================================================

const mentionTypeSchema = z.enum(["user", "team", "all", "channel"]);
const mentionContextTypeSchema = z.enum([
  "conversation",
  "commitment",
  "decision",
  "task",
  "uio",
  "contact",
  "comment",
  "note",
]);

const commentTargetTypeSchema = z.enum([
  "conversation",
  "commitment",
  "decision",
  "task",
  "uio",
  "contact",
]);

const activityTypeSchema = z.enum([
  "commitment_created",
  "commitment_updated",
  "commitment_completed",
  "commitment_overdue",
  "decision_made",
  "decision_updated",
  "decision_reversed",
  "task_created",
  "task_assigned",
  "task_completed",
  "comment_added",
  "comment_resolved",
  "mention",
  "share",
  "share_request",
  "conversation_assigned",
  "conversation_claimed",
  "conversation_resolved",
  "conversation_escalated",
  "deadline_approaching",
  "deadline_missed",
  "risk_detected",
  "risk_resolved",
  "member_joined",
  "member_left",
  "settings_changed",
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

async function verifyCommentAccess(
  organizationId: string,
  commentId: string
): Promise<typeof comment.$inferSelect> {
  const found = await db.query.comment.findFirst({
    where: eq(comment.id, commentId),
  });

  if (!found || found.organizationId !== organizationId) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Comment not found.",
    });
  }

  return found;
}

/**
 * Create activity feed entry.
 */
async function createActivity(params: {
  organizationId: string;
  userId?: string;
  activityType: string;
  targetType: string;
  targetId: string;
  targetTitle?: string;
  metadata?: ActivityMetadata;
  visibility?: string;
  visibleToTeamIds?: string[];
  visibleToUserIds?: string[];
}): Promise<void> {
  await db.insert(activity).values({
    organizationId: params.organizationId,
    userId: params.userId,
    activityType: params.activityType as z.infer<typeof activityTypeSchema>,
    targetType: params.targetType,
    targetId: params.targetId,
    targetTitle: params.targetTitle,
    metadata: params.metadata,
    visibility: (params.visibility ?? "organization") as
      | "private"
      | "team"
      | "organization",
    visibleToTeamIds: params.visibleToTeamIds,
    visibleToUserIds: params.visibleToUserIds,
  });
}

// =============================================================================
// ROUTER
// =============================================================================

export const collaborationRouter = router({
  // ===========================================================================
  // MENTIONS
  // ===========================================================================

  /**
   * Create a mention.
   */
  createMention: protectedProcedure
    .input(
      z.object({
        organizationId: z.string().min(1),
        mentionType: mentionTypeSchema,
        mentionedUserId: z.string().optional(),
        mentionedTeamId: z.string().optional(),
        contextType: mentionContextTypeSchema,
        contextId: z.string().min(1),
        mentionText: z.string().min(1).max(100),
        contextPreview: z.string().max(200).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      await verifyOrgMembership(userId, input.organizationId);

      // Validate mention target
      if (input.mentionType === "user" && !input.mentionedUserId) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "User mention requires mentionedUserId.",
        });
      }
      if (input.mentionType === "team" && !input.mentionedTeamId) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Team mention requires mentionedTeamId.",
        });
      }

      // Verify mentioned user is org member
      if (input.mentionedUserId) {
        await verifyOrgMembership(input.mentionedUserId, input.organizationId);
      }

      // Verify team exists
      if (input.mentionedTeamId) {
        const teamRecord = await db.query.team.findFirst({
          where: eq(team.id, input.mentionedTeamId),
        });
        if (!teamRecord || teamRecord.organizationId !== input.organizationId) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Team not found.",
          });
        }
      }

      const [newMention] = await db
        .insert(mention)
        .values({
          organizationId: input.organizationId,
          mentionedByUserId: userId,
          mentionType: input.mentionType,
          mentionedUserId: input.mentionedUserId,
          mentionedTeamId: input.mentionedTeamId,
          contextType: input.contextType,
          contextId: input.contextId,
          mentionText: input.mentionText,
          contextPreview: input.contextPreview,
        })
        .returning();

      // Create activity for the mention
      await createActivity({
        organizationId: input.organizationId,
        userId,
        activityType: "mention",
        targetType: input.contextType,
        targetId: input.contextId,
        metadata: {
          mentionText: input.mentionText,
        },
        visibleToUserIds: input.mentionedUserId ? [input.mentionedUserId] : [],
      });

      return { mention: newMention };
    }),

  /**
   * Get unread mentions for the current user.
   */
  getUnreadMentions: protectedProcedure
    .input(z.object({ organizationId: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      await verifyOrgMembership(userId, input.organizationId);

      const mentions = await db.query.mention.findMany({
        where: and(
          eq(mention.organizationId, input.organizationId),
          eq(mention.mentionedUserId, userId),
          isNull(mention.readAt)
        ),
        orderBy: [desc(mention.createdAt)],
        with: {
          mentionedByUser: {
            columns: {
              id: true,
              name: true,
              email: true,
              image: true,
            },
          },
        },
      });

      return { mentions, unreadCount: mentions.length };
    }),

  /**
   * Mark mentions as read.
   */
  markMentionsRead: protectedProcedure
    .input(
      z.object({
        organizationId: z.string().min(1),
        mentionIds: z.array(z.string()).optional(),
        markAll: z.boolean().default(false),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      await verifyOrgMembership(userId, input.organizationId);

      const conditions = [
        eq(mention.organizationId, input.organizationId),
        eq(mention.mentionedUserId, userId),
        isNull(mention.readAt),
      ];

      if (input.mentionIds && input.mentionIds.length > 0 && !input.markAll) {
        conditions.push(inArray(mention.id, input.mentionIds));
      }

      await db
        .update(mention)
        .set({ readAt: new Date() })
        .where(and(...conditions));

      return { success: true };
    }),

  /**
   * Get mentions for a specific resource.
   */
  getMentionsForResource: protectedProcedure
    .input(
      z.object({
        organizationId: z.string().min(1),
        contextType: mentionContextTypeSchema,
        contextId: z.string().min(1),
      })
    )
    .query(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      await verifyOrgMembership(userId, input.organizationId);

      const mentions = await db.query.mention.findMany({
        where: and(
          eq(mention.organizationId, input.organizationId),
          eq(mention.contextType, input.contextType),
          eq(mention.contextId, input.contextId)
        ),
        orderBy: [desc(mention.createdAt)],
        with: {
          mentionedByUser: {
            columns: {
              id: true,
              name: true,
              email: true,
              image: true,
            },
          },
          mentionedUser: {
            columns: {
              id: true,
              name: true,
              email: true,
              image: true,
            },
          },
          mentionedTeam: {
            columns: {
              id: true,
              name: true,
            },
          },
        },
      });

      return { mentions };
    }),

  // ===========================================================================
  // COMMENTS
  // ===========================================================================

  /**
   * Create a comment.
   */
  createComment: protectedProcedure
    .input(
      z.object({
        organizationId: z.string().min(1),
        targetType: commentTargetTypeSchema,
        targetId: z.string().min(1),
        content: z.string().min(1).max(5000),
        parentCommentId: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      await verifyOrgMembership(userId, input.organizationId);

      let depth = 0;
      let rootCommentId: string | null = null;

      // Handle threading
      if (input.parentCommentId) {
        const parent = await verifyCommentAccess(
          input.organizationId,
          input.parentCommentId
        );
        depth = parent.depth + 1;
        rootCommentId = parent.rootCommentId ?? parent.id;
      }

      const [newComment] = await db
        .insert(comment)
        .values({
          organizationId: input.organizationId,
          userId,
          targetType: input.targetType,
          targetId: input.targetId,
          content: input.content,
          contentPlainText: input.content.replace(/<[^>]*>/g, ""),
          parentCommentId: input.parentCommentId,
          rootCommentId,
          depth,
        })
        .returning();

      // If top-level, set rootCommentId to self
      if (!input.parentCommentId && newComment) {
        await db
          .update(comment)
          .set({ rootCommentId: newComment.id })
          .where(eq(comment.id, newComment.id));
      }

      // Create activity
      await createActivity({
        organizationId: input.organizationId,
        userId,
        activityType: "comment_added",
        targetType: input.targetType,
        targetId: input.targetId,
        metadata: {
          commentPreview: input.content.slice(0, 100),
        },
      });

      return { comment: newComment };
    }),

  /**
   * Update a comment.
   */
  updateComment: protectedProcedure
    .input(
      z.object({
        organizationId: z.string().min(1),
        commentId: z.string().min(1),
        content: z.string().min(1).max(5000),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      await verifyOrgMembership(userId, input.organizationId);
      const existingComment = await verifyCommentAccess(
        input.organizationId,
        input.commentId
      );

      // Only author can edit
      if (existingComment.userId !== userId) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "You can only edit your own comments.",
        });
      }

      await db
        .update(comment)
        .set({
          content: input.content,
          contentPlainText: input.content.replace(/<[^>]*>/g, ""),
          isEdited: true,
          editedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(comment.id, input.commentId));

      return { success: true };
    }),

  /**
   * Delete a comment.
   */
  deleteComment: protectedProcedure
    .input(
      z.object({
        organizationId: z.string().min(1),
        commentId: z.string().min(1),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      const { role } = await verifyOrgMembership(userId, input.organizationId);
      const existingComment = await verifyCommentAccess(
        input.organizationId,
        input.commentId
      );

      // Author or admin can delete
      if (
        existingComment.userId !== userId &&
        role !== "owner" &&
        role !== "admin"
      ) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "You can only delete your own comments.",
        });
      }

      // Soft delete
      await db
        .update(comment)
        .set({
          isDeleted: true,
          deletedAt: new Date(),
          deletedByUserId: userId,
          content: "[deleted]",
          contentPlainText: "[deleted]",
          updatedAt: new Date(),
        })
        .where(eq(comment.id, input.commentId));

      return { success: true };
    }),

  /**
   * Get comments for a resource.
   */
  getCommentsForResource: protectedProcedure
    .input(
      z.object({
        organizationId: z.string().min(1),
        targetType: commentTargetTypeSchema,
        targetId: z.string().min(1),
        includeDeleted: z.boolean().default(false),
      })
    )
    .query(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      await verifyOrgMembership(userId, input.organizationId);

      const conditions = [
        eq(comment.organizationId, input.organizationId),
        eq(comment.targetType, input.targetType),
        eq(comment.targetId, input.targetId),
      ];

      if (!input.includeDeleted) {
        conditions.push(eq(comment.isDeleted, false));
      }

      const comments = await db.query.comment.findMany({
        where: and(...conditions),
        orderBy: [desc(comment.createdAt)],
        with: {
          user: {
            columns: {
              id: true,
              name: true,
              email: true,
              image: true,
            },
          },
          resolvedByUser: {
            columns: {
              id: true,
              name: true,
              email: true,
            },
          },
        },
      });

      return { comments };
    }),

  /**
   * Add reaction to a comment.
   */
  addReaction: protectedProcedure
    .input(
      z.object({
        organizationId: z.string().min(1),
        commentId: z.string().min(1),
        emoji: z.string().min(1).max(2),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      await verifyOrgMembership(userId, input.organizationId);
      const existingComment = await verifyCommentAccess(
        input.organizationId,
        input.commentId
      );

      const reactions = (existingComment.reactions as Reaction[]) ?? [];
      const existingReaction = reactions.find((r) => r.emoji === input.emoji);

      if (existingReaction) {
        if (!existingReaction.userIds.includes(userId)) {
          existingReaction.userIds.push(userId);
          existingReaction.count++;
        }
      } else {
        reactions.push({
          emoji: input.emoji,
          userIds: [userId],
          count: 1,
        });
      }

      await db
        .update(comment)
        .set({ reactions, updatedAt: new Date() })
        .where(eq(comment.id, input.commentId));

      return { success: true };
    }),

  /**
   * Remove reaction from a comment.
   */
  removeReaction: protectedProcedure
    .input(
      z.object({
        organizationId: z.string().min(1),
        commentId: z.string().min(1),
        emoji: z.string().min(1).max(2),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      await verifyOrgMembership(userId, input.organizationId);
      const existingComment = await verifyCommentAccess(
        input.organizationId,
        input.commentId
      );

      let reactions = (existingComment.reactions as Reaction[]) ?? [];
      reactions = reactions
        .map((r) => {
          if (r.emoji === input.emoji) {
            r.userIds = r.userIds.filter((id) => id !== userId);
            r.count = r.userIds.length;
          }
          return r;
        })
        .filter((r) => r.count > 0);

      await db
        .update(comment)
        .set({ reactions, updatedAt: new Date() })
        .where(eq(comment.id, input.commentId));

      return { success: true };
    }),

  /**
   * Resolve a comment thread.
   */
  resolveThread: protectedProcedure
    .input(
      z.object({
        organizationId: z.string().min(1),
        commentId: z.string().min(1),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      await verifyOrgMembership(userId, input.organizationId);
      const existingComment = await verifyCommentAccess(
        input.organizationId,
        input.commentId
      );

      // Can only resolve top-level comments (threads)
      if (existingComment.parentCommentId) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Can only resolve top-level comments.",
        });
      }

      await db
        .update(comment)
        .set({
          isResolved: true,
          resolvedByUserId: userId,
          resolvedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(comment.id, input.commentId));

      // Create activity
      await createActivity({
        organizationId: input.organizationId,
        userId,
        activityType: "comment_resolved",
        targetType: existingComment.targetType,
        targetId: existingComment.targetId,
      });

      return { success: true };
    }),

  /**
   * Unresolve a comment thread.
   */
  unresolveThread: protectedProcedure
    .input(
      z.object({
        organizationId: z.string().min(1),
        commentId: z.string().min(1),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      await verifyOrgMembership(userId, input.organizationId);
      await verifyCommentAccess(input.organizationId, input.commentId);

      await db
        .update(comment)
        .set({
          isResolved: false,
          resolvedByUserId: null,
          resolvedAt: null,
          updatedAt: new Date(),
        })
        .where(eq(comment.id, input.commentId));

      return { success: true };
    }),

  // ===========================================================================
  // ACTIVITY FEED
  // ===========================================================================

  /**
   * Get activity feed.
   */
  getActivityFeed: protectedProcedure
    .input(
      z.object({
        organizationId: z.string().min(1),
        activityTypes: z.array(activityTypeSchema).optional(),
        targetType: z.string().optional(),
        targetId: z.string().optional(),
        limit: z.number().int().min(1).max(100).default(50),
        cursor: z.string().optional(), // Activity ID for pagination
      })
    )
    .query(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      await verifyOrgMembership(userId, input.organizationId);

      const conditions = [eq(activity.organizationId, input.organizationId)];

      // Visibility filter - user can see:
      // 1. Organization-wide activities
      // 2. Activities where they're in visibleToUserIds
      // 3. Their own activities
      conditions.push(
        or(
          eq(activity.visibility, "organization"),
          sql`${userId} = ANY(${activity.visibleToUserIds})`,
          eq(activity.userId, userId)
        )!
      );

      if (input.activityTypes && input.activityTypes.length > 0) {
        conditions.push(inArray(activity.activityType, input.activityTypes));
      }

      if (input.targetType) {
        conditions.push(eq(activity.targetType, input.targetType));
      }

      if (input.targetId) {
        conditions.push(eq(activity.targetId, input.targetId));
      }

      if (input.cursor) {
        // Get the timestamp of the cursor activity
        const cursorActivity = await db.query.activity.findFirst({
          where: eq(activity.id, input.cursor),
        });
        if (cursorActivity) {
          conditions.push(
            sql`${activity.createdAt} < ${cursorActivity.createdAt}`
          );
        }
      }

      const activities = await db.query.activity.findMany({
        where: and(...conditions),
        limit: input.limit + 1, // Fetch one extra to check hasMore
        orderBy: [desc(activity.createdAt)],
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

      const hasMore = activities.length > input.limit;
      if (hasMore) {
        activities.pop();
      }

      const nextCursor =
        activities.length > 0 ? activities.at(-1)?.id : undefined;

      return {
        activities,
        hasMore,
        nextCursor,
      };
    }),

  /**
   * Get activity for a specific resource.
   */
  getActivityForResource: protectedProcedure
    .input(
      z.object({
        organizationId: z.string().min(1),
        targetType: z.string().min(1),
        targetId: z.string().min(1),
        limit: z.number().int().min(1).max(100).default(50),
      })
    )
    .query(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      await verifyOrgMembership(userId, input.organizationId);

      const activities = await db.query.activity.findMany({
        where: and(
          eq(activity.organizationId, input.organizationId),
          eq(activity.targetType, input.targetType),
          eq(activity.targetId, input.targetId)
        ),
        limit: input.limit,
        orderBy: [desc(activity.createdAt)],
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

      return { activities };
    }),

  /**
   * Mark activity as seen (for unread counts).
   */
  markActivitySeen: protectedProcedure
    .input(
      z.object({
        organizationId: z.string().min(1),
        lastSeenActivityId: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      await verifyOrgMembership(userId, input.organizationId);

      // Upsert read status
      await db
        .insert(activityReadStatus)
        .values({
          userId,
          organizationId: input.organizationId,
          lastSeenActivityId: input.lastSeenActivityId,
          lastViewedAt: new Date(),
          unreadCount: 0,
        })
        .onConflictDoUpdate({
          target: [
            activityReadStatus.userId,
            activityReadStatus.organizationId,
          ],
          set: {
            lastSeenActivityId: input.lastSeenActivityId,
            lastViewedAt: new Date(),
            unreadCount: 0,
            updatedAt: new Date(),
          },
        });

      return { success: true };
    }),

  /**
   * Get unread activity count.
   */
  getUnreadActivityCount: protectedProcedure
    .input(z.object({ organizationId: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      await verifyOrgMembership(userId, input.organizationId);

      // Get read status
      const readStatus = await db.query.activityReadStatus.findFirst({
        where: and(
          eq(activityReadStatus.userId, userId),
          eq(activityReadStatus.organizationId, input.organizationId)
        ),
      });

      const conditions = [
        eq(activity.organizationId, input.organizationId),
        or(
          eq(activity.visibility, "organization"),
          sql`${userId} = ANY(${activity.visibleToUserIds})`,
          eq(activity.userId, userId)
        )!,
      ];

      // Count activities newer than last seen
      if (readStatus?.lastViewedAt) {
        conditions.push(gt(activity.createdAt, readStatus.lastViewedAt));
      }

      const [result] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(activity)
        .where(and(...conditions));

      return { unreadCount: result?.count ?? 0 };
    }),

  // ===========================================================================
  // DELEGATION
  // ===========================================================================

  /**
   * Create a delegation.
   */
  createDelegation: protectedProcedure
    .input(
      z.object({
        organizationId: z.string().min(1),
        delegateeUserId: z.string().min(1),
        delegationType: z.enum([
          "inbox_triage",
          "commitment_management",
          "full_access",
        ]),
        sourceAccountIds: z.array(z.string()).default([]),
        permissions: z.object({
          canRespond: z.boolean().default(true),
          canArchive: z.boolean().default(true),
          canAssignCommitments: z.boolean().default(false),
          canMakeDecisions: z.boolean().default(false),
          canViewPrivate: z.boolean().default(false),
        }),
        startsAt: z.date().optional(),
        expiresAt: z.date().optional(),
        reason: z.string().max(200).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      await verifyOrgMembership(userId, input.organizationId);

      // Verify delegatee is org member
      await verifyOrgMembership(input.delegateeUserId, input.organizationId);

      // Can't delegate to yourself
      if (input.delegateeUserId === userId) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Cannot delegate to yourself.",
        });
      }

      const [newDelegation] = await db
        .insert(delegation)
        .values({
          organizationId: input.organizationId,
          delegatorUserId: userId,
          delegateeUserId: input.delegateeUserId,
          delegationType: input.delegationType,
          sourceAccountIds: input.sourceAccountIds,
          permissions: input.permissions,
          startsAt: input.startsAt ?? new Date(),
          expiresAt: input.expiresAt,
          reason: input.reason,
        })
        .returning();

      return { delegation: newDelegation };
    }),

  /**
   * Revoke a delegation.
   */
  revokeDelegation: protectedProcedure
    .input(
      z.object({
        organizationId: z.string().min(1),
        delegationId: z.string().min(1),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      const { role } = await verifyOrgMembership(userId, input.organizationId);

      const existingDelegation = await db.query.delegation.findFirst({
        where: eq(delegation.id, input.delegationId),
      });

      if (
        !existingDelegation ||
        existingDelegation.organizationId !== input.organizationId
      ) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Delegation not found.",
        });
      }

      // Only delegator, delegatee, or admin can revoke
      if (
        existingDelegation.delegatorUserId !== userId &&
        existingDelegation.delegateeUserId !== userId &&
        role !== "owner" &&
        role !== "admin"
      ) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Cannot revoke this delegation.",
        });
      }

      await db
        .update(delegation)
        .set({
          isActive: false,
          revokedAt: new Date(),
          revokedByUserId: userId,
          updatedAt: new Date(),
        })
        .where(eq(delegation.id, input.delegationId));

      return { success: true };
    }),

  /**
   * Get delegations I've created.
   */
  getMyDelegations: protectedProcedure
    .input(
      z.object({
        organizationId: z.string().min(1),
        includeInactive: z.boolean().default(false),
      })
    )
    .query(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      await verifyOrgMembership(userId, input.organizationId);

      const conditions = [
        eq(delegation.organizationId, input.organizationId),
        eq(delegation.delegatorUserId, userId),
      ];

      if (!input.includeInactive) {
        conditions.push(eq(delegation.isActive, true));
      }

      const delegations = await db.query.delegation.findMany({
        where: and(...conditions),
        orderBy: [desc(delegation.createdAt)],
        with: {
          delegateeUser: {
            columns: {
              id: true,
              name: true,
              email: true,
              image: true,
            },
          },
        },
      });

      return { delegations };
    }),

  /**
   * Get delegations assigned to me.
   */
  getDelegatedToMe: protectedProcedure
    .input(
      z.object({
        organizationId: z.string().min(1),
        includeInactive: z.boolean().default(false),
      })
    )
    .query(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      await verifyOrgMembership(userId, input.organizationId);

      const now = new Date();
      const conditions = [
        eq(delegation.organizationId, input.organizationId),
        eq(delegation.delegateeUserId, userId),
      ];

      if (!input.includeInactive) {
        conditions.push(eq(delegation.isActive, true));
        conditions.push(
          or(isNull(delegation.expiresAt), gte(delegation.expiresAt, now))!
        );
      }

      const delegations = await db.query.delegation.findMany({
        where: and(...conditions),
        orderBy: [desc(delegation.createdAt)],
        with: {
          delegatorUser: {
            columns: {
              id: true,
              name: true,
              email: true,
              image: true,
            },
          },
        },
      });

      return { delegations };
    }),
});
