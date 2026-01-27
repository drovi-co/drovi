// =============================================================================
// CONTACTS ROUTER
// =============================================================================
//
// API for managing contacts and relationship intelligence.
// Supports profile viewing, VIP management, and meeting brief generation.
//

import { db } from "@memorystack/db";

// =============================================================================
// NOTE: Relationship AI functionality has been moved to Python backend.
// AI-powered procedures return migration errors or simplified logic.
// =============================================================================
import {
  contact,
  contactIdentity,
  conversation,
  conversationTopic,
  type MessageRecipient,
  member,
  message,
  sourceAccount,
} from "@memorystack/db/schema";
import { TRPCError } from "@trpc/server";
import { and, desc, eq, gte, ilike, inArray, or, sql } from "drizzle-orm";
import { z } from "zod";
import { protectedProcedure, router } from "../index";

// =============================================================================
// INPUT SCHEMAS
// =============================================================================

const listContactsSchema = z.object({
  organizationId: z.string().min(1),
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
  organizationId: z.string().min(1),
  contactId: z.string().uuid(),
});

const updateContactSchema = z.object({
  organizationId: z.string().min(1),
  contactId: z.string().uuid(),
  // Profile updates
  displayName: z.string().optional(),
  title: z.string().optional(),
  company: z.string().optional(),
  phone: z.string().optional(),
  linkedinUrl: z.string().url().optional(),
  // VIP override
  userOverrideVip: z.boolean().optional(),
  // Notes
  notes: z.string().optional(),
  // Tags
  tags: z.array(z.string()).optional(),
});

const generateMeetingBriefSchema = z.object({
  organizationId: z.string().min(1),
  contactId: z.string().uuid(),
});

const mergeContactsSchema = z.object({
  organizationId: z.string().min(1),
  primaryContactId: z.string().uuid(),
  secondaryContactId: z.string().uuid(),
});

const searchContactsSchema = z.object({
  organizationId: z.string().min(1),
  query: z.string().min(1),
  limit: z.number().int().min(1).max(20).default(10),
});

