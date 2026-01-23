import { randomBytes } from "node:crypto";
import {
  safeSignPayload,
  safeVerifySignedPayload,
} from "@memorystack/auth/lib/crypto";
import {
  type EmailProvider,
  getGmailAuthorizationUrl,
  getOutlookAuthorizationUrl,
  isGmailConfigured,
  isOutlookConfigured,
  revokeGmailToken,
  revokeOutlookToken,
} from "@memorystack/auth/providers";
import { db } from "@memorystack/db";
import {
  member,
  sourceAccount,
  type SourceAccountSettings,
} from "@memorystack/db/schema";
import { TRPCError } from "@trpc/server";
import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { protectedProcedure, router } from "../index";

// =============================================================================
// INPUT SCHEMAS
// =============================================================================

const providerSchema = z.enum(["gmail", "outlook"]);

const listInputSchema = z.object({
  organizationId: z.string().min(1),
});

const connectInputSchema = z.object({
  organizationId: z.string().min(1),
  provider: providerSchema,
  /** Optional: Pre-fill user's email in consent screen */
  loginHint: z.string().email().optional(),
  /** Optional: URL to redirect to after OAuth completes */
  redirectTo: z.string().optional(),
});

const disconnectInputSchema = z.object({
  organizationId: z.string().min(1),
  accountId: z.string().uuid(),
});

const updateSettingsInputSchema = z.object({
  organizationId: z.string().min(1),
  accountId: z.string().uuid(),
  settings: z.object({
    syncEnabled: z.boolean().optional(),
    syncFrequencyMinutes: z.number().int().min(5).max(60).optional(),
    backfillDays: z.number().int().min(7).max(365).optional(),
    excludeLabels: z.array(z.string()).optional(),
    includeLabels: z.array(z.string()).optional(),
    autoArchive: z.boolean().optional(),
  }),
});

const setPrimaryInputSchema = z.object({
  organizationId: z.string().min(1),
  accountId: z.string().uuid(),
});

const getByIdInputSchema = z.object({
  organizationId: z.string().min(1),
  accountId: z.string().uuid(),
});

// =============================================================================
// OUTPUT TYPES
// =============================================================================

interface AccountListItem {
  id: string;
  provider: EmailProvider;
  email: string;
  displayName: string | null;
  status: "pending" | "connected" | "disconnected" | "syncing" | "error" | "expired" | "revoked";
  isPrimary: boolean;
  lastSyncAt: Date | null;
  lastSyncStatus: string | null;
  messageCount: number;
  settings: SourceAccountSettings;
  addedByUserId: string;
  createdAt: Date;
}

// =============================================================================
// ORGANIZATION MEMBERSHIP VERIFICATION
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

async function verifyOrgAdmin(
  userId: string,
  organizationId: string
): Promise<void> {
  const { role } = await verifyOrgMembership(userId, organizationId);

  if (role !== "owner" && role !== "admin") {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Only organization owners and admins can perform this action.",
    });
  }
}

// =============================================================================
// PENDING AUTH STATE STORAGE
// Now includes organizationId for org-scoped account creation
// =============================================================================

function generateOAuthState(
  userId: string,
  organizationId: string,
  provider: EmailProvider,
  redirectTo?: string
): string {
  const randomPart = randomBytes(16).toString("hex");
  const timestamp = Date.now();
  // Encode state as: random:userId:organizationId:provider:timestamp:redirectTo
  const redirectPath = redirectTo || "";
  const payload = `${randomPart}:${userId}:${organizationId}:${provider}:${timestamp}:${redirectPath}`;
  const base64Payload = Buffer.from(payload).toString("base64url");
  // Sign the payload to prevent tampering
  return safeSignPayload(base64Payload);
}

function parseOAuthState(state: string): {
  userId: string;
  organizationId: string;
  provider: EmailProvider;
  timestamp: number;
  redirectTo: string | null;
  isValid: boolean;
} {
  try {
    // Verify the signature first - returns null if tampered
    const verifiedPayload = safeVerifySignedPayload(state);
    if (!verifiedPayload) {
      return {
        userId: "",
        organizationId: "",
        provider: "gmail",
        timestamp: 0,
        redirectTo: null,
        isValid: false,
      };
    }

    // Decode the verified base64 payload
    const decodedPayload = Buffer.from(verifiedPayload, "base64url").toString();
    const parts = decodedPayload.split(":");
    const userId = parts[1] ?? "";
    const organizationId = parts[2] ?? "";
    const provider = (parts[3] ?? "gmail") as EmailProvider;
    const timestampStr = parts[4] ?? "0";
    const timestamp = Number.parseInt(timestampStr, 10);
    const redirectTo = parts[5] || null;

    // State expires after 10 minutes
    const isExpired = Date.now() - timestamp > 10 * 60 * 1000;

    return {
      userId,
      organizationId,
      provider,
      timestamp,
      redirectTo,
      isValid: !isExpired && !!userId && !!organizationId && !!provider,
    };
  } catch {
    return {
      userId: "",
      organizationId: "",
      provider: "gmail",
      timestamp: 0,
      redirectTo: null,
      isValid: false,
    };
  }
}

