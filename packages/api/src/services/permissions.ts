// =============================================================================
// PERMISSIONS SERVICE
// =============================================================================
//
// Service for checking user permissions based on base roles and custom roles.
// Implements a composable permissions system with OR logic for role merging.
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
import { and, eq, gte, isNull, or } from "drizzle-orm";

// =============================================================================
// TYPES
// =============================================================================

export interface PermissionCheckResult {
  granted: boolean;
  reason: string;
  sourceRole?: string;
  sourceRoleId?: string;
}

export interface UserPermissionContext {
  userId: string;
  organizationId: string;
  memberId: string;
  baseRole: string;
  effectivePermissions: PermissionSet;
}

// =============================================================================
// PERMISSION HELPERS
// =============================================================================

/**
 * Parse a permission path string into category and permission.
 */
function parsePermissionPath(path: PermissionPath): {
  category: keyof PermissionSet;
  permission: string;
} {
  const [category, permission] = path.split(".") as [keyof PermissionSet, string];
  return { category, permission };
}

/**
 * Get a permission value from a permission set.
 */
function getPermission(permissions: PermissionSet, path: PermissionPath): boolean {
  const { category, permission } = parsePermissionPath(path);
  const categoryPerms = permissions[category] as Record<string, boolean> | undefined;
  return categoryPerms?.[permission] ?? false;
}

// =============================================================================
// PERMISSION RESOLUTION
// =============================================================================

/**
 * Get the member record for a user in an organization.
 */
export async function getMemberRecord(
  userId: string,
  organizationId: string
): Promise<{ memberId: string; baseRole: string } | null> {
  const membership = await db.query.member.findFirst({
    where: and(
      eq(member.userId, userId),
      eq(member.organizationId, organizationId)
    ),
  });

  if (!membership) return null;

  return {
    memberId: membership.id,
    baseRole: membership.role,
  };
}

/**
 * Get all active custom role assignments for a member.
 */
export async function getActiveRoleAssignments(
  memberId: string
): Promise<Array<{ roleId: string; permissions: PermissionSet; roleName: string }>> {
  const assignments = await db.query.memberRoleAssignment.findMany({
    where: and(
      eq(memberRoleAssignment.memberId, memberId),
      or(
        isNull(memberRoleAssignment.expiresAt),
        gte(memberRoleAssignment.expiresAt, new Date())
      )
    ),
    with: {
      customRole: true,
    },
  });

  return assignments
    .filter((a) => a.customRole && a.customRole.isActive)
    .map((a) => ({
      roleId: a.customRole!.id,
      permissions: a.customRole!.permissions as PermissionSet,
      roleName: a.customRole!.name,
    }));
}

/**
 * Compute effective permissions by merging base role with custom roles.
 * Uses OR logic: if any role grants a permission, it's granted.
 */
export async function getEffectivePermissions(
  memberId: string,
  baseRole: string
): Promise<PermissionSet> {
  // Start with base role permissions
  const basePermissions =
    DEFAULT_PERMISSIONS[baseRole] ?? DEFAULT_PERMISSIONS.member;

  // Deep clone base permissions
  const effective: PermissionSet = JSON.parse(JSON.stringify(basePermissions));

  // Get custom role assignments
  const roleAssignments = await getActiveRoleAssignments(memberId);

  // Merge custom role permissions using OR logic
  for (const assignment of roleAssignments) {
    const rolePerms = assignment.permissions;

    // Iterate through all permission categories
    for (const category of Object.keys(effective) as Array<keyof PermissionSet>) {
      const effectiveCategory = effective[category] as Record<string, boolean>;
      const roleCategory = rolePerms[category] as Record<string, boolean> | undefined;

      if (!roleCategory) continue;

      // Merge each permission in the category
      for (const perm of Object.keys(effectiveCategory)) {
        if (roleCategory[perm] === true) {
          effectiveCategory[perm] = true;
        }
      }
    }
  }

  return effective;
}

/**
 * Get full permission context for a user.
 */
export async function getUserPermissionContext(
  userId: string,
  organizationId: string
): Promise<UserPermissionContext | null> {
  const memberRecord = await getMemberRecord(userId, organizationId);
  if (!memberRecord) return null;

  const effectivePermissions = await getEffectivePermissions(
    memberRecord.memberId,
    memberRecord.baseRole
  );

  return {
    userId,
    organizationId,
    memberId: memberRecord.memberId,
    baseRole: memberRecord.baseRole,
    effectivePermissions,
  };
}

// =============================================================================
// PERMISSION CHECKING
// =============================================================================

/**
 * Check if a user has a specific permission.
 */
export async function hasPermission(
  userId: string,
  organizationId: string,
  permissionPath: PermissionPath
): Promise<PermissionCheckResult> {
  const context = await getUserPermissionContext(userId, organizationId);

  if (!context) {
    return {
      granted: false,
      reason: "User is not a member of this organization",
    };
  }

  const granted = getPermission(context.effectivePermissions, permissionPath);

  if (granted) {
    return {
      granted: true,
      reason: `Permission ${permissionPath} granted`,
      sourceRole: context.baseRole,
    };
  }

  return {
    granted: false,
    reason: `Permission ${permissionPath} not granted`,
    sourceRole: context.baseRole,
  };
}

/**
 * Check multiple permissions at once.
 */
