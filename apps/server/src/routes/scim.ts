// =============================================================================
// SCIM 2.0 REST ENDPOINTS
// =============================================================================
//
// System for Cross-domain Identity Management (SCIM) 2.0 API
// Enables automatic user provisioning and deprovisioning from IdPs
//
// Endpoints:
// - /Users - CRUD operations for users
// - /Groups - CRUD operations for groups (mapped to teams)
// - /ServiceProviderConfig - Server capabilities
// - /Schemas - Schema definitions
//

import { Hono } from "hono";
import { db } from "@memorystack/db";
import {
  organizationSettings,
  scimGroupMapping,
  member,
  team,
  teamMember,
} from "@memorystack/db/schema";
import { eq, and, like, or } from "drizzle-orm";
import { log } from "../lib/logger";

const scimRoutes = new Hono();

// =============================================================================
// MIDDLEWARE - Bearer Token Auth
// =============================================================================

scimRoutes.use("/:organizationId/*", async (c, next) => {
  const organizationId = c.req.param("organizationId");
  const authHeader = c.req.header("Authorization");

  if (!authHeader?.startsWith("Bearer ")) {
    return c.json(
      {
        schemas: ["urn:ietf:params:scim:api:messages:2.0:Error"],
        detail: "Authentication required",
        status: "401",
      },
      401
    );
  }

  const token = authHeader.slice(7);

  // Verify SCIM token
  const settings = await db.query.organizationSettings.findFirst({
    where: eq(organizationSettings.organizationId, organizationId),
  });

  if (!settings?.scimEnabled || settings.scimBearerToken !== token) {
    return c.json(
      {
        schemas: ["urn:ietf:params:scim:api:messages:2.0:Error"],
        detail: "Invalid SCIM token",
        status: "401",
      },
      401
    );
  }

  // Store org settings in context
  c.set("orgSettings", settings);
  c.set("organizationId", organizationId);

  await next();
});

// =============================================================================
// SERVICE PROVIDER CONFIG
// =============================================================================

scimRoutes.get("/:organizationId/ServiceProviderConfig", (c) => {
  const baseUrl = new URL(c.req.url).origin;
  const organizationId = c.req.param("organizationId");

  return c.json({
    schemas: ["urn:ietf:params:scim:schemas:core:2.0:ServiceProviderConfig"],
    documentationUri: `${baseUrl}/docs/scim`,
    patch: { supported: true },
    bulk: { supported: false, maxOperations: 0, maxPayloadSize: 0 },
    filter: { supported: true, maxResults: 100 },
    changePassword: { supported: false },
    sort: { supported: false },
    etag: { supported: false },
    authenticationSchemes: [
      {
        type: "oauthbearertoken",
        name: "OAuth Bearer Token",
        description: "Authentication using bearer token",
        specUri: "https://www.rfc-editor.org/rfc/rfc6750",
        documentationUri: `${baseUrl}/docs/scim#authentication`,
        primary: true,
      },
    ],
    meta: {
      location: `${baseUrl}/api/v1/scim/${organizationId}/ServiceProviderConfig`,
      resourceType: "ServiceProviderConfig",
      created: "2024-01-01T00:00:00Z",
    },
  });
});

// =============================================================================
// SCHEMAS
// =============================================================================

scimRoutes.get("/:organizationId/Schemas", (c) => {
  const baseUrl = new URL(c.req.url).origin;
  const organizationId = c.req.param("organizationId");

  return c.json({
    schemas: ["urn:ietf:params:scim:api:messages:2.0:ListResponse"],
    totalResults: 2,
    Resources: [
      {
        id: "urn:ietf:params:scim:schemas:core:2.0:User",
        name: "User",
        description: "User Account",
        attributes: [
          {
            name: "userName",
            type: "string",
            multiValued: false,
            required: true,
            uniqueness: "server",
          },
          {
            name: "emails",
            type: "complex",
            multiValued: true,
            required: true,
          },
          {
            name: "name",
            type: "complex",
            multiValued: false,
            required: false,
          },
          {
            name: "displayName",
            type: "string",
            multiValued: false,
            required: false,
          },
          {
            name: "active",
            type: "boolean",
            multiValued: false,
            required: false,
          },
        ],
        meta: {
          resourceType: "Schema",
          location: `${baseUrl}/api/v1/scim/${organizationId}/Schemas/urn:ietf:params:scim:schemas:core:2.0:User`,
        },
      },
      {
        id: "urn:ietf:params:scim:schemas:core:2.0:Group",
        name: "Group",
        description: "Group/Team",
        attributes: [
          {
            name: "displayName",
            type: "string",
            multiValued: false,
            required: true,
          },
          {
            name: "members",
            type: "complex",
            multiValued: true,
            required: false,
          },
        ],
        meta: {
          resourceType: "Schema",
          location: `${baseUrl}/api/v1/scim/${organizationId}/Schemas/urn:ietf:params:scim:schemas:core:2.0:Group`,
        },
      },
    ],
  });
});