// =============================================================================
// ROUTER
// =============================================================================

export const emailAccountsRouter = router({
  /**
   * List all connected email accounts for an organization
   */
  list: protectedProcedure
    .input(listInputSchema)
    .query(async ({ ctx, input }): Promise<AccountListItem[]> => {
      const userId = ctx.session.user.id;
      const { organizationId } = input;

      // Verify user is a member of this organization
      await verifyOrgMembership(userId, organizationId);

      // Get email source accounts
      const accounts = await db
        .select({
          id: sourceAccount.id,
          provider: sourceAccount.provider,
          email: sourceAccount.externalId,
          displayName: sourceAccount.displayName,
          status: sourceAccount.status,
          isPrimary: sourceAccount.isPrimary,
          lastSyncAt: sourceAccount.lastSyncAt,
          lastSyncStatus: sourceAccount.lastSyncStatus,
          settings: sourceAccount.settings,
          addedByUserId: sourceAccount.addedByUserId,
          createdAt: sourceAccount.createdAt,
          tokenExpiresAt: sourceAccount.tokenExpiresAt,
        })
        .from(sourceAccount)
        .where(
          and(
            eq(sourceAccount.organizationId, organizationId),
            eq(sourceAccount.type, "email")
          )
        )
        .orderBy(desc(sourceAccount.isPrimary), desc(sourceAccount.createdAt));

      // Get message counts per account using unified schema
      const messageCounts = await db.execute(sql`
        SELECT
          sa.id as account_id,
          COUNT(m.id)::int as message_count
        FROM source_account sa
        LEFT JOIN conversation c ON c.source_account_id = sa.id
        LEFT JOIN message m ON m.conversation_id = c.id
        WHERE sa.organization_id = ${organizationId}
          AND sa.type = 'email'
        GROUP BY sa.id
      `);

      const countMap = new Map<string, number>();
      for (const row of messageCounts.rows as Array<{
        account_id: string;
        message_count: number;
      }>) {
        countMap.set(row.account_id, row.message_count);
      }

      return accounts.map((account) => {
        // Compute effective status based on token expiration
        let effectiveStatus = account.status;
        if (
          account.status === "connected" &&
          account.tokenExpiresAt &&
          account.tokenExpiresAt < new Date()
        ) {
          effectiveStatus = "expired";
        }

        return {
          id: account.id,
          provider: account.provider as EmailProvider,
          email: account.email,
          displayName: account.displayName,
          status: effectiveStatus,
          isPrimary: account.isPrimary,
          lastSyncAt: account.lastSyncAt,
          lastSyncStatus: account.lastSyncStatus,
          messageCount: countMap.get(account.id) ?? 0,
          settings: account.settings ?? {
            syncEnabled: true,
            syncFrequencyMinutes: 5,
          },
          addedByUserId: account.addedByUserId,
          createdAt: account.createdAt,
        };
      });
    }),

  /**
   * Get available providers that can be connected
   */
  getAvailableProviders: protectedProcedure.query(() => {
    return {
      gmail: {
        available: isGmailConfigured(),
        name: "Gmail",
        description: "Connect your Gmail account for email intelligence",
      },
      outlook: {
        available: isOutlookConfigured(),
        name: "Outlook",
        description: "Connect your Outlook or Microsoft 365 account",
      },
    };
  }),

  /**
   * Initiate OAuth flow to connect a new email account to an organization
   */
  connect: protectedProcedure
    .input(connectInputSchema)
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      const { organizationId, provider, loginHint, redirectTo } = input;

      // Verify user is an admin of this organization
      await verifyOrgAdmin(userId, organizationId);

      // Check if provider is configured
      if (provider === "gmail" && !isGmailConfigured()) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "Gmail OAuth is not configured. Please contact support.",
        });
      }

      if (provider === "outlook" && !isOutlookConfigured()) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "Outlook OAuth is not configured. Please contact support.",
        });
      }

      // Check for existing account with same email in this organization
      if (loginHint) {
        const existing = await db.query.sourceAccount.findFirst({
          where: and(
            eq(sourceAccount.organizationId, organizationId),
            eq(sourceAccount.type, "email"),
            eq(sourceAccount.externalId, loginHint)
          ),
        });

        if (existing) {
          throw new TRPCError({
            code: "CONFLICT",
            message: `An account with email ${loginHint} is already connected to this organization.`,
          });
        }
      }

      // Generate secure state token with org context and redirect info
      const state = generateOAuthState(
        userId,
        organizationId,
        provider,
        redirectTo
      );

      // Generate authorization URL
      let authorizationUrl: string;

      if (provider === "gmail") {
        authorizationUrl = getGmailAuthorizationUrl(state, {
          accessType: "offline",
          prompt: "consent",
          loginHint,
        });
      } else {
        authorizationUrl = getOutlookAuthorizationUrl(state, {
          prompt: "consent",
          loginHint,
        });
      }

      return {
        authorizationUrl,
        state,
      };
    }),

  /**
   * Disconnect an email account and revoke OAuth tokens
   */
  disconnect: protectedProcedure
    .input(disconnectInputSchema)
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      const { organizationId, accountId } = input;

      // Verify user is an admin of this organization
      await verifyOrgAdmin(userId, organizationId);

      // Verify account belongs to this organization
      const account = await db.query.sourceAccount.findFirst({
        where: and(
          eq(sourceAccount.id, accountId),
          eq(sourceAccount.organizationId, organizationId),
          eq(sourceAccount.type, "email")
        ),
      });

      if (!account) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Email account not found.",
        });
      }

      // Attempt to revoke token at provider
      try {
        if (account.provider === "gmail" && account.refreshToken) {
          await revokeGmailToken(account.refreshToken);
        } else if (account.provider === "outlook" && account.refreshToken) {
          await revokeOutlookToken(account.refreshToken);
        }
      } catch (error) {
        // Log but don't fail - token might already be revoked
        console.warn(`Failed to revoke ${account.provider} token:`, error);
      }

      // Mark account as revoked (preserve data for audit)
      await db
        .update(sourceAccount)
        .set({
          status: "revoked",
          accessToken: "REVOKED",
          refreshToken: "REVOKED",
          isPrimary: false,
          updatedAt: new Date(),
        })
        .where(eq(sourceAccount.id, accountId));

      return {
        success: true,
        message: `${account.externalId} has been disconnected.`,
      };
    }),

  /**
   * Update sync settings for an email account
   */
  updateSettings: protectedProcedure
    .input(updateSettingsInputSchema)
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      const { organizationId, accountId, settings: newSettings } = input;

      // Verify user is an admin of this organization
      await verifyOrgAdmin(userId, organizationId);

      // Verify account belongs to this organization
      const account = await db.query.sourceAccount.findFirst({
        where: and(
          eq(sourceAccount.id, accountId),
          eq(sourceAccount.organizationId, organizationId),
          eq(sourceAccount.type, "email")
        ),
      });

      if (!account) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Email account not found.",
        });
      }

      if (account.status === "revoked") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Cannot update settings for a disconnected account.",
        });
      }

      // Merge settings
      const currentSettings = account.settings ?? {
        syncEnabled: true,
        syncFrequencyMinutes: 5,
      };

      const updatedSettings: SourceAccountSettings = {
        ...currentSettings,
        ...newSettings,
      };

      // Validate sync frequency options
      const validFrequencies = [5, 15, 30, 60];
      if (
        updatedSettings.syncFrequencyMinutes &&
        !validFrequencies.includes(updatedSettings.syncFrequencyMinutes)
      ) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Invalid sync frequency. Must be 5, 15, 30, or 60 minutes.",
        });
      }

      // Update settings
      await db
        .update(sourceAccount)
        .set({
          settings: updatedSettings,
          updatedAt: new Date(),
        })
        .where(eq(sourceAccount.id, accountId));

      return {
        success: true,
        settings: updatedSettings,
      };
    }),

  /**
   * Set an account as the primary account for an organization
   */
  setPrimary: protectedProcedure
    .input(setPrimaryInputSchema)
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      const { organizationId, accountId } = input;

      // Verify user is an admin of this organization
      await verifyOrgAdmin(userId, organizationId);

      // Verify account belongs to this organization and is active
      const account = await db.query.sourceAccount.findFirst({
        where: and(
          eq(sourceAccount.id, accountId),
          eq(sourceAccount.organizationId, organizationId),
          eq(sourceAccount.type, "email")
        ),
      });

      if (!account) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Email account not found.",
        });
      }

      if (account.status !== "connected" && account.status !== "syncing") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Cannot set a disconnected or expired account as primary.",
        });
      }

      // Atomic update: clear all primary flags and set new primary
      await db.transaction(async (tx) => {
        // Clear existing primary for email accounts in this organization
        await tx
          .update(sourceAccount)
          .set({ isPrimary: false, updatedAt: new Date() })
          .where(
            and(
              eq(sourceAccount.organizationId, organizationId),
              eq(sourceAccount.type, "email"),
              eq(sourceAccount.isPrimary, true)
            )
          );

        // Set new primary
        await tx
          .update(sourceAccount)
          .set({ isPrimary: true, updatedAt: new Date() })
          .where(eq(sourceAccount.id, accountId));
      });

      return {
        success: true,
        message: `${account.externalId} is now the primary account.`,
      };
    }),

  /**
   * Get a single account by ID
   */
  getById: protectedProcedure
    .input(getByIdInputSchema)
    .query(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      const { organizationId, accountId } = input;

      // Verify user is a member of this organization
      await verifyOrgMembership(userId, organizationId);

      const account = await db.query.sourceAccount.findFirst({
        where: and(
          eq(sourceAccount.id, accountId),
          eq(sourceAccount.organizationId, organizationId),
          eq(sourceAccount.type, "email")
        ),
      });

      if (!account) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Email account not found.",
        });
      }

      // Compute effective status
      let effectiveStatus = account.status;
      if (
        account.status === "connected" &&
        account.tokenExpiresAt &&
        account.tokenExpiresAt < new Date()
      ) {
        effectiveStatus = "expired";
      }

      return {
        id: account.id,
        provider: account.provider as EmailProvider,
        email: account.externalId,
        displayName: account.displayName,
        status: effectiveStatus,
        isPrimary: account.isPrimary,
        lastSyncAt: account.lastSyncAt,
        lastSyncStatus: account.lastSyncStatus,
        lastSyncError: account.lastSyncError,
        syncCursor: account.syncCursor,
        settings: account.settings ?? {
          syncEnabled: true,
          syncFrequencyMinutes: 5,
        },
        addedByUserId: account.addedByUserId,
        createdAt: account.createdAt,
        updatedAt: account.updatedAt,
      };
    }),

  /**
   * Get calendar events from connected Google accounts
   */
  getCalendarEvents: protectedProcedure
    .input(
      z.object({
        organizationId: z.string().min(1).optional(),
        timeMin: z.string().datetime().optional(),
        timeMax: z.string().datetime().optional(),
        maxResults: z.number().int().min(1).max(50).default(20),
      })
    )
    .query(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      const { timeMin, timeMax, maxResults } = input;

      // Get all Gmail source accounts for this user (across all orgs if no org specified)
      const accounts = await db.query.sourceAccount.findMany({
        where: and(
          eq(sourceAccount.addedByUserId, userId),
          eq(sourceAccount.type, "email"),
          eq(sourceAccount.provider, "gmail"),
          eq(sourceAccount.status, "connected")
        ),
      });

      if (accounts.length === 0) {
        return { events: [] };
      }

      const allEvents: Array<{
        id: string;
        title: string;
        startTime: string;
        endTime: string;
        isAllDay: boolean;
        location?: string;
        attendees: string[];
        isVideoCall: boolean;
        accountEmail: string;
      }> = [];

      // Default to today's events
      const now = new Date();
      const startOfDay = new Date(
        now.getFullYear(),
        now.getMonth(),
        now.getDate()
      );
      const endOfDay = new Date(startOfDay);
      endOfDay.setDate(endOfDay.getDate() + 1);

      const effectiveTimeMin = timeMin || startOfDay.toISOString();
      const effectiveTimeMax = timeMax || endOfDay.toISOString();

      for (const account of accounts) {
        if (!account.accessToken) continue;

        try {
          const response = await fetch(
            "https://www.googleapis.com/calendar/v3/calendars/primary/events?" +
              new URLSearchParams({
                timeMin: effectiveTimeMin,
                timeMax: effectiveTimeMax,
                maxResults: String(maxResults),
                singleEvents: "true",
                orderBy: "startTime",
              }),
            {
              headers: {
                Authorization: `Bearer ${account.accessToken}`,
              },
            }
          );

          if (!response.ok) {
            console.warn(
              `Failed to fetch calendar for ${account.externalId}:`,
              response.status
            );
            continue;
          }

          const data = (await response.json()) as {
            items?: Array<{
              id: string;
              summary?: string;
              start?: { dateTime?: string; date?: string };
              end?: { dateTime?: string; date?: string };
              location?: string;
              attendees?: Array<{ email: string }>;
              conferenceData?: {
                entryPoints?: Array<{ entryPointType: string }>;
              };
              hangoutLink?: string;
            }>;
          };

          for (const event of data.items ?? []) {
            const isAllDay = !event.start?.dateTime;
            const startTime = event.start?.dateTime || event.start?.date || "";
            const endTime = event.end?.dateTime || event.end?.date || "";
            const isVideoCall = !!(
              event.hangoutLink ||
              event.conferenceData?.entryPoints?.some(
                (e) => e.entryPointType === "video"
              )
            );

            allEvents.push({
              id: event.id,
              title: event.summary || "Untitled Event",
              startTime,
              endTime,
              isAllDay,
              location: event.location,
              attendees: event.attendees?.map((a) => a.email) ?? [],
              isVideoCall,
              accountEmail: account.externalId,
            });
          }
        } catch (error) {
          console.error(
            `Error fetching calendar for ${account.externalId}:`,
            error
          );
        }
      }

      // Sort by start time
      allEvents.sort(
        (a, b) =>
          new Date(a.startTime).getTime() - new Date(b.startTime).getTime()
      );

      return { events: allEvents };
    }),

  /**
   * Get sync status for an email account (for real-time progress)
   */
  getSyncStatus: protectedProcedure
    .input(
      z.object({
        organizationId: z.string().min(1),
        accountId: z.string().uuid().optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      const { organizationId, accountId } = input;

      // Verify user is a member of this organization
      await verifyOrgMembership(userId, organizationId);

      // Get accounts
      const whereClause = accountId
        ? and(
            eq(sourceAccount.organizationId, organizationId),
            eq(sourceAccount.type, "email"),
            eq(sourceAccount.id, accountId)
          )
        : and(
            eq(sourceAccount.organizationId, organizationId),
            eq(sourceAccount.type, "email")
          );

      const accounts = await db.query.sourceAccount.findMany({
        where: whereClause,
        columns: {
          id: true,
          externalId: true,
          provider: true,
          status: true,
          backfillProgress: true,
          lastSyncAt: true,
          lastSyncStatus: true,
          createdAt: true,
        },
      });

      // Get conversation/message counts using unified schema
      const counts = await db.execute(sql`
        SELECT
          sa.id as account_id,
          COUNT(DISTINCT c.id)::int as conversation_count,
          COUNT(m.id)::int as message_count
        FROM source_account sa
        LEFT JOIN conversation c ON c.source_account_id = sa.id
        LEFT JOIN message m ON m.conversation_id = c.id
        WHERE sa.organization_id = ${organizationId}
          AND sa.type = 'email'
        GROUP BY sa.id
      `);

      const countMap = new Map<
        string,
        { conversationCount: number; messageCount: number }
      >();
      for (const row of counts.rows as Array<{
        account_id: string;
        conversation_count: number;
        message_count: number;
      }>) {
        countMap.set(row.account_id, {
          conversationCount: row.conversation_count,
          messageCount: row.message_count,
        });
      }

      return accounts.map((account) => {
        const stats = countMap.get(account.id) ?? {
          conversationCount: 0,
          messageCount: 0,
        };
        const progress = account.backfillProgress;

        // Determine if sync is complete
        const isComplete =
          progress?.phase === "complete" ||
          (progress?.phase === "idle" && stats.conversationCount > 0);

        // Determine current phase label
        let phaseLabel = "Initializing...";
        if (progress?.phase === "priority") {
          phaseLabel = "Syncing recent emails (last 90 days)";
        } else if (progress?.phase === "extended") {
          phaseLabel = "Syncing older emails (90 days - 1 year)";
        } else if (progress?.phase === "archive") {
          phaseLabel = "Syncing archived emails (1+ years)";
        } else if (isComplete) {
          phaseLabel = "Sync complete";
        }

        return {
          id: account.id,
          email: account.externalId,
          provider: account.provider,
          status: account.status,
          isComplete,
          phase: progress?.phase ?? "idle",
          phaseLabel,
          totalThreads: progress?.totalItems ?? 0,
          processedThreads: progress?.processedItems ?? 0,
          phaseProgress: progress?.phaseProgress ?? 0,
          overallProgress: progress?.overallProgress ?? 0,
          totalMessages: 0,
          errorCount: progress?.errorCount ?? 0,
          phaseStartedAt: progress?.phaseStartedAt ?? null,
          threadCount: stats.conversationCount,
          messageCount: stats.messageCount,
          lastSyncAt: account.lastSyncAt,
          createdAt: account.createdAt,
        };
      });
    }),
});

// Export state parsing for use in OAuth callback handlers
export { parseOAuthState };
