// =============================================================================
// DRAFTS ROUTER (PRD-08)
// =============================================================================
//
// API for evidence-grounded email drafting with citations, tone matching,
// and consistency checking.
//

import { db } from "@memorystack/db";

// =============================================================================
// NOTE: Drafting AI functionality has been moved to Python backend.
// All drafting procedures now return errors indicating this migration.
// =============================================================================

interface FollowUpContext {
  commitment: {
    id: string;
    title: string;
    description?: string;
    direction: string;
    dueDate?: Date;
    status: string;
    originalText?: string;
  };
  contact: {
    email: string;
    name?: string;
    company?: string;
    isVip: boolean;
    responseRate?: number;
    avgResponseTimeHours?: number;
  };
  originalThread?: {
    subject: string;
    lastMessageDate: Date;
    lastMessageFrom: string;
  };
  daysSinceCommitment: number;
  previousFollowUps: number;
}

/**
 * Migration error for drafting AI.
 */
const DRAFTING_MIGRATION_ERROR = new TRPCError({
  code: "NOT_IMPLEMENTED",
  message:
    "Drafting AI functionality is being migrated to Python backend. " +
    "This feature will be available soon.",
});
import {
  claim,
  commitment,
  contact,
  conversation,
  decision,
  member,
  message,
  sourceAccount,
} from "@memorystack/db/schema";
import { TRPCError } from "@trpc/server";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { protectedProcedure, router } from "../index";

// =============================================================================
// INPUT SCHEMAS
// =============================================================================

const generateDraftSchema = z.object({
  organizationId: z.string().min(1),
  threadId: z.string().uuid(),
  userIntent: z.string().min(1).max(2000),
  options: z
    .object({
      tone: z.enum(["formal", "professional", "casual", "friendly"]).optional(),
      length: z.enum(["brief", "standard", "detailed"]).optional(),
      includeGreeting: z.boolean().optional(),
      includeSignoff: z.boolean().optional(),
      citationLevel: z.enum(["minimal", "standard", "thorough"]).optional(),
      forceToneMatch: z.boolean().optional(),
    })
    .optional(),
  includeToneSamples: z.boolean().optional().default(true),
});

const refineDraftSchema = z.object({
  organizationId: z.string().min(1),
  threadId: z.string().uuid().optional(),
  originalDraft: z.string().min(1).max(10_000),
  feedback: z.string().min(1).max(2000),
  recipientName: z.string().optional(),
});

const generateVariationsSchema = z.object({
  organizationId: z.string().min(1),
  baseDraft: z.string().min(1).max(10_000),
  intent: z.string().min(1).max(500),
  variationTypes: z
    .array(z.enum(["brief", "detailed", "formal", "casual", "urgent"]))
    .min(1)
    .max(5),
});

const generateFollowUpSchema = z.object({
  organizationId: z.string().min(1),
  commitmentId: z.string().uuid(),
});

const adjustLengthSchema = z.object({
  organizationId: z.string().min(1),
  draft: z.string().min(1).max(10_000),
  target: z.union([
    z.enum(["shorter", "longer"]),
    z.object({
      minWords: z.number().int().min(0).optional(),
      maxWords: z.number().int().min(1).optional(),
    }),
  ]),
  preserveElements: z.array(z.string()).optional(),
});

const improveDraftSchema = z.object({
  organizationId: z.string().min(1),
  draft: z.string().min(1).max(10_000),
  improvementType: z.enum([
    "clarity",
    "persuasion",
    "empathy",
    "professionalism",
    "action-oriented",
  ]),
});

const quickActionSchema = z.object({
  organizationId: z.string().min(1),
  draft: z.string().min(1).max(10_000),
  action: z.enum([
    "add-greeting",
    "add-signoff",
    "add-cta",
    "soften-tone",
    "strengthen-tone",
    "add-appreciation",
  ]),
});

