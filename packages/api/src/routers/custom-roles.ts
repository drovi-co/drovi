// =============================================================================
// CUSTOM ROLES ROUTER
// =============================================================================
//
// API routes for custom role management including:
// - Role CRUD operations
// - Role assignment to members
// - Permission checking
//

import { db } from "@memorystack/db";
import {
  customRole,
  DEFAULT_PERMISSIONS,
  member,
  memberRoleAssignment,
  type PermissionPath,
  type PermissionSet,
} from "@memorystack/db/schema";
import { TRPCError } from "@trpc/server";
import { and, asc, eq, gte, or, sql } from "drizzle-orm";
import { z } from "zod";
import { protectedProcedure, router } from "../index";

// =============================================================================
// INPUT SCHEMAS
// =============================================================================

const permissionSetSchema = z.object({
  org: z.object({
    read: z.boolean(),
    update: z.boolean(),
    delete: z.boolean(),
    manageMembers: z.boolean(),
    manageTeams: z.boolean(),
    manageBilling: z.boolean(),
    manageSettings: z.boolean(),
    viewAuditLogs: z.boolean(),
  }),
  intelligence: z.object({
    viewOwn: z.boolean(),
    viewTeam: z.boolean(),
    viewAll: z.boolean(),
    create: z.boolean(),
    edit: z.boolean(),
    delete: z.boolean(),
    share: z.boolean(),
    export: z.boolean(),
  }),
  sharedInbox: z.object({
    view: z.boolean(),
    claim: z.boolean(),
    assign: z.boolean(),
    resolve: z.boolean(),
    manageSettings: z.boolean(),
  }),
  contacts: z.object({
    viewOwn: z.boolean(),
    viewAll: z.boolean(),
    edit: z.boolean(),
    delete: z.boolean(),
    export: z.boolean(),
    merge: z.boolean(),
  }),
  integrations: z.object({
    viewConnections: z.boolean(),
    manageConnections: z.boolean(),
    viewApiKeys: z.boolean(),
    manageApiKeys: z.boolean(),
    manageWebhooks: z.boolean(),
  }),
  admin: z.object({
    impersonate: z.boolean(),
    manageRoles: z.boolean(),
    manageSSO: z.boolean(),
    manageSCIM: z.boolean(),
    viewAllData: z.boolean(),
  }),
  collaboration: z.object({
    mention: z.boolean(),
    comment: z.boolean(),
    createActivity: z.boolean(),
    delegate: z.boolean(),
  }),
});

// =============================================================================
// HELPERS
// =============================================================================

async function verifyOrgMembership(
  userId: string,
  organizationId: string
): Promise<{ role: string; memberId: string }> {
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

  return { role: membership.role, memberId: membership.id };
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

async function verifyRoleAccess(
  organizationId: string,
  roleId: string
): Promise<typeof customRole.$inferSelect> {
  const role = await db.query.customRole.findFirst({
    where: eq(customRole.id, roleId),
  });

  if (!role || role.organizationId !== organizationId) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Role not found.",
    });
  }

  return role;
}

function generateSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

/**
 * Get effective permissions for a member by combining base role + custom roles.
 * Uses OR logic: if any role grants a permission, it's granted.
 */
async function getEffectivePermissions(
  memberId: string,
  baseRole: string
): Promise<PermissionSet> {
  // Start with base role permissions
  const basePermissions =
    DEFAULT_PERMISSIONS[baseRole] ?? DEFAULT_PERMISSIONS.member;

  // Get all active custom role assignments for this member
  const assignments = await db.query.memberRoleAssignment.findMany({
    where: and(
      eq(memberRoleAssignment.memberId, memberId),
      or(
        eq(memberRoleAssignment.expiresAt, sql`NULL`),
        gte(memberRoleAssignment.expiresAt, new Date())
      )
    ),
    with: {
      customRole: true,
    },
  });

  // Start with a deep copy of base permissions
  const effective: PermissionSet = JSON.parse(JSON.stringify(basePermissions));

  // Merge in custom role permissions (OR logic)
  for (const assignment of assignments) {
    if (!assignment.customRole?.permissions) {
      continue;
    }
    const rolePerms = assignment.customRole.permissions;

    // Merge each category
    for (const category of Object.keys(effective) as Array<
      keyof PermissionSet
    >) {
      for (const perm of Object.keys(effective[category]) as Array<
        keyof PermissionSet[typeof category]
      >) {
        // Use OR logic - if any role grants it, it's granted
        if (
          rolePerms[category] &&
          (rolePerms[category] as Record<string, boolean>)[perm]
        ) {
          (effective[category] as Record<string, boolean>)[perm] = true;
        }
      }
    }
  }

  return effective;
}

