import { randomUUID } from "node:crypto";
import { relations } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import { user } from "./auth";
import { organization, team } from "./organization";

// =============================================================================
// TYPE DEFINITIONS
// =============================================================================

/**
 * Organization-level feature flags
 */
export interface OrganizationFeatureFlags {
  sharedInboxEnabled: boolean;
  intelligenceSharingEnabled: boolean;
  customRolesEnabled: boolean;
  mentionsEnabled: boolean;
  commentsEnabled: boolean;
  presenceEnabled: boolean;
  activityFeedEnabled: boolean;
  delegationEnabled: boolean;
}

/**
 * Compliance and data retention settings
 */
export interface ComplianceSettings {
  gdprEnabled: boolean;
  hipaaEnabled: boolean;
  soc2Enabled: boolean;
  dataRetentionDays: number;
  auditLogRetentionDays: number;
  autoDeleteEnabled: boolean;
  legalHoldEnabled: boolean;
  exportFormat: "json" | "csv" | "both";
}

/**
 * AI feature configuration
 */
export interface AIFeatureSettings {
  draftingEnabled: boolean;
  triageEnabled: boolean;
  extractionEnabled: boolean;
  summarizationEnabled: boolean;
  riskAnalysisEnabled: boolean;
}

/**
 * SSO configuration (SAML/OIDC)
 */
export interface SSOConfig {
  // SAML settings
  entityId?: string;
  ssoUrl?: string;
  certificate?: string;
  // OIDC settings
  clientId?: string;
  clientSecret?: string;
  tenantId?: string;
  discoveryUrl?: string;
  // Attribute mapping
  attributeMapping?: {
    email?: string;
    name?: string;
    firstName?: string;
    lastName?: string;
    groups?: string;
  };
}

// =============================================================================
// ENUMS
// =============================================================================

/**
 * Default privacy policy for source accounts
 */
export const privacyPolicyEnum = pgEnum("privacy_policy", [
  "private", // All data private by default
  "team_visible", // Visible within teams
  "org_visible", // Visible across organization
]);

/**
 * SSO provider types
 */
export const ssoProviderEnum = pgEnum("sso_provider", [
  "okta",
  "azure_ad",
  "google_workspace",
  "onelogin",
  "jumpcloud",
  "custom_saml",
  "custom_oidc",
]);

/**
 * Assignment method for shared inboxes
 */
export const assignmentMethodEnum = pgEnum("assignment_method", [
  "round_robin", // Equal distribution in order
  "load_balanced", // Based on current workload
  "manual_only", // No auto-assignment
  "skills_based", // Match based on skills
]);

// =============================================================================
// ORGANIZATION SETTINGS TABLE
// =============================================================================

/**
 * Organization-level settings for multiplayer, enterprise, and compliance features.
 */
