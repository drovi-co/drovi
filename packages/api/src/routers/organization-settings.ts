// =============================================================================
// ORGANIZATION SETTINGS ROUTER
// =============================================================================
//
// API routes for organization settings management including:
// - Privacy policy configuration
// - SSO/SCIM settings
// - Feature flags
// - Compliance settings
//

import crypto from "node:crypto";
import { db } from "@memorystack/db";
import {
  type AIFeatureSettings,
  type ComplianceSettings,
  member,
  type OrganizationFeatureFlags,
  organizationSettings,
  scimGroupMapping,
  ssoIdentity,
} from "@memorystack/db/schema";
import { TRPCError } from "@trpc/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { protectedProcedure, router } from "../index";

// =============================================================================
// INPUT SCHEMAS
// =============================================================================

const privacyPolicySchema = z.enum(["private", "team_visible", "org_visible"]);

const ssoProviderSchema = z.enum([
  "okta",
  "azure_ad",
  "google_workspace",
  "onelogin",
  "jumpcloud",
  "custom_saml",
  "custom_oidc",
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

async function getOrCreateSettings(
  organizationId: string
): Promise<typeof organizationSettings.$inferSelect> {
  let settings = await db.query.organizationSettings.findFirst({
    where: eq(organizationSettings.organizationId, organizationId),
  });

  if (!settings) {
    const [newSettings] = await db
      .insert(organizationSettings)
      .values({ organizationId })
      .returning();
    settings = newSettings;
  }

  if (!settings) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Failed to create organization settings.",
    });
  }

  return settings;
}

// =============================================================================
// ROUTER
// =============================================================================

