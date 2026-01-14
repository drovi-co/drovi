// =============================================================================
// COMPOSE ROUTER
// =============================================================================
//
// API for compose operations that only need database access.
// Send/draft operations are handled by the server's Hono routes.
//

import { db } from "@memorystack/db";
import { emailMessage, emailThread, member } from "@memorystack/db/schema";
import { TRPCError } from "@trpc/server";
import { and, desc, eq } from "drizzle-orm";
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
      const thread = await db.query.emailThread.findFirst({
        where: eq(emailThread.id, input.threadId),
        with: {
          messages: {
            orderBy: [desc(emailMessage.sentAt)],
          },
          account: true,
        },
      });

      if (!thread) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Thread not found",
        });
      }

      const lastMessage = thread.messages[0];
      const userEmail = thread.account?.email ?? "";

      // Build reply subject
      const subject = (thread.subject ?? "").startsWith("Re: ")
        ? thread.subject
        : `Re: ${thread.subject ?? ""}`;

      // Build reply recipients - reply to sender, excluding self
      const toRecipients: Array<{ email: string; name?: string }> = [];
      const ccRecipients: Array<{ email: string; name?: string }> = [];

      if (lastMessage) {
        // Add the sender as the primary recipient
        const sender = lastMessage.fromEmail;
        if (sender && sender !== userEmail) {
          toRecipients.push({
            email: sender,
            name: lastMessage.fromName ?? undefined,
          });
        }

        // Add other To/CC recipients (for Reply All)
        const msgToRecipients = (lastMessage.toRecipients ?? []) as Array<{ email: string; name?: string }>;
        const msgCcRecipients = (lastMessage.ccRecipients ?? []) as Array<{ email: string; name?: string }>;

        for (const recipient of msgToRecipients) {
          if (recipient.email !== userEmail && recipient.email !== sender) {
            toRecipients.push({ email: recipient.email, name: recipient.name });
          }
        }

        for (const recipient of msgCcRecipients) {
          if (recipient.email !== userEmail && recipient.email !== sender) {
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
        const from = lastMessage.fromName ?? lastMessage.fromEmail ?? "Unknown";
        const bodyText = lastMessage.bodyText ?? lastMessage.snippet ?? "";

        quotedBody = `\n\n---\nOn ${date}, ${from} wrote:\n\n${bodyText
          .split("\n")
          .map((line) => `> ${line}`)
          .join("\n")}`;
      }

      return {
        accountId: thread.accountId,
        subject,
        toRecipients,
        ccRecipients,
        quotedBody,
        replyToThreadId: thread.id,
        inReplyToMessageId: lastMessage?.id,
      };
    }),
});
