// =============================================================================
// COMPOSE ROUTES
// =============================================================================
//
// Hono routes for sending emails and managing drafts.
// These routes have direct access to the email client.
//

import { auth } from "@memorystack/auth";
import { db } from "@memorystack/db";
import {
  conversation,
  member,
  message,
  sourceAccount,
} from "@memorystack/db/schema";
import { tasks } from "@trigger.dev/sdk/v3";
import { and, desc, eq } from "drizzle-orm";
import { Hono } from "hono";
import { safeDecryptToken } from "../lib/crypto/tokens";
import { createEmailClient } from "../lib/email-client";
import { log } from "../lib/logger";

// Define the type for our context variables
type Variables = {
  userId: string;
};

// =============================================================================
// TYPES
// =============================================================================

interface Recipient {
  email: string;
  name?: string;
}

interface AttachmentInput {
  /** Original filename */
  filename: string;
  /** MIME type */
  mimeType: string;
  /** Size in bytes */
  size: number;
  /** Base64-encoded file content */
  content: string;
  /** For inline attachments */
  contentId?: string;
  /** Whether inline */
  isInline?: boolean;
}

interface ComposeInput {
  organizationId: string;
  accountId: string;
  to: Recipient[];
  cc?: Recipient[];
  bcc?: Recipient[];
  subject: string;
  bodyText?: string;
  bodyHtml?: string;
  replyToThreadId?: string;
  inReplyToMessageId?: string;
  /** File attachments */
  attachments?: AttachmentInput[];
}

interface DraftInput extends ComposeInput {
  draftId?: string;
}

// =============================================================================
// HELPERS
// =============================================================================

async function getSession(req: Request) {
  const session = await auth.api.getSession({ headers: req.headers });
  return session;
}

async function verifyOrgMembership(
  userId: string,
  organizationId: string
): Promise<boolean> {
  const membership = await db.query.member.findFirst({
    where: and(
      eq(member.userId, userId),
      eq(member.organizationId, organizationId)
    ),
  });
  return !!membership;
}

async function getAccountWithAccess(
  userId: string,
  organizationId: string,
  accountId: string
) {
  const hasAccess = await verifyOrgMembership(userId, organizationId);
  if (!hasAccess) {
    return null;
  }

  const account = await db.query.sourceAccount.findFirst({
    where: and(
      eq(sourceAccount.id, accountId),
      eq(sourceAccount.organizationId, organizationId),
      eq(sourceAccount.type, "email")
    ),
  });

  return account;
}

async function getThreadingInfo(
  conversationId: string,
  inReplyToMessageId?: string
): Promise<{
  threadId?: string;
  inReplyTo?: string;
  references?: string[];
}> {
  const conv = await db.query.conversation.findFirst({
    where: eq(conversation.id, conversationId),
    with: {
      messages: {
        orderBy: [desc(message.sentAt)],
        limit: 10,
      },
    },
  });

  if (!conv) {
    return {};
  }

  // Use the external ID as the provider thread ID
  const providerThreadId = conv.externalId;

  let replyToMessage = conv.messages[0];
  if (inReplyToMessageId) {
    const found = conv.messages.find((m: typeof conv.messages[0]) => m.id === inReplyToMessageId);
    if (found) {
      replyToMessage = found;
    }
  }

  const references: string[] = [];
  for (const msg of conv.messages.reverse()) {
    const msgId = (msg.metadata as Record<string, unknown> | null)?.headers as Record<string, string> | undefined;
    const messageId = msgId?.["Message-ID"];
    if (messageId) {
      references.push(messageId);
    }
  }

  const replyHeaders = replyToMessage
    ? ((replyToMessage.metadata as Record<string, unknown> | null)?.headers as Record<string, string> | undefined)
    : undefined;
  const inReplyTo = replyHeaders?.["Message-ID"];

  return {
    threadId: providerThreadId,
    inReplyTo,
    references: references.length > 0 ? references : undefined,
  };
}

// =============================================================================
// ROUTES
// =============================================================================

