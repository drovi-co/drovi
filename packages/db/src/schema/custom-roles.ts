import { randomUUID } from "node:crypto";
import { relations } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
} from "drizzle-orm/pg-core";
import { user } from "./auth";
import { member, organization, team } from "./organization";

// =============================================================================
// TYPE DEFINITIONS
// =============================================================================

/**
 * Granular permission definitions for custom roles.
 * Each category contains specific actions that can be permitted or denied.
 */
export interface PermissionSet {
  // Organization-level permissions
  org: {
    read: boolean;
    update: boolean;
    delete: boolean;
    manageMembers: boolean;
    manageTeams: boolean;
    manageBilling: boolean;
    manageSettings: boolean;
    viewAuditLogs: boolean;
  };

  // Intelligence object permissions
  intelligence: {
    viewOwn: boolean; // View objects they own/created
    viewTeam: boolean; // View objects shared with their team
    viewAll: boolean; // View all objects in organization
    create: boolean;
    edit: boolean;
    delete: boolean;
    share: boolean;
    export: boolean;
  };

  // Shared inbox permissions
  sharedInbox: {
    view: boolean;
    claim: boolean;
    assign: boolean;
    resolve: boolean;
    manageSettings: boolean;
  };

  // Contact permissions
  contacts: {
    viewOwn: boolean;
    viewAll: boolean;
    edit: boolean;
    delete: boolean;
    export: boolean;
    merge: boolean;
  };

  // API & integrations
  integrations: {
    viewConnections: boolean;
    manageConnections: boolean;
    viewApiKeys: boolean;
    manageApiKeys: boolean;
    manageWebhooks: boolean;
  };

  // Admin permissions
  admin: {
    impersonate: boolean;
    manageRoles: boolean;
    manageSSO: boolean;
    manageSCIM: boolean;
    viewAllData: boolean;
  };

  // Collaboration permissions
  collaboration: {
    mention: boolean;
    comment: boolean;
    createActivity: boolean;
    delegate: boolean;
  };
}

/**
 * Default permission sets for base roles
 */
