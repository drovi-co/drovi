// =============================================================================
// MULTI-SOURCE ABSTRACTION ROUTER
// =============================================================================
//
// Source management for multi-channel intelligence platform.
// Handles connecting, disconnecting, and syncing intelligence sources:
// - Email (Gmail, Outlook)
// - Calendar (Google Calendar, Outlook)
// - Slack
// - WhatsApp
// - Notion
// - Google Workspace (Docs, Sheets)
// - Meeting Transcripts
// - And more...
//
// This router manages source accounts and provides unified intelligence queries.
//

import { randomUUID } from "node:crypto";
import { SOURCE_DISPLAY_CONFIG, type SourceType } from "@memorystack/ai";
import { db } from "@memorystack/db";
import {
  claim,
  commitment,
  conversation,
  decision,
  emailAccount,
  member,
  sourceAccount,
} from "@memorystack/db/schema";
import { tasks } from "@trigger.dev/sdk";
import { TRPCError } from "@trpc/server";
import { and, desc, eq, gte, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { protectedProcedure, router } from "../index";

// =============================================================================
// TYPES
// =============================================================================

/**
 * Source configuration for UI display.
 */
export interface SourceConfig {
  type: SourceType;
  enabled: boolean;
  connectionStatus: "connected" | "disconnected" | "error" | "syncing";
  lastSyncAt?: Date | null;
  provider?: string;
  displayName?: string;
  settings?: Record<string, unknown>;
}

/**
 * Unified intelligence item from any source.
 */
export interface UnifiedIntelligenceItem {
  id: string;
  sourceType: SourceType;
  sourceId: string;
  type: "commitment" | "decision" | "mention" | "context" | "claim";
  title: string;
  description?: string;
  confidence: number;
  metadata: Record<string, unknown>;
  extractedAt: Date;
  sourceUrl?: string;
}

// =============================================================================
// INPUT SCHEMAS
// =============================================================================

const sourceTypeSchema = z.enum([
  "email",
  "slack",
  "calendar",
  "whatsapp",
  "notion",
  "google_docs",
  "google_sheets",
  "meeting_transcript",
  "teams",
  "discord",
  "linear",
  "github",
]);

const listSourcesSchema = z.object({
  organizationId: z.string().min(1),
});

const connectSourceSchema = z.object({
  organizationId: z.string().min(1),
  sourceType: sourceTypeSchema,
  provider: z.string().optional(),
  externalId: z.string().optional(),
  displayName: z.string().optional(),
  credentials: z
    .object({
      accessToken: z.string().optional(),
      refreshToken: z.string().optional(),
      apiKey: z.string().optional(),
    })
    .optional(),
  settings: z.record(z.string(), z.unknown()).optional(),
});

const disconnectSourceSchema = z.object({
  organizationId: z.string().min(1),
  sourceAccountId: z.string(),
});

const getSourceIntelligenceSchema = z.object({
  organizationId: z.string().min(1),
  sourceTypes: z.array(sourceTypeSchema).optional(),
  intelligenceTypes: z
    .array(z.enum(["commitment", "decision", "mention", "context", "claim"]))
    .optional(),
  limit: z.number().int().min(1).max(100).default(50),
  offset: z.number().int().min(0).default(0),
  dateRange: z
    .object({
      from: z.date(),
      to: z.date(),
    })
    .optional(),
});

// =============================================================================
// HELPERS
// =============================================================================

async function verifyOrgMembership(
  userId: string,
  organizationId: string
): Promise<boolean> {
  const memberRecord = await db.query.member.findFirst({
    where: and(
      eq(member.userId, userId),
      eq(member.organizationId, organizationId)
    ),
  });
  return !!memberRecord;
}

async function verifyOrgAdmin(
  userId: string,
  organizationId: string
): Promise<boolean> {
  const memberRecord = await db.query.member.findFirst({
    where: and(
      eq(member.userId, userId),
      eq(member.organizationId, organizationId),
      eq(member.role, "owner")
    ),
  });
  return !!memberRecord;
}

/**
 * Get source display configuration.
 */
function getSourceDisplay(type: SourceType) {
  return (
    SOURCE_DISPLAY_CONFIG[type] ?? {
      icon: "file",
      color: "#666666",
      label: type,
      description: `${type} integration`,
    }
  );
}

// =============================================================================
// ROUTER
// =============================================================================

export const sourcesRouter = router({
  // ===========================================================================
  // LIST SOURCES
  // ===========================================================================
  //
  // Get all available sources and their connection status.
  //
  list: protectedProcedure
    .input(listSourcesSchema)
    .query(async ({ ctx, input }) => {
      const { organizationId } = input;
      const userId = ctx.session.user.id;

      // Verify org membership
      const isMember = await verifyOrgMembership(userId, organizationId);
      if (!isMember) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Not a member of this organization",
        });
      }

      // Get connected source accounts from database
      const connectedSources = await db.query.sourceAccount.findMany({
        where: eq(sourceAccount.organizationId, organizationId),
      });

      // Also get legacy email accounts
      const emailAccounts = await db.query.emailAccount.findMany({
        where: eq(emailAccount.organizationId, organizationId),
      });

      // Build source configurations
      const sources: SourceConfig[] = [];

      // Add connected source accounts
      for (const source of connectedSources) {
        const display = getSourceDisplay(source.type as SourceType);
        sources.push({
          type: source.type as SourceType,
          enabled: source.status === "connected" || source.status === "syncing",
          connectionStatus: source.status as SourceConfig["connectionStatus"],
          lastSyncAt: source.lastSyncAt,
          provider: source.provider,
          displayName: source.displayName ?? display.label,
        });
      }

      // Add email accounts that aren't yet migrated
      for (const email of emailAccounts) {
        const alreadyAdded = connectedSources.some(
          (s) => s.type === "email" && s.externalId === email.email
        );
        if (!alreadyAdded) {
          sources.push({
            type: "email",
            enabled: email.status === "active" || email.status === "syncing",
            connectionStatus: (email.status ??
              "disconnected") as SourceConfig["connectionStatus"],
            lastSyncAt: email.lastSyncAt,
            provider: email.provider ?? "gmail",
            displayName: email.email,
          });
        }
      }

      // Add available but unconnected sources
      const availableTypes: SourceType[] = [
        "email",
        "slack",
        "calendar",
        "whatsapp",
        "notion",
        "google_docs",
        "google_sheets",
        "meeting_transcript",
        "teams",
        "discord",
        "linear",
        "github",
      ];

      const unconnectedSources = availableTypes
        .filter((type) => !sources.some((s) => s.type === type))
        .map((type) => ({
          type,
          enabled: false,
          connectionStatus: "disconnected" as const,
          lastSyncAt: null,
          ...getSourceDisplay(type),
        }));

      return {
        sources: [...sources, ...unconnectedSources],
        connectedCount: sources.filter((s) => s.enabled).length,
        isAdmin: await verifyOrgAdmin(userId, organizationId),
      };
    }),

  // ===========================================================================
  // GET SOURCE ACCOUNT
  // ===========================================================================
  //
  // Get a specific source account by ID.
  //
  get: protectedProcedure
    .input(
      z.object({
        organizationId: z.string().min(1),
        sourceAccountId: z.string(),
      })
    )
    .query(async ({ ctx, input }) => {
      const { organizationId, sourceAccountId } = input;
      const userId = ctx.session.user.id;

      const isMember = await verifyOrgMembership(userId, organizationId);
      if (!isMember) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Not a member of this organization",
        });
      }

      const source = await db.query.sourceAccount.findFirst({
        where: and(
          eq(sourceAccount.id, sourceAccountId),
          eq(sourceAccount.organizationId, organizationId)
        ),
      });

      if (!source) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Source account not found",
        });
      }

      return {
        id: source.id,
        type: source.type as SourceType,
        provider: source.provider,
        externalId: source.externalId,
        displayName: source.displayName,
        status: source.status,
        lastSyncAt: source.lastSyncAt,
        syncCursor: source.syncCursor,
        settings: source.settings as Record<string, unknown> | null,
        createdAt: source.createdAt,
      };
    }),

  // ===========================================================================
  // CONNECT SOURCE
  // ===========================================================================
  //
  // Connect a new intelligence source.
  //
  connect: protectedProcedure
    .input(connectSourceSchema)
    .mutation(async ({ ctx, input }) => {
      const {
        organizationId,
        sourceType,
        provider,
        externalId,
        displayName,
        settings,
      } = input;
      const userId = ctx.session.user.id;

      // Verify org admin
      const isAdmin = await verifyOrgAdmin(userId, organizationId);
      if (!isAdmin) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Only organization admins can connect sources",
        });
      }

      // Check if already connected
      if (externalId) {
        const existing = await db.query.sourceAccount.findFirst({
          where: and(
            eq(sourceAccount.organizationId, organizationId),
            eq(sourceAccount.type, sourceType),
            eq(sourceAccount.externalId, externalId)
          ),
        });

        if (existing) {
          throw new TRPCError({
            code: "CONFLICT",
            message: "This source is already connected",
          });
        }
      }

      // Determine provider and OAuth requirements
      const sourceConfig = getSourceDisplay(sourceType);
      const requiresOAuth = [
        "email",
        "calendar",
        "slack",
        "google_docs",
        "google_sheets",
      ].includes(sourceType);

      // For OAuth sources, return OAuth URL
      if (requiresOAuth && !input.credentials?.accessToken) {
        const oauthPaths: Record<string, string> = {
          email: "/api/auth/gmail",
          calendar: "/api/auth/calendar",
          slack: "/api/auth/slack",
          google_docs: "/api/auth/google-docs",
          google_sheets: "/api/auth/google-sheets",
        };

        return {
          success: true,
          message: `${sourceConfig.label} requires OAuth authentication`,
          requiresOAuth: true,
          oauthUrl: `${oauthPaths[sourceType] ?? "/api/auth/oauth"}?organizationId=${organizationId}&sourceType=${sourceType}`,
        };
      }

      // Create source account
      const sourceAccountId = randomUUID();

      // Build settings with proper defaults
      const defaultSettings: typeof sourceAccount.$inferInsert.settings = {
        syncEnabled: true,
        syncFrequencyMinutes: 15,
      };
      const accountSettings = settings
        ? ({
            ...defaultSettings,
            ...settings,
          } as typeof sourceAccount.$inferInsert.settings)
        : defaultSettings;

      await db.insert(sourceAccount).values({
        organizationId,
        addedByUserId: userId,
        type: sourceType,
        provider: provider ?? sourceType,
        externalId: externalId ?? "",
        displayName: displayName ?? sourceConfig.label,
        status: "disconnected" as const,
        settings: accountSettings,
      });

      return {
        success: true,
        message: `${sourceConfig.label} source created`,
        sourceAccountId,
        requiresOAuth: false,
      };
    }),

  // ===========================================================================
  // DISCONNECT SOURCE
  // ===========================================================================
  //
  // Disconnect an intelligence source.
  //
  disconnect: protectedProcedure
    .input(disconnectSourceSchema)
    .mutation(async ({ ctx, input }) => {
      const { organizationId, sourceAccountId } = input;
      const userId = ctx.session.user.id;

      // Verify org admin
      const isAdmin = await verifyOrgAdmin(userId, organizationId);
      if (!isAdmin) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Only organization admins can disconnect sources",
        });
      }

      // Get source account
      const source = await db.query.sourceAccount.findFirst({
        where: and(
          eq(sourceAccount.id, sourceAccountId),
          eq(sourceAccount.organizationId, organizationId)
        ),
      });

      if (!source) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Source account not found",
        });
      }

      // Update status to disconnected and clear tokens
      await db
        .update(sourceAccount)
        .set({
          status: "disconnected",
          accessToken: null,
          refreshToken: null,
          tokenExpiresAt: null,
          updatedAt: new Date(),
        })
        .where(eq(sourceAccount.id, sourceAccountId));

      return {
        success: true,
        message: `${source.displayName ?? source.type} disconnected`,
      };
    }),

  // ===========================================================================
  // DELETE SOURCE
  // ===========================================================================
  //
  // Permanently delete a source and all its data.
  //
  delete: protectedProcedure
    .input(disconnectSourceSchema)
    .mutation(async ({ ctx, input }) => {
      const { organizationId, sourceAccountId } = input;
      const userId = ctx.session.user.id;

      // Verify org admin
      const isAdmin = await verifyOrgAdmin(userId, organizationId);
      if (!isAdmin) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Only organization admins can delete sources",
        });
      }

      // Verify source exists
      const source = await db.query.sourceAccount.findFirst({
        where: and(
          eq(sourceAccount.id, sourceAccountId),
          eq(sourceAccount.organizationId, organizationId)
        ),
      });

      if (!source) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Source account not found",
        });
      }

      // Delete source account (cascades to conversations, messages, etc.)
      await db
        .delete(sourceAccount)
        .where(eq(sourceAccount.id, sourceAccountId));

      return {
        success: true,
        message: `${source.displayName ?? source.type} deleted`,
      };
    }),

  // ===========================================================================
  // GET UNIFIED INTELLIGENCE
  // ===========================================================================
  //
  // Get intelligence items from all connected sources.
  // This aggregates commitments, decisions, and claims across all sources.
  //
  getIntelligence: protectedProcedure
    .input(getSourceIntelligenceSchema)
    .query(async ({ ctx, input }) => {
      const {
        organizationId,
        sourceTypes,
        intelligenceTypes,
        limit,
        offset,
        dateRange,
      } = input;
      const userId = ctx.session.user.id;

      // Verify org membership
      const isMember = await verifyOrgMembership(userId, organizationId);
      if (!isMember) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Not a member of this organization",
        });
      }

      const items: UnifiedIntelligenceItem[] = [];
      const activeTypes = intelligenceTypes ?? [
        "commitment",
        "decision",
        "claim",
      ];

      // Get source account IDs if filtering by type
      let sourceAccountIds: string[] | undefined;
      if (sourceTypes && sourceTypes.length > 0) {
        const accounts = await db.query.sourceAccount.findMany({
          where: and(
            eq(sourceAccount.organizationId, organizationId),
            inArray(sourceAccount.type, sourceTypes)
          ),
          columns: { id: true },
        });
        sourceAccountIds = accounts.map((a) => a.id);
      }

      // Query commitments
      if (activeTypes.includes("commitment")) {
        const commitmentConditions = [
          eq(commitment.organizationId, organizationId),
        ];

        if (sourceAccountIds) {
          commitmentConditions.push(
            inArray(commitment.sourceAccountId, sourceAccountIds)
          );
        }

        if (dateRange) {
          commitmentConditions.push(gte(commitment.createdAt, dateRange.from));
        }

        const commitments = await db.query.commitment.findMany({
          where: and(...commitmentConditions),
          limit: Math.ceil(limit / activeTypes.length),
          orderBy: [desc(commitment.createdAt)],
        });

        for (const c of commitments) {
          items.push({
            id: c.id,
            sourceType: "email", // Default, would need to join to get actual source type
            sourceId: c.sourceConversationId ?? c.sourceThreadId ?? "",
            type: "commitment",
            title: c.title,
            description: c.description ?? undefined,
            confidence: c.confidence ?? 0.8,
            metadata: (c.metadata ?? {}) as Record<string, unknown>,
            extractedAt: c.createdAt ?? new Date(),
          });
        }
      }

      // Query decisions
      if (activeTypes.includes("decision")) {
        const decisionConditions = [
          eq(decision.organizationId, organizationId),
        ];

        if (sourceAccountIds) {
          decisionConditions.push(
            inArray(decision.sourceAccountId, sourceAccountIds)
          );
        }

        if (dateRange) {
          decisionConditions.push(gte(decision.createdAt, dateRange.from));
        }

        const decisions = await db.query.decision.findMany({
          where: and(...decisionConditions),
          limit: Math.ceil(limit / activeTypes.length),
          orderBy: [desc(decision.createdAt)],
        });

        for (const d of decisions) {
          items.push({
            id: d.id,
            sourceType: "email",
            sourceId: d.sourceConversationId ?? "",
            type: "decision",
            title: d.statement,
            description: d.rationale ?? undefined,
            confidence: d.confidence ?? 0.8,
            metadata: (d.metadata ?? {}) as Record<string, unknown>,
            extractedAt: d.createdAt ?? new Date(),
          });
        }
      }

      // Query claims
      if (activeTypes.includes("claim")) {
        const claimConditions = [
          eq(claim.organizationId, organizationId),
          eq(claim.isUserDismissed, false),
        ];

        if (sourceAccountIds) {
          claimConditions.push(
            inArray(claim.sourceAccountId, sourceAccountIds)
          );
        }

        if (dateRange) {
          claimConditions.push(gte(claim.extractedAt, dateRange.from));
        }

        const claims = await db.query.claim.findMany({
          where: and(...claimConditions),
          limit: Math.ceil(limit / activeTypes.length),
          orderBy: [desc(claim.extractedAt)],
        });

        for (const c of claims) {
          items.push({
            id: c.id,
            sourceType: "email",
            sourceId: c.conversationId ?? c.threadId ?? "",
            type: "claim",
            title: c.text,
            description: c.quotedText ?? undefined,
            confidence: c.confidence ?? 0.8,
            metadata: (c.metadata ?? {}) as Record<string, unknown>,
            extractedAt: c.extractedAt ?? new Date(),
          });
        }
      }

      // Sort by extracted date
      items.sort((a, b) => b.extractedAt.getTime() - a.extractedAt.getTime());

      return {
        items: items.slice(offset, offset + limit),
        sources: sourceTypes ?? ["email"],
        types: activeTypes,
        total: items.length,
        hasMore: offset + limit < items.length,
      };
    }),

  // ===========================================================================
  // GET SOURCE STATS
  // ===========================================================================
  //
  // Get statistics for each connected source.
  //
  getStats: protectedProcedure
    .input(listSourcesSchema)
    .query(async ({ ctx, input }) => {
      const { organizationId } = input;
      const userId = ctx.session.user.id;

      // Verify org membership
      const isMember = await verifyOrgMembership(userId, organizationId);
      if (!isMember) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Not a member of this organization",
        });
      }

      // Get source accounts
      const sources = await db.query.sourceAccount.findMany({
        where: eq(sourceAccount.organizationId, organizationId),
      });

      const stats = [];

      for (const source of sources) {
        // Count conversations
        const [convCount] = await db
          .select({ count: sql<number>`count(*)::int` })
          .from(conversation)
          .where(eq(conversation.sourceAccountId, source.id));

        // Count commitments
        const [commitmentCount] = await db
          .select({ count: sql<number>`count(*)::int` })
          .from(commitment)
          .where(eq(commitment.sourceAccountId, source.id));

        // Count decisions
        const [decisionCount] = await db
          .select({ count: sql<number>`count(*)::int` })
          .from(decision)
          .where(eq(decision.sourceAccountId, source.id));

        stats.push({
          sourceAccountId: source.id,
          sourceType: source.type as SourceType,
          displayName: source.displayName,
          conversations: convCount?.count ?? 0,
          commitments: commitmentCount?.count ?? 0,
          decisions: decisionCount?.count ?? 0,
          lastSync: source.lastSyncAt,
          health:
            source.status === "connected"
              ? ("healthy" as const)
              : ("disconnected" as const),
        });
      }

      return { stats };
    }),

  // ===========================================================================
  // SYNC SOURCE
  // ===========================================================================
  //
  // Trigger a manual sync for a specific source.
  //
  sync: protectedProcedure
    .input(
      z.object({
        organizationId: z.string().min(1),
        sourceAccountId: z.string(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { organizationId, sourceAccountId } = input;
      const userId = ctx.session.user.id;

      // Verify org membership
      const isMember = await verifyOrgMembership(userId, organizationId);
      if (!isMember) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Not a member of this organization",
        });
      }

      // Get source account
      const source = await db.query.sourceAccount.findFirst({
        where: and(
          eq(sourceAccount.id, sourceAccountId),
          eq(sourceAccount.organizationId, organizationId)
        ),
      });

      if (!source) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Source account not found",
        });
      }

      // Update status to syncing
      await db
        .update(sourceAccount)
        .set({ status: "syncing", updatedAt: new Date() })
        .where(eq(sourceAccount.id, sourceAccountId));

      // Trigger the appropriate sync task based on source type
      let syncHandle: { id: string } | null = null;
      try {
        switch (source.type) {
          case "slack":
            syncHandle = await tasks.trigger("slack-sync", {
              sourceAccountId: source.id,
              fullSync: true,
            });
            break;
          case "whatsapp":
            syncHandle = await tasks.trigger("whatsapp-sync", {
              sourceAccountId: source.id,
            });
            break;
          case "calendar": {
            // Calendar uses email account for OAuth
            const emailAcct = await db.query.emailAccount.findFirst({
              where: eq(emailAccount.organizationId, organizationId),
              columns: { id: true },
            });
            if (emailAcct) {
              syncHandle = await tasks.trigger("calendar-sync", {
                emailAccountId: emailAcct.id,
              });
            }
            break;
          }
          case "email":
            // Email sync is handled by email-sync task
            if (source.externalId) {
              syncHandle = await tasks.trigger("email-sync", {
                accountId: source.externalId,
                fullSync: true,
              });
            }
            break;
          default:
            // Unknown source type, just mark as connected
            await db
              .update(sourceAccount)
              .set({ status: "connected", updatedAt: new Date() })
              .where(eq(sourceAccount.id, sourceAccountId));
            break;
        }
      } catch (syncError) {
        // If sync trigger fails, reset status
        await db
          .update(sourceAccount)
          .set({ status: "error", updatedAt: new Date() })
          .where(eq(sourceAccount.id, sourceAccountId));
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to trigger sync task",
          cause: syncError,
        });
      }

      return {
        success: true,
        message: `Sync triggered for ${source.displayName ?? source.type}`,
        syncId: syncHandle?.id ?? null,
      };
    }),

  // ===========================================================================
  // UPDATE SOURCE SETTINGS
  // ===========================================================================
  //
  // Update settings for a source account.
  //
  updateSettings: protectedProcedure
    .input(
      z.object({
        organizationId: z.string().min(1),
        sourceAccountId: z.string(),
        settings: z.record(z.string(), z.unknown()),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { organizationId, sourceAccountId, settings } = input;
      const userId = ctx.session.user.id;

      // Verify org admin
      const isAdmin = await verifyOrgAdmin(userId, organizationId);
      if (!isAdmin) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Only organization admins can update source settings",
        });
      }

      // Get existing source
      const source = await db.query.sourceAccount.findFirst({
        where: and(
          eq(sourceAccount.id, sourceAccountId),
          eq(sourceAccount.organizationId, organizationId)
        ),
      });

      if (!source) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Source account not found",
        });
      }

      // Merge settings
      const existingSettings = (source.settings ?? {
        syncEnabled: true,
        syncFrequencyMinutes: 15,
      }) as typeof sourceAccount.$inferInsert.settings;
      const newSettings = {
        ...existingSettings,
        ...settings,
      } as typeof sourceAccount.$inferInsert.settings;

      await db
        .update(sourceAccount)
        .set({ settings: newSettings, updatedAt: new Date() })
        .where(eq(sourceAccount.id, sourceAccountId));

      return {
        success: true,
        message: "Settings updated",
      };
    }),
});