export const organizationSettings = pgTable(
  "organization_settings",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => randomUUID()),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" })
      .unique(),

    // ==========================================================================
    // PRIVACY SETTINGS
    // ==========================================================================

    // Default privacy policy for new source accounts
    defaultPrivacyPolicy: privacyPolicyEnum("default_privacy_policy")
      .notNull()
      .default("team_visible"),

    // Allow users to override the default privacy policy
    allowPrivacyOverride: boolean("allow_privacy_override")
      .notNull()
      .default(true),

    // Allow members to connect personal accounts
    allowPersonalAccounts: boolean("allow_personal_accounts")
      .notNull()
      .default(true),

    // ==========================================================================
    // SHARED INBOX SETTINGS
    // ==========================================================================

    // Enable shared inbox functionality
    sharedInboxEnabled: boolean("shared_inbox_enabled").notNull().default(false),

    // Default assignment method for shared inboxes
    defaultAssignmentMethod: assignmentMethodEnum("default_assignment_method")
      .notNull()
      .default("round_robin"),

    // Enable automatic assignment
    autoAssignEnabled: boolean("auto_assign_enabled").notNull().default(true),

    // Skip away members in round-robin
    roundRobinSkipAway: boolean("round_robin_skip_away").notNull().default(true),

    // Maximum concurrent assignments per member (default)
    maxConcurrentAssignments: integer("max_concurrent_assignments")
      .notNull()
      .default(10),

    // ==========================================================================
    // INTELLIGENCE SHARING SETTINGS
    // ==========================================================================

    // Auto-share commitments when they involve teammates
    autoShareCommitments: boolean("auto_share_commitments")
      .notNull()
      .default(true),

    // Auto-share decisions when they involve teammates
    autoShareDecisions: boolean("auto_share_decisions").notNull().default(true),

    // Auto-share when someone is @mentioned
    autoShareOnMention: boolean("auto_share_on_mention").notNull().default(true),

    // ==========================================================================
    // SECURITY SETTINGS
    // ==========================================================================

    // Require SSO for all users
    ssoRequired: boolean("sso_required").notNull().default(false),

    // Require MFA for all users
    mfaRequired: boolean("mfa_required").notNull().default(false),

    // Allowed email domains (empty = all allowed)
    allowedEmailDomains: text("allowed_email_domains").array().default([]),

    // Session timeout in minutes
    sessionTimeoutMinutes: integer("session_timeout_minutes")
      .notNull()
      .default(10080), // 7 days

    // IP allowlist (empty = all allowed)
    ipAllowlist: text("ip_allowlist").array().default([]),

    // ==========================================================================
    // SSO CONFIGURATION
    // ==========================================================================

    // Enable SSO
    ssoEnabled: boolean("sso_enabled").notNull().default(false),

    // SSO provider type
    ssoProvider: ssoProviderEnum("sso_provider"),

    // SSO configuration (SAML/OIDC settings)
    ssoConfig: jsonb("sso_config").$type<SSOConfig>(),

    // Enforce SSO (disable other login methods)
    ssoEnforced: boolean("sso_enforced").notNull().default(false),

    // ==========================================================================
    // SCIM PROVISIONING
    // ==========================================================================

    // Enable SCIM provisioning
    scimEnabled: boolean("scim_enabled").notNull().default(false),

    // SCIM bearer token (hashed)
    scimTokenHash: text("scim_token_hash"),

    // SCIM token prefix (for identification)
    scimTokenPrefix: text("scim_token_prefix"),

    // SCIM endpoint (auto-generated)
    scimEndpoint: text("scim_endpoint"),

    // Last SCIM sync timestamp
    scimLastSyncAt: timestamp("scim_last_sync_at"),

    // ==========================================================================
    // DATA SETTINGS
    // ==========================================================================

    // Data retention in days (0 = forever)
    dataRetentionDays: integer("data_retention_days").notNull().default(0),

    // Allow data export
    allowDataExport: boolean("allow_data_export").notNull().default(true),

    // Allowed integrations (empty = all allowed)
    allowedIntegrations: text("allowed_integrations").array().default([]),

    // ==========================================================================
    // FEATURE FLAGS
    // ==========================================================================

    featureFlags: jsonb("feature_flags")
      .$type<OrganizationFeatureFlags>()
      .default({
        sharedInboxEnabled: false,
        intelligenceSharingEnabled: true,
        customRolesEnabled: false,
        mentionsEnabled: true,
        commentsEnabled: true,
        presenceEnabled: true,
        activityFeedEnabled: true,
        delegationEnabled: false,
      }),

    // ==========================================================================
    // AI FEATURES
    // ==========================================================================

    aiFeatures: jsonb("ai_features").$type<AIFeatureSettings>().default({
      draftingEnabled: true,
      triageEnabled: true,
      extractionEnabled: true,
      summarizationEnabled: true,
      riskAnalysisEnabled: true,
    }),

    // ==========================================================================
    // COMPLIANCE SETTINGS
    // ==========================================================================

    complianceSettings: jsonb("compliance_settings")
      .$type<ComplianceSettings>()
      .default({
        gdprEnabled: false,
        hipaaEnabled: false,
        soc2Enabled: false,
        dataRetentionDays: 365,
        auditLogRetentionDays: 90,
        autoDeleteEnabled: false,
        legalHoldEnabled: false,
        exportFormat: "json",
      }),

    // ==========================================================================
    // TIMESTAMPS
    // ==========================================================================

    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index("org_settings_org_idx").on(table.organizationId),
    index("org_settings_sso_enabled_idx").on(table.ssoEnabled),
    index("org_settings_scim_enabled_idx").on(table.scimEnabled),
  ]
);

