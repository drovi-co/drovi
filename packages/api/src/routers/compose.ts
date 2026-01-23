// =============================================================================
// COMPOSE ROUTER
// =============================================================================
//
// API for compose operations that only need database access.
// Send/draft operations are handled by the server's Hono routes.
//

import {
  createContradictionDetector,
  type HistoricalStatement,
} from "@memorystack/ai/detectors";
import { db } from "@memorystack/db";
import {
  claim,
  conversation,
  member,
  message,
} from "@memorystack/db/schema";
import { TRPCError } from "@trpc/server";
import { and, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { protectedProcedure, router } from "../index";

// =============================================================================
// INPUT SCHEMAS
// =============================================================================

const replyContextSchema = z.object({
  organizationId: z.string().min(1),
  threadId: z.string().uuid(),
});

// =============================================================================
// ORGANIZATION MEMBERSHIP VERIFICATION
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
      message: "You are not a member of this organization",
    });
  }

  return { role: membership.role };
}

// =============================================================================
// COMPOSE ROUTER
// =============================================================================

export const composeRouter = router({
  /**
   * Get context for replying to a thread
   * Returns prefilled data for the compose dialog
   */
  getReplyContext: protectedProcedure
    .input(replyContextSchema)
    .query(async ({ ctx, input }) => {
      // Verify org membership
      await verifyOrgMembership(ctx.session.user.id, input.organizationId);

      // Get the thread with its messages
      const thread = await db.query.conversation.findFirst({
        where: eq(conversation.id, input.threadId),
        with: {
          messages: {
            orderBy: [desc(message.sentAt)],
          },
          sourceAccount: true,
        },
      });

      if (!thread) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Thread not found",
        });
      }

      const lastMessage = thread.messages[0];
      const userEmail = thread.sourceAccount?.externalId ?? "";

      // Build reply subject
      const subject = (thread.title ?? "").startsWith("Re: ")
        ? thread.title
        : `Re: ${thread.title ?? ""}`;

      // Build reply recipients - reply to sender, excluding self
      const toRecipients: Array<{ email: string; name?: string }> = [];
      const ccRecipients: Array<{ email: string; name?: string }> = [];

      if (lastMessage) {
        // Add the sender as the primary recipient
        const sender = lastMessage.senderEmail;
        if (sender && sender !== userEmail) {
          toRecipients.push({
            email: sender,
            name: lastMessage.senderName ?? undefined,
          });
        }

        // Add other To/CC recipients (for Reply All)
        const allRecipients = (lastMessage.recipients ?? []) as Array<{
          email?: string;
          name?: string;
          type: "to" | "cc" | "bcc" | "mention" | "reaction";
        }>;
        const msgToRecipients = allRecipients.filter((r) => r.type === "to");
        const msgCcRecipients = allRecipients.filter((r) => r.type === "cc");

        for (const recipient of msgToRecipients) {
          if (recipient.email && recipient.email !== userEmail && recipient.email !== sender) {
            toRecipients.push({ email: recipient.email, name: recipient.name });
          }
        }

        for (const recipient of msgCcRecipients) {
          if (recipient.email && recipient.email !== userEmail && recipient.email !== sender) {
            ccRecipients.push({ email: recipient.email, name: recipient.name });
          }
        }
      }

      // Build quoted body
      let quotedBody = "";
      if (lastMessage) {
        const date = lastMessage.sentAt
          ? new Date(lastMessage.sentAt).toLocaleString()
          : "Unknown date";
        const from = lastMessage.senderName ?? lastMessage.senderEmail ?? "Unknown";
        const bodyText = lastMessage.bodyText ?? lastMessage.snippet ?? "";

        quotedBody = `\n\n---\nOn ${date}, ${from} wrote:\n\n${bodyText
          .split("\n")
          .map((line: string) => `> ${line}`)
          .join("\n")}`;
      }

      return {
        accountId: thread.sourceAccountId,
        subject,
        toRecipients,
        ccRecipients,
        quotedBody,
        replyToThreadId: thread.id,
        inReplyToMessageId: lastMessage?.id,
      };
    }),

  /**
   * Check for contradictions in draft content against historical statements
   */
  checkContradictions: protectedProcedure
    .input(
      z.object({
        organizationId: z.string().min(1),
        draftContent: z.string().min(1),
        threadId: z.string().uuid().optional(),
        recipients: z
          .array(
            z.object({
              email: z.string().email(),
              name: z.string().optional(),
            })
          )
          .optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      // Verify org membership
      await verifyOrgMembership(ctx.session.user.id, input.organizationId);

      // Get historical statements from claims (commitments, decisions)
      const recipientEmails = input.recipients?.map((r) => r.email) ?? [];

      // Fetch relevant claims - commitments and decisions related to recipients
      const claimsQuery = db.query.claim.findMany({
        where: and(
          eq(claim.organizationId, input.organizationId),
          eq(claim.isUserDismissed, false),
          inArray(claim.type, ["promise", "decision"])
        ),
        orderBy: [desc(claim.extractedAt)],
        limit: 100,
      });

      const claims = await claimsQuery;

      // Filter claims that are relevant to recipients (if any)
      const relevantClaims =
        recipientEmails.length > 0
          ? claims.filter((c) => {
              // Check if claim is related to any recipient
              const meta = c.metadata as { attributedTo?: string } | null;
              const attributedTo = meta?.attributedTo?.toLowerCase() ?? "";
              return recipientEmails.some((email) =>
                attributedTo.includes(email.toLowerCase())
              );
            })
          : claims;

      // Also include claims from the same thread if replying
      let threadClaims: typeof claims = [];
      if (input.threadId) {
        threadClaims = claims.filter((c) => c.conversationId === input.threadId);
      }

      // Combine and deduplicate
      const allRelevantClaims = [
        ...new Map(
          [...relevantClaims, ...threadClaims].map((c) => [c.id, c])
        ).values(),
      ];

      // Transform claims to historical statements format
      const historicalStatements: HistoricalStatement[] = allRelevantClaims.map(
        (c) => ({
          id: c.id,
          type: c.type === "promise" ? "commitment" : "decision",
          text: c.text,
          source: c.messageId ?? c.conversationId ?? "unknown",
          date: c.extractedAt ?? new Date(),
          confidence: c.confidence ?? 0.8,
          metadata: c.metadata as Record<string, unknown> | undefined,
        })
      );

      // Run contradiction detection
      const detector = createContradictionDetector();
      const result = detector.checkContradictions(
        {
          content: input.draftContent,
          contentType: "draft",
          threadId: input.threadId,
        },
        historicalStatements
      );

      // Transform result to match frontend Contradiction interface
      const contradictions = result.conflicts.map((conflict) => ({
        id: conflict.id,
        type: conflict.type,
        severity: conflict.severity,
        description: conflict.explanation,
        originalStatement: conflict.historicalStatement,
        originalSource: {
          type: conflict.type,
          id: conflict.id
            .replace("conflict-", "")
            .replace("conflict-date-", "")
            .replace("conflict-amount-", "")
            .replace("conflict-reversal-", "")
            .replace("conflict-statement-", ""),
          title: conflict.historicalStatement.slice(0, 50),
          date: conflict.historicalDate,
        },
        conflictingText: conflict.draftStatement,
        confidence: result.score / 100,
        suggestion: result.suggestions[0]?.suggestedText,
      }));

      return {
        contradictions,
        hasContradictions: result.hasContradiction,
        severity: result.severity,
        score: result.score,
        suggestions: result.suggestions,
      };
    }),
});
