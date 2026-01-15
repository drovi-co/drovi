// =============================================================================
// MULTI-SOURCE ABSTRACTION ROUTER
// =============================================================================
//
// Source abstraction layer for multi-channel intelligence:
// - Email (primary)
// - Calendar (Google Calendar, Outlook)
// - Slack
// - Future: Teams, Notion, etc.
//
// Each source provides:
// - Commitments
// - Decisions
// - Context for AI understanding
//
// This is the foundation for MEMORYSTACK's multi-source intelligence.
//

import { db } from "@memorystack/db";
import { member } from "@memorystack/db/schema";
import { TRPCError } from "@trpc/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { protectedProcedure, router } from "../index";

// =============================================================================
// TYPES
// =============================================================================

// Unified source type
export type SourceType = "email" | "calendar" | "slack" | "notion" | "teams";

// Source configuration stored per organization
export interface SourceConfig {
  type: SourceType;
  enabled: boolean;
  connectionStatus: "connected" | "disconnected" | "error";
  lastSyncAt?: Date;
  settings: Record<string, unknown>;
  credentials?: {
    accessToken?: string;
    refreshToken?: string;
    expiresAt?: Date;
  };
}

// Unified intelligence item that can come from any source
export interface UnifiedIntelligenceItem {
  id: string;
  sourceType: SourceType;
  sourceId: string; // ID in the source system
  type: "commitment" | "decision" | "mention" | "context";
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

const listSourcesSchema = z.object({
  organizationId: z.string().min(1),
});

const connectSourceSchema = z.object({
  organizationId: z.string().min(1),
  sourceType: z.enum(["email", "calendar", "slack", "notion", "teams"]),
  credentials: z
    .object({
      accessToken: z.string().optional(),
      refreshToken: z.string().optional(),
      apiKey: z.string().optional(),
    })
    .optional(),
  settings: z.record(z.unknown()).optional(),
});

const disconnectSourceSchema = z.object({
  organizationId: z.string().min(1),
  sourceType: z.enum(["email", "calendar", "slack", "notion", "teams"]),
});

const getSourceIntelligenceSchema = z.object({
  organizationId: z.string().min(1),
  sourceTypes: z
    .array(z.enum(["email", "calendar", "slack", "notion", "teams"]))
    .optional(),
  intelligenceTypes: z
    .array(z.enum(["commitment", "decision", "mention", "context"]))
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

// Default sources configuration
const defaultSources: Record<SourceType, Omit<SourceConfig, "credentials">> = {
  email: {
    type: "email",
    enabled: true,
    connectionStatus: "connected",
    settings: {},
  },
  calendar: {
    type: "calendar",
    enabled: false,
    connectionStatus: "disconnected",
    settings: {
      provider: "google", // or "outlook"
      syncEvents: true,
      extractCommitments: true,
      extractDecisions: false,
    },
  },
  slack: {
    type: "slack",
    enabled: false,
    connectionStatus: "disconnected",
    settings: {
      syncChannels: [],
      syncDMs: false,
      extractCommitments: true,
      extractDecisions: true,
    },
  },
  notion: {
    type: "notion",
    enabled: false,
    connectionStatus: "disconnected",
    settings: {
      syncDatabases: [],
      extractCommitments: true,
      extractDecisions: true,
    },
  },
  teams: {
    type: "teams",
    enabled: false,
    connectionStatus: "disconnected",
    settings: {
      syncChannels: [],
      syncChats: false,
      extractCommitments: true,
      extractDecisions: true,
    },
  },
};

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

      // Get organization's source configurations
      // In a real implementation, this would come from the database
      // For now, return default sources with email connected

      const sources = Object.values(defaultSources).map((source) => ({
        ...source,
        // Email is always connected via existing email accounts
        connectionStatus:
          source.type === "email" ? "connected" : source.connectionStatus,
        isAvailable: source.type === "email" || source.type === "calendar", // Only email and calendar implemented
      }));

      return {
        sources,
        isAdmin: await verifyOrgAdmin(userId, organizationId),
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
      const { organizationId, sourceType, credentials, settings } = input;
      const userId = ctx.session.user.id;

      // Verify org admin
      const isAdmin = await verifyOrgAdmin(userId, organizationId);
      if (!isAdmin) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Only organization admins can connect sources",
        });
      }

