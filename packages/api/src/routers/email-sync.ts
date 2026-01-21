// =============================================================================
// EMAIL SYNC ROUTER
// =============================================================================
//
// tRPC procedures for controlling and monitoring email synchronization.
// Organization-scoped access control for all operations.
//

import { db } from "@memorystack/db";
import type { EmailAccountSettings } from "@memorystack/db/schema";
import { emailAccount, emailThread, member } from "@memorystack/db/schema";
import { TRPCError } from "@trpc/server";
import { and, count, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { protectedProcedure, router } from "../index";

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Verify user is a member of the organization
 */
async function verifyOrgMembership(
  userId: string,
  organizationId: string
): Promise<{ role: string }> {
  const membership = await db.query.member.findFirst({
    where: and(
      eq(member.userId, userId),
      eq(member.organizationId, organizationId)
    ),
    columns: { role: true },
  });

  if (!membership) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "You are not a member of this organization",
    });
  }

  return { role: membership.role };
}

// =============================================================================
// ROUTER
// =============================================================================

export const emailSyncRouter = router({
  /**
   * Get sync status for all accounts in an organization
   */
  getStatus: protectedProcedure
    .input(
      z.object({
        organizationId: z.string().min(1),
      })
    )
    .query(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      await verifyOrgMembership(userId, input.organizationId);

      const accounts = await db.query.emailAccount.findMany({
        where: eq(emailAccount.organizationId, input.organizationId),
        columns: {
          id: true,
          email: true,
          provider: true,
          status: true,
          syncCursor: true,
          lastSyncAt: true,
          lastSyncError: true,
          settings: true,
        },
        orderBy: [desc(emailAccount.createdAt)],
      });

      // Get thread counts for each account
      const accountsWithStats = await Promise.all(
        accounts.map(async (account) => {
          const [threadCountResult] = await db
            .select({ count: count() })
            .from(emailThread)
            .where(eq(emailThread.accountId, account.id));

          const settings = account.settings as {
            syncEnabled?: boolean;
            syncFrequencyMinutes?: number;
            backfillDays?: number;
          } | null;

          return {
            id: account.id,
            email: account.email,
            provider: account.provider,
            status: account.status,
            hasCursor: !!account.syncCursor,
            needsBackfill: !account.syncCursor,
            lastSyncAt: account.lastSyncAt,
            lastSyncError: account.lastSyncError,
            threadCount: threadCountResult?.count ?? 0,
            syncEnabled: settings?.syncEnabled ?? true,
            syncFrequencyMinutes: settings?.syncFrequencyMinutes ?? 5,
          };
        })
      );

      return {
        accounts: accountsWithStats,
        totalAccounts: accounts.length,
        activeAccounts: accounts.filter((a) => a.status === "active").length,
        syncingAccounts: accounts.filter((a) => a.status === "syncing").length,
      };
    }),

  /**
   * Get detailed sync status for a single account
   */
  getAccountStatus: protectedProcedure
    .input(
      z.object({
        organizationId: z.string().min(1),
        accountId: z.string().uuid(),
      })
    )
    .query(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      await verifyOrgMembership(userId, input.organizationId);

      const account = await db.query.emailAccount.findFirst({
        where: and(
          eq(emailAccount.id, input.accountId),
          eq(emailAccount.organizationId, input.organizationId)
        ),
      });

      if (!account) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Email account not found",
        });
      }

      // Get thread statistics
      const [threadCountResult] = await db
        .select({ count: count() })
        .from(emailThread)
        .where(eq(emailThread.accountId, account.id));

      // Get most recent thread
      const latestThread = await db.query.emailThread.findFirst({
        where: eq(emailThread.accountId, account.id),
        orderBy: [desc(emailThread.lastMessageAt)],
        columns: {
          subject: true,
          lastMessageAt: true,
        },
      });

      const settings = account.settings as {
        syncEnabled?: boolean;
        syncFrequencyMinutes?: number;
        backfillDays?: number;
      } | null;

      return {
        id: account.id,
        email: account.email,
        provider: account.provider,
        status: account.status,
        hasCursor: !!account.syncCursor,
        needsBackfill: !account.syncCursor,
        lastSyncAt: account.lastSyncAt,
        lastSyncError: account.lastSyncError,
        createdAt: account.createdAt,
        stats: {
          threadCount: threadCountResult?.count ?? 0,
          latestThreadSubject: latestThread?.subject ?? null,
          latestThreadAt: latestThread?.lastMessageAt ?? null,
        },
        settings: {
          syncEnabled: settings?.syncEnabled ?? true,
          syncFrequencyMinutes: settings?.syncFrequencyMinutes ?? 5,
          backfillDays: settings?.backfillDays ?? 90,
        },
      };
    }),

  /**
   * Trigger on-demand sync for an account
   */
  triggerSync: protectedProcedure
    .input(
      z.object({
        organizationId: z.string().min(1),
        accountId: z.string().uuid(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      await verifyOrgMembership(userId, input.organizationId);

      // Verify account belongs to organization
      const account = await db.query.emailAccount.findFirst({
        where: and(
          eq(emailAccount.id, input.accountId),
          eq(emailAccount.organizationId, input.organizationId)
        ),
        columns: { id: true, status: true },
      });

      if (!account) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Email account not found",
        });
      }

      if (account.status === "syncing") {
        throw new TRPCError({
          code: "CONFLICT",
          message: "Account is already syncing",
        });
      }

      // Trigger sync via Trigger.dev
      // Note: In production, you'd import and trigger the task
      // For now, we'll just update the status and let the scheduled task pick it up

      await db
        .update(emailAccount)
        .set({
          lastSyncAt: null, // Force next scheduled sync
          updatedAt: new Date(),
        })
        .where(eq(emailAccount.id, input.accountId));

      return {
        triggered: true,
        accountId: input.accountId,
        message: "Sync will begin shortly",
      };
    }),

  /**
   * Trigger backfill for an account
   */
  triggerBackfill: protectedProcedure
    .input(
      z.object({
        organizationId: z.string().min(1),
        accountId: z.string().uuid(),
        backfillDays: z.number().min(1).max(365).optional(),
        force: z.boolean().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      await verifyOrgMembership(userId, input.organizationId);

      // Verify account belongs to organization
      const account = await db.query.emailAccount.findFirst({
        where: and(
          eq(emailAccount.id, input.accountId),
          eq(emailAccount.organizationId, input.organizationId)
        ),
        columns: { id: true, status: true, syncCursor: true },
      });

      if (!account) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Email account not found",
        });
      }

      if (account.status === "syncing") {
        throw new TRPCError({
          code: "CONFLICT",
          message: "Account is already syncing",
        });
      }

      if (account.syncCursor && !input.force) {
        throw new TRPCError({
          code: "CONFLICT",
          message:
            "Account already has sync data. Use force=true to re-backfill.",
        });
      }

      // Update backfill settings if provided
      if (input.backfillDays) {
        const existingAccount = await db.query.emailAccount.findFirst({
          where: eq(emailAccount.id, input.accountId),
        });

        const existingSettings =
          (existingAccount?.settings as EmailAccountSettings | null) ?? {
            syncEnabled: true,
            syncFrequencyMinutes: 15,
          };

        await db
          .update(emailAccount)
          .set({
            settings: {
              ...existingSettings,
              backfillDays: input.backfillDays,
            } as EmailAccountSettings,
            updatedAt: new Date(),
          })
          .where(eq(emailAccount.id, input.accountId));
      }

      // Trigger backfill via Trigger.dev
      // Note: In production, you'd import and trigger the task

      return {
        triggered: true,
        accountId: input.accountId,
        backfillDays: input.backfillDays ?? 90,
        message: "Backfill will begin shortly",
      };
    }),

  /**
   * Update sync settings for an account
   */
  updateSettings: protectedProcedure
    .input(
      z.object({
        organizationId: z.string().min(1),
        accountId: z.string().uuid(),
        settings: z.object({
          syncEnabled: z.boolean().optional(),
          syncFrequencyMinutes: z.number().min(1).max(60).optional(),
          backfillDays: z.number().min(1).max(365).optional(),
        }),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      await verifyOrgMembership(userId, input.organizationId);

      // Verify account belongs to organization
      const account = await db.query.emailAccount.findFirst({
        where: and(
          eq(emailAccount.id, input.accountId),
          eq(emailAccount.organizationId, input.organizationId)
        ),
      });

      if (!account) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Email account not found",
        });
      }

      // Merge with existing settings
      const existingSettings =
        (account.settings as EmailAccountSettings | null) ?? {
          syncEnabled: true,
          syncFrequencyMinutes: 15,
        };
      const newSettings: EmailAccountSettings = {
        ...existingSettings,
        ...input.settings,
      };

      await db
        .update(emailAccount)
        .set({
          settings: newSettings,
          updatedAt: new Date(),
        })
        .where(eq(emailAccount.id, input.accountId));

      return {
        success: true,
        settings: newSettings,
      };
    }),

  /**
   * Get sync history/logs for an account
   */
  getSyncHistory: protectedProcedure
    .input(
      z.object({
        organizationId: z.string().min(1),
        accountId: z.string().uuid(),
        limit: z.number().min(1).max(100).default(20),
      })
    )
    .query(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      await verifyOrgMembership(userId, input.organizationId);

      // Verify account belongs to organization
      const account = await db.query.emailAccount.findFirst({
        where: and(
          eq(emailAccount.id, input.accountId),
          eq(emailAccount.organizationId, input.organizationId)
        ),
        columns: { id: true },
      });

      if (!account) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Email account not found",
        });
      }

      // For now, return basic info
      // In production, you'd query a sync_jobs table
      return {
        accountId: input.accountId,
        history: [],
        message: "Sync history tracking will be implemented in a future update",
      };
    }),
});