export const composeRoutes = new Hono<{ Variables: Variables }>();

// Auth middleware
composeRoutes.use("/*", async (c, next) => {
  const session = await getSession(c.req.raw);
  if (!session?.user) {
    return c.json({ error: "Unauthorized" }, 401);
  }
  c.set("userId", session.user.id);
  await next();
});

/**
 * Send an email
 * POST /api/compose/send
 */
composeRoutes.post("/send", async (c) => {
  const userId = c.get("userId") as string;
  const input: ComposeInput = await c.req.json();

  // Validate required fields
  if (!(input.organizationId && input.accountId)) {
    return c.json({ error: "Missing organizationId or accountId" }, 400);
  }
  if (!input.to || input.to.length === 0) {
    return c.json({ error: "At least one recipient is required" }, 400);
  }
  if (!input.subject) {
    return c.json({ error: "Subject is required" }, 400);
  }

  // Get account with access verification
  const account = await getAccountWithAccess(
    userId,
    input.organizationId,
    input.accountId
  );

  if (!account) {
    return c.json({ error: "Email account not found or access denied" }, 404);
  }

  if (account.status !== "connected") {
    return c.json(
      { error: `Email account is not connected (status: ${account.status})` },
      400
    );
  }

  try {
    // Get threading info if replying
    let threadingInfo: {
      threadId?: string;
      inReplyTo?: string;
      references?: string[];
    } = {};

    if (input.replyToThreadId) {
      threadingInfo = await getThreadingInfo(
        input.replyToThreadId,
        input.inReplyToMessageId
      );
    }

    // Create email client
    const client = createEmailClient({
      account: {
        id: account.id,
        provider: account.provider,
        externalId: account.externalId,
        accessToken: account.accessToken,
        refreshToken: account.refreshToken,
        tokenExpiresAt: account.tokenExpiresAt,
      },
      decryptToken: safeDecryptToken,
    });

    // Send the email
    const result = await client.sendMessage({
      to: input.to,
      cc: input.cc,
      bcc: input.bcc,
      subject: input.subject,
      bodyText: input.bodyText,
      bodyHtml: input.bodyHtml,
      attachments: input.attachments,
      ...threadingInfo,
    });

    log.info("Email sent successfully", {
      accountId: account.id,
      messageId: result.messageId,
      threadId: result.threadId,
    });

    // Trigger a sync to fetch the sent email into our database
    try {
      await tasks.trigger("email-sync-on-demand", {
        accountId: account.id,
        reason: "sent-email",
      });
      log.info("Triggered sync after sending email", { accountId: account.id });
    } catch (syncError) {
      // Don't fail the send if sync trigger fails
      log.warn("Failed to trigger sync after sending", {
        error: String(syncError),
      });
    }

    return c.json({
      success: true,
      messageId: result.messageId,
      threadId: result.threadId,
      sentAt: result.sentAt,
    });
  } catch (error) {
    log.error("Failed to send email", error, {
      accountId: account.id,
      to: input.to.map((r) => r.email).join(", "),
    });

    return c.json(
      {
        error: error instanceof Error ? error.message : "Failed to send email",
      },
      500
    );
  }
});

/**
 * Save a draft (create or update)
 * POST /api/compose/draft
 */