const getMergeSuggestionsSchema = z.object({
  organizationId: z.string().min(1),
  minConfidence: z.number().min(0).max(1).default(0.5),
  limit: z.number().int().min(1).max(100).default(50),
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

      // Get account IDs for this organization
      const accounts = await db.query.sourceAccount.findMany({
        where: and(
          eq(sourceAccount.organizationId, input.organizationId),
          eq(sourceAccount.type, "email")
        ),
        columns: { id: true },
      });
      const accountIds = accounts.map((a: { id: string }) => a.id);

      if (accountIds.length === 0) {
        return {
          contact: found,
          recentThreads: [],
        };
      }

      const recentThreads = await db.query.conversation.findMany({
        where: and(
          inArray(conversation.sourceAccountId, accountIds),
          gte(conversation.lastMessageAt, ninetyDaysAgo)
        ),
        with: {
          messages: {
            orderBy: [desc(message.sentAt)],
            limit: 1,
          },
        },
        orderBy: [desc(conversation.lastMessageAt)],
        limit: 100,
      });

      // Filter to threads involving this contact
      const contactThreads = recentThreads
        .filter((t) =>
          t.messages.some(
            (m) =>
              m.senderEmail?.toLowerCase() === contactEmail ||
              (m.recipients as MessageRecipient[] | null)?.some(
                (r) => r.email?.toLowerCase() === contactEmail
              )
          )
        )
        .slice(0, 10);

      return {
        contact: found,
        recentThreads: contactThreads.map((t) => ({
          id: t.id,
          subject: t.title,
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

      if (input.userOverrideVip !== undefined) {
        updates.userOverrideVip = input.userOverrideVip;
        updates.isVip = input.userOverrideVip;
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
          userOverrideVip: newVipStatus,
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

      // Get account IDs for this organization
      const accounts = await db.query.sourceAccount.findMany({
        where: and(
          eq(sourceAccount.organizationId, input.organizationId),
          eq(sourceAccount.type, "email")
        ),
        columns: { id: true },
      });
      const accountIds = accounts.map((a: { id: string }) => a.id);

      if (accountIds.length === 0) {
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
          },
          communicationPatterns: {
            threadsPerMonth: 0,
            messagesPerMonth: 0,
            avgResponseTimeMinutes: 0,
            responseRate: 0,
          },
          recentTopics: [],
          commitments: [],
          recentDecisions: [],
        };
      }

      const threads = await db.query.conversation.findMany({
        where: and(
          inArray(conversation.sourceAccountId, accountIds),
          gte(conversation.lastMessageAt, thirtyDaysAgo)
        ),
        with: {
          messages: true,
          sourceAccount: true,
        },
        orderBy: [desc(conversation.lastMessageAt)],
        limit: 20,
      });

      // Filter to threads involving this contact
      const contactThreads = threads.filter((t) =>
        t.messages.some(
          (m) =>
            m.senderEmail?.toLowerCase() === contactEmail ||
            (m.recipients as MessageRecipient[] | null)?.some(
              (r) => r.email?.toLowerCase() === contactEmail
            )
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
      const threadTopicAssocs = await db.query.conversationTopic.findMany({
        where: inArray(conversationTopic.conversationId, threadIds),
        with: { topic: true },
      });

      // Build thread topics map
      const threadTopicsMap = new Map<
        string,
        { topicId: string; topicName: string }[]
      >();
      for (const assoc of threadTopicAssocs) {
        const existing = threadTopicsMap.get(assoc.conversationId) ?? [];
        existing.push({
          topicId: assoc.topicId,
          topicName: assoc.topic.name,
        });
        threadTopicsMap.set(assoc.conversationId, existing);
      }

      // Get user email
      const userEmail = contactThreads[0]?.sourceAccount?.externalId ?? "";

      // Build thread context
      const threadContexts = contactThreads.map((t) => ({
        threadId: t.id,
        subject: t.title ?? undefined,
        participants: [
          ...new Set(
            t.messages.flatMap((m) => [
              m.senderEmail,
              ...((m.recipients as MessageRecipient[] | null) ?? [])
                .map((r) => r.email)
                .filter((e): e is string => !!e),
            ])
          ),
        ].filter((e): e is string => !!e),
        messageCount: t.messages.length,
        firstMessageAt: t.messages[0]?.sentAt ?? new Date(),
        lastMessageAt: t.messages.at(-1)?.sentAt ?? new Date(),
        messages: t.messages.map((m) => ({
          id: m.id,
          fromEmail: m.senderEmail ?? "",
          sentAt: m.sentAt ?? undefined,
          bodyText: m.bodyText ?? undefined,
          isFromUser: m.isFromUser,
        })),
      }));

      // NOTE: AI-powered meeting brief has been migrated to Python backend
      // Context kept for future Python backend integration
      void userEmail;
      void threadContexts;
      throw new TRPCError({
        code: "NOT_IMPLEMENTED",
        message:
          "AI-powered meeting brief generation is being migrated to Python backend. " +
          "Use /api/v1/memory/search for contact context.",
      });
    }),

  /**
   * Get VIP contacts.
   */
  getVips: protectedProcedure
    .input(
      z.object({
        organizationId: z.string().min(1),
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
        organizationId: z.string().min(1),
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
   * Get organization-wide merge suggestions.
   * Scans all contacts to find likely duplicates using:
   * 1. Shared identities (exact matches via contact_identity table)
   * 2. Probabilistic matching (similar names + same email domain)
   */
  getMergeSuggestions: protectedProcedure
    .input(getMergeSuggestionsSchema)
    .query(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      await verifyOrgMembership(userId, input.organizationId);

      const suggestions: {
        contactA: typeof contact.$inferSelect;
        contactB: typeof contact.$inferSelect;
        confidence: number;
        reasons: string[];
        sharedIdentities: {
          type: string;
          value: string;
        }[];
      }[] = [];

      // Step 1: Find contacts with shared identities
      // Group identities by (type, value) and find those linked to multiple contacts
      const allIdentities = await db.query.contactIdentity.findMany({
        where: eq(contactIdentity.organizationId, input.organizationId),
        with: {
          contact: true,
        },
      });

      // Group by identity type + value
      const identityGroups = new Map<string, typeof allIdentities>();
      for (const identity of allIdentities) {
        const key = `${identity.identityType}:${identity.identityValue.toLowerCase()}`;
        const existing = identityGroups.get(key) ?? [];
        existing.push(identity);
        identityGroups.set(key, existing);
      }

      // Find groups with multiple contacts (potential duplicates)
      const seenPairs = new Set<string>();
      for (const [_identityKey, identities] of identityGroups) {
        if (identities.length > 1) {
          // Multiple contacts share this identity - they might be the same person
          const uniqueContactIds = [
            ...new Set(identities.map((i) => i.contactId)),
          ];
          if (uniqueContactIds.length > 1) {
            // Get all pairs
            for (let i = 0; i < uniqueContactIds.length; i++) {
              for (let j = i + 1; j < uniqueContactIds.length; j++) {
                const contactAId = uniqueContactIds[i];
                const contactBId = uniqueContactIds[j];
                const pairKey = [contactAId, contactBId].sort().join(":");

                if (!seenPairs.has(pairKey)) {
                  seenPairs.add(pairKey);

                  const contactA = identities.find(
                    (i) => i.contactId === contactAId
                  )?.contact;
                  const contactB = identities.find(
                    (i) => i.contactId === contactBId
                  )?.contact;

                  if (contactA && contactB) {
                    // Find all shared identities for this pair
                    const sharedIdentities: { type: string; value: string }[] =
                      [];
                    for (const [k, ids] of identityGroups) {
                      const hasA = ids.some((i) => i.contactId === contactAId);
                      const hasB = ids.some((i) => i.contactId === contactBId);
                      if (hasA && hasB) {
                        const [type, value] = k.split(":");
                        sharedIdentities.push({
                          type: type ?? "unknown",
                          value: value ?? "",
                        });
                      }
                    }

                    // High confidence for shared identities
                    const confidence = Math.min(
                      0.95,
                      0.7 + sharedIdentities.length * 0.1
                    );

                    if (confidence >= input.minConfidence) {
                      suggestions.push({
                        contactA,
                        contactB,
                        confidence,
                        reasons: [
                          `Share ${sharedIdentities.length} identifier(s)`,
                        ],
                        sharedIdentities,
                      });
                    }
                  }
                }
              }
            }
          }
        }
      }

      // Step 2: Probabilistic matching for contacts without shared identities
      // Get all contacts
      const allContacts = await db.query.contact.findMany({
        where: eq(contact.organizationId, input.organizationId),
      });

      // Group by email domain
      const domainGroups = new Map<string, typeof allContacts>();
      for (const c of allContacts) {
        const domain = c.primaryEmail.split("@")[1]?.toLowerCase();
        if (domain) {
          const existing = domainGroups.get(domain) ?? [];
          existing.push(c);
          domainGroups.set(domain, existing);
        }
      }

      // Check for similar names within same domain
      for (const [domain, contacts] of domainGroups) {
        if (contacts.length > 1) {
          for (let i = 0; i < contacts.length; i++) {
            for (let j = i + 1; j < contacts.length; j++) {
              const a = contacts[i];
              const b = contacts[j];

              if (!(a && b)) {
                continue;
              }

              const pairKey = [a.id, b.id].sort().join(":");
              if (seenPairs.has(pairKey)) {
                continue;
              }

              // Calculate name similarity
              const nameA = (a.displayName ?? "").toLowerCase().trim();
              const nameB = (b.displayName ?? "").toLowerCase().trim();

              if (!(nameA && nameB) || nameA.length < 2 || nameB.length < 2) {
                continue;
              }

              // Simple similarity: check for substring match or similar parts
              let nameSimilarity = 0;
              if (nameA === nameB) {
                nameSimilarity = 1.0;
              } else if (nameA.includes(nameB) || nameB.includes(nameA)) {
                nameSimilarity = 0.7;
              } else {
                // Check for shared name parts (first/last name overlap)
                const partsA = nameA.split(/\s+/);
                const partsB = nameB.split(/\s+/);
                const sharedParts = partsA.filter((p) =>
                  partsB.some((pb) => pb.includes(p) || p.includes(pb))
                );
                if (sharedParts.length > 0) {
                  nameSimilarity =
                    0.3 +
                    (sharedParts.length /
                      Math.max(partsA.length, partsB.length)) *
                      0.4;
                }
              }

              if (nameSimilarity > 0.3) {
                // Calculate overall confidence
                // Same domain: +0.2, Name similarity: up to +0.5, Same company: +0.2
                let confidence = 0.2 + nameSimilarity * 0.5;

                const reasons: string[] = [`Same email domain (@${domain})`];

                if (nameSimilarity >= 0.7) {
                  reasons.push("Very similar names");
                } else if (nameSimilarity > 0.3) {
                  reasons.push("Similar name parts");
                }

                // Company match bonus
                if (
                  a.company &&
                  b.company &&
                  a.company.toLowerCase() === b.company.toLowerCase()
                ) {
                  confidence += 0.2;
                  reasons.push("Same company");
                }

                confidence = Math.min(confidence, 0.85); // Cap probabilistic matches

                if (confidence >= input.minConfidence) {
                  seenPairs.add(pairKey);
                  suggestions.push({
                    contactA: a,
                    contactB: b,
                    confidence,
                    reasons,
                    sharedIdentities: [],
                  });
                }
              }
            }
          }
        }
      }

      // Sort by confidence descending
      suggestions.sort((a, b) => b.confidence - a.confidence);

      // Apply limit
      const limited = suggestions.slice(0, input.limit);

      return {
        suggestions: limited.map((s) => ({
          contactA: {
            id: s.contactA.id,
            displayName: s.contactA.displayName,
            primaryEmail: s.contactA.primaryEmail,
            company: s.contactA.company,
            title: s.contactA.title,
            avatarUrl: s.contactA.avatarUrl,
            isVip: s.contactA.isVip,
          },
          contactB: {
            id: s.contactB.id,
            displayName: s.contactB.displayName,
            primaryEmail: s.contactB.primaryEmail,
            company: s.contactB.company,
            title: s.contactB.title,
            avatarUrl: s.contactB.avatarUrl,
            isVip: s.contactB.isVip,
          },
          confidence: Math.round(s.confidence * 100) / 100,
          reasons: s.reasons,
          sharedIdentities: s.sharedIdentities,
        })),
        total: suggestions.length,
        hasMore: suggestions.length > input.limit,
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

      // Simple merge candidate detection (replaces AI agent)
      // Finds contacts with similar email domains or similar names
      const targetEmailDomain = targetContact.primaryEmail
        .split("@")[1]
        ?.toLowerCase();
      const targetName = (targetContact.displayName ?? "").toLowerCase();

      const candidates = allContacts
        .map((c) => {
          let similarity = 0;
          const reasons: string[] = [];

          // Check email domain match
          const candidateDomain = c.primaryEmail.split("@")[1]?.toLowerCase();
          if (targetEmailDomain && candidateDomain === targetEmailDomain) {
            similarity += 0.3;
            reasons.push("Same email domain");
          }

          // Check name similarity (simple substring match)
          const candidateName = (c.displayName ?? "").toLowerCase();
          if (
            targetName &&
            candidateName &&
            targetName.length > 2 &&
            (candidateName.includes(targetName) ||
              targetName.includes(candidateName))
          ) {
            similarity += 0.5;
            reasons.push("Similar name");
          }

          return {
            contactId: c.id,
            similarity,
            reasons,
          };
        })
        .filter((c) => c.similarity > 0)
        .sort((a, b) => b.similarity - a.similarity);

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

      // Merge emails
      const existingEmails = (primaryContact.emails ?? []) as string[];
      const secondaryEmails = (secondaryContact.emails ?? []) as string[];
      const allEmails = [
        ...new Set([
          ...existingEmails,
          ...secondaryEmails,
          secondaryContact.primaryEmail,
        ]),
      ];
      updates.emails = allEmails;

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
      // TODO: Update references when those tables have foreign keys

      // 3. Delete secondary contact after merge
      await db.delete(contact).where(eq(contact.id, input.secondaryContactId));

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
        organizationId: z.string().min(1),
      })
    )
    .query(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      await verifyOrgMembership(userId, input.organizationId);

      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

      // Get all contacts
      const allContacts = await db.query.contact.findMany({
        where: eq(contact.organizationId, input.organizationId),
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

  /**
   * Get relationship intelligence for a contact.
   * Used by the Relationship Intelligence Sidebar.
   */
  getIntelligence: protectedProcedure
    .input(
      z.object({
        organizationId: z.string().min(1),
        contactId: z.string().uuid(),
      })
    )
    .query(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      await verifyOrgMembership(userId, input.organizationId);

      // Get the contact
      const contactRecord = await verifyContactAccess(
        input.organizationId,
        input.contactId
      );

      // Import commitment and decision tables dynamically
      const { commitment, decision, contactRelationship } = await import(
        "@memorystack/db/schema"
      );

      // Get open commitments involving this contact (as debtor or creditor)
      const openCommitments = await db.query.commitment.findMany({
        where: and(
          eq(commitment.organizationId, input.organizationId),
          inArray(commitment.status, ["pending", "in_progress", "waiting"]),
          or(
            eq(commitment.debtorContactId, input.contactId),
            eq(commitment.creditorContactId, input.contactId)
          )
        ),
        orderBy: [desc(commitment.dueDate)],
        limit: 10,
      });

      // Get recent decisions involving this contact
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      const recentDecisions = await db.query.decision.findMany({
        where: and(
          eq(decision.organizationId, input.organizationId),
          sql`${input.contactId} = ANY(${decision.ownerContactIds})`,
          gte(decision.decidedAt, thirtyDaysAgo)
        ),
        orderBy: [desc(decision.decidedAt)],
        limit: 5,
      });

      // Get mutual connections (contacts this contact communicates with)
      const relationships = await db.query.contactRelationship.findMany({
        where: and(
          eq(contactRelationship.organizationId, input.organizationId),
          or(
            eq(contactRelationship.contactAId, input.contactId),
            eq(contactRelationship.contactBId, input.contactId)
          )
        ),
        with: {
          contactA: true,
          contactB: true,
        },
        orderBy: [desc(contactRelationship.strength)],
        limit: 10,
      });

      // Extract mutual contacts from relationships
      const mutualContacts = relationships.map((rel) => {
        const otherContact =
          rel.contactAId === input.contactId ? rel.contactB : rel.contactA;
        return {
          id: otherContact.id,
          displayName: otherContact.displayName,
          primaryEmail: otherContact.primaryEmail,
          avatarUrl: otherContact.avatarUrl,
          company: otherContact.company,
          strength: rel.strength,
          relationshipType: rel.relationshipType,
          lastInteractionAt: rel.lastInteractionAt,
        };
      });

      // Calculate health insight message
      const healthInsight = getHealthInsight(contactRecord);

      // Calculate communication pattern description
      const communicationPattern = getCommunicationPattern(contactRecord);

      return {
        contact: {
          id: contactRecord.id,
          displayName: contactRecord.displayName,
          primaryEmail: contactRecord.primaryEmail,
          company: contactRecord.company,
          title: contactRecord.title,
          avatarUrl: contactRecord.avatarUrl,
          isVip: contactRecord.isVip,
          isAtRisk: contactRecord.isAtRisk,
        },
        healthScore: contactRecord.healthScore ?? 0.5,
        healthInsight,
        communicationPattern,
        metrics: {
          totalThreads: contactRecord.totalThreads ?? 0,
          totalMessages: contactRecord.totalMessages ?? 0,
          avgResponseTimeMinutes: contactRecord.avgResponseTimeMinutes ?? 0,
          responseRate: contactRecord.responseRate ?? 0,
          sentimentScore: contactRecord.sentimentScore ?? 0,
          engagementScore: contactRecord.engagementScore ?? 0,
          daysSinceLastContact: contactRecord.daysSinceLastContact ?? 0,
          firstInteractionAt: contactRecord.firstInteractionAt,
          lastInteractionAt: contactRecord.lastInteractionAt,
        },
        openCommitments: openCommitments.map((c) => ({
          id: c.id,
          title: c.title,
          status: c.status,
          priority: c.priority,
          dueDate: c.dueDate,
          direction: c.direction,
          isDebtor: c.debtorContactId === input.contactId,
        })),
        recentDecisions: recentDecisions.map((d) => ({
          id: d.id,
          title: d.title,
          decisionDate: d.decidedAt,
          status: d.supersededById ? "superseded" : "active",
        })),
        mutualContacts,
      };
    }),

  /**
   * Get contact by email.
   * Useful for looking up a contact from thread participants.
   */
  getByEmail: protectedProcedure
    .input(
      z.object({
        organizationId: z.string().min(1),
        email: z.string().email(),
      })
    )
    .query(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      await verifyOrgMembership(userId, input.organizationId);

      const contactRecord = await db.query.contact.findFirst({
        where: and(
          eq(contact.organizationId, input.organizationId),
          eq(contact.primaryEmail, input.email.toLowerCase())
        ),
      });

      return { contact: contactRecord ?? null };
    }),
});

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

function getHealthInsight(contactRecord: typeof contact.$inferSelect): string {
  const healthScore = contactRecord.healthScore ?? 0.5;
  const responseRate = contactRecord.responseRate ?? 0;
  const daysSince = contactRecord.daysSinceLastContact ?? 0;

  if (healthScore >= 0.8) {
    return "Strong relationship - frequent, positive engagement";
  }
  if (healthScore >= 0.6) {
    if (responseRate >= 0.7) {
      return "Good relationship - responsive and engaged";
    }
    return "Healthy relationship - regular communication";
  }
  if (healthScore >= 0.4) {
    if (daysSince > 14) {
      return "Consider reaching out - it's been a while";
    }
    return "Moderate engagement - could be strengthened";
  }
  if (daysSince > 30) {
    return "At risk - no contact in over a month";
  }
  return "Needs attention - low engagement detected";
}

function getCommunicationPattern(
  contactRecord: typeof contact.$inferSelect
): string {
  const avgResponse = contactRecord.avgResponseTimeMinutes;
  const totalMessages = contactRecord.totalMessages ?? 0;
  const responseRate = contactRecord.responseRate ?? 0;

  const parts: string[] = [];

  if (avgResponse !== null && avgResponse !== undefined) {
    if (avgResponse < 60) {
      parts.push("Responds quickly (usually within an hour)");
    } else if (avgResponse < 240) {
      parts.push("Responds within a few hours");
    } else if (avgResponse < 1440) {
      parts.push("Usually responds within a day");
    } else {
      parts.push("May take a few days to respond");
    }
  }

  if (responseRate > 0) {
    if (responseRate >= 0.8) {
      parts.push("Very responsive");
    } else if (responseRate >= 0.5) {
      parts.push("Generally responsive");
    } else if (responseRate >= 0.3) {
      parts.push("Sometimes responsive");
    }
  }

  if (totalMessages > 100) {
    parts.push("Frequent communicator");
  } else if (totalMessages > 20) {
    parts.push("Regular communication");
  }

  return parts.join(" • ") || "Communication pattern not yet established";
}
