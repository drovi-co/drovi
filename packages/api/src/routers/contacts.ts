// =============================================================================
// CONTACTS ROUTER
// =============================================================================
//
// API for managing contacts and relationship intelligence.
// Supports profile viewing, VIP management, and meeting brief generation.
//

import { createRelationshipAgent } from "@saas-template/ai/agents";
import { db } from "@saas-template/db";
import {
  contact,
  emailThread,
  member,
  threadTopic,
} from "@saas-template/db/schema";
import { TRPCError } from "@trpc/server";
import { and, desc, eq, gte, ilike, inArray, or, sql } from "drizzle-orm";
import { z } from "zod";
import { protectedProcedure, router } from "../index";

// =============================================================================
// INPUT SCHEMAS
// =============================================================================

const listContactsSchema = z.object({
  organizationId: z.string().uuid(),
  limit: z.number().int().min(1).max(100).default(50),
  offset: z.number().int().min(0).default(0),
  // Search
  search: z.string().optional(),
  // Filters
  isVip: z.boolean().optional(),
  isAtRisk: z.boolean().optional(),
  minImportanceScore: z.number().min(0).max(1).optional(),
  minHealthScore: z.number().min(0).max(1).optional(),
  // Sorting
  sortBy: z
    .enum([
      "lastInteractionAt",
      "importanceScore",
      "healthScore",
      "engagementScore",
      "displayName",
    ])
    .default("lastInteractionAt"),
  sortOrder: z.enum(["asc", "desc"]).default("desc"),
});

const getContactSchema = z.object({
  organizationId: z.string().uuid(),
  contactId: z.string().uuid(),
});

const updateContactSchema = z.object({
  organizationId: z.string().uuid(),
  contactId: z.string().uuid(),
  // Profile updates
  displayName: z.string().optional(),
  title: z.string().optional(),
  company: z.string().optional(),
  phone: z.string().optional(),
  linkedinUrl: z.string().url().optional(),
  // VIP override
  isVipOverride: z.boolean().optional(),
  // Notes
  notes: z.string().optional(),
  // Tags
  tags: z.array(z.string()).optional(),
});

const generateMeetingBriefSchema = z.object({
  organizationId: z.string().uuid(),
  contactId: z.string().uuid(),
});

const mergeContactsSchema = z.object({
  organizationId: z.string().uuid(),
  primaryContactId: z.string().uuid(),
  secondaryContactId: z.string().uuid(),
});

const searchContactsSchema = z.object({
  organizationId: z.string().uuid(),
  query: z.string().min(1),
  limit: z.number().int().min(1).max(20).default(10),
});

// =============================================================================
// HELPERS
// =============================================================================

async function verifyOrgMembership(
  userId: string,
  organizationId: string
): Promise<void> {
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
}

async function verifyContactAccess(
  organizationId: string,
  contactId: string
): Promise<typeof contact.$inferSelect> {
  const found = await db.query.contact.findFirst({
    where: eq(contact.id, contactId),
  });

  if (!found || found.organizationId !== organizationId) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Contact not found.",
    });
  }

  return found;
}

// =============================================================================
// ROUTER
// =============================================================================

