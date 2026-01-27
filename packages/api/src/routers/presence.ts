// =============================================================================
// PRESENCE ROUTER
// =============================================================================
//
// API routes for real-time presence management including:
// - WebSocket heartbeat updates
// - Status management
// - Resource viewer tracking
// - Online user lists
//

import { db } from "@memorystack/db";
import {
  type CursorPosition,
  type DeviceInfo,
  member,
  presenceHistory,
  resourceViewers,
  userPresence,
} from "@memorystack/db/schema";
import { TRPCError } from "@trpc/server";
import { and, desc, eq, gte, sql } from "drizzle-orm";
import { z } from "zod";
import { protectedProcedure, router } from "../index";

// =============================================================================
// INPUT SCHEMAS
// =============================================================================

const presenceStatusSchema = z.enum([
  "online",
  "away",
  "busy",
  "do_not_disturb",
  "offline",
]);

const viewingTypeSchema = z.enum([
  "inbox",
  "conversation",
  "commitment",
  "decision",
  "task",
  "contact",
  "uio",
  "settings",
  "shared_inbox",
  "search",
  "dashboard",
  "other",
]);

const deviceInfoSchema = z.object({
  browser: z.string().optional(),
  browserVersion: z.string().optional(),
  os: z.string().optional(),
  osVersion: z.string().optional(),
  device: z.string().optional(),
  isMobile: z.boolean().optional(),
  isDesktopApp: z.boolean().optional(),
});

const cursorPositionSchema = z.object({
  line: z.number().optional(),
  column: z.number().optional(),
  selection: z
    .object({
      start: z.number(),
      end: z.number(),
    })
    .optional(),
  scrollTop: z.number().optional(),
});

// =============================================================================
// CONSTANTS
// =============================================================================

// How long before a user is considered offline (no heartbeat)
const HEARTBEAT_TIMEOUT_MS = 60_000; // 60 seconds

// How long before a viewer record is stale
const VIEWER_STALE_MS = 30_000; // 30 seconds

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

async function getOrCreatePresence(
  userId: string,
  organizationId?: string
): Promise<typeof userPresence.$inferSelect> {
  let presence = await db.query.userPresence.findFirst({
    where: eq(userPresence.userId, userId),
  });

  if (!presence) {
    const [newPresence] = await db
      .insert(userPresence)
      .values({
        userId,
        organizationId,
        status: "online",
        lastHeartbeat: new Date(),
        lastOnlineAt: new Date(),
      })
      .returning();
    presence = newPresence;
  }

  if (!presence) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Failed to create presence record.",
    });
  }

  return presence;
}

async function logStatusChange(
  userId: string,
  organizationId: string | null,
  previousStatus: string | null,
  newStatus: string,
  trigger: string
): Promise<void> {
  await db.insert(presenceHistory).values({
    userId,
    organizationId,
    previousStatus: previousStatus as
      | "online"
      | "away"
      | "busy"
      | "do_not_disturb"
      | "offline"
      | null,
    newStatus: newStatus as
      | "online"
      | "away"
      | "busy"
      | "do_not_disturb"
      | "offline",
    trigger,
  });
}

// =============================================================================
// ROUTER
// =============================================================================