export const DEFAULT_PERMISSIONS: Record<string, PermissionSet> = {
  owner: {
    org: {
      read: true,
      update: true,
      delete: true,
      manageMembers: true,
      manageTeams: true,
      manageBilling: true,
      manageSettings: true,
      viewAuditLogs: true,
    },
    intelligence: {
      viewOwn: true,
      viewTeam: true,
      viewAll: true,
      create: true,
      edit: true,
      delete: true,
      share: true,
      export: true,
    },
    sharedInbox: {
      view: true,
      claim: true,
      assign: true,
      resolve: true,
      manageSettings: true,
    },
    contacts: {
      viewOwn: true,
      viewAll: true,
      edit: true,
      delete: true,
      export: true,
      merge: true,
    },
    integrations: {
      viewConnections: true,
      manageConnections: true,
      viewApiKeys: true,
      manageApiKeys: true,
      manageWebhooks: true,
    },
    admin: {
      impersonate: true,
      manageRoles: true,
      manageSSO: true,
      manageSCIM: true,
      viewAllData: true,
    },
    collaboration: {
      mention: true,
      comment: true,
      createActivity: true,
      delegate: true,
    },
  },
  admin: {
    org: {
      read: true,
      update: true,
      delete: false,
      manageMembers: true,
      manageTeams: true,
      manageBilling: true,
      manageSettings: true,
      viewAuditLogs: true,
    },
    intelligence: {
      viewOwn: true,
      viewTeam: true,
      viewAll: true,
      create: true,
      edit: true,
      delete: true,
      share: true,
      export: true,
    },
    sharedInbox: {
      view: true,
      claim: true,
      assign: true,
      resolve: true,
      manageSettings: true,
    },
    contacts: {
      viewOwn: true,
      viewAll: true,
      edit: true,
      delete: false,
      export: true,
      merge: true,
    },
    integrations: {
      viewConnections: true,
      manageConnections: true,
      viewApiKeys: true,
      manageApiKeys: true,
      manageWebhooks: true,
    },
    admin: {
      impersonate: false,
      manageRoles: true,
      manageSSO: true,
      manageSCIM: true,
      viewAllData: true,
    },
    collaboration: {
      mention: true,
      comment: true,
      createActivity: true,
      delegate: true,
    },
  },
  member: {
    org: {
      read: true,
      update: false,
      delete: false,
      manageMembers: false,
      manageTeams: false,
      manageBilling: false,
      manageSettings: false,
      viewAuditLogs: false,
    },
    intelligence: {
      viewOwn: true,
      viewTeam: true,
      viewAll: false,
      create: true,
      edit: true,
      delete: false,
      share: true,
      export: true,
    },
    sharedInbox: {
      view: true,
      claim: true,
      assign: false,
      resolve: true,
      manageSettings: false,
    },
    contacts: {
      viewOwn: true,
      viewAll: false,
      edit: true,
      delete: false,
      export: false,
      merge: false,
    },
    integrations: {
      viewConnections: true,
      manageConnections: false,
      viewApiKeys: false,
      manageApiKeys: false,
      manageWebhooks: false,
    },
    admin: {
      impersonate: false,
      manageRoles: false,
      manageSSO: false,
      manageSCIM: false,
      viewAllData: false,
    },
    collaboration: {
      mention: true,
      comment: true,
      createActivity: true,
      delegate: false,
    },
  },
  viewer: {
    org: {
      read: true,
      update: false,
      delete: false,
      manageMembers: false,
      manageTeams: false,
      manageBilling: false,
      manageSettings: false,
      viewAuditLogs: false,
    },
    intelligence: {
      viewOwn: true,
      viewTeam: true,
      viewAll: false,
      create: false,
      edit: false,
      delete: false,
      share: false,
      export: false,
    },
    sharedInbox: {
      view: true,
      claim: false,
      assign: false,
      resolve: false,
      manageSettings: false,
    },
    contacts: {
      viewOwn: true,
      viewAll: false,
      edit: false,
      delete: false,
      export: false,
      merge: false,
    },
    integrations: {
      viewConnections: false,
      manageConnections: false,
      viewApiKeys: false,
      manageApiKeys: false,
      manageWebhooks: false,
    },
    admin: {
      impersonate: false,
      manageRoles: false,
      manageSSO: false,
      manageSCIM: false,
      viewAllData: false,
    },
    collaboration: {
      mention: false,
      comment: true,
      createActivity: false,
      delegate: false,
    },
  },
};

// =============================================================================
// CUSTOM ROLE TABLE
// =============================================================================

/**
 * Custom permission roles that can be created per organization.
 * Extends beyond the base roles (owner, admin, member, viewer).
 */
export const customRole = pgTable(
  "custom_role",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => randomUUID()),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),

    // ==========================================================================
    // ROLE IDENTITY
    // ==========================================================================

    name: text("name").notNull(),
    slug: text("slug").notNull(),
    description: text("description"),

    // UI customization
    color: text("color"), // Hex color for badges
    icon: text("icon"), // Icon name

    // ==========================================================================
    // PERMISSIONS
    // ==========================================================================

    // Full permission set
    permissions: jsonb("permissions").$type<PermissionSet>().notNull(),

    // ==========================================================================
    // HIERARCHY
    // ==========================================================================

    // Base role this was derived from (for understanding context)
    basedOnRole: text("based_on_role"), // "owner" | "admin" | "member" | "viewer" | custom role ID

    // Priority for conflict resolution (higher = more permissions in conflict)
    priority: integer("priority").notNull().default(0),

    // ==========================================================================
    // STATUS
    // ==========================================================================

    // System roles can't be deleted or modified
    isSystemRole: boolean("is_system_role").notNull().default(false),

    // Is this the default role for new members?
    isDefault: boolean("is_default").notNull().default(false),

    // Is this role active?
    isActive: boolean("is_active").notNull().default(true),

    // ==========================================================================
    // STATS
    // ==========================================================================

    memberCount: integer("member_count").notNull().default(0),

    // ==========================================================================
    // AUDIT
    // ==========================================================================

    createdByUserId: text("created_by_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    lastModifiedByUserId: text("last_modified_by_user_id").references(
      () => user.id,
      { onDelete: "set null" }
    ),

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
    index("custom_role_org_idx").on(table.organizationId),
    index("custom_role_slug_idx").on(table.slug),
    index("custom_role_active_idx").on(table.isActive),
    index("custom_role_default_idx").on(table.isDefault),
    unique("custom_role_org_slug_unique").on(table.organizationId, table.slug),
  ]
);

