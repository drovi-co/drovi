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
  type EmailAccountSettings,
  emailAccount,
  member,
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
  status: "active" | "expired" | "revoked" | "syncing" | "error";
  isPrimary: boolean;
  lastSyncAt: Date | null;
  lastSyncStatus: string | null;
  messageCount: number;
  settings: EmailAccountSettings;
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

      // Get accounts with thread count
      const accounts = await db
        .select({
          id: emailAccount.id,
          provider: emailAccount.provider,
          email: emailAccount.email,
          displayName: emailAccount.displayName,
          status: emailAccount.status,
          isPrimary: emailAccount.isPrimary,
          lastSyncAt: emailAccount.lastSyncAt,
          lastSyncStatus: emailAccount.lastSyncStatus,
          settings: emailAccount.settings,
          addedByUserId: emailAccount.addedByUserId,
          createdAt: emailAccount.createdAt,
          tokenExpiresAt: emailAccount.tokenExpiresAt,
        })
        .from(emailAccount)
        .where(eq(emailAccount.organizationId, organizationId))
        .orderBy(desc(emailAccount.isPrimary), desc(emailAccount.createdAt));

      // Get message counts per account
      const messageCounts = await db.execute(sql`
        SELECT
          ea.id as account_id,
          COUNT(em.id)::int as message_count
        FROM email_account ea
        LEFT JOIN email_thread et ON et.account_id = ea.id
        LEFT JOIN email_message em ON em.thread_id = et.id
        WHERE ea.organization_id = ${organizationId}
        GROUP BY ea.id
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
          account.status === "active" &&
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
            backfillDays: 90,
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
        const existing = await db.query.emailAccount.findFirst({
          where: and(
            eq(emailAccount.organizationId, organizationId),
            eq(emailAccount.email, loginHint)
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

      // Attempt to revoke token at provider
      try {
        if (account.provider === "gmail") {
          await revokeGmailToken(account.refreshToken);
        } else if (account.provider === "outlook") {
          await revokeOutlookToken(account.refreshToken);
        }
      } catch (error) {
        // Log but don't fail - token might already be revoked
        console.warn(`Failed to revoke ${account.provider} token:`, error);
      }

      // Mark account as revoked (preserve data for audit)
      await db
        .update(emailAccount)
        .set({
          status: "revoked",
          accessToken: "REVOKED",
          refreshToken: "REVOKED",
          isPrimary: false,
          updatedAt: new Date(),
        })
        .where(eq(emailAccount.id, accountId));

      return {
        success: true,
        message: `${account.email} has been disconnected.`,
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
        backfillDays: 90,
      };

      const updatedSettings: EmailAccountSettings = {
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
        .update(emailAccount)
        .set({
          settings: updatedSettings,
          updatedAt: new Date(),
        })
        .where(eq(emailAccount.id, accountId));

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

      if (account.status !== "active" && account.status !== "syncing") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Cannot set a disconnected or expired account as primary.",
        });
      }

      // Atomic update: clear all primary flags and set new primary
      await db.transaction(async (tx) => {
        // Clear existing primary for this organization
        await tx
          .update(emailAccount)
          .set({ isPrimary: false, updatedAt: new Date() })
          .where(
            and(
              eq(emailAccount.organizationId, organizationId),
              eq(emailAccount.isPrimary, true)
            )
          );

        // Set new primary
        await tx
          .update(emailAccount)
          .set({ isPrimary: true, updatedAt: new Date() })
          .where(eq(emailAccount.id, accountId));
      });

      return {
        success: true,
        message: `${account.email} is now the primary account.`,
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

      // Compute effective status
      let effectiveStatus = account.status;
      if (account.status === "active" && account.tokenExpiresAt < new Date()) {
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
        lastSyncError: account.lastSyncError,
        syncCursor: account.syncCursor,
        settings: account.settings ?? {
          syncEnabled: true,
          syncFrequencyMinutes: 5,
          backfillDays: 90,
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

      // Get all Gmail accounts for this user (across all orgs if no org specified)
      const accounts = await db.query.emailAccount.findMany({
        where: and(
          eq(emailAccount.addedByUserId, userId),
          eq(emailAccount.provider, "gmail"),
          eq(emailAccount.status, "active")
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
              `Failed to fetch calendar for ${account.email}:`,
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
              accountEmail: account.email,
            });
          }
        } catch (error) {
          console.error(`Error fetching calendar for ${account.email}:`, error);
        }
      }

      // Sort by start time
      allEvents.sort(
        (a, b) =>
          new Date(a.startTime).getTime() - new Date(b.startTime).getTime()
      );

      return { events: allEvents };
    }),
});

// Export state parsing for use in OAuth callback handlers
export { parseOAuthState };