export const contactsRouter = router({
  /**
   * List contacts with filters and sorting.
   */
  list: protectedProcedure
    .input(listContactsSchema)
    .query(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      await verifyOrgMembership(userId, input.organizationId);

      const conditions = [eq(contact.organizationId, input.organizationId)];

      // Search filter
      if (input.search) {
        const searchPattern = `%${input.search}%`;
        conditions.push(
          or(
            ilike(contact.displayName, searchPattern),
            ilike(contact.primaryEmail, searchPattern),
            ilike(contact.company, searchPattern)
          ) ?? sql`true`
        );
      }

      // VIP filter
      if (input.isVip !== undefined) {
        conditions.push(eq(contact.isVip, input.isVip));
      }

      // At-risk filter
      if (input.isAtRisk !== undefined) {
        conditions.push(eq(contact.isAtRisk, input.isAtRisk));
      }

      // Importance score filter
      if (input.minImportanceScore !== undefined) {
        conditions.push(gte(contact.importanceScore, input.minImportanceScore));
      }

      // Health score filter
      if (input.minHealthScore !== undefined) {
        conditions.push(gte(contact.healthScore, input.minHealthScore));
      }

      // Count total
      const [countResult] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(contact)
        .where(and(...conditions));

      const total = countResult?.count ?? 0;

      // Build orderBy
      const sortColumn = {
        lastInteractionAt: contact.lastInteractionAt,
        importanceScore: contact.importanceScore,
        healthScore: contact.healthScore,
        engagementScore: contact.engagementScore,
        displayName: contact.displayName,
      }[input.sortBy];

      const orderBy =
        input.sortOrder === "desc" ? desc(sortColumn) : sortColumn;

      // Get contacts
      const contacts = await db.query.contact.findMany({
        where: and(...conditions),
        limit: input.limit,
        offset: input.offset,
        orderBy: [orderBy],
      });

      return {
        contacts,
        total,
        hasMore: input.offset + contacts.length < total,
      };
    }),

  /**
   * Get contact details with full profile.
   */
  get: protectedProcedure
    .input(getContactSchema)
    .query(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      await verifyOrgMembership(userId, input.organizationId);

      const found = await db.query.contact.findFirst({
        where: and(
          eq(contact.id, input.contactId),
          eq(contact.organizationId, input.organizationId)
        ),
      });

      if (!found) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Contact not found.",
        });
      }

      // Get recent threads with this contact
      const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
      const contactEmail = found.primaryEmail.toLowerCase();

      const recentThreads = await db.query.emailThread.findMany({
        where: and(
          eq(emailThread.organizationId, input.organizationId),
          gte(emailThread.lastMessageAt, ninetyDaysAgo)
        ),
        with: {
          messages: {
            orderBy: (m, { desc: d }) => [d(m.sentAt)],
            limit: 1,
          },
        },
        orderBy: [desc(emailThread.lastMessageAt)],
        limit: 100,
      });

      // Filter to threads involving this contact
      const contactThreads = recentThreads
        .filter((t) =>
          t.messages.some(
            (m) =>
              m.fromEmail.toLowerCase() === contactEmail ||
              m.toEmails?.some((e) => e.toLowerCase() === contactEmail)
          )
        )
        .slice(0, 10);

      return {
        contact: found,
        recentThreads: contactThreads.map((t) => ({
          id: t.id,
          subject: t.subject,
          snippet: t.snippet,
          lastMessageAt: t.lastMessageAt,
        })),
      };
    }),

  /**
   * Update contact profile.
   */
  update: protectedProcedure
    .input(updateContactSchema)
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      await verifyOrgMembership(userId, input.organizationId);
      await verifyContactAccess(input.organizationId, input.contactId);

      const updates: Partial<typeof contact.$inferInsert> = {
        updatedAt: new Date(),
      };

      if (input.displayName !== undefined) {
        updates.displayName = input.displayName;
      }

      if (input.title !== undefined) {
        updates.title = input.title;
      }

      if (input.company !== undefined) {
        updates.company = input.company;
      }

      if (input.phone !== undefined) {
        updates.phone = input.phone;
      }

      if (input.linkedinUrl !== undefined) {
        updates.linkedinUrl = input.linkedinUrl;
      }

      if (input.isVipOverride !== undefined) {
        updates.isVipOverride = input.isVipOverride;
        updates.isVip = input.isVipOverride;
      }

      if (input.notes !== undefined) {
        updates.notes = input.notes;
      }

      if (input.tags !== undefined) {
        updates.tags = input.tags;
      }

      await db
        .update(contact)
        .set(updates)
        .where(eq(contact.id, input.contactId));

      return { success: true };
    }),

  /**
   * Toggle VIP status.
   */
  toggleVip: protectedProcedure
    .input(getContactSchema)
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      await verifyOrgMembership(userId, input.organizationId);
      const existing = await verifyContactAccess(
        input.organizationId,
        input.contactId
      );

      const newVipStatus = !existing.isVip;

      await db
        .update(contact)
        .set({
          isVip: newVipStatus,
          isVipOverride: newVipStatus,
          updatedAt: new Date(),
        })
        .where(eq(contact.id, input.contactId));

      return { success: true, isVip: newVipStatus };
    }),

  /**
   * Generate meeting brief for a contact.
   */
  generateMeetingBrief: protectedProcedure
    .input(generateMeetingBriefSchema)
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      await verifyOrgMembership(userId, input.organizationId);

      const contactRecord = await verifyContactAccess(
        input.organizationId,
        input.contactId
      );

      // Get recent threads
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      const contactEmail = contactRecord.primaryEmail.toLowerCase();

      const threads = await db.query.emailThread.findMany({
        where: and(
          eq(emailThread.organizationId, input.organizationId),
          gte(emailThread.lastMessageAt, thirtyDaysAgo)
        ),
        with: {
          messages: {
            orderBy: (m, { asc }) => [asc(m.messageIndex)],
          },
          account: true,
        },
        orderBy: [desc(emailThread.lastMessageAt)],
        limit: 20,
      });

      // Filter to threads involving this contact
      const contactThreads = threads.filter((t) =>
        t.messages.some(
          (m) =>
            m.fromEmail.toLowerCase() === contactEmail ||
            m.toEmails?.some((e) => e.toLowerCase() === contactEmail)
        )
      );

      if (contactThreads.length === 0) {
        return {
          contactId: input.contactId,
          generatedAt: new Date(),
          profile: {
            name: contactRecord.displayName ?? contactRecord.primaryEmail,
            email: contactRecord.primaryEmail,
            title: contactRecord.title ?? undefined,
            company: contactRecord.company ?? undefined,
          },
          relationshipSummary: {
            firstContact: contactRecord.firstInteractionAt ?? new Date(),
            totalThreads: 0,
            totalMessages: 0,
            lastInteraction: contactRecord.lastInteractionAt ?? new Date(),
            healthScore: 0,
            isVip: contactRecord.isVip ?? false,
          },
          recentHistory: [],
          openLoops: [],
          talkingPoints: ["No recent interactions found"],
          suggestedTopics: ["Reconnect and catch up"],
        };
      }

      // Get thread topics
      const threadIds = contactThreads.map((t) => t.id);
      const threadTopicAssocs = await db.query.threadTopic.findMany({
        where: inArray(threadTopic.threadId, threadIds),
        with: { topic: true },
      });

      // Build thread topics map
      const threadTopicsMap = new Map<
        string,
        { topicId: string; topicName: string }[]
      >();
      for (const assoc of threadTopicAssocs) {
        const existing = threadTopicsMap.get(assoc.threadId) ?? [];
        existing.push({
          topicId: assoc.topicId,
          topicName: assoc.topic.name,
        });
        threadTopicsMap.set(assoc.threadId, existing);
      }

      // Get user email
      const userEmail = contactThreads[0]?.account.email ?? "";

      // Build thread context
      const threadContexts = contactThreads.map((t) => ({
        threadId: t.id,
        subject: t.subject ?? undefined,
        participants: [
          ...new Set(
            t.messages.flatMap((m) => [m.fromEmail, ...(m.toEmails ?? [])])
          ),
        ],
        messageCount: t.messages.length,
        firstMessageAt: t.messages[0]?.sentAt ?? new Date(),
        lastMessageAt: t.messages.at(-1)?.sentAt ?? new Date(),
        messages: t.messages.map((m) => ({
          id: m.id,
          fromEmail: m.fromEmail,
          sentAt: m.sentAt ?? undefined,
          bodyText: m.bodyText ?? undefined,
          isFromUser: m.isFromUser,
        })),
      }));

      // Generate meeting brief
      const agent = createRelationshipAgent();
      const brief = await agent.generateMeetingBrief(
        {
          contactId: input.contactId,
          organizationId: input.organizationId,
          primaryEmail: contactRecord.primaryEmail,
          displayName: contactRecord.displayName ?? undefined,
          userEmail,
        },
        threadContexts,
        threadTopicsMap
      );

      return brief;
    }),

  /**
   * Get VIP contacts.
   */
  getVips: protectedProcedure
    .input(
      z.object({
        organizationId: z.string().uuid(),
        limit: z.number().int().min(1).max(50).default(20),
      })
    )
    .query(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      await verifyOrgMembership(userId, input.organizationId);

      const vipContacts = await db.query.contact.findMany({
        where: and(
          eq(contact.organizationId, input.organizationId),
          eq(contact.isVip, true)
        ),
        limit: input.limit,
        orderBy: [desc(contact.importanceScore)],
      });

      return {
        contacts: vipContacts,
        total: vipContacts.length,
      };
    }),

  /**
   * Get at-risk contacts.
   */
  getAtRisk: protectedProcedure
    .input(
      z.object({
        organizationId: z.string().uuid(),
        limit: z.number().int().min(1).max(50).default(20),
      })
    )
    .query(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      await verifyOrgMembership(userId, input.organizationId);

      const atRiskContacts = await db.query.contact.findMany({
        where: and(
          eq(contact.organizationId, input.organizationId),
          eq(contact.isAtRisk, true)
        ),
        limit: input.limit,
        orderBy: [desc(contact.lastInteractionAt)],
      });

      return {
        contacts: atRiskContacts,
        total: atRiskContacts.length,
      };
    }),

  /**
   * Search contacts by name or email.
   */
  search: protectedProcedure
    .input(searchContactsSchema)
    .query(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      await verifyOrgMembership(userId, input.organizationId);

      const searchPattern = `%${input.query}%`;

      const results = await db.query.contact.findMany({
        where: and(
          eq(contact.organizationId, input.organizationId),
          or(
            ilike(contact.displayName, searchPattern),
            ilike(contact.primaryEmail, searchPattern),
            ilike(contact.company, searchPattern)
          )
        ),
        limit: input.limit,
        orderBy: [desc(contact.importanceScore)],
      });

      return {
        contacts: results,
        total: results.length,
      };
    }),

  /**
   * Find merge candidates for a contact.
   */
  findMergeCandidates: protectedProcedure
    .input(getContactSchema)
    .query(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      await verifyOrgMembership(userId, input.organizationId);

      const targetContact = await verifyContactAccess(
        input.organizationId,
        input.contactId
      );

      // Get all contacts in the organization (excluding the target)
      const allContacts = await db.query.contact.findMany({
        where: and(
          eq(contact.organizationId, input.organizationId),
          sql`${contact.id} != ${input.contactId}`
        ),
      });

      // Use the agent to find merge candidates
      const agent = createRelationshipAgent();
      const candidates = agent.findMergeCandidates(
        targetContact.primaryEmail,
        targetContact.displayName ?? undefined,
        allContacts.map((c) => ({
          id: c.id,
          primaryEmail: c.primaryEmail,
          displayName: c.displayName ?? undefined,
        }))
      );

      // Enrich candidates with full contact data
      const enrichedCandidates = candidates.map((candidate) => {
        const fullContact = allContacts.find(
          (c) => c.id === candidate.contactId
        );
        return {
          ...candidate,
          contact: fullContact,
        };
      });

      return {
        candidates: enrichedCandidates,
        total: enrichedCandidates.length,
      };
    }),

  /**
   * Merge two contacts.
   */
  merge: protectedProcedure
    .input(mergeContactsSchema)
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      await verifyOrgMembership(userId, input.organizationId);

      const primaryContact = await verifyContactAccess(
        input.organizationId,
        input.primaryContactId
      );
      const secondaryContact = await verifyContactAccess(
        input.organizationId,
        input.secondaryContactId
      );

      // Merge secondary into primary:
      // 1. Update primary with any missing data from secondary
      const updates: Partial<typeof contact.$inferInsert> = {};

      if (!primaryContact.displayName && secondaryContact.displayName) {
        updates.displayName = secondaryContact.displayName;
      }
      if (!primaryContact.title && secondaryContact.title) {
        updates.title = secondaryContact.title;
      }
      if (!primaryContact.company && secondaryContact.company) {
        updates.company = secondaryContact.company;
      }
      if (!primaryContact.phone && secondaryContact.phone) {
        updates.phone = secondaryContact.phone;
      }
      if (!primaryContact.linkedinUrl && secondaryContact.linkedinUrl) {
        updates.linkedinUrl = secondaryContact.linkedinUrl;
      }
      if (!primaryContact.avatarUrl && secondaryContact.avatarUrl) {
        updates.avatarUrl = secondaryContact.avatarUrl;
      }

      // Merge aliases
      const existingAliases = (primaryContact.aliases ?? []) as string[];
      const secondaryAliases = (secondaryContact.aliases ?? []) as string[];
      const allAliases = [
        ...new Set([
          ...existingAliases,
          ...secondaryAliases,
          secondaryContact.primaryEmail,
        ]),
      ];
      updates.aliases = allAliases;

      // Merge totals
      updates.totalThreads =
        (primaryContact.totalThreads ?? 0) +
        (secondaryContact.totalThreads ?? 0);
      updates.totalMessages =
        (primaryContact.totalMessages ?? 0) +
        (secondaryContact.totalMessages ?? 0);

      // Update first/last interaction dates
      if (
        secondaryContact.firstInteractionAt &&
        (!primaryContact.firstInteractionAt ||
          secondaryContact.firstInteractionAt <
            primaryContact.firstInteractionAt)
      ) {
        updates.firstInteractionAt = secondaryContact.firstInteractionAt;
      }
      if (
        secondaryContact.lastInteractionAt &&
        (!primaryContact.lastInteractionAt ||
          secondaryContact.lastInteractionAt > primaryContact.lastInteractionAt)
      ) {
        updates.lastInteractionAt = secondaryContact.lastInteractionAt;
      }

      // VIP status: if either is VIP, merged is VIP
      if (secondaryContact.isVip && !primaryContact.isVip) {
        updates.isVip = true;
      }

      updates.updatedAt = new Date();

      // Apply updates to primary
      if (Object.keys(updates).length > 0) {
        await db
          .update(contact)
          .set(updates)
          .where(eq(contact.id, input.primaryContactId));
      }

      // 2. Update all references to secondary contact to point to primary
      // This would include: commitments, decisions, etc.
      // For now, we'll just mark the secondary as merged

      // 3. Mark secondary as merged (soft delete)
      await db
        .update(contact)
        .set({
          mergedIntoContactId: input.primaryContactId,
          updatedAt: new Date(),
        })
        .where(eq(contact.id, input.secondaryContactId));

      return {
        success: true,
        primaryContactId: input.primaryContactId,
        secondaryContactId: input.secondaryContactId,
      };
    }),

  /**
   * Get contact statistics for dashboard.
   */
  getStats: protectedProcedure
    .input(
      z.object({
        organizationId: z.string().uuid(),
      })
    )
    .query(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      await verifyOrgMembership(userId, input.organizationId);

      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

      // Get all contacts
      const allContacts = await db.query.contact.findMany({
        where: and(
          eq(contact.organizationId, input.organizationId),
          sql`${contact.mergedIntoContactId} IS NULL`
        ),
      });

      const vipCount = allContacts.filter((c) => c.isVip).length;
      const atRiskCount = allContacts.filter((c) => c.isAtRisk).length;
      const recentlyActiveCount = allContacts.filter(
        (c) => c.lastInteractionAt && c.lastInteractionAt >= thirtyDaysAgo
      ).length;
      const needsAttentionCount = allContacts.filter(
        (c) =>
          c.healthScore !== null &&
          c.healthScore !== undefined &&
          c.healthScore < 0.5
      ).length;

      // Average scores
      const withImportance = allContacts.filter(
        (c) => c.importanceScore !== null && c.importanceScore !== undefined
      );
      const avgImportanceScore =
        withImportance.length > 0
          ? withImportance.reduce(
              (sum, c) => sum + (c.importanceScore ?? 0),
              0
            ) / withImportance.length
          : 0;

      const withHealth = allContacts.filter(
        (c) => c.healthScore !== null && c.healthScore !== undefined
      );
      const avgHealthScore =
        withHealth.length > 0
          ? withHealth.reduce((sum, c) => sum + (c.healthScore ?? 0), 0) /
            withHealth.length
          : 0;

      return {
        total: allContacts.length,
        vipCount,
        atRiskCount,
        recentlyActiveCount,
        needsAttentionCount,
        avgImportanceScore: Math.round(avgImportanceScore * 100) / 100,
        avgHealthScore: Math.round(avgHealthScore * 100) / 100,
      };
    }),
});