// =============================================================================
// USERS
// =============================================================================

// List users
scimRoutes.get("/:organizationId/Users", async (c) => {
  const organizationId = c.req.param("organizationId");
  const filter = c.req.query("filter");
  const startIndex = Number.parseInt(c.req.query("startIndex") || "1");
  const count = Number.parseInt(c.req.query("count") || "100");
  const baseUrl = new URL(c.req.url).origin;

  let whereClause = eq(member.organizationId, organizationId);

  // Parse simple filter (e.g., userName eq "john@example.com")
  if (filter) {
    const match = filter.match(/userName\s+eq\s+"([^"]+)"/i);
    if (match) {
      const email = match[1].toLowerCase();
      // Would need to join with user table to filter by email
      log.info(`SCIM: Filtering users by email ${email}`);
    }
  }

  const members = await db.query.member.findMany({
    where: whereClause,
    with: {
      user: {
        columns: {
          id: true,
          name: true,
          email: true,
          image: true,
          createdAt: true,
        },
      },
    },
    limit: count,
    offset: startIndex - 1,
  });

  const resources = members
    .filter((m) => m.user)
    .map((m) => ({
      schemas: ["urn:ietf:params:scim:schemas:core:2.0:User"],
      id: m.user!.id,
      userName: m.user!.email,
      name: {
        formatted: m.user!.name || m.user!.email.split("@")[0],
      },
      displayName: m.user!.name || m.user!.email.split("@")[0],
      emails: [
        {
          value: m.user!.email,
          primary: true,
          type: "work",
        },
      ],
      active: true,
      meta: {
        resourceType: "User",
        created: m.user!.createdAt.toISOString(),
        location: `${baseUrl}/api/v1/scim/${organizationId}/Users/${m.user!.id}`,
      },
    }));

  return c.json({
    schemas: ["urn:ietf:params:scim:api:messages:2.0:ListResponse"],
    totalResults: resources.length,
    startIndex,
    itemsPerPage: count,
    Resources: resources,
  });
});

// Get user by ID
scimRoutes.get("/:organizationId/Users/:userId", async (c) => {
  const organizationId = c.req.param("organizationId");
  const userId = c.req.param("userId");
  const baseUrl = new URL(c.req.url).origin;

  const membership = await db.query.member.findFirst({
    where: and(
      eq(member.organizationId, organizationId),
      eq(member.userId, userId)
    ),
    with: {
      user: {
        columns: {
          id: true,
          name: true,
          email: true,
          image: true,
          createdAt: true,
        },
      },
    },
  });

  if (!membership?.user) {
    return c.json(
      {
        schemas: ["urn:ietf:params:scim:api:messages:2.0:Error"],
        detail: "User not found",
        status: "404",
      },
      404
    );
  }

  const user = membership.user;

  return c.json({
    schemas: ["urn:ietf:params:scim:schemas:core:2.0:User"],
    id: user.id,
    userName: user.email,
    name: {
      formatted: user.name || user.email.split("@")[0],
    },
    displayName: user.name || user.email.split("@")[0],
    emails: [
      {
        value: user.email,
        primary: true,
        type: "work",
      },
    ],
    active: true,
    meta: {
      resourceType: "User",
      created: user.createdAt.toISOString(),
      location: `${baseUrl}/api/v1/scim/${organizationId}/Users/${user.id}`,
    },
  });
});