const analyzeToneSchema = z.object({
  organizationId: z.string().min(1),
  samples: z.array(z.string().min(1).max(5000)).min(1).max(10),
});

const checkConsistencySchema = z.object({
  organizationId: z.string().min(1),
  draft: z.string().min(1).max(10_000),
  threadId: z.string().uuid().optional(),
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

async function getThreadWithContext(threadId: string) {
  const thread = await db.query.conversation.findFirst({
    where: eq(conversation.id, threadId),
    with: {
      messages: {
        orderBy: [desc(message.receivedAt)],
        limit: 20,
      },
      sourceAccount: {
        columns: { organizationId: true, externalId: true },
      },
    },
  });

  if (!thread) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Thread not found.",
    });
  }

  return thread;
}

async function buildThreadContext(
  thread: Awaited<ReturnType<typeof getThreadWithContext>>,
  userEmail: string
) {
  // Get claims for the thread
  const claims = await db.query.claim.findMany({
    where: eq(claim.conversationId, thread.id),
    orderBy: [desc(claim.createdAt)],
  });

  return {
    id: thread.id,
    subject: thread.title ?? "",
    messages: thread.messages.map((m: typeof message.$inferSelect) => ({
      id: m.id,
      from: m.senderEmail ?? "",
      fromName: m.senderName ?? undefined,
      date: m.receivedAt ?? new Date(),
      bodyText: m.bodyText ?? "",
      isFromUser: m.senderEmail === userEmail,
    })),
    claims: claims.map((c) => ({
      id: c.id,
      type: c.type,
      text: c.text,
      messageId: c.messageId ?? undefined,
    })),
  };
}

async function getRelationshipContext(
  organizationId: string,
  contactEmail: string
) {
  const contactRecord = await db.query.contact.findFirst({
    where: and(
      eq(contact.organizationId, organizationId),
      eq(contact.primaryEmail, contactEmail)
    ),
  });

  if (!contactRecord) {
    return undefined;
  }

  return {
    contactEmail: contactRecord.primaryEmail,
    contactName: contactRecord.displayName ?? undefined,
    company: contactRecord.company ?? undefined,
    title: contactRecord.title ?? undefined,
    relationshipSummary: contactRecord.notes ?? undefined,
    lastInteractionAt: contactRecord.lastInteractionAt ?? undefined,
    totalThreads: contactRecord.totalThreads,
    sentimentScore: contactRecord.sentimentScore ?? undefined,
    isVip: contactRecord.isVip ?? false,
    communicationStyle:
      contactRecord.metadata?.communicationPreferences?.formalityLevel ??
      undefined,
  };
}

async function getHistoricalContext(
  organizationId: string,
  _threadId: string,
  _contactEmail?: string
) {
  // Get related decisions
  const decisions = await db.query.decision.findMany({
    where: eq(decision.organizationId, organizationId),
    orderBy: [desc(decision.decidedAt)],
    limit: 10,
  });

  return {
    relatedThreads: [], // Would need semantic search
    decisions: decisions.map((d) => ({
      id: d.id,
      title: d.title,
      statement: d.statement,
      decidedAt: d.decidedAt,
    })),
  };
}

async function getCommitmentContext(organizationId: string, threadId: string) {
  // Get commitments related to the thread
  const commitments = await db.query.commitment.findMany({
    where: and(
      eq(commitment.organizationId, organizationId),
      eq(commitment.sourceConversationId, threadId),
      inArray(commitment.status, ["pending", "in_progress", "overdue"])
    ),
    orderBy: [desc(commitment.dueDate)],
    limit: 10,
  });

  return {
    openCommitments: commitments.map((c) => ({
      id: c.id,
      title: c.title,
      direction: c.direction,
      dueDate: c.dueDate ?? undefined,
      status: c.status,
    })),
  };
}