export const organizationSettingsRouter = router({
  // ===========================================================================
  // SETTINGS CRUD
  // ===========================================================================

  /**
   * Get organization settings.
   */
  get: protectedProcedure
    .input(z.object({ organizationId: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      await verifyOrgMembership(userId, input.organizationId);

      const settings = await getOrCreateSettings(input.organizationId);
      return { settings };
    }),

  /**
   * Update organization settings (admin only).
   */
  update: protectedProcedure
    .input(
      z.object({
        organizationId: z.string().min(1),
        // Privacy settings
        defaultPrivacyPolicy: privacyPolicySchema.optional(),
        allowPrivacyOverride: z.boolean().optional(),
        allowPersonalAccounts: z.boolean().optional(),
        autoShareCommitments: z.boolean().optional(),
        autoShareDecisions: z.boolean().optional(),
        autoShareOnMention: z.boolean().optional(),
        // Shared inbox settings
        sharedInboxEnabled: z.boolean().optional(),
        autoAssignEnabled: z.boolean().optional(),
        roundRobinSkipAway: z.boolean().optional(),
        maxConcurrentAssignments: z.number().int().min(1).max(100).optional(),
        // Security settings
        ssoRequired: z.boolean().optional(),
        mfaRequired: z.boolean().optional(),
        sessionTimeoutMinutes: z.number().int().min(5).max(10_080).optional(),
        allowedEmailDomains: z.array(z.string()).optional(),
        ipAllowlist: z.array(z.string()).optional(),
        // Data settings
        dataRetentionDays: z.number().int().min(0).max(3650).optional(),
        allowDataExport: z.boolean().optional(),
        // Allowed integrations
        allowedIntegrations: z.array(z.string()).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      await verifyAdminAccess(userId, input.organizationId);

      const settings = await getOrCreateSettings(input.organizationId);

      const updates: Partial<typeof organizationSettings.$inferInsert> = {
        updatedAt: new Date(),
      };

      // Privacy settings
      if (input.defaultPrivacyPolicy !== undefined) {
        updates.defaultPrivacyPolicy = input.defaultPrivacyPolicy;
      }
      if (input.allowPrivacyOverride !== undefined) {
        updates.allowPrivacyOverride = input.allowPrivacyOverride;
      }
      if (input.allowPersonalAccounts !== undefined) {
        updates.allowPersonalAccounts = input.allowPersonalAccounts;
      }
      if (input.autoShareCommitments !== undefined) {
        updates.autoShareCommitments = input.autoShareCommitments;
      }
      if (input.autoShareDecisions !== undefined) {
        updates.autoShareDecisions = input.autoShareDecisions;
      }
      if (input.autoShareOnMention !== undefined) {
        updates.autoShareOnMention = input.autoShareOnMention;
      }
      // Shared inbox settings
      if (input.sharedInboxEnabled !== undefined) {
        updates.sharedInboxEnabled = input.sharedInboxEnabled;
      }
      if (input.autoAssignEnabled !== undefined) {
        updates.autoAssignEnabled = input.autoAssignEnabled;
      }
      if (input.roundRobinSkipAway !== undefined) {
        updates.roundRobinSkipAway = input.roundRobinSkipAway;
      }
      if (input.maxConcurrentAssignments !== undefined) {
        updates.maxConcurrentAssignments = input.maxConcurrentAssignments;
      }
      // Security settings
      if (input.ssoRequired !== undefined) {
        updates.ssoRequired = input.ssoRequired;
      }
      if (input.mfaRequired !== undefined) {
        updates.mfaRequired = input.mfaRequired;
      }
      if (input.sessionTimeoutMinutes !== undefined) {
        updates.sessionTimeoutMinutes = input.sessionTimeoutMinutes;
      }
      if (input.allowedEmailDomains !== undefined) {
        updates.allowedEmailDomains = input.allowedEmailDomains;
      }
      if (input.ipAllowlist !== undefined) {
        updates.ipAllowlist = input.ipAllowlist;
      }
      // Data settings
      if (input.dataRetentionDays !== undefined) {
        updates.dataRetentionDays = input.dataRetentionDays;
      }
      if (input.allowDataExport !== undefined) {
        updates.allowDataExport = input.allowDataExport;
      }
      if (input.allowedIntegrations !== undefined) {
        updates.allowedIntegrations = input.allowedIntegrations;
      }

      await db
        .update(organizationSettings)
        .set(updates)
        .where(eq(organizationSettings.id, settings.id));

      return { success: true };
    }),

  // ===========================================================================
  // PRIVACY POLICY
  // ===========================================================================

  /**
   * Get privacy policy settings.
   */
  getPrivacyPolicy: protectedProcedure
    .input(z.object({ organizationId: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      await verifyOrgMembership(userId, input.organizationId);

      const settings = await getOrCreateSettings(input.organizationId);

      return {
        defaultPrivacyPolicy: settings.defaultPrivacyPolicy,
        allowPrivacyOverride: settings.allowPrivacyOverride,
        allowPersonalAccounts: settings.allowPersonalAccounts,
        autoShareCommitments: settings.autoShareCommitments,
        autoShareDecisions: settings.autoShareDecisions,
        autoShareOnMention: settings.autoShareOnMention,
      };
    }),

  /**
   * Update privacy policy settings (admin only).
   */
  updatePrivacyPolicy: protectedProcedure
    .input(
      z.object({
        organizationId: z.string().min(1),
        defaultPrivacyPolicy: privacyPolicySchema.optional(),
        allowPrivacyOverride: z.boolean().optional(),
        allowPersonalAccounts: z.boolean().optional(),
        autoShareCommitments: z.boolean().optional(),
        autoShareDecisions: z.boolean().optional(),
        autoShareOnMention: z.boolean().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      await verifyAdminAccess(userId, input.organizationId);

      const settings = await getOrCreateSettings(input.organizationId);

      await db
        .update(organizationSettings)
        .set({
          defaultPrivacyPolicy:
            input.defaultPrivacyPolicy ?? settings.defaultPrivacyPolicy,
          allowPrivacyOverride:
            input.allowPrivacyOverride ?? settings.allowPrivacyOverride,
          allowPersonalAccounts:
            input.allowPersonalAccounts ?? settings.allowPersonalAccounts,
          autoShareCommitments:
            input.autoShareCommitments ?? settings.autoShareCommitments,
          autoShareDecisions:
            input.autoShareDecisions ?? settings.autoShareDecisions,
          autoShareOnMention:
            input.autoShareOnMention ?? settings.autoShareOnMention,
          updatedAt: new Date(),
        })
        .where(eq(organizationSettings.id, settings.id));

      return { success: true };
    }),

  // ===========================================================================
  // FEATURE FLAGS
  // ===========================================================================

  /**
   * Get feature flags.
   */
  getFeatureFlags: protectedProcedure
    .input(z.object({ organizationId: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      await verifyOrgMembership(userId, input.organizationId);

      const settings = await getOrCreateSettings(input.organizationId);

      return {
        featureFlags: settings.featureFlags,
        aiFeatures: settings.aiFeatures,
        complianceSettings: settings.complianceSettings,
      };
    }),

  /**
   * Update feature flags (admin only).
   */
  updateFeatureFlags: protectedProcedure
    .input(
      z.object({
        organizationId: z.string().min(1),
        featureFlags: z
          .object({
            sharedInboxEnabled: z.boolean().optional(),
            intelligenceSharingEnabled: z.boolean().optional(),
            customRolesEnabled: z.boolean().optional(),
            mentionsEnabled: z.boolean().optional(),
            commentsEnabled: z.boolean().optional(),
            presenceEnabled: z.boolean().optional(),
            activityFeedEnabled: z.boolean().optional(),
            delegationEnabled: z.boolean().optional(),
          })
          .optional(),
        aiFeatures: z
          .object({
            draftingEnabled: z.boolean().optional(),
            triageEnabled: z.boolean().optional(),
            extractionEnabled: z.boolean().optional(),
            summarizationEnabled: z.boolean().optional(),
            riskAnalysisEnabled: z.boolean().optional(),
          })
          .optional(),
        complianceSettings: z
          .object({
            gdprEnabled: z.boolean().optional(),
            hipaaEnabled: z.boolean().optional(),
            soc2Enabled: z.boolean().optional(),
            dataRetentionDays: z.number().int().min(0).optional(),
            auditLogRetentionDays: z.number().int().min(0).optional(),
            autoDeleteEnabled: z.boolean().optional(),
            legalHoldEnabled: z.boolean().optional(),
          })
          .optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      await verifyAdminAccess(userId, input.organizationId);

      const settings = await getOrCreateSettings(input.organizationId);

      const updates: Partial<typeof organizationSettings.$inferInsert> = {
        updatedAt: new Date(),
      };

      if (input.featureFlags) {
        updates.featureFlags = {
          ...settings.featureFlags,
          ...input.featureFlags,
        } as OrganizationFeatureFlags;
      }

      if (input.aiFeatures) {
        updates.aiFeatures = {
          ...settings.aiFeatures,
          ...input.aiFeatures,
        } as AIFeatureSettings;
      }

      if (input.complianceSettings) {
        updates.complianceSettings = {
          ...settings.complianceSettings,
          ...input.complianceSettings,
        } as ComplianceSettings;
      }

      await db
        .update(organizationSettings)
        .set(updates)
        .where(eq(organizationSettings.id, settings.id));

      return { success: true };
    }),

  // ===========================================================================
  // SSO CONFIGURATION
  // ===========================================================================

  /**
   * Get SSO configuration (admin only).
   */
  getSSOConfig: protectedProcedure
    .input(z.object({ organizationId: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      await verifyAdminAccess(userId, input.organizationId);

      const settings = await getOrCreateSettings(input.organizationId);

      return {
        ssoEnabled: settings.ssoEnabled,
        ssoProvider: settings.ssoProvider,
        ssoEnforced: settings.ssoEnforced,
        // Don't expose actual SSO config details in API
        isConfigured:
          settings.ssoProvider !== null && settings.ssoConfig !== null,
      };
    }),

  /**
   * Update SSO configuration (admin only).
   */
  updateSSOConfig: protectedProcedure
    .input(
      z.object({
        organizationId: z.string().min(1),
        ssoEnabled: z.boolean().optional(),
        ssoProvider: ssoProviderSchema.optional(),
        ssoEnforced: z.boolean().optional(),
        ssoConfig: z
          .object({
            entityId: z.string().optional(),
            ssoUrl: z.string().url().optional(),
            certificate: z.string().optional(),
            clientId: z.string().optional(),
            clientSecret: z.string().optional(),
            issuer: z.string().optional(),
          })
          .optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      await verifyAdminAccess(userId, input.organizationId);

      const settings = await getOrCreateSettings(input.organizationId);

      const updates: Partial<typeof organizationSettings.$inferInsert> = {
        updatedAt: new Date(),
      };

      if (input.ssoEnabled !== undefined) {
        updates.ssoEnabled = input.ssoEnabled;
      }
      if (input.ssoProvider !== undefined) {
        updates.ssoProvider = input.ssoProvider;
      }
      if (input.ssoEnforced !== undefined) {
        updates.ssoEnforced = input.ssoEnforced;
      }
      if (input.ssoConfig !== undefined) {
        updates.ssoConfig = {
          ...(settings.ssoConfig as Record<string, string>),
          ...input.ssoConfig,
        };
      }

      await db
        .update(organizationSettings)
        .set(updates)
        .where(eq(organizationSettings.id, settings.id));

      return { success: true };
    }),

  /**
   * List SSO identities for the organization (admin only).
   */
  listSSOIdentities: protectedProcedure
    .input(
      z.object({
        organizationId: z.string().min(1),
        limit: z.number().int().min(1).max(100).default(50),
        offset: z.number().int().min(0).default(0),
      })
    )
    .query(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      await verifyAdminAccess(userId, input.organizationId);

      const identities = await db.query.ssoIdentity.findMany({
        where: eq(ssoIdentity.organizationId, input.organizationId),
        limit: input.limit,
        offset: input.offset,
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

      return { identities };
    }),

  // ===========================================================================
  // SCIM PROVISIONING
  // ===========================================================================

  /**
   * Get SCIM configuration (admin only).
   */
  getSCIMConfig: protectedProcedure
    .input(z.object({ organizationId: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      await verifyAdminAccess(userId, input.organizationId);

      const settings = await getOrCreateSettings(input.organizationId);

      return {
        scimEnabled: settings.scimEnabled,
        scimEndpoint: settings.scimEndpoint,
        scimLastSyncAt: settings.scimLastSyncAt,
        // Don't expose token in API, only show prefix for identification
        hasToken: settings.scimTokenHash !== null,
        tokenPrefix: settings.scimTokenPrefix,
      };
    }),

  /**
   * Enable/configure SCIM (admin only).
   */
  updateSCIMConfig: protectedProcedure
    .input(
      z.object({
        organizationId: z.string().min(1),
        scimEnabled: z.boolean().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      await verifyAdminAccess(userId, input.organizationId);

      const settings = await getOrCreateSettings(input.organizationId);

      const updates: Partial<typeof organizationSettings.$inferInsert> = {
        updatedAt: new Date(),
      };

      if (input.scimEnabled !== undefined) {
        updates.scimEnabled = input.scimEnabled;

        // Generate endpoint and token when enabling
        if (input.scimEnabled && !settings.scimEndpoint) {
          const newToken = crypto.randomUUID();
          updates.scimEndpoint = `/api/scim/v2/organizations/${input.organizationId}`;
          // Store hash and prefix (in production, use proper hashing)
          updates.scimTokenHash = newToken; // TODO: hash this properly
          updates.scimTokenPrefix = newToken.substring(0, 8);
        }
      }

      await db
        .update(organizationSettings)
        .set(updates)
        .where(eq(organizationSettings.id, settings.id));

      return { success: true };
    }),

  /**
   * Regenerate SCIM token (admin only).
   */
  regenerateSCIMToken: protectedProcedure
    .input(z.object({ organizationId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      await verifyAdminAccess(userId, input.organizationId);

      await getOrCreateSettings(input.organizationId);

      const newToken = crypto.randomUUID();

      await db
        .update(organizationSettings)
        .set({
          scimTokenHash: newToken, // TODO: hash this properly
          scimTokenPrefix: newToken.substring(0, 8),
          updatedAt: new Date(),
        })
        .where(eq(organizationSettings.organizationId, input.organizationId));

      // Return the new token (only shown once)
      return { token: newToken };
    }),

  /**
   * List SCIM group mappings (admin only).
   */
  listSCIMGroupMappings: protectedProcedure
    .input(z.object({ organizationId: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      await verifyAdminAccess(userId, input.organizationId);

      const mappings = await db.query.scimGroupMapping.findMany({
        where: eq(scimGroupMapping.organizationId, input.organizationId),
        with: {
          team: {
            columns: {
              id: true,
              name: true,
            },
          },
        },
      });

      return { mappings };
    }),

  /**
   * Create SCIM group mapping (admin only).
   */
  createSCIMGroupMapping: protectedProcedure
    .input(
      z.object({
        organizationId: z.string().min(1),
        scimGroupId: z.string().min(1),
        scimGroupName: z.string().min(1),
        teamId: z.string().optional(),
        autoSync: z.boolean().default(true),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      await verifyAdminAccess(userId, input.organizationId);

      const [mapping] = await db
        .insert(scimGroupMapping)
        .values({
          organizationId: input.organizationId,
          scimGroupId: input.scimGroupId,
          scimGroupName: input.scimGroupName,
          teamId: input.teamId,
          autoSync: input.autoSync,
        })
        .returning();

      return { mapping };
    }),

  /**
   * Delete SCIM group mapping (admin only).
   */
  deleteSCIMGroupMapping: protectedProcedure
    .input(
      z.object({
        organizationId: z.string().min(1),
        mappingId: z.string().min(1),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      await verifyAdminAccess(userId, input.organizationId);

      const mapping = await db.query.scimGroupMapping.findFirst({
        where: eq(scimGroupMapping.id, input.mappingId),
      });

      if (!mapping || mapping.organizationId !== input.organizationId) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "SCIM group mapping not found.",
        });
      }

      await db
        .delete(scimGroupMapping)
        .where(eq(scimGroupMapping.id, input.mappingId));

      return { success: true };
    }),
});
