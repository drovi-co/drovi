// =============================================================================
// INTELLIGENCE SHARING ROUTER
// =============================================================================
//
// API routes for sharing unified intelligence objects (UIOs) including:
// - Share/unshare with users and teams
// - Teammate contact linking
// - Share requests and approvals
// - Access tracking
//

import { db } from "@memorystack/db";
import {
  contact,
  intelligenceShare,
  member,
  shareRequest,
  team,
  teammateContactLink,
  unifiedIntelligenceObject,
} from "@memorystack/db/schema";
import { TRPCError } from "@trpc/server";
import { and, desc, eq, ilike, sql } from "drizzle-orm";
import { z } from "zod";
import { protectedProcedure, router } from "../index";

// =============================================================================
// INPUT SCHEMAS
// =============================================================================

const sharePermissionSchema = z.enum(["view", "comment", "edit", "admin"]);

const contactLinkMethodSchema = z.enum([
  "email_match",
  "sso_match",
  "manual",
  "import",
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

async function verifyUIOAccess(
  userId: string,
  organizationId: string,
  uioId: string
): Promise<typeof unifiedIntelligenceObject.$inferSelect> {
  const uio = await db.query.unifiedIntelligenceObject.findFirst({
    where: eq(unifiedIntelligenceObject.id, uioId),
  });

  if (!uio || uio.organizationId !== organizationId) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Intelligence object not found.",
    });
  }

  // Check if user is linked to the owner contact via teammateContactLink
  if (uio.ownerContactId) {
    const ownerLink = await db.query.teammateContactLink.findFirst({
      where: and(
        eq(teammateContactLink.userId, userId),
        eq(teammateContactLink.contactId, uio.ownerContactId),
        eq(teammateContactLink.isActive, true)
      ),
    });
    if (ownerLink) {
      return uio;
    }
  }

  const share = await db.query.intelligenceShare.findFirst({
    where: and(
      eq(intelligenceShare.unifiedObjectId, uioId),
      eq(intelligenceShare.sharedWithUserId, userId),
      eq(intelligenceShare.isActive, true)
    ),
  });

  if (share) {
    return uio;
  }

  // Check if shared with any of user's teams
  // TODO: Implement proper team membership verification
  const teamShare = await db.query.intelligenceShare.findFirst({
    where: and(
      eq(intelligenceShare.unifiedObjectId, uioId),
      eq(intelligenceShare.isActive, true),
      sql`${intelligenceShare.sharedWithTeamId} IS NOT NULL`
    ),
  });

  if (teamShare) {
    // For now, allow access if shared with any team in the org
    // TODO: Verify user is actually a member of the specific team
    return uio;
  }

  // Check org-wide share
  const orgShare = await db.query.intelligenceShare.findFirst({
    where: and(
      eq(intelligenceShare.unifiedObjectId, uioId),
      eq(intelligenceShare.sharedWithOrganization, true),
      eq(intelligenceShare.isActive, true)
    ),
  });

  if (orgShare) {
    return uio;
  }

  throw new TRPCError({
    code: "FORBIDDEN",
    message: "You do not have access to this intelligence object.",
  });
}

async function canManageShare(
  userId: string,
  organizationId: string,
  uioId: string
): Promise<boolean> {
  const uio = await db.query.unifiedIntelligenceObject.findFirst({
    where: eq(unifiedIntelligenceObject.id, uioId),
  });

  if (!uio) return false;

  // Check if user is linked to the owner contact - owner can always manage shares
  if (uio.ownerContactId) {
    const ownerLink = await db.query.teammateContactLink.findFirst({
      where: and(
        eq(teammateContactLink.userId, userId),
        eq(teammateContactLink.contactId, uio.ownerContactId),
        eq(teammateContactLink.isActive, true)
      ),
    });
    if (ownerLink) return true;
  }

  // Check if user has admin share permission
  const share = await db.query.intelligenceShare.findFirst({
    where: and(
      eq(intelligenceShare.unifiedObjectId, uioId),
      eq(intelligenceShare.sharedWithUserId, userId),
      eq(intelligenceShare.permission, "admin"),
      eq(intelligenceShare.isActive, true)
    ),
  });

  if (share) return true;

  // Org admins can manage all shares
  const { role } = await verifyOrgMembership(userId, organizationId);
  return role === "owner" || role === "admin";
}