async function getUserToneSamples(
  organizationId: string,
  _userEmail: string,
  limit = 5
) {
  // Get recent sent messages from user to analyze their writing style
  const accounts = await db.query.sourceAccount.findMany({
    where: and(
      eq(sourceAccount.organizationId, organizationId),
      eq(sourceAccount.type, "email")
    ),
    columns: { id: true, externalId: true },
  });

  const accountIds = accounts.map((a: { id: string }) => a.id);

  if (accountIds.length === 0) {
    return [];
  }

  // Get conversations from these accounts
  const conversations = await db.query.conversation.findMany({
    where: inArray(conversation.sourceAccountId, accountIds),
    limit: limit * 2,
    orderBy: [desc(conversation.lastMessageAt)],
    columns: { id: true },
  });

  if (conversations.length === 0) {
    return [];
  }

  const conversationIds = conversations.map((t: { id: string }) => t.id);

  // Get messages from these conversations where user is the sender
  const sentMessages = await db
    .select({
      bodyText: message.bodyText,
    })
    .from(message)
    .where(
      and(
        inArray(message.conversationId, conversationIds),
        eq(message.isFromUser, true),
        sql`${message.bodyText} IS NOT NULL`,
        sql`length(${message.bodyText}) > 100`
      )
    )
    .orderBy(desc(message.receivedAt))
    .limit(limit);

  return sentMessages
    .map((m) => m.bodyText)
    .filter((text): text is string => text !== null);
}

// =============================================================================
// ROUTER
// =============================================================================