      // Validate source type is implemented
      if (!["email", "calendar"].includes(sourceType)) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Source type "${sourceType}" is not yet implemented`,
        });
      }

      // For calendar, initiate OAuth flow
      if (sourceType === "calendar") {
        // In a real implementation, this would:
        // 1. Store the credentials securely
        // 2. Initiate background sync
        // 3. Return OAuth URL if needed

        return {
          success: true,
          message: "Calendar connection initiated",
          requiresOAuth: true,
          oauthUrl: `/api/auth/calendar?organizationId=${organizationId}`,
        };
      }

      // Email is connected via existing email accounts flow
      if (sourceType === "email") {
        return {
          success: true,
          message: "Email is connected via Email Accounts settings",
          requiresOAuth: false,
        };
      }

      return {
        success: false,
        message: "Source type not implemented",
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
      const { organizationId, sourceType } = input;
      const userId = ctx.session.user.id;

      // Verify org admin
      const isAdmin = await verifyOrgAdmin(userId, organizationId);
      if (!isAdmin) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Only organization admins can disconnect sources",
        });
      }

      // Can't disconnect email (primary source)
      if (sourceType === "email") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Cannot disconnect email - it is the primary source",
        });
      }

      // In a real implementation, this would:
      // 1. Revoke OAuth tokens
      // 2. Mark source as disconnected
      // 3. Optionally delete extracted data

      return {
        success: true,
        message: `${sourceType} disconnected`,
      };
    }),

  // ===========================================================================
  // GET UNIFIED INTELLIGENCE
  // ===========================================================================
  //
  // Get intelligence items from all connected sources.
  // This is the core multi-source query.
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

      // Currently only email is fully implemented
      // In a real implementation, this would query multiple tables
      // and merge results from different sources

      const activeSources = sourceTypes ?? ["email"];
      const activeTypes = intelligenceTypes ?? [
        "commitment",
        "decision",
      ];

      // For now, return placeholder data structure
      // Real implementation would query commitments, decisions, etc.
      // and map them to UnifiedIntelligenceItem format

      return {
        items: [] as UnifiedIntelligenceItem[],
        sources: activeSources,
        types: activeTypes,
        total: 0,
        hasMore: false,
        message:
          "Multi-source intelligence is aggregated from email. Connect more sources to expand coverage.",
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

      // In a real implementation, this would count items from each source
      return {
        stats: [
          {
            sourceType: "email" as SourceType,
            commitments: 0, // Would query actual count
            decisions: 0,
            lastSync: new Date(),
            health: "healthy" as const,
          },
          {
            sourceType: "calendar" as SourceType,
            commitments: 0,
            decisions: 0,
            lastSync: null,
            health: "disconnected" as const,
          },
        ],
      };
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
        sourceType: z.enum(["email", "calendar", "slack", "notion", "teams"]),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { organizationId, sourceType } = input;
      const userId = ctx.session.user.id;

      // Verify org membership
      const isMember = await verifyOrgMembership(userId, organizationId);
      if (!isMember) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Not a member of this organization",
        });
      }

      // Email sync is handled by existing email sync flow
      if (sourceType === "email") {
        return {
          success: true,
          message: "Email sync triggered via existing flow",
          syncId: null,
        };
      }

      // Calendar sync would be implemented separately
      if (sourceType === "calendar") {
        // In real implementation, this would trigger a background job
        return {
          success: true,
          message: "Calendar sync is not yet implemented",
          syncId: null,
        };
      }

      return {
        success: false,
        message: `Sync for ${sourceType} is not implemented`,
      };
    }),
});