export const presenceRouter = router({
  // ===========================================================================
  // HEARTBEAT & STATUS
  // ===========================================================================

  /**
   * Send a heartbeat to update presence.
   * Call this every 30 seconds from the client.
   */
  heartbeat: protectedProcedure
    .input(
      z.object({
        organizationId: z.string().min(1),
        status: presenceStatusSchema.optional(),
        viewingType: viewingTypeSchema.optional(),
        viewingId: z.string().optional(),
        viewingTitle: z.string().max(100).optional(),
        connectionId: z.string().optional(),
        deviceInfo: deviceInfoSchema.optional(),
        isTyping: z.boolean().optional(),
        typingInResourceId: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      await verifyOrgMembership(userId, input.organizationId);

      const presence = await getOrCreatePresence(userId, input.organizationId);
      const previousStatus = presence.status;

      const updates: Partial<typeof userPresence.$inferInsert> = {
        organizationId: input.organizationId,
        lastHeartbeat: new Date(),
        lastActivityAt: new Date(),
        updatedAt: new Date(),
      };

      // Update status if provided
      if (input.status !== undefined) {
        updates.status = input.status;
        // Only log if status actually changed
        if (input.status !== previousStatus) {
          await logStatusChange(
            userId,
            input.organizationId,
            previousStatus,
            input.status,
            "manual"
          );
        }
      } else if (presence.status === "offline") {
        // Auto-set to online if was offline
        updates.status = "online";
        await logStatusChange(
          userId,
          input.organizationId,
          "offline",
          "online",
          "heartbeat"
        );
      }

      // Update viewing info
      if (input.viewingType !== undefined) {
        updates.currentViewingType = input.viewingType;
        updates.currentViewingId = input.viewingId ?? null;
        updates.currentViewingTitle = input.viewingTitle ?? null;
      }

      // Update connection/device info
      if (input.connectionId !== undefined) {
        updates.connectionId = input.connectionId;
      }
      if (input.deviceInfo !== undefined) {
        updates.deviceInfo = input.deviceInfo as DeviceInfo;
      }

      // Update typing status
      if (input.isTyping !== undefined) {
        updates.isTyping = input.isTyping;
        updates.typingInResourceId = input.typingInResourceId ?? null;
      }

      // Set last online time
      if (updates.status === "online") {
        updates.lastOnlineAt = new Date();
      }

      await db
        .update(userPresence)
        .set(updates)
        .where(eq(userPresence.id, presence.id));

      // Update resource viewers if viewing something
      if (input.viewingType && input.viewingId) {
        await db
          .insert(resourceViewers)
          .values({
            resourceType: input.viewingType,
            resourceId: input.viewingId,
            userId,
            organizationId: input.organizationId,
            lastHeartbeat: new Date(),
            isActive: true,
            isTyping: input.isTyping ?? false,
          })
          .onConflictDoUpdate({
            target: [
              resourceViewers.resourceType,
              resourceViewers.resourceId,
              resourceViewers.userId,
            ],
            set: {
              lastHeartbeat: new Date(),
              isActive: true,
              isTyping: input.isTyping ?? false,
            },
          });
      }

      return { success: true };
    }),

  /**
   * Set user status explicitly.
   */
  setStatus: protectedProcedure
    .input(
      z.object({
        organizationId: z.string().min(1),
        status: presenceStatusSchema,
        statusMessage: z.string().max(100).optional(),
        statusEmoji: z.string().max(2).optional(),
        statusExpiresAt: z.date().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      await verifyOrgMembership(userId, input.organizationId);

      const presence = await getOrCreatePresence(userId, input.organizationId);
      const previousStatus = presence.status;

      await db
        .update(userPresence)
        .set({
          status: input.status,
          statusMessage: input.statusMessage,
          statusEmoji: input.statusEmoji,
          statusExpiresAt: input.statusExpiresAt,
          lastActivityAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(userPresence.id, presence.id));

      if (input.status !== previousStatus) {
        await logStatusChange(
          userId,
          input.organizationId,
          previousStatus,
          input.status,
          "manual"
        );
      }

      return { success: true };
    }),

  /**
   * Get my current presence.
   */
  getMyPresence: protectedProcedure
    .input(z.object({ organizationId: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      await verifyOrgMembership(userId, input.organizationId);

      const presence = await db.query.userPresence.findFirst({
        where: eq(userPresence.userId, userId),
      });

      return { presence };
    }),

  /**
   * Go offline (explicit logout).
   */
  goOffline: protectedProcedure
    .input(z.object({ organizationId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;

      const presence = await db.query.userPresence.findFirst({
        where: eq(userPresence.userId, userId),
      });

      if (presence && presence.status !== "offline") {
        await logStatusChange(
          userId,
          input.organizationId,
          presence.status,
          "offline",
          "explicit_logout"
        );

        await db
          .update(userPresence)
          .set({
            status: "offline",
            connectionId: null,
            currentViewingType: null,
            currentViewingId: null,
            currentViewingTitle: null,
            isTyping: false,
            typingInResourceId: null,
            updatedAt: new Date(),
          })
          .where(eq(userPresence.id, presence.id));

        // Clean up viewer records
        await db
          .delete(resourceViewers)
          .where(eq(resourceViewers.userId, userId));
      }

      return { success: true };
    }),

  // ===========================================================================
  // ONLINE USERS
  // ===========================================================================

  /**
   * Get online users in the organization.
   */
  getOnlineUsers: protectedProcedure
    .input(z.object({ organizationId: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      await verifyOrgMembership(userId, input.organizationId);

      const cutoff = new Date(Date.now() - HEARTBEAT_TIMEOUT_MS);

      // Get members who are online (have recent heartbeat and not offline status)
      const onlineUsers = await db.query.userPresence.findMany({
        where: and(
          eq(userPresence.organizationId, input.organizationId),
          gte(userPresence.lastHeartbeat, cutoff),
          sql`${userPresence.status} != 'offline'`
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

      return {
        users: onlineUsers.map((p) => ({
          userId: p.userId,
          user: p.user,
          status: p.status,
          statusMessage: p.statusMessage,
          statusEmoji: p.statusEmoji,
          currentViewingType: p.currentViewingType,
          currentViewingId: p.currentViewingId,
          currentViewingTitle: p.currentViewingTitle,
          lastActivityAt: p.lastActivityAt,
          isTyping: p.isTyping,
          typingInResourceId: p.typingInResourceId,
        })),
      };
    }),

  /**
   * Get users currently viewing a specific resource.
   */
  getResourceViewers: protectedProcedure
    .input(
      z.object({
        organizationId: z.string().min(1),
        resourceType: viewingTypeSchema,
        resourceId: z.string().min(1),
      })
    )
    .query(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      await verifyOrgMembership(userId, input.organizationId);

      const cutoff = new Date(Date.now() - VIEWER_STALE_MS);

      const viewers = await db.query.resourceViewers.findMany({
        where: and(
          eq(resourceViewers.organizationId, input.organizationId),
          eq(resourceViewers.resourceType, input.resourceType),
          eq(resourceViewers.resourceId, input.resourceId),
          gte(resourceViewers.lastHeartbeat, cutoff)
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

      return {
        viewers: viewers.map((v) => ({
          userId: v.userId,
          user: v.user,
          startedViewingAt: v.startedViewingAt,
          isActive: v.isActive,
          isTyping: v.isTyping,
          cursorPosition: v.cursorPosition,
        })),
      };
    }),

  /**
   * Set viewing state (start/stop viewing a resource).
   */
  setViewing: protectedProcedure
    .input(
      z.object({
        organizationId: z.string().min(1),
        resourceType: viewingTypeSchema,
        resourceId: z.string().min(1),
        isViewing: z.boolean(),
        cursorPosition: cursorPositionSchema.optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      await verifyOrgMembership(userId, input.organizationId);

      if (input.isViewing) {
        // Add or update viewer record
        await db
          .insert(resourceViewers)
          .values({
            resourceType: input.resourceType,
            resourceId: input.resourceId,
            userId,
            organizationId: input.organizationId,
            lastHeartbeat: new Date(),
            isActive: true,
            cursorPosition: input.cursorPosition as CursorPosition,
          })
          .onConflictDoUpdate({
            target: [
              resourceViewers.resourceType,
              resourceViewers.resourceId,
              resourceViewers.userId,
            ],
            set: {
              lastHeartbeat: new Date(),
              isActive: true,
              cursorPosition: input.cursorPosition as CursorPosition,
            },
          });

        // Update user presence
        await db
          .update(userPresence)
          .set({
            currentViewingType: input.resourceType,
            currentViewingId: input.resourceId,
            lastActivityAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(userPresence.userId, userId));
      } else {
        // Remove viewer record
        await db.delete(resourceViewers).where(
          and(
            eq(resourceViewers.resourceType, input.resourceType),
            eq(resourceViewers.resourceId, input.resourceId),
            eq(resourceViewers.userId, userId)
          )
        );

        // Clear viewing from presence
        await db
          .update(userPresence)
          .set({
            currentViewingType: null,
            currentViewingId: null,
            currentViewingTitle: null,
            updatedAt: new Date(),
          })
          .where(eq(userPresence.userId, userId));
      }

      return { success: true };
    }),

  /**
   * Update cursor position (for collaborative editing).
   */
  updateCursor: protectedProcedure
    .input(
      z.object({
        organizationId: z.string().min(1),
        resourceType: viewingTypeSchema,
        resourceId: z.string().min(1),
        cursorPosition: cursorPositionSchema,
      })
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;

      await db
        .update(resourceViewers)
        .set({
          cursorPosition: input.cursorPosition as CursorPosition,
          lastHeartbeat: new Date(),
        })
        .where(
          and(
            eq(resourceViewers.resourceType, input.resourceType),
            eq(resourceViewers.resourceId, input.resourceId),
            eq(resourceViewers.userId, userId)
          )
        );

      return { success: true };
    }),

  /**
   * Set typing indicator.
   */
  setTyping: protectedProcedure
    .input(
      z.object({
        organizationId: z.string().min(1),
        resourceType: viewingTypeSchema,
        resourceId: z.string().min(1),
        isTyping: z.boolean(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;

      // Update resource viewers
      await db
        .update(resourceViewers)
        .set({
          isTyping: input.isTyping,
          lastHeartbeat: new Date(),
        })
        .where(
          and(
            eq(resourceViewers.resourceType, input.resourceType),
            eq(resourceViewers.resourceId, input.resourceId),
            eq(resourceViewers.userId, userId)
          )
        );

      // Update user presence
      await db
        .update(userPresence)
        .set({
          isTyping: input.isTyping,
          typingInResourceId: input.isTyping ? input.resourceId : null,
          lastActivityAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(userPresence.userId, userId));

      return { success: true };
    }),

  // ===========================================================================
  // CLEANUP (admin/system use)
  // ===========================================================================

  /**
   * Clean up stale presence records (called by background job).
   */
  cleanupStale: protectedProcedure
    .input(z.object({ organizationId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      await verifyOrgMembership(userId, input.organizationId);

      const heartbeatCutoff = new Date(Date.now() - HEARTBEAT_TIMEOUT_MS);
      const viewerCutoff = new Date(Date.now() - VIEWER_STALE_MS);

      // Mark users as offline if heartbeat is stale
      const stalePresences = await db.query.userPresence.findMany({
        where: and(
          eq(userPresence.organizationId, input.organizationId),
          sql`${userPresence.status} != 'offline'`,
          sql`${userPresence.lastHeartbeat} < ${heartbeatCutoff}`
        ),
      });

      for (const presence of stalePresences) {
        await db
          .update(userPresence)
          .set({
            status: "offline",
            currentViewingType: null,
            currentViewingId: null,
            currentViewingTitle: null,
            isTyping: false,
            typingInResourceId: null,
            updatedAt: new Date(),
          })
          .where(eq(userPresence.id, presence.id));

        await logStatusChange(
          presence.userId,
          input.organizationId,
          presence.status,
          "offline",
          "heartbeat_lost"
        );
      }

      // Delete stale viewer records
      await db.delete(resourceViewers).where(
        and(
          eq(resourceViewers.organizationId, input.organizationId),
          sql`${resourceViewers.lastHeartbeat} < ${viewerCutoff}`
        )
      );

      return {
        success: true,
        markedOffline: stalePresences.length,
      };
    }),

  // ===========================================================================
  // PRESENCE HISTORY
  // ===========================================================================

  /**
   * Get my presence history.
   */
  getMyHistory: protectedProcedure
    .input(
      z.object({
        organizationId: z.string().min(1),
        limit: z.number().int().min(1).max(100).default(50),
      })
    )
    .query(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      await verifyOrgMembership(userId, input.organizationId);

      const history = await db.query.presenceHistory.findMany({
        where: and(
          eq(presenceHistory.userId, userId),
          eq(presenceHistory.organizationId, input.organizationId)
        ),
        orderBy: [desc(presenceHistory.createdAt)],
        limit: input.limit,
      });

      return { history };
    }),
});