// =============================================================================
// SSO IDENTITY TABLE
// =============================================================================

/**
 * Links users to their SSO provider identities.
 * Enables JIT provisioning and group sync.
 */
export const ssoIdentity = pgTable(
  "sso_identity",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => randomUUID()),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),

    // SSO provider identification
    provider: ssoProviderEnum("provider").notNull(),
    providerUserId: text("provider_user_id").notNull(), // External ID from IdP

    // SAML/OIDC attributes from provider
    attributes: jsonb("attributes").$type<Record<string, unknown>>(),

    // Group memberships from IdP
    providerGroups: text("provider_groups").array().default([]),

    // Session tracking
    lastLoginAt: timestamp("last_login_at"),
    lastLoginIp: text("last_login_ip"),
    lastLoginUserAgent: text("last_login_user_agent"),

    // Timestamps
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index("sso_identity_org_idx").on(table.organizationId),
    index("sso_identity_user_idx").on(table.userId),
    index("sso_identity_provider_user_idx").on(
      table.provider,
      table.providerUserId
    ),
  ]
);

// =============================================================================
// SCIM GROUP MAPPING TABLE
// =============================================================================

/**
 * Maps external SCIM groups to internal teams and roles.
 * Enables automatic team/role assignment based on IdP groups.
 */
export const scimGroupMapping = pgTable(
  "scim_group_mapping",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => randomUUID()),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),

    // External SCIM group info
    scimGroupId: text("scim_group_id").notNull(),
    scimGroupName: text("scim_group_name").notNull(),

    // Internal mapping targets (at least one should be set)
    teamId: text("team_id").references(() => team.id, { onDelete: "set null" }),
    // Note: roleId will reference customRole table once created

    // Auto-sync settings
    autoSync: boolean("auto_sync").notNull().default(true),
    lastSyncAt: timestamp("last_sync_at"),
    lastSyncStatus: text("last_sync_status"),
    lastSyncError: text("last_sync_error"),

    // Timestamps
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index("scim_group_org_idx").on(table.organizationId),
    index("scim_group_scim_id_idx").on(table.scimGroupId),
    index("scim_group_team_idx").on(table.teamId),
  ]
);

// =============================================================================
// RELATIONS
// =============================================================================

export const organizationSettingsRelations = relations(
  organizationSettings,
  ({ one }) => ({
    organization: one(organization, {
      fields: [organizationSettings.organizationId],
      references: [organization.id],
    }),
  })
);

export const ssoIdentityRelations = relations(ssoIdentity, ({ one }) => ({
  organization: one(organization, {
    fields: [ssoIdentity.organizationId],
    references: [organization.id],
  }),
  user: one(user, {
    fields: [ssoIdentity.userId],
    references: [user.id],
  }),
}));

export const scimGroupMappingRelations = relations(
  scimGroupMapping,
  ({ one }) => ({
    organization: one(organization, {
      fields: [scimGroupMapping.organizationId],
      references: [organization.id],
    }),
    team: one(team, {
      fields: [scimGroupMapping.teamId],
      references: [team.id],
    }),
  })
);

// =============================================================================
// TYPE EXPORTS
// =============================================================================

export type OrganizationSettings = typeof organizationSettings.$inferSelect;
export type NewOrganizationSettings = typeof organizationSettings.$inferInsert;
export type SSOIdentity = typeof ssoIdentity.$inferSelect;
export type NewSSOIdentity = typeof ssoIdentity.$inferInsert;
export type ScimGroupMapping = typeof scimGroupMapping.$inferSelect;
export type NewScimGroupMapping = typeof scimGroupMapping.$inferInsert;

// Privacy policy type union
export type PrivacyPolicy = "private" | "team_visible" | "org_visible";

// SSO provider type union
export type SSOProvider =
  | "okta"
  | "azure_ad"
  | "google_workspace"
  | "onelogin"
  | "jumpcloud"
  | "custom_saml"
  | "custom_oidc";

// Assignment method type union
export type AssignmentMethod =
  | "round_robin"
  | "load_balanced"
  | "manual_only"
  | "skills_based";