export async function hasAllPermissions(
  userId: string,
  organizationId: string,
  permissionPaths: PermissionPath[]
): Promise<{ granted: boolean; missingPermissions: PermissionPath[] }> {
  const context = await getUserPermissionContext(userId, organizationId);

  if (!context) {
    return { granted: false, missingPermissions: permissionPaths };
  }

  const missingPermissions: PermissionPath[] = [];

  for (const path of permissionPaths) {
    if (!getPermission(context.effectivePermissions, path)) {
      missingPermissions.push(path);
    }
  }

  return {
    granted: missingPermissions.length === 0,
    missingPermissions,
  };
}

/**
 * Check if user has any of the given permissions.
 */
export async function hasAnyPermission(
  userId: string,
  organizationId: string,
  permissionPaths: PermissionPath[]
): Promise<{ granted: boolean; grantedPermissions: PermissionPath[] }> {
  const context = await getUserPermissionContext(userId, organizationId);

  if (!context) {
    return { granted: false, grantedPermissions: [] };
  }

  const grantedPermissions: PermissionPath[] = [];

  for (const path of permissionPaths) {
    if (getPermission(context.effectivePermissions, path)) {
      grantedPermissions.push(path);
    }
  }

  return {
    granted: grantedPermissions.length > 0,
    grantedPermissions,
  };
}

// =============================================================================
// ROLE-BASED CHECKS
// =============================================================================

/**
 * Check if user has owner or admin role.
 */
export async function isOrgAdmin(
  userId: string,
  organizationId: string
): Promise<boolean> {
  const memberRecord = await getMemberRecord(userId, organizationId);
  if (!memberRecord) return false;

  return memberRecord.baseRole === "owner" || memberRecord.baseRole === "admin";
}

/**
 * Check if user is the organization owner.
 */
export async function isOrgOwner(
  userId: string,
  organizationId: string
): Promise<boolean> {
  const memberRecord = await getMemberRecord(userId, organizationId);
  if (!memberRecord) return false;

  return memberRecord.baseRole === "owner";
}

/**
 * Check if user has a specific custom role.
 */
export async function hasCustomRole(
  userId: string,
  organizationId: string,
  roleSlug: string
): Promise<boolean> {
  const memberRecord = await getMemberRecord(userId, organizationId);
  if (!memberRecord) return false;

  const role = await db.query.customRole.findFirst({
    where: and(
      eq(customRole.organizationId, organizationId),
      eq(customRole.slug, roleSlug),
      eq(customRole.isActive, true)
    ),
  });

  if (!role) return false;

  const assignment = await db.query.memberRoleAssignment.findFirst({
    where: and(
      eq(memberRoleAssignment.memberId, memberRecord.memberId),
      eq(memberRoleAssignment.customRoleId, role.id),
      or(
        isNull(memberRoleAssignment.expiresAt),
        gte(memberRoleAssignment.expiresAt, new Date())
      )
    ),
  });

  return !!assignment;
}

// =============================================================================
// AUTHORIZATION HELPERS
// =============================================================================

/**
 * Require a permission, throwing an error if not granted.
 */
export async function requirePermission(
  userId: string,
  organizationId: string,
  permissionPath: PermissionPath,
  errorMessage?: string
): Promise<void> {
  const result = await hasPermission(userId, organizationId, permissionPath);

  if (!result.granted) {
    throw new Error(
      errorMessage ?? `Permission denied: ${permissionPath} is required`
    );
  }
}

/**
 * Require admin access, throwing an error if not granted.
 */
export async function requireAdmin(
  userId: string,
  organizationId: string,
  errorMessage?: string
): Promise<void> {
  const isAdmin = await isOrgAdmin(userId, organizationId);

  if (!isAdmin) {
    throw new Error(errorMessage ?? "Admin access required");
  }
}

/**
 * Require owner access, throwing an error if not granted.
 */
export async function requireOwner(
  userId: string,
  organizationId: string,
  errorMessage?: string
): Promise<void> {
  const isOwner = await isOrgOwner(userId, organizationId);

  if (!isOwner) {
    throw new Error(errorMessage ?? "Owner access required");
  }
}

// =============================================================================
// PERMISSION INTROSPECTION
// =============================================================================

/**
 * Get a list of all permissions a user has.
 */
export async function listGrantedPermissions(
  userId: string,
  organizationId: string
): Promise<PermissionPath[]> {
  const context = await getUserPermissionContext(userId, organizationId);
  if (!context) return [];

  const granted: PermissionPath[] = [];
  const perms = context.effectivePermissions;

  for (const category of Object.keys(perms) as Array<keyof PermissionSet>) {
    const categoryPerms = perms[category] as Record<string, boolean>;
    for (const perm of Object.keys(categoryPerms)) {
      if (categoryPerms[perm]) {
        granted.push(`${category}.${perm}` as PermissionPath);
      }
    }
  }

  return granted;
}

/**
 * Compare permissions between two users.
 */
export async function comparePermissions(
  userId1: string,
  userId2: string,
  organizationId: string
): Promise<{
  user1Only: PermissionPath[];
  user2Only: PermissionPath[];
  shared: PermissionPath[];
}> {
  const perms1 = new Set(await listGrantedPermissions(userId1, organizationId));
  const perms2 = new Set(await listGrantedPermissions(userId2, organizationId));

  const user1Only: PermissionPath[] = [];
  const user2Only: PermissionPath[] = [];
  const shared: PermissionPath[] = [];

  for (const p of perms1) {
    if (perms2.has(p)) {
      shared.push(p);
    } else {
      user1Only.push(p);
    }
  }

  for (const p of perms2) {
    if (!perms1.has(p)) {
      user2Only.push(p);
    }
  }

  return { user1Only, user2Only, shared };
}