/**
 * Check if a member has a specific permission.
 */
async function hasPermission(
  userId: string,
  organizationId: string,
  permissionPath: PermissionPath
): Promise<boolean> {
  const { role, memberId } = await verifyOrgMembership(userId, organizationId);

  const permissions = await getEffectivePermissions(memberId, role);

  const [category, permission] = permissionPath.split(".") as [
    keyof PermissionSet,
    string,
  ];

  return (
    (permissions[category] as Record<string, boolean>)?.[permission] ?? false
  );
}

// =============================================================================
// ROUTER
// =============================================================================

export const customRolesRouter = router({
  // ===========================================================================
  // ROLE CRUD
  // ===========================================================================

  /**
   * List custom roles for the organization.
   */
  list: protectedProcedure
    .input(z.object({ organizationId: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      await verifyOrgMembership(userId, input.organizationId);

      const roles = await db.query.customRole.findMany({
        where: and(
          eq(customRole.organizationId, input.organizationId),
          eq(customRole.isActive, true)
        ),
        orderBy: [asc(customRole.priority), asc(customRole.name)],
        with: {
          createdByUser: {
            columns: {
              id: true,
              name: true,
              email: true,
            },
          },
        },
      });

      // Also include default role permissions for reference
      return {
        roles,
        defaultRoles: Object.entries(DEFAULT_PERMISSIONS).map(
          ([name, permissions]) => ({
            name,
            slug: name,
            permissions,
            isSystemRole: true,
          })
        ),
      };
    }),

  /**
   * Get a single role by ID.
   */
  getById: protectedProcedure
    .input(
      z.object({
        organizationId: z.string().min(1),
        roleId: z.string().min(1),
      })
    )
    .query(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      await verifyOrgMembership(userId, input.organizationId);

      const role = await verifyRoleAccess(input.organizationId, input.roleId);

      return { role };
    }),

  /**
   * Create a new custom role.
   */
  create: protectedProcedure
    .input(
      z.object({
        organizationId: z.string().min(1),
        name: z.string().min(1).max(50),
        description: z.string().max(200).optional(),
        basedOnRole: z.enum(["owner", "admin", "member", "viewer"]).optional(),
        permissions: permissionSetSchema,
        color: z
          .string()
          .regex(/^#[0-9A-Fa-f]{6}$/)
          .optional(),
        icon: z.string().max(50).optional(),
        isDefault: z.boolean().default(false),
        priority: z.number().int().min(0).max(1000).default(0),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      await verifyAdminAccess(userId, input.organizationId);

      const slug = generateSlug(input.name);

      // Check for duplicate slug
      const existing = await db.query.customRole.findFirst({
        where: and(
          eq(customRole.organizationId, input.organizationId),
          eq(customRole.slug, slug)
        ),
      });

      if (existing) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "A role with this name already exists.",
        });
      }

      // If setting as default, unset other defaults
      if (input.isDefault) {
        await db
          .update(customRole)
          .set({ isDefault: false, updatedAt: new Date() })
          .where(
            and(
              eq(customRole.organizationId, input.organizationId),
              eq(customRole.isDefault, true)
            )
          );
      }

      const [newRole] = await db
        .insert(customRole)
        .values({
          organizationId: input.organizationId,
          name: input.name,
          slug,
          description: input.description,
          basedOnRole: input.basedOnRole,
          permissions: input.permissions,
          color: input.color,
          icon: input.icon,
          isDefault: input.isDefault,
          priority: input.priority,
          createdByUserId: userId,
        })
        .returning();

      return { role: newRole };
    }),

  /**
   * Update a custom role.
   */
  update: protectedProcedure
    .input(
      z.object({
        organizationId: z.string().min(1),
        roleId: z.string().min(1),
        name: z.string().min(1).max(50).optional(),
        description: z.string().max(200).optional(),
        permissions: permissionSetSchema.optional(),
        color: z
          .string()
          .regex(/^#[0-9A-Fa-f]{6}$/)
          .nullable()
          .optional(),
        icon: z.string().max(50).nullable().optional(),
        isDefault: z.boolean().optional(),
        priority: z.number().int().min(0).max(1000).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      await verifyAdminAccess(userId, input.organizationId);
      const role = await verifyRoleAccess(input.organizationId, input.roleId);

      if (role.isSystemRole) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "System roles cannot be modified.",
        });
      }

      const updates: Partial<typeof customRole.$inferInsert> = {
        updatedAt: new Date(),
        lastModifiedByUserId: userId,
      };

      if (input.name !== undefined) {
        updates.name = input.name;
        updates.slug = generateSlug(input.name);

        // Check for duplicate slug
        const existing = await db.query.customRole.findFirst({
          where: and(
            eq(customRole.organizationId, input.organizationId),
            eq(customRole.slug, updates.slug)
          ),
        });

        if (existing && existing.id !== input.roleId) {
          throw new TRPCError({
            code: "CONFLICT",
            message: "A role with this name already exists.",
          });
        }
      }

      if (input.description !== undefined) {
        updates.description = input.description;
      }
      if (input.permissions !== undefined) {
        updates.permissions = input.permissions;
      }
      if (input.color !== undefined) {
        updates.color = input.color;
      }
      if (input.icon !== undefined) {
        updates.icon = input.icon;
      }
      if (input.priority !== undefined) {
        updates.priority = input.priority;
      }

      // Handle isDefault change
      if (input.isDefault !== undefined) {
        if (input.isDefault) {
          // Unset other defaults
          await db
            .update(customRole)
            .set({ isDefault: false, updatedAt: new Date() })
            .where(
              and(
                eq(customRole.organizationId, input.organizationId),
                eq(customRole.isDefault, true)
              )
            );
        }
        updates.isDefault = input.isDefault;
      }

      await db
        .update(customRole)
        .set(updates)
        .where(eq(customRole.id, input.roleId));

      return { success: true };
    }),

  /**
   * Delete a custom role.
   */
  delete: protectedProcedure
    .input(
      z.object({
        organizationId: z.string().min(1),
        roleId: z.string().min(1),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      await verifyAdminAccess(userId, input.organizationId);
      const role = await verifyRoleAccess(input.organizationId, input.roleId);

      if (role.isSystemRole) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "System roles cannot be deleted.",
        });
      }

      // Soft delete - mark as inactive
      await db
        .update(customRole)
        .set({ isActive: false, updatedAt: new Date() })
        .where(eq(customRole.id, input.roleId));

      return { success: true };
    }),

  // ===========================================================================
  // ROLE ASSIGNMENT
  // ===========================================================================

  /**
   * Assign a custom role to a member.
   */
  assignToMember: protectedProcedure
    .input(
      z.object({
        organizationId: z.string().min(1),
        memberId: z.string().min(1),
        roleId: z.string().min(1),
        scopeType: z.enum(["organization", "team"]).default("organization"),
        scopeTeamId: z.string().optional(),
        assignmentNote: z.string().max(200).optional(),
        expiresAt: z.date().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      await verifyAdminAccess(userId, input.organizationId);
      await verifyRoleAccess(input.organizationId, input.roleId);

      // Verify member exists and belongs to org
      const memberRecord = await db.query.member.findFirst({
        where: eq(member.id, input.memberId),
      });

      if (
        !memberRecord ||
        memberRecord.organizationId !== input.organizationId
      ) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Member not found.",
        });
      }

      // Check for existing assignment
      const existing = await db.query.memberRoleAssignment.findFirst({
        where: and(
          eq(memberRoleAssignment.memberId, input.memberId),
          eq(memberRoleAssignment.customRoleId, input.roleId),
          eq(memberRoleAssignment.scopeType, input.scopeType),
          input.scopeTeamId
            ? eq(memberRoleAssignment.scopeTeamId, input.scopeTeamId)
            : sql`${memberRoleAssignment.scopeTeamId} IS NULL`
        ),
      });

      if (existing) {
        // Update existing assignment
        await db
          .update(memberRoleAssignment)
          .set({
            assignmentNote: input.assignmentNote,
            expiresAt: input.expiresAt,
            updatedAt: new Date(),
          })
          .where(eq(memberRoleAssignment.id, existing.id));

        return { success: true, assignmentId: existing.id, updated: true };
      }

      const [assignment] = await db
        .insert(memberRoleAssignment)
        .values({
          memberId: input.memberId,
          customRoleId: input.roleId,
          scopeType: input.scopeType,
          scopeTeamId: input.scopeTeamId,
          assignedByUserId: userId,
          assignmentNote: input.assignmentNote,
          expiresAt: input.expiresAt,
        })
        .returning();

      // Update role member count
      await db
        .update(customRole)
        .set({
          memberCount: sql`${customRole.memberCount} + 1`,
          updatedAt: new Date(),
        })
        .where(eq(customRole.id, input.roleId));

      return { success: true, assignmentId: assignment?.id };
    }),

  /**
   * Remove a custom role from a member.
   */
  removeFromMember: protectedProcedure
    .input(
      z.object({
        organizationId: z.string().min(1),
        assignmentId: z.string().min(1),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      await verifyAdminAccess(userId, input.organizationId);

      const assignment = await db.query.memberRoleAssignment.findFirst({
        where: eq(memberRoleAssignment.id, input.assignmentId),
        with: {
          customRole: true,
          member: true,
        },
      });

      if (!assignment) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Assignment not found.",
        });
      }

      if (assignment.member?.organizationId !== input.organizationId) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Assignment does not belong to this organization.",
        });
      }

      await db
        .delete(memberRoleAssignment)
        .where(eq(memberRoleAssignment.id, input.assignmentId));

      // Update role member count
      await db
        .update(customRole)
        .set({
          memberCount: sql`GREATEST(${customRole.memberCount} - 1, 0)`,
          updatedAt: new Date(),
        })
        .where(eq(customRole.id, assignment.customRoleId));

      return { success: true };
    }),

  /**
   * Get role assignments for a member.
   */
  getMemberRoles: protectedProcedure
    .input(
      z.object({
        organizationId: z.string().min(1),
        memberId: z.string().min(1),
      })
    )
    .query(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      await verifyOrgMembership(userId, input.organizationId);

      // Verify member belongs to org
      const memberRecord = await db.query.member.findFirst({
        where: eq(member.id, input.memberId),
      });

      if (
        !memberRecord ||
        memberRecord.organizationId !== input.organizationId
      ) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Member not found.",
        });
      }

      const assignments = await db.query.memberRoleAssignment.findMany({
        where: eq(memberRoleAssignment.memberId, input.memberId),
        with: {
          customRole: true,
          scopeTeam: {
            columns: {
              id: true,
              name: true,
            },
          },
          assignedByUser: {
            columns: {
              id: true,
              name: true,
              email: true,
            },
          },
        },
      });

      return { assignments };
    }),

  /**
   * Get members with a specific role.
   */
  getRoleMembers: protectedProcedure
    .input(
      z.object({
        organizationId: z.string().min(1),
        roleId: z.string().min(1),
      })
    )
    .query(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      await verifyOrgMembership(userId, input.organizationId);
      await verifyRoleAccess(input.organizationId, input.roleId);

      const assignments = await db.query.memberRoleAssignment.findMany({
        where: eq(memberRoleAssignment.customRoleId, input.roleId),
        with: {
          member: {
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
          },
          scopeTeam: {
            columns: {
              id: true,
              name: true,
            },
          },
        },
      });

      return { assignments };
    }),

  // ===========================================================================
  // PERMISSION CHECKING
  // ===========================================================================

  /**
   * Get my effective permissions.
   */
  getMyPermissions: protectedProcedure
    .input(z.object({ organizationId: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      const { role, memberId } = await verifyOrgMembership(
        userId,
        input.organizationId
      );

      const permissions = await getEffectivePermissions(memberId, role);

      return { permissions, baseRole: role };
    }),

  /**
   * Check if I have a specific permission.
   */
  checkPermission: protectedProcedure
    .input(
      z.object({
        organizationId: z.string().min(1),
        permission: z.string() as z.ZodType<PermissionPath>,
      })
    )
    .query(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;

      const hasAccess = await hasPermission(
        userId,
        input.organizationId,
        input.permission
      );

      return { hasPermission: hasAccess };
    }),

  /**
   * Get effective permissions for a specific member (admin only).
   */
  getMemberPermissions: protectedProcedure
    .input(
      z.object({
        organizationId: z.string().min(1),
        memberId: z.string().min(1),
      })
    )
    .query(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      await verifyAdminAccess(userId, input.organizationId);

      const memberRecord = await db.query.member.findFirst({
        where: eq(member.id, input.memberId),
      });

      if (
        !memberRecord ||
        memberRecord.organizationId !== input.organizationId
      ) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Member not found.",
        });
      }

      const permissions = await getEffectivePermissions(
        input.memberId,
        memberRecord.role
      );

      return { permissions, baseRole: memberRecord.role };
    }),
});