// =============================================================================
// ROUTER
// =============================================================================

export const intelligenceSharingRouter = router({
  // ===========================================================================
  // SHARING
  // ===========================================================================

  /**
   * Share a UIO with a user.
   */
  shareWithUser: protectedProcedure
    .input(
      z.object({
        organizationId: z.string().min(1),
        unifiedObjectId: z.string().min(1),
        targetUserId: z.string().min(1),
        permission: sharePermissionSchema.default("view"),
        shareNote: z.string().max(500).optional(),
        expiresAt: z.date().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      await verifyOrgMembership(userId, input.organizationId);

      // Verify user can manage shares on this UIO
      const canManage = await canManageShare(
        userId,
        input.organizationId,
        input.unifiedObjectId
      );

      if (!canManage) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "You cannot share this intelligence object.",
        });
      }

      // Verify target user is org member
      await verifyOrgMembership(input.targetUserId, input.organizationId);

      // Check for existing share
      const existing = await db.query.intelligenceShare.findFirst({
        where: and(
          eq(intelligenceShare.unifiedObjectId, input.unifiedObjectId),
          eq(intelligenceShare.sharedWithUserId, input.targetUserId)
        ),
      });

      if (existing) {
        // Update existing share
        await db
          .update(intelligenceShare)
          .set({
            permission: input.permission,
            shareNote: input.shareNote,
            expiresAt: input.expiresAt,
            isActive: true,
            revokedAt: null,
            revokedByUserId: null,
            updatedAt: new Date(),
          })
          .where(eq(intelligenceShare.id, existing.id));

        return { success: true, shareId: existing.id, updated: true };
      }

      // Create new share
      const [share] = await db
        .insert(intelligenceShare)
        .values({
          unifiedObjectId: input.unifiedObjectId,
          sharedWithUserId: input.targetUserId,
          shareType: "manual",
          permission: input.permission,
          sharedByUserId: userId,
          shareNote: input.shareNote,
          expiresAt: input.expiresAt,
        })
        .returning();

      return { success: true, shareId: share?.id, updated: false };
    }),

  /**
   * Share a UIO with a team.
   */
  shareWithTeam: protectedProcedure
    .input(
      z.object({
        organizationId: z.string().min(1),
        unifiedObjectId: z.string().min(1),
        targetTeamId: z.string().min(1),
        permission: sharePermissionSchema.default("view"),
        shareNote: z.string().max(500).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      await verifyOrgMembership(userId, input.organizationId);

      const canManage = await canManageShare(
        userId,
        input.organizationId,
        input.unifiedObjectId
      );

      if (!canManage) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "You cannot share this intelligence object.",
        });
      }

      // Verify team exists and belongs to org
      const targetTeam = await db.query.team.findFirst({
        where: eq(team.id, input.targetTeamId),
      });

      if (!targetTeam || targetTeam.organizationId !== input.organizationId) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Team not found.",
        });
      }

      // Check for existing share
      const existing = await db.query.intelligenceShare.findFirst({
        where: and(
          eq(intelligenceShare.unifiedObjectId, input.unifiedObjectId),
          eq(intelligenceShare.sharedWithTeamId, input.targetTeamId)
        ),
      });

      if (existing) {
        await db
          .update(intelligenceShare)
          .set({
            permission: input.permission,
            shareNote: input.shareNote,
            isActive: true,
            revokedAt: null,
            revokedByUserId: null,
            updatedAt: new Date(),
          })
          .where(eq(intelligenceShare.id, existing.id));

        return { success: true, shareId: existing.id, updated: true };
      }

      const [share] = await db
        .insert(intelligenceShare)
        .values({
          unifiedObjectId: input.unifiedObjectId,
          sharedWithTeamId: input.targetTeamId,
          shareType: "manual",
          permission: input.permission,
          sharedByUserId: userId,
          shareNote: input.shareNote,
        })
        .returning();

      return { success: true, shareId: share?.id, updated: false };
    }),

  /**
   * Share a UIO with the entire organization.
   */
  shareWithOrganization: protectedProcedure
    .input(
      z.object({
        organizationId: z.string().min(1),
        unifiedObjectId: z.string().min(1),
        permission: sharePermissionSchema.default("view"),
        shareNote: z.string().max(500).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      await verifyOrgMembership(userId, input.organizationId);

      const canManage = await canManageShare(
        userId,
        input.organizationId,
        input.unifiedObjectId
      );

      if (!canManage) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "You cannot share this intelligence object.",
        });
      }

      // Check for existing org share
      const existing = await db.query.intelligenceShare.findFirst({
        where: and(
          eq(intelligenceShare.unifiedObjectId, input.unifiedObjectId),
          eq(intelligenceShare.sharedWithOrganization, true)
        ),
      });

      if (existing) {
        await db
          .update(intelligenceShare)
          .set({
            permission: input.permission,
            shareNote: input.shareNote,
            isActive: true,
            revokedAt: null,
            revokedByUserId: null,
            updatedAt: new Date(),
          })
          .where(eq(intelligenceShare.id, existing.id));

        return { success: true, shareId: existing.id, updated: true };
      }

      const [share] = await db
        .insert(intelligenceShare)
        .values({
          unifiedObjectId: input.unifiedObjectId,
          sharedWithOrganization: true,
          shareType: "manual",
          permission: input.permission,
          sharedByUserId: userId,
          shareNote: input.shareNote,
        })
        .returning();

      return { success: true, shareId: share?.id, updated: false };
    }),

  /**
   * Revoke a share.
   */
  unshare: protectedProcedure
    .input(
      z.object({
        organizationId: z.string().min(1),
        shareId: z.string().min(1),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      await verifyOrgMembership(userId, input.organizationId);

      const share = await db.query.intelligenceShare.findFirst({
        where: eq(intelligenceShare.id, input.shareId),
        with: {
          unifiedObject: true,
        },
      });

      if (!share) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Share not found.",
        });
      }

      const canManage = await canManageShare(
        userId,
        input.organizationId,
        share.unifiedObjectId
      );

      if (!canManage) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "You cannot modify this share.",
        });
      }

      await db
        .update(intelligenceShare)
        .set({
          isActive: false,
          revokedAt: new Date(),
          revokedByUserId: userId,
          updatedAt: new Date(),
        })
        .where(eq(intelligenceShare.id, input.shareId));

      return { success: true };
    }),

  /**
   * Update share permission.
   */
  updatePermission: protectedProcedure
    .input(
      z.object({
        organizationId: z.string().min(1),
        shareId: z.string().min(1),
        permission: sharePermissionSchema,
      })
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      await verifyOrgMembership(userId, input.organizationId);

      const share = await db.query.intelligenceShare.findFirst({
        where: eq(intelligenceShare.id, input.shareId),
      });

      if (!share) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Share not found.",
        });
      }

      const canManage = await canManageShare(
        userId,
        input.organizationId,
        share.unifiedObjectId
      );

      if (!canManage) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "You cannot modify this share.",
        });
      }

      await db
        .update(intelligenceShare)
        .set({
          permission: input.permission,
          updatedAt: new Date(),
        })
        .where(eq(intelligenceShare.id, input.shareId));

      return { success: true };
    }),

  // ===========================================================================
  // SHARE QUERIES
  // ===========================================================================

  /**
   * Get items shared with me.
   */
  getSharedWithMe: protectedProcedure
    .input(
      z.object({
        organizationId: z.string().min(1),
        limit: z.number().int().min(1).max(100).default(50),
        offset: z.number().int().min(0).default(0),
      })
    )
    .query(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      await verifyOrgMembership(userId, input.organizationId);

      const shares = await db.query.intelligenceShare.findMany({
        where: and(
          eq(intelligenceShare.sharedWithUserId, userId),
          eq(intelligenceShare.isActive, true)
        ),
        limit: input.limit,
        offset: input.offset,
        orderBy: [desc(intelligenceShare.createdAt)],
        with: {
          unifiedObject: {
            columns: {
              id: true,
              type: true,
              canonicalTitle: true,
              status: true,
              overallConfidence: true,
              createdAt: true,
            },
          },
          sharedByUser: {
            columns: {
              id: true,
              name: true,
              email: true,
              image: true,
            },
          },
        },
      });

      return { shares };
    }),

  /**
   * Get items I've shared.
   */
  getSharedByMe: protectedProcedure
    .input(
      z.object({
        organizationId: z.string().min(1),
        limit: z.number().int().min(1).max(100).default(50),
        offset: z.number().int().min(0).default(0),
      })
    )
    .query(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      await verifyOrgMembership(userId, input.organizationId);

      const shares = await db.query.intelligenceShare.findMany({
        where: and(
          eq(intelligenceShare.sharedByUserId, userId),
          eq(intelligenceShare.isActive, true)
        ),
        limit: input.limit,
        offset: input.offset,
        orderBy: [desc(intelligenceShare.createdAt)],
        with: {
          unifiedObject: {
            columns: {
              id: true,
              type: true,
              canonicalTitle: true,
              status: true,
              overallConfidence: true,
            },
          },
          sharedWithUser: {
            columns: {
              id: true,
              name: true,
              email: true,
              image: true,
            },
          },
          sharedWithTeam: {
            columns: {
              id: true,
              name: true,
            },
          },
        },
      });

      return { shares };
    }),

  /**
   * Get shares for a specific UIO.
   */
  getSharesForObject: protectedProcedure
    .input(
      z.object({
        organizationId: z.string().min(1),
        unifiedObjectId: z.string().min(1),
      })
    )
    .query(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      await verifyUIOAccess(userId, input.organizationId, input.unifiedObjectId);

      const shares = await db.query.intelligenceShare.findMany({
        where: and(
          eq(intelligenceShare.unifiedObjectId, input.unifiedObjectId),
          eq(intelligenceShare.isActive, true)
        ),
        with: {
          sharedWithUser: {
            columns: {
              id: true,
              name: true,
              email: true,
              image: true,
            },
          },
          sharedWithTeam: {
            columns: {
              id: true,
              name: true,
            },
          },
          sharedByUser: {
            columns: {
              id: true,
              name: true,
              email: true,
            },
          },
        },
      });

      return { shares };
    }),

  // ===========================================================================
  // TEAMMATE CONTACT LINKING
  // ===========================================================================

  /**
   * Link a user to a contact (admin only).
   */
  linkTeammateContact: protectedProcedure
    .input(
      z.object({
        organizationId: z.string().min(1),
        userId: z.string().min(1),
        contactId: z.string().min(1),
        linkMethod: contactLinkMethodSchema.default("manual"),
        isPrimary: z.boolean().default(true),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const currentUserId = ctx.session.user.id;
      await verifyAdminAccess(currentUserId, input.organizationId);

      // Verify user is org member
      await verifyOrgMembership(input.userId, input.organizationId);

      // Verify contact exists and belongs to org
      const contactRecord = await db.query.contact.findFirst({
        where: eq(contact.id, input.contactId),
      });

      if (!contactRecord || contactRecord.organizationId !== input.organizationId) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Contact not found.",
        });
      }

      // Check for existing link
      const existing = await db.query.teammateContactLink.findFirst({
        where: and(
          eq(teammateContactLink.userId, input.userId),
          eq(teammateContactLink.contactId, input.contactId)
        ),
      });

      if (existing) {
        // Reactivate if inactive
        if (!existing.isActive) {
          await db
            .update(teammateContactLink)
            .set({
              isActive: true,
              isPrimary: input.isPrimary,
              updatedAt: new Date(),
            })
            .where(eq(teammateContactLink.id, existing.id));
        }
        return { success: true, linkId: existing.id, reactivated: !existing.isActive };
      }

      // If setting as primary, unset other primary links for this user
      if (input.isPrimary) {
        await db
          .update(teammateContactLink)
          .set({ isPrimary: false, updatedAt: new Date() })
          .where(
            and(
              eq(teammateContactLink.userId, input.userId),
              eq(teammateContactLink.organizationId, input.organizationId),
              eq(teammateContactLink.isPrimary, true)
            )
          );
      }

      const [link] = await db
        .insert(teammateContactLink)
        .values({
          organizationId: input.organizationId,
          userId: input.userId,
          contactId: input.contactId,
          linkMethod: input.linkMethod,
          isPrimary: input.isPrimary,
          confidence: input.linkMethod === "manual" ? 1.0 : 0.8,
        })
        .returning();

      return { success: true, linkId: link?.id };
    }),

  /**
   * Unlink a teammate from a contact.
   */
  unlinkTeammateContact: protectedProcedure
    .input(
      z.object({
        organizationId: z.string().min(1),
        linkId: z.string().min(1),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      await verifyAdminAccess(userId, input.organizationId);

      const link = await db.query.teammateContactLink.findFirst({
        where: eq(teammateContactLink.id, input.linkId),
      });

      if (!link || link.organizationId !== input.organizationId) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Link not found.",
        });
      }

      await db
        .update(teammateContactLink)
        .set({ isActive: false, updatedAt: new Date() })
        .where(eq(teammateContactLink.id, input.linkId));

      return { success: true };
    }),

  /**
   * Get teammate contact links.
   */
  getTeammateLinks: protectedProcedure
    .input(
      z.object({
        organizationId: z.string().min(1),
        userId: z.string().optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      const currentUserId = ctx.session.user.id;
      await verifyOrgMembership(currentUserId, input.organizationId);

      const conditions = [
        eq(teammateContactLink.organizationId, input.organizationId),
        eq(teammateContactLink.isActive, true),
      ];

      if (input.userId) {
        conditions.push(eq(teammateContactLink.userId, input.userId));
      }

      const links = await db.query.teammateContactLink.findMany({
        where: and(...conditions),
        with: {
          user: {
            columns: {
              id: true,
              name: true,
              email: true,
              image: true,
            },
          },
          contact: {
            columns: {
              id: true,
              displayName: true,
              primaryEmail: true,
              avatarUrl: true,
            },
          },
        },
      });

      return { links };
    }),

  /**
   * Auto-link teammates by email match.
   * Finds contacts whose email matches org members.
   */
  autoLinkTeammates: protectedProcedure
    .input(z.object({ organizationId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      await verifyAdminAccess(userId, input.organizationId);

      // Get all org members with their emails
      const members = await db.query.member.findMany({
        where: eq(member.organizationId, input.organizationId),
        with: {
          user: {
            columns: {
              id: true,
              email: true,
            },
          },
        },
      });

      let linkedCount = 0;

      for (const m of members) {
        if (!m.user?.email) continue;

        // Find contacts with matching email
        const matchingContacts = await db.query.contact.findMany({
          where: and(
            eq(contact.organizationId, input.organizationId),
            ilike(contact.primaryEmail, m.user.email)
          ),
        });

        for (const c of matchingContacts) {
          // Check if link already exists
          const existing = await db.query.teammateContactLink.findFirst({
            where: and(
              eq(teammateContactLink.userId, m.userId),
              eq(teammateContactLink.contactId, c.id)
            ),
          });

          if (!existing) {
            await db.insert(teammateContactLink).values({
              organizationId: input.organizationId,
              userId: m.userId,
              contactId: c.id,
              linkMethod: "email_match",
              matchedEmail: m.user.email,
              confidence: 0.95,
              isPrimary: true,
            });
            linkedCount++;
          }
        }
      }

      return { success: true, linkedCount };
    }),

  // ===========================================================================
  // SHARE REQUESTS
  // ===========================================================================

  /**
   * Request access to a UIO.
   */
  requestAccess: protectedProcedure
    .input(
      z.object({
        organizationId: z.string().min(1),
        unifiedObjectId: z.string().min(1),
        requestedPermission: sharePermissionSchema.default("view"),
        requestReason: z.string().max(500).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      await verifyOrgMembership(userId, input.organizationId);

      // Verify UIO exists
      const uio = await db.query.unifiedIntelligenceObject.findFirst({
        where: eq(unifiedIntelligenceObject.id, input.unifiedObjectId),
      });

      if (!uio || uio.organizationId !== input.organizationId) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Intelligence object not found.",
        });
      }

      // Check if user already has access
      const existingShare = await db.query.intelligenceShare.findFirst({
        where: and(
          eq(intelligenceShare.unifiedObjectId, input.unifiedObjectId),
          eq(intelligenceShare.sharedWithUserId, userId),
          eq(intelligenceShare.isActive, true)
        ),
      });

      // Check if user is already the owner via contact link
      let isOwner = false;
      if (uio.ownerContactId) {
        const ownerLink = await db.query.teammateContactLink.findFirst({
          where: and(
            eq(teammateContactLink.userId, userId),
            eq(teammateContactLink.contactId, uio.ownerContactId),
            eq(teammateContactLink.isActive, true)
          ),
        });
        isOwner = !!ownerLink;
      }

      if (existingShare || isOwner) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "You already have access to this item.",
        });
      }

      // Check for pending request
      const pendingRequest = await db.query.shareRequest.findFirst({
        where: and(
          eq(shareRequest.unifiedObjectId, input.unifiedObjectId),
          eq(shareRequest.requestedByUserId, userId),
          eq(shareRequest.status, "pending")
        ),
      });

      if (pendingRequest) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "You already have a pending request for this item.",
        });
      }

      const [request] = await db
        .insert(shareRequest)
        .values({
          organizationId: input.organizationId,
          unifiedObjectId: input.unifiedObjectId,
          requestedByUserId: userId,
          requestedPermission: input.requestedPermission,
          requestReason: input.requestReason,
        })
        .returning();

      return { success: true, requestId: request?.id };
    }),

  /**
   * Get my pending share requests.
   */
  getMyRequests: protectedProcedure
    .input(z.object({ organizationId: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      await verifyOrgMembership(userId, input.organizationId);

      const requests = await db.query.shareRequest.findMany({
        where: and(
          eq(shareRequest.requestedByUserId, userId),
          eq(shareRequest.organizationId, input.organizationId)
        ),
        orderBy: [desc(shareRequest.createdAt)],
        with: {
          unifiedObject: {
            columns: {
              id: true,
              type: true,
              canonicalTitle: true,
            },
          },
          respondedByUser: {
            columns: {
              id: true,
              name: true,
              email: true,
            },
          },
        },
      });

      return { requests };
    }),

  /**
   * Get pending requests for items I own/manage.
   */
  getPendingRequests: protectedProcedure
    .input(z.object({ organizationId: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      await verifyOrgMembership(userId, input.organizationId);

      // Get contacts linked to this user
      const userContactLinks = await db.query.teammateContactLink.findMany({
        where: and(
          eq(teammateContactLink.userId, userId),
          eq(teammateContactLink.organizationId, input.organizationId),
          eq(teammateContactLink.isActive, true)
        ),
        columns: { contactId: true },
      });

      const linkedContactIds = userContactLinks.map((l) => l.contactId);

      // Get UIOs where owner contact is linked to user
      let ownedUIOs: { id: string }[] = [];
      if (linkedContactIds.length > 0) {
        ownedUIOs = await db.query.unifiedIntelligenceObject.findMany({
          where: and(
            eq(unifiedIntelligenceObject.organizationId, input.organizationId),
            sql`${unifiedIntelligenceObject.ownerContactId} = ANY(${linkedContactIds})`
          ),
          columns: { id: true },
        });
      }

      const uioIds = ownedUIOs.map((u) => u.id);

      if (uioIds.length === 0) {
        return { requests: [] };
      }

      const requests = await db.query.shareRequest.findMany({
        where: and(
          eq(shareRequest.organizationId, input.organizationId),
          eq(shareRequest.status, "pending"),
          sql`${shareRequest.unifiedObjectId} = ANY(${uioIds})`
        ),
        orderBy: [desc(shareRequest.createdAt)],
        with: {
          unifiedObject: {
            columns: {
              id: true,
              type: true,
              canonicalTitle: true,
            },
          },
          requestedByUser: {
            columns: {
              id: true,
              name: true,
              email: true,
              image: true,
            },
          },
        },
      });

      return { requests };
    }),

  /**
   * Respond to a share request (approve/deny).
   */
  respondToRequest: protectedProcedure
    .input(
      z.object({
        organizationId: z.string().min(1),
        requestId: z.string().min(1),
        approve: z.boolean(),
        responseNote: z.string().max(500).optional(),
        grantedPermission: sharePermissionSchema.optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      await verifyOrgMembership(userId, input.organizationId);

      const request = await db.query.shareRequest.findFirst({
        where: eq(shareRequest.id, input.requestId),
      });

      if (!request || request.organizationId !== input.organizationId) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Request not found.",
        });
      }

      if (request.status !== "pending") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Request has already been processed.",
        });
      }

      // Verify user can manage the UIO
      const canManage = await canManageShare(
        userId,
        input.organizationId,
        request.unifiedObjectId
      );

      if (!canManage) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "You cannot manage this request.",
        });
      }

      let createdShareId: string | null = null;

      if (input.approve) {
        // Create the share
        const [share] = await db
          .insert(intelligenceShare)
          .values({
            unifiedObjectId: request.unifiedObjectId,
            sharedWithUserId: request.requestedByUserId,
            shareType: "manual",
            permission: input.grantedPermission ?? request.requestedPermission,
            sharedByUserId: userId,
            shareReason: `Approved request: ${input.responseNote ?? ""}`,
          })
          .returning();

        createdShareId = share?.id ?? null;
      }

      // Update request
      await db
        .update(shareRequest)
        .set({
          status: input.approve ? "approved" : "denied",
          respondedByUserId: userId,
          respondedAt: new Date(),
          responseNote: input.responseNote,
          createdShareId,
          updatedAt: new Date(),
        })
        .where(eq(shareRequest.id, input.requestId));

      return { success: true, approved: input.approve, shareId: createdShareId };
    }),

  // ===========================================================================
  // ACCESS TRACKING
  // ===========================================================================

  /**
   * Record access to a shared item.
   */
  recordAccess: protectedProcedure
    .input(
      z.object({
        organizationId: z.string().min(1),
        shareId: z.string().min(1),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      await verifyOrgMembership(userId, input.organizationId);

      const share = await db.query.intelligenceShare.findFirst({
        where: eq(intelligenceShare.id, input.shareId),
      });

      if (!share || share.sharedWithUserId !== userId) {
        return { success: false };
      }

      await db
        .update(intelligenceShare)
        .set({
          lastAccessedAt: new Date(),
          accessCount: (share.accessCount ?? 0) + 1,
          updatedAt: new Date(),
        })
        .where(eq(intelligenceShare.id, input.shareId));

      return { success: true };
    }),
});