composeRoutes.post("/draft", async (c) => {
  const userId = c.get("userId") as string;
  const input: DraftInput = await c.req.json();

  // Validate required fields
  if (!(input.organizationId && input.accountId)) {
    return c.json({ error: "Missing organizationId or accountId" }, 400);
  }

  // Get account with access verification
  const account = await getAccountWithAccess(
    userId,
    input.organizationId,
    input.accountId
  );

  if (!account) {
    return c.json({ error: "Email account not found or access denied" }, 404);
  }

  if (account.status !== "connected") {
    return c.json(
      { error: `Email account is not connected (status: ${account.status})` },
      400
    );
  }

  try {
    // Get threading info if replying
    let threadingInfo: {
      threadId?: string;
      inReplyTo?: string;
      references?: string[];
    } = {};

    if (input.replyToThreadId) {
      threadingInfo = await getThreadingInfo(
        input.replyToThreadId,
        input.inReplyToMessageId
      );
    }

    // Create email client
    const client = createEmailClient({
      account: {
        id: account.id,
        provider: account.provider,
        externalId: account.externalId,
        accessToken: account.accessToken,
        refreshToken: account.refreshToken,
        tokenExpiresAt: account.tokenExpiresAt,
      },
      decryptToken: safeDecryptToken,
    });

    const draftInput = {
      to: input.to || [],
      cc: input.cc,
      bcc: input.bcc,
      subject: input.subject || "",
      bodyText: input.bodyText,
      bodyHtml: input.bodyHtml,
      attachments: input.attachments,
      ...threadingInfo,
    };

    // Create or update draft
    if (input.draftId) {
      const result = await client.updateDraft(input.draftId, draftInput);
      return c.json({
        success: true,
        draftId: result.draftId,
        messageId: result.messageId,
        threadId: result.threadId,
        isNew: false,
      });
    }

    const result = await client.createDraft(draftInput);
    return c.json({
      success: true,
      draftId: result.draftId,
      messageId: result.messageId,
      threadId: result.threadId,
      isNew: true,
    });
  } catch (error) {
    log.error("Failed to save draft", error, { accountId: account.id });

    return c.json(
      {
        error: error instanceof Error ? error.message : "Failed to save draft",
      },
      500
    );
  }
});

/**
 * Get a draft
 * GET /api/compose/draft/:accountId/:draftId
 */
composeRoutes.get("/draft/:accountId/:draftId", async (c) => {
  const userId = c.get("userId") as string;
  const { accountId, draftId } = c.req.param();
  const organizationId = c.req.query("organizationId");

  if (!organizationId) {
    return c.json({ error: "Missing organizationId query parameter" }, 400);
  }

  // Get account with access verification
  const account = await getAccountWithAccess(userId, organizationId, accountId);

  if (!account) {
    return c.json({ error: "Email account not found or access denied" }, 404);
  }

  try {
    // Create email client
    const client = createEmailClient({
      account: {
        id: account.id,
        provider: account.provider,
        externalId: account.externalId,
        accessToken: account.accessToken,
        refreshToken: account.refreshToken,
        tokenExpiresAt: account.tokenExpiresAt,
      },
      decryptToken: safeDecryptToken,
    });

    const draft = await client.getDraft(draftId);

    if (!draft) {
      return c.json({ error: "Draft not found" }, 404);
    }

    return c.json(draft);
  } catch (error) {
    log.error("Failed to get draft", error, { accountId, draftId });

    return c.json(
      {
        error: error instanceof Error ? error.message : "Failed to get draft",
      },
      500
    );
  }
});

/**
 * Delete a draft
 * DELETE /api/compose/draft/:accountId/:draftId
 */
composeRoutes.delete("/draft/:accountId/:draftId", async (c) => {
  const userId = c.get("userId") as string;
  const { accountId, draftId } = c.req.param();
  const organizationId = c.req.query("organizationId");

  if (!organizationId) {
    return c.json({ error: "Missing organizationId query parameter" }, 400);
  }

  // Get account with access verification
  const account = await getAccountWithAccess(userId, organizationId, accountId);

  if (!account) {
    return c.json({ error: "Email account not found or access denied" }, 404);
  }

  try {
    // Create email client
    const client = createEmailClient({
      account: {
        id: account.id,
        provider: account.provider,
        externalId: account.externalId,
        accessToken: account.accessToken,
        refreshToken: account.refreshToken,
        tokenExpiresAt: account.tokenExpiresAt,
      },
      decryptToken: safeDecryptToken,
    });

    await client.deleteDraft(draftId);

    return c.json({ success: true });
  } catch (error) {
    log.error("Failed to delete draft", error, { accountId, draftId });

    return c.json(
      {
        error:
          error instanceof Error ? error.message : "Failed to delete draft",
      },
      500
    );
  }
});
