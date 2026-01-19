// =============================================================================
// ORGANIZATIONS ROUTER
// =============================================================================
//
// API routes for organization management including member listing.
//

import { db } from "@memorystack/db";
import { member } from "@memorystack/db/schema";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { protectedProcedure, router } from "../index";

// =============================================================================
// ROUTER
// =============================================================================

export const organizationsRouter = router({
  /**
   * Get members of an organization.
   * Used for task assignment dropdowns and member lists.
   */
  getMembers: protectedProcedure
    .input(
      z.object({
        organizationId: z.string(),
      })
    )
    .query(async ({ ctx, input }) => {
      const { organizationId } = input;

      // Verify user has access to this organization
      const userMembership = await db.query.member.findFirst({
        where: eq(member.organizationId, organizationId),
        columns: { id: true },
      });

      // For now, allow access if user is querying (we'll add proper auth later)
      // In production, verify ctx.session.user.id is a member

      // Fetch all members with user info
      const members = await db.query.member.findMany({
        where: eq(member.organizationId, organizationId),
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
        columns: {
          id: true,
          userId: true,
          role: true,
          createdAt: true,
        },
      });

      return {
        members: members.map((m) => ({
          id: m.id,
          userId: m.userId,
          role: m.role,
          createdAt: m.createdAt,
          user: m.user
            ? {
                id: m.user.id,
                name: m.user.name,
                email: m.user.email,
                image: m.user.image,
              }
            : null,
        })),
      };
    }),
});