// =============================================================================
// MEMBER ROLE ASSIGNMENT TABLE
// =============================================================================

/**
 * Assigns custom roles to organization members.
 * A member can have multiple roles, and roles can be scoped to teams.
 */
export const memberRoleAssignment = pgTable(
  "member_role_assignment",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => randomUUID()),

    // The member receiving the role
    memberId: text("member_id")
      .notNull()
      .references(() => member.id, { onDelete: "cascade" }),

    // The custom role being assigned
    customRoleId: text("custom_role_id")
      .notNull()
      .references(() => customRole.id, { onDelete: "cascade" }),

    // ==========================================================================
    // SCOPE
    // ==========================================================================

    // Scope type: "organization" (full org) or "team" (specific team only)
    scopeType: text("scope_type").notNull().default("organization"),

    // Team ID if scoped to a specific team
    scopeTeamId: text("scope_team_id").references(() => team.id, {
      onDelete: "cascade",
    }),

    // ==========================================================================
    // AUDIT
    // ==========================================================================

    assignedByUserId: text("assigned_by_user_id").references(() => user.id, {
      onDelete: "set null",
    }),

    // Optional note about why this role was assigned
    assignmentNote: text("assignment_note"),

    // ==========================================================================
    // EXPIRATION
    // ==========================================================================

    // Optional expiration for temporary roles
    expiresAt: timestamp("expires_at"),

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
    index("member_role_member_idx").on(table.memberId),
    index("member_role_role_idx").on(table.customRoleId),
    index("member_role_scope_idx").on(table.scopeType, table.scopeTeamId),
    index("member_role_expires_idx").on(table.expiresAt),
    // Prevent duplicate assignments (same member, role, and scope)
    unique("member_role_unique").on(
      table.memberId,
      table.customRoleId,
      table.scopeType,
      table.scopeTeamId
    ),
  ]
);

// =============================================================================
// RELATIONS
// =============================================================================

export const customRoleRelations = relations(customRole, ({ one, many }) => ({
  organization: one(organization, {
    fields: [customRole.organizationId],
    references: [organization.id],
  }),
  createdByUser: one(user, {
    fields: [customRole.createdByUserId],
    references: [user.id],
    relationName: "createdByUser",
  }),
  lastModifiedByUser: one(user, {
    fields: [customRole.lastModifiedByUserId],
    references: [user.id],
    relationName: "lastModifiedByUser",
  }),
  assignments: many(memberRoleAssignment),
}));

export const memberRoleAssignmentRelations = relations(
  memberRoleAssignment,
  ({ one }) => ({
    member: one(member, {
      fields: [memberRoleAssignment.memberId],
      references: [member.id],
    }),
    customRole: one(customRole, {
      fields: [memberRoleAssignment.customRoleId],
      references: [customRole.id],
    }),
    scopeTeam: one(team, {
      fields: [memberRoleAssignment.scopeTeamId],
      references: [team.id],
    }),
    assignedByUser: one(user, {
      fields: [memberRoleAssignment.assignedByUserId],
      references: [user.id],
    }),
  })
);

// =============================================================================
// TYPE EXPORTS
// =============================================================================

export type CustomRole = typeof customRole.$inferSelect;
export type NewCustomRole = typeof customRole.$inferInsert;
export type MemberRoleAssignment = typeof memberRoleAssignment.$inferSelect;
export type NewMemberRoleAssignment = typeof memberRoleAssignment.$inferInsert;

// Permission path type for type-safe permission checks
export type PermissionPath =
  | `org.${keyof PermissionSet["org"]}`
  | `intelligence.${keyof PermissionSet["intelligence"]}`
  | `sharedInbox.${keyof PermissionSet["sharedInbox"]}`
  | `contacts.${keyof PermissionSet["contacts"]}`
  | `integrations.${keyof PermissionSet["integrations"]}`
  | `admin.${keyof PermissionSet["admin"]}`
  | `collaboration.${keyof PermissionSet["collaboration"]}`;