export const draftsRouter = router({
  /**
   * Generate an evidence-grounded draft reply.
   */
  generateDraft: protectedProcedure
    .input(generateDraftSchema)
    .output(
      z.object({
        draft: z.object({
          body: z.string(),
          subject: z.string().optional(),
        }),
        citations: z.array(
          z.object({
            id: z.string(),
            text: z.string(),
            sourceType: z.string(),
            sourceId: z.string(),
          })
        ),
        toneAnalysis: z
          .object({
            detected: z.string().optional(),
            confidence: z.number().optional(),
          })
          .optional(),
        warnings: z.array(z.string()).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      await verifyOrgMembership(userId, input.organizationId);

      // Get thread with context
      const thread = await getThreadWithContext(input.threadId);

      if (thread.sourceAccount?.organizationId !== input.organizationId) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Thread does not belong to this organization.",
        });
      }

      const userEmail = thread.sourceAccount?.externalId ?? "";

      // Build all context (kept for future Python backend integration)
      const _threadContext = await buildThreadContext(thread, userEmail);

      // Get sender email for relationship context
      const senderMessage = thread.messages.find(
        (m: typeof message.$inferSelect) => m.senderEmail !== userEmail
      );
      const senderEmail = senderMessage?.senderEmail ?? "";

      const _relationshipContext = senderEmail
        ? await getRelationshipContext(input.organizationId, senderEmail)
        : undefined;

      const _historicalContext = await getHistoricalContext(
        input.organizationId,
        input.threadId,
        senderEmail
      );

      const _commitmentContext = await getCommitmentContext(
        input.organizationId,
        input.threadId
      );

      // Get user tone samples
      const _userToneSamples = input.includeToneSamples
        ? await getUserToneSamples(input.organizationId, userEmail)
        : undefined;

      // NOTE: AI drafting has been migrated to Python backend
      // Context vars above kept for future integration
      void _threadContext;
      void _relationshipContext;
      void _historicalContext;
      void _commitmentContext;
      void _userToneSamples;
      throw DRAFTING_MIGRATION_ERROR;
    }),

  /**
   * Refine a draft based on user feedback.
   */
  refineDraft: protectedProcedure
    .input(refineDraftSchema)
    .output(
      z.object({
        refinedBody: z.string(),
        changes: z.array(z.string()).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      await verifyOrgMembership(userId, input.organizationId);

      // NOTE: AI drafting has been migrated to Python backend
      throw DRAFTING_MIGRATION_ERROR;
    }),

  /**
   * Generate multiple variations of a draft.
   */
  generateVariations: protectedProcedure
    .input(generateVariationsSchema)
    .output(
      z.object({
        variations: z.array(
          z.object({
            type: z.string(),
            draft: z.string(),
            description: z.string().optional(),
          })
        ),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      await verifyOrgMembership(userId, input.organizationId);

      // NOTE: AI drafting has been migrated to Python backend
      throw DRAFTING_MIGRATION_ERROR;
    }),

  /**
   * Generate a follow-up email for a commitment.
   */
  generateFollowUp: protectedProcedure
    .input(generateFollowUpSchema)
    .output(
      z.object({
        subject: z.string(),
        body: z.string(),
        tone: z.string().optional(),
        urgencyLevel: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      await verifyOrgMembership(userId, input.organizationId);

      // Get commitment with related data
      const commitmentRecord = await db.query.commitment.findFirst({
        where: and(
          eq(commitment.id, input.commitmentId),
          eq(commitment.organizationId, input.organizationId)
        ),
        with: {
          sourceConversation: true,
          debtor: true,
          creditor: true,
        },
      });

      if (!commitmentRecord) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Commitment not found.",
        });
      }

      // Determine the contact to follow up with
      const targetContact =
        commitmentRecord.direction === "owed_to_me"
          ? commitmentRecord.debtor
          : commitmentRecord.creditor;

      if (!targetContact) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "No contact associated with this commitment.",
        });
      }

      // Calculate days since commitment was created
      const daysSinceCommitment = Math.floor(
        (Date.now() - commitmentRecord.createdAt.getTime()) /
          (1000 * 60 * 60 * 24)
      );

      // Build follow-up context
      const followUpContext: FollowUpContext = {
        commitment: {
          id: commitmentRecord.id,
          title: commitmentRecord.title,
          description: commitmentRecord.description ?? undefined,
          direction: commitmentRecord.direction,
          dueDate: commitmentRecord.dueDate ?? undefined,
          status: commitmentRecord.status,
          originalText: commitmentRecord.metadata?.originalText,
        },
        contact: {
          email: targetContact.primaryEmail,
          name: targetContact.displayName ?? undefined,
          company: targetContact.company ?? undefined,
          isVip: targetContact.isVip ?? false,
          responseRate: targetContact.responseRate ?? undefined,
          avgResponseTimeHours: targetContact.avgResponseTimeMinutes
            ? targetContact.avgResponseTimeMinutes / 60
            : undefined,
        },
        originalThread: commitmentRecord.sourceConversation
          ? {
              subject: commitmentRecord.sourceConversation.title ?? "",
              lastMessageDate:
                commitmentRecord.sourceConversation.lastMessageAt ?? new Date(),
              lastMessageFrom: "", // Would need to query
            }
          : undefined,
        daysSinceCommitment,
        previousFollowUps: commitmentRecord.reminderCount,
      };

      // NOTE: AI drafting has been migrated to Python backend
      // Context kept for future Python backend integration
      void followUpContext;
      throw DRAFTING_MIGRATION_ERROR;
    }),

  /**
   * Adjust the length of a draft.
   */
  adjustLength: protectedProcedure
    .input(adjustLengthSchema)
    .output(
      z.object({
        draft: z.string(),
        wordCount: z.number(),
        changes: z.array(z.string()).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      await verifyOrgMembership(userId, input.organizationId);

      // NOTE: AI drafting has been migrated to Python backend
      throw DRAFTING_MIGRATION_ERROR;
    }),

  /**
   * Apply a specific improvement type to a draft.
   */
  improveDraft: protectedProcedure
    .input(improveDraftSchema)
    .output(
      z.object({
        draft: z.string(),
        improvements: z.array(z.string()).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      await verifyOrgMembership(userId, input.organizationId);

      // NOTE: AI drafting has been migrated to Python backend
      throw DRAFTING_MIGRATION_ERROR;
    }),

  /**
   * Apply a quick action to a draft.
   */
  quickAction: protectedProcedure
    .input(quickActionSchema)
    .output(
      z.object({
        draft: z.string(),
        action: z.string(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      await verifyOrgMembership(userId, input.organizationId);

      // NOTE: AI drafting has been migrated to Python backend
      throw DRAFTING_MIGRATION_ERROR;
    }),

  /**
   * Analyze writing tone from samples.
   */
  analyzeTone: protectedProcedure
    .input(analyzeToneSchema)
    .output(
      z.object({
        toneProfile: z.object({
          primary: z.string(),
          secondary: z.string().optional(),
          formality: z.number(),
          warmth: z.number(),
          assertiveness: z.number(),
        }),
        patterns: z.array(z.string()).optional(),
        recommendations: z.array(z.string()).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      await verifyOrgMembership(userId, input.organizationId);

      // NOTE: AI drafting has been migrated to Python backend
      throw DRAFTING_MIGRATION_ERROR;
    }),

  /**
   * Check draft consistency against historical statements.
   */
  checkConsistency: protectedProcedure
    .input(checkConsistencySchema)
    .output(
      z.object({
        isConsistent: z.boolean(),
        conflicts: z.array(
          z.object({
            id: z.string(),
            text: z.string(),
            source: z.string(),
            conflictType: z.string().optional(),
          })
        ),
        score: z.number(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      await verifyOrgMembership(userId, input.organizationId);

      // Get historical statements from decisions and commitments
      const statements: Array<{
        id: string;
        text: string;
        source: string;
        date: Date;
      }> = [];

      // Add decisions
      const decisions = await db.query.decision.findMany({
        where: eq(decision.organizationId, input.organizationId),
        orderBy: [desc(decision.decidedAt)],
        limit: 20,
      });

      for (const d of decisions) {
        statements.push({
          id: d.id,
          text: d.statement,
          source: `Decision: ${d.title}`,
          date: d.decidedAt,
        });
      }

      // Add commitments
      const commitments = await db.query.commitment.findMany({
        where: and(
          eq(commitment.organizationId, input.organizationId),
          inArray(commitment.status, ["pending", "in_progress"])
        ),
        orderBy: [desc(commitment.createdAt)],
        limit: 20,
      });

      for (const c of commitments) {
        statements.push({
          id: c.id,
          text: c.title,
          source: `Commitment: ${c.title}`,
          date: c.createdAt,
        });
      }

      if (statements.length === 0) {
        return {
          isConsistent: true,
          conflicts: [],
          score: 1,
        };
      }

      // NOTE: AI drafting has been migrated to Python backend
      throw DRAFTING_MIGRATION_ERROR;
    }),

  /**
   * Get reminder schedule for a commitment.
   */
  getReminderSchedule: protectedProcedure
    .input(
      z.object({
        organizationId: z.string().min(1),
        commitmentId: z.string().uuid(),
      })
    )
    .output(
      z.object({
        commitment: z.object({
          id: z.string(),
          title: z.string(),
          dueDate: z.date().nullable(),
        }),
        schedule: z.array(
          z.object({
            date: z.date(),
            type: z.string(),
            message: z.string().optional(),
          })
        ),
        contact: z
          .object({
            email: z.string(),
            name: z.string().nullable(),
            avgResponseTimeHours: z.number().nullable(),
          })
          .nullable(),
      })
    )
    .query(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      await verifyOrgMembership(userId, input.organizationId);

      // Get commitment
      const commitmentRecord = await db.query.commitment.findFirst({
        where: and(
          eq(commitment.id, input.commitmentId),
          eq(commitment.organizationId, input.organizationId)
        ),
        with: {
          debtor: true,
          creditor: true,
        },
      });

      if (!commitmentRecord) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Commitment not found.",
        });
      }

      // Determine target contact
      // NOTE: AI drafting has been migrated to Python backend
      throw DRAFTING_MIGRATION_ERROR;
    }),
});