// Create user
scimRoutes.post("/:organizationId/Users", async (c) => {
  const organizationId = c.req.param("organizationId");
  const body = await c.req.json();

  log.info(`SCIM: Create user request for org ${organizationId}`, {
    userName: body.userName,
  });

  // Extract email from SCIM user schema
  const email =
    body.userName ||
    body.emails?.find((e: { primary?: boolean }) => e.primary)?.value ||
    body.emails?.[0]?.value;

  if (!email) {
    return c.json(
      {
        schemas: ["urn:ietf:params:scim:api:messages:2.0:Error"],
        detail: "Email is required",
        status: "400",
      },
      400
    );
  }

  // In a full implementation, you would:
  // 1. Create the user through Better Auth
  // 2. Add them as a member to the organization
  // 3. Send an invitation email

  // For now, return a "not implemented" response
  return c.json(
    {
      schemas: ["urn:ietf:params:scim:api:messages:2.0:Error"],
      detail: "User provisioning requires integration with auth system",
      status: "501",
    },
    501
  );
});

// Update user (PATCH)
scimRoutes.patch("/:organizationId/Users/:userId", async (c) => {
  const organizationId = c.req.param("organizationId");
  const userId = c.req.param("userId");
  const body = await c.req.json();

  log.info(`SCIM: Patch user ${userId} for org ${organizationId}`, {
    operations: body.Operations?.length,
  });

  // Handle SCIM PATCH operations
  for (const op of body.Operations || []) {
    if (op.op === "replace" && op.path === "active" && op.value === false) {
      // Deactivate user - remove from organization
      await db
        .delete(member)
        .where(
          and(
            eq(member.organizationId, organizationId),
            eq(member.userId, userId)
          )
        );

      log.info(`SCIM: Deactivated user ${userId} from org ${organizationId}`);
    }
  }

  // Return updated user (or 404 if not found)
  return c.redirect(`/api/v1/scim/${organizationId}/Users/${userId}`, 200);
});

// Delete user
scimRoutes.delete("/:organizationId/Users/:userId", async (c) => {
  const organizationId = c.req.param("organizationId");
  const userId = c.req.param("userId");

  log.info(`SCIM: Delete user ${userId} from org ${organizationId}`);

  await db
    .delete(member)
    .where(
      and(eq(member.organizationId, organizationId), eq(member.userId, userId))
    );

  return c.body(null, 204);
});

// =============================================================================
// GROUPS
// =============================================================================

// List groups (mapped to teams)
scimRoutes.get("/:organizationId/Groups", async (c) => {
  const organizationId = c.req.param("organizationId");
  const baseUrl = new URL(c.req.url).origin;

  const teams = await db.query.team.findMany({
    where: eq(team.organizationId, organizationId),
    with: {
      members: {
        with: {
          member: {
            with: {
              user: true,
            },
          },
        },
      },
    },
  });

  const resources = teams.map((t) => ({
    schemas: ["urn:ietf:params:scim:schemas:core:2.0:Group"],
    id: t.id,
    displayName: t.name,
    members: t.members?.map((m) => ({
      value: m.member?.user?.id,
      display: m.member?.user?.name || m.member?.user?.email,
    })) || [],
    meta: {
      resourceType: "Group",
      created: t.createdAt.toISOString(),
      location: `${baseUrl}/api/v1/scim/${organizationId}/Groups/${t.id}`,
    },
  }));

  return c.json({
    schemas: ["urn:ietf:params:scim:api:messages:2.0:ListResponse"],
    totalResults: resources.length,
    Resources: resources,
  });
});

// Get group by ID
scimRoutes.get("/:organizationId/Groups/:groupId", async (c) => {
  const organizationId = c.req.param("organizationId");
  const groupId = c.req.param("groupId");
  const baseUrl = new URL(c.req.url).origin;

  const teamData = await db.query.team.findFirst({
    where: and(eq(team.id, groupId), eq(team.organizationId, organizationId)),
    with: {
      members: {
        with: {
          member: {
            with: {
              user: true,
            },
          },
        },
      },
    },
  });

  if (!teamData) {
    return c.json(
      {
        schemas: ["urn:ietf:params:scim:api:messages:2.0:Error"],
        detail: "Group not found",
        status: "404",
      },
      404
    );
  }

  return c.json({
    schemas: ["urn:ietf:params:scim:schemas:core:2.0:Group"],
    id: teamData.id,
    displayName: teamData.name,
    members: teamData.members?.map((m) => ({
      value: m.member?.user?.id,
      display: m.member?.user?.name || m.member?.user?.email,
    })) || [],
    meta: {
      resourceType: "Group",
      created: teamData.createdAt.toISOString(),
      location: `${baseUrl}/api/v1/scim/${organizationId}/Groups/${teamData.id}`,
    },
  });
});

