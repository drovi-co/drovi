// =============================================================================
// DRAFTS ROUTER (PRD-08)
// =============================================================================
//
// API for evidence-grounded email drafting with citations, tone matching,
// and consistency checking.
//

import {
  createDraftingAgent,
  type DraftOptions,
  type FollowUpContext,
  type ImprovementType,
  type VariationType,
} from "@memorystack/ai/agents";
import { db } from "@memorystack/db";
import {
  claim,
  commitment,
  contact,
  decision,
  emailAccount,
  emailMessage,
  emailThread,
  member,
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
  const thread = await db.query.emailThread.findFirst({
    where: eq(emailThread.id, threadId),
    with: {
      messages: {
        orderBy: [desc(emailMessage.receivedAt)],
        limit: 20,
      },
      account: {
        columns: { organizationId: true, email: true },
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
    where: eq(claim.threadId, thread.id),
    orderBy: [desc(claim.createdAt)],
  });

  return {
    id: thread.id,
    subject: thread.subject ?? "",
    messages: thread.messages.map((m) => ({
      id: m.id,
      from: m.fromEmail ?? "",
      fromName: m.fromName ?? undefined,
      date: m.receivedAt ?? new Date(),
      bodyText: m.bodyText ?? "",
      isFromUser: m.fromEmail === userEmail,
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
      eq(commitment.sourceThreadId, threadId),
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
  const accounts = await db.query.emailAccount.findMany({
    where: eq(emailAccount.organizationId, organizationId),
    columns: { id: true, email: true },
  });

  const accountIds = accounts.map((a) => a.id);

  if (accountIds.length === 0) {
    return [];
  }

  // Get threads from these accounts
  const threads = await db.query.emailThread.findMany({
    where: and(
      inArray(emailThread.accountId, accountIds),
      eq(emailThread.isDraft, false)
    ),
    limit: limit * 2,
    orderBy: [desc(emailThread.lastMessageAt)],
    columns: { id: true },
  });

  if (threads.length === 0) {
    return [];
  }

  const threadIds = threads.map((t) => t.id);

  // Get messages from these threads where user is the sender
  const sentMessages = await db
    .select({
      bodyText: emailMessage.bodyText,
    })
    .from(emailMessage)
    .where(
      and(
        inArray(emailMessage.threadId, threadIds),
        eq(emailMessage.isFromUser, true),
        sql`${emailMessage.bodyText} IS NOT NULL`,
        sql`length(${emailMessage.bodyText}) > 100`
      )
    )
    .orderBy(desc(emailMessage.receivedAt))
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
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      await verifyOrgMembership(userId, input.organizationId);

      // Get thread with context
      const thread = await getThreadWithContext(input.threadId);

      if (thread.account.organizationId !== input.organizationId) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Thread does not belong to this organization.",
        });
      }

      const userEmail = thread.account.email;

      // Build all context
      const threadContext = await buildThreadContext(thread, userEmail);

      // Get sender email for relationship context
      const senderMessage = thread.messages.find(
        (m) => m.fromEmail !== userEmail
      );
      const senderEmail = senderMessage?.fromEmail ?? "";

      const relationshipContext = senderEmail
        ? await getRelationshipContext(input.organizationId, senderEmail)
        : undefined;

      const historicalContext = await getHistoricalContext(
        input.organizationId,
        input.threadId,
        senderEmail
      );

      const commitmentContext = await getCommitmentContext(
        input.organizationId,
        input.threadId
      );

      // Get user tone samples
      const userToneSamples = input.includeToneSamples
        ? await getUserToneSamples(input.organizationId, userEmail)
        : undefined;

      // Create agent and generate draft
      const agent = createDraftingAgent({
        enableToneMatching: true,
        enableConsistencyCheck: true,
      });

      const result = await agent.generateDraft({
        threadId: input.threadId,
        thread: threadContext,
        userIntent: input.userIntent,
        relationship: relationshipContext,
        history: historicalContext,
        commitments: commitmentContext,
        userToneSamples,
        options: input.options as DraftOptions,
      });

      return {
        draft: result.draft,
        citationSources: result.citationSources,
        toneProfile: result.toneProfile,
        consistencyCheck: result.consistencyCheck,
      };
    }),

  /**
   * Refine a draft based on user feedback.
   */
  refineDraft: protectedProcedure
    .input(refineDraftSchema)
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      await verifyOrgMembership(userId, input.organizationId);

      const agent = createDraftingAgent();

      let threadSubject: string | undefined;
      if (input.threadId) {
        const thread = await getThreadWithContext(input.threadId);
        if (thread.account.organizationId !== input.organizationId) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "Thread does not belong to this organization.",
          });
        }
        threadSubject = thread.subject ?? undefined;
      }

      const result = await agent.refineDraft(
        input.originalDraft,
        input.feedback,
        {
          threadSubject,
          recipientName: input.recipientName,
        }
      );

      return result;
    }),

  /**
   * Generate multiple variations of a draft.
   */
  generateVariations: protectedProcedure
    .input(generateVariationsSchema)
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      await verifyOrgMembership(userId, input.organizationId);

      const agent = createDraftingAgent();

      const result = await agent.generateVariations(
        input.baseDraft,
        input.intent,
        input.variationTypes as VariationType[]
      );

      return result;
    }),

  /**
   * Generate a follow-up email for a commitment.
   */
  generateFollowUp: protectedProcedure
    .input(generateFollowUpSchema)
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
          sourceThread: true,
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
        originalThread: commitmentRecord.sourceThread
          ? {
              subject: commitmentRecord.sourceThread.subject ?? "",
              lastMessageDate:
                commitmentRecord.sourceThread.lastMessageAt ?? new Date(),
              lastMessageFrom: "", // Would need to query
            }
          : undefined,
        daysSinceCommitment,
        previousFollowUps: commitmentRecord.reminderCount,
      };

      const agent = createDraftingAgent();
      const result = await agent.generateFollowUp(followUpContext);

      return result;
    }),

  /**
   * Adjust the length of a draft.
   */
  adjustLength: protectedProcedure
    .input(adjustLengthSchema)
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      await verifyOrgMembership(userId, input.organizationId);

      const agent = createDraftingAgent();

      const result = await agent.adjustLength(
        input.draft,
        input.target,
        input.preserveElements
      );

      return result;
    }),

  /**
   * Apply a specific improvement type to a draft.
   */
  improveDraft: protectedProcedure
    .input(improveDraftSchema)
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      await verifyOrgMembership(userId, input.organizationId);

      const agent = createDraftingAgent();

      const result = await agent.improveDraft(
        input.draft,
        input.improvementType as ImprovementType
      );

      return result;
    }),

  /**
   * Apply a quick action to a draft.
   */
  quickAction: protectedProcedure
    .input(quickActionSchema)
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      await verifyOrgMembership(userId, input.organizationId);

      const agent = createDraftingAgent();

      const result = await agent.applyQuickAction(input.draft, input.action);

      return { draft: result };
    }),

  /**
   * Analyze writing tone from samples.
   */
  analyzeTone: protectedProcedure
    .input(analyzeToneSchema)
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      await verifyOrgMembership(userId, input.organizationId);

      const agent = createDraftingAgent();

      const result = await agent.analyzeTone(input.samples);

      return result;
    }),

  /**
   * Check draft consistency against historical statements.
   */
  checkConsistency: protectedProcedure
    .input(checkConsistencySchema)
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

      const agent = createDraftingAgent();
      const result = await agent.checkConsistency(input.draft, statements);

      return result;
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
      const targetContact =
        commitmentRecord.direction === "owed_to_me"
          ? commitmentRecord.debtor
          : commitmentRecord.creditor;

      const agent = createDraftingAgent();

      const result = await agent.generateReminderSchedule(
        {
          title: commitmentRecord.title,
          dueDate: commitmentRecord.dueDate ?? undefined,
          importance: commitmentRecord.priority as
            | "low"
            | "medium"
            | "high"
            | "critical",
        },
        targetContact
          ? {
              avgResponseDays: targetContact.avgResponseTimeMinutes
                ? targetContact.avgResponseTimeMinutes / (60 * 24)
                : 3,
              preferredDays: ["Tuesday", "Wednesday", "Thursday"],
            }
          : undefined
      );

      return result;
    }),
});