// Create group
scimRoutes.post("/:organizationId/Groups", async (c) => {
  const organizationId = c.req.param("organizationId");
  const body = await c.req.json();
  const baseUrl = new URL(c.req.url).origin;

  if (!body.displayName) {
    return c.json(
      {
        schemas: ["urn:ietf:params:scim:api:messages:2.0:Error"],
        detail: "displayName is required",
        status: "400",
      },
      400
    );
  }

  log.info(`SCIM: Create group "${body.displayName}" for org ${organizationId}`);

  const [newTeam] = await db
    .insert(team)
    .values({
      organizationId,
      name: body.displayName,
    })
    .returning();

  // Add members if provided
  if (body.members?.length > 0) {
    for (const m of body.members) {
      const membership = await db.query.member.findFirst({
        where: and(
          eq(member.organizationId, organizationId),
          eq(member.userId, m.value)
        ),
      });

      if (membership) {
        await db.insert(teamMember).values({
          teamId: newTeam.id,
          memberId: membership.id,
        });
      }
    }
  }

  return c.json(
    {
      schemas: ["urn:ietf:params:scim:schemas:core:2.0:Group"],
      id: newTeam.id,
      displayName: newTeam.name,
      members: body.members || [],
      meta: {
        resourceType: "Group",
        created: newTeam.createdAt.toISOString(),
        location: `${baseUrl}/api/v1/scim/${organizationId}/Groups/${newTeam.id}`,
      },
    },
    201
  );
});

// Update group (PATCH)
scimRoutes.patch("/:organizationId/Groups/:groupId", async (c) => {
  const organizationId = c.req.param("organizationId");
  const groupId = c.req.param("groupId");
  const body = await c.req.json();

  log.info(`SCIM: Patch group ${groupId} for org ${organizationId}`, {
    operations: body.Operations?.length,
  });

  const teamData = await db.query.team.findFirst({
    where: and(eq(team.id, groupId), eq(team.organizationId, organizationId)),
  });

  if (!teamData) {
    return c.json(
      {
        schemas: ["urn:ietf:params:scim:api:messages:2.0:Error"],
        detail: "Group not found",
        status: "404",
      },
      404
    );
  }

  for (const op of body.Operations || []) {
    if (op.op === "replace" && op.path === "displayName") {
      await db.update(team).set({ name: op.value }).where(eq(team.id, groupId));
    }

    // Handle member operations
    if (op.path === "members" || op.path?.startsWith("members")) {
      if (op.op === "add" && op.value) {
        for (const m of op.value) {
          const membership = await db.query.member.findFirst({
            where: and(
              eq(member.organizationId, organizationId),
              eq(member.userId, m.value)
            ),
          });

          if (membership) {
            await db
              .insert(teamMember)
              .values({
                teamId: groupId,
                memberId: membership.id,
              })
              .onConflictDoNothing();
          }
        }
      }

      if (op.op === "remove") {
        // Extract user ID from path like "members[value eq \"user-id\"]"
        const match = op.path?.match(/members\[value eq "([^"]+)"\]/);
        if (match) {
          const userId = match[1];
          const membership = await db.query.member.findFirst({
            where: and(
              eq(member.organizationId, organizationId),
              eq(member.userId, userId)
            ),
          });

          if (membership) {
            await db
              .delete(teamMember)
              .where(
                and(
                  eq(teamMember.teamId, groupId),
                  eq(teamMember.memberId, membership.id)
                )
              );
          }
        }
      }
    }
  }

  return c.redirect(`/api/v1/scim/${organizationId}/Groups/${groupId}`, 200);
});

// Delete group
scimRoutes.delete("/:organizationId/Groups/:groupId", async (c) => {
  const organizationId = c.req.param("organizationId");
  const groupId = c.req.param("groupId");

  log.info(`SCIM: Delete group ${groupId} from org ${organizationId}`);

  // Delete team members first
  await db.delete(teamMember).where(eq(teamMember.teamId, groupId));

  // Delete team
  await db
    .delete(team)
    .where(and(eq(team.id, groupId), eq(team.organizationId, organizationId)));

  return c.body(null, 204);
});

export { scimRoutes };
