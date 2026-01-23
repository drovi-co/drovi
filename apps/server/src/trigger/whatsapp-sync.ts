// =============================================================================
// WHATSAPP SYNC TRIGGER TASKS
// =============================================================================
//
// Trigger.dev tasks for syncing WhatsApp Business data and processing
// incoming messages into the multi-source intelligence platform.
//
// NOTE: WhatsApp Cloud API doesn't support fetching message history.
// Messages are received via webhooks and stored locally. This sync task:
// 1. Verifies account status and refreshes token if needed
// 2. Syncs WABA info and phone numbers
// 3. Syncs message templates
// 4. Triggers intelligence extraction for unprocessed messages
//

import { randomUUID } from "node:crypto";
import {
  debugWhatsAppToken,
  getWhatsAppPhoneNumbers,
  WHATSAPP_API_BASE,
} from "@memorystack/auth/providers/whatsapp";
import { db } from "@memorystack/db";
import {
  contact,
  conversation,
  message,
  sourceAccount,
  whatsappBusinessAccount,
  whatsappContactCache,
  whatsappMessageMeta,
  whatsappPhoneNumber,
  whatsappTemplate,
} from "@memorystack/db/schema";
import { logger, schedules, task } from "@trigger.dev/sdk/v3";
import { and, eq, isNull, sql } from "drizzle-orm";
import { safeDecryptToken } from "../lib/crypto/tokens";
import {
  callPythonIntelligence,
  checkIntelligenceBackendHealth,
} from "../lib/intelligence-backend";

const log = logger;

// =============================================================================
// TYPES
// =============================================================================

interface WhatsAppSyncPayload {
  /** Source account ID for WhatsApp Business Account */
  sourceAccountId: string;
  /** Whether to do a full sync vs incremental */
  fullSync?: boolean;
}

interface WhatsAppSyncResult {
  success: boolean;
  sourceAccountId: string;
  phoneNumbersSynced: number;
  templatesSynced: number;
  conversationsProcessed: number;
  messagesProcessed: number;
  errors: string[];
}

interface WhatsAppMessageReceivedPayload {
  wabaId: string;
  phoneNumberId: string;
  message: {
    id: string;
    from: string;
    timestamp: string;
    type: string;
    text?: { body: string };
    image?: { id: string; mime_type: string; sha256: string; caption?: string };
    audio?: { id: string; mime_type: string; voice?: boolean };
    video?: { id: string; mime_type: string; sha256: string; caption?: string };
    document?: {
      id: string;
      mime_type: string;
      sha256: string;
      filename?: string;
      caption?: string;
    };
    sticker?: { id: string; mime_type: string; animated?: boolean };
    location?: {
      latitude: number;
      longitude: number;
      name?: string;
      address?: string;
    };
    contacts?: unknown[];
    context?: { from: string; id: string; forwarded?: boolean };
    reaction?: { message_id: string; emoji: string };
  };
  contacts?: Array<{
    profile: { name: string };
    wa_id: string;
  }>;
}

// =============================================================================
// MAIN WHATSAPP SYNC TASK
// =============================================================================

/**
 * Sync WhatsApp Business Account data.
 * Since WhatsApp doesn't provide message history API, this focuses on:
 * - Account status verification
 * - Phone number sync
 * - Template sync
 */
export const syncWhatsAppTask = task({
  id: "whatsapp-sync",
  queue: { name: "whatsapp-sync", concurrencyLimit: 3 },
  retry: {
    maxAttempts: 3,
    minTimeoutInMs: 5000,
    maxTimeoutInMs: 60_000,
    factor: 2,
  },
  maxDuration: 300, // 5 minutes max

  run: async (payload: WhatsAppSyncPayload): Promise<WhatsAppSyncResult> => {
    const { sourceAccountId, fullSync = false } = payload;

    const result: WhatsAppSyncResult = {
      success: false,
      sourceAccountId,
      phoneNumbersSynced: 0,
      templatesSynced: 0,
      conversationsProcessed: 0,
      messagesProcessed: 0,
      errors: [],
    };

    log.info("Starting WhatsApp sync", { sourceAccountId, fullSync });

    try {
      // Get source account
      const account = await db.query.sourceAccount.findFirst({
        where: eq(sourceAccount.id, sourceAccountId),
      });

      if (!account) {
        result.errors.push("Source account not found");
        return result;
      }

      if (account.type !== "whatsapp") {
        result.errors.push("Source account is not a WhatsApp account");
        return result;
      }

      // Decrypt access token
      const accessToken = account.accessToken
        ? await safeDecryptToken(account.accessToken)
        : null;

      if (!accessToken) {
        result.errors.push("No access token found");
        return result;
      }

      // Verify token is still valid
      try {
        const tokenInfo = await debugWhatsAppToken(accessToken);
        if (!tokenInfo.isValid) {
          result.errors.push("Access token is invalid or expired");
          await db
            .update(sourceAccount)
            .set({
              status: "error",
              lastSyncError: "Token expired",
              updatedAt: new Date(),
            })
            .where(eq(sourceAccount.id, sourceAccountId));
          return result;
        }
      } catch (error) {
        log.warn("Token verification failed, continuing with sync", { error });
      }

      // Get WABA record
      const waba = await db.query.whatsappBusinessAccount.findFirst({
        where: eq(whatsappBusinessAccount.sourceAccountId, sourceAccountId),
      });

      if (!waba) {
        result.errors.push("WhatsApp Business Account not found");
        return result;
      }

      // Sync phone numbers
      try {
        const phoneNumbers = await getWhatsAppPhoneNumbers(
          waba.wabaId,
          accessToken
        );

        for (const pn of phoneNumbers) {
          await db
            .insert(whatsappPhoneNumber)
            .values({
              id: randomUUID(),
              wabaId: waba.id,
              phoneNumberId: pn.id,
              displayPhoneNumber: pn.display_phone_number,
              verifiedName: pn.verified_name,
              qualityRating: pn.quality_rating,
              codeVerificationStatus: pn.code_verification_status,
              lastSyncAt: new Date(),
              createdAt: new Date(),
              updatedAt: new Date(),
            })
            .onConflictDoUpdate({
              target: [
                whatsappPhoneNumber.wabaId,
                whatsappPhoneNumber.phoneNumberId,
              ],
              set: {
                displayPhoneNumber: pn.display_phone_number,
                verifiedName: pn.verified_name,
                qualityRating: pn.quality_rating,
                codeVerificationStatus: pn.code_verification_status,
                lastSyncAt: new Date(),
                updatedAt: new Date(),
              },
            });

          result.phoneNumbersSynced++;
        }

        log.info("Synced phone numbers", { count: result.phoneNumbersSynced });
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        result.errors.push(`Phone number sync failed: ${errorMsg}`);
        log.error("Failed to sync phone numbers", { error: errorMsg });
      }

      // Sync message templates
      try {
        const templates = await fetchMessageTemplates(waba.wabaId, accessToken);

        for (const template of templates) {
          await db
            .insert(whatsappTemplate)
            .values({
              id: randomUUID(),
              wabaId: waba.id,
              templateId: template.id,
              name: template.name,
              language: template.language,
              category: template.category,
              status: template.status,
              components: template.components,
              createdAt: new Date(),
              updatedAt: new Date(),
            })
            .onConflictDoUpdate({
              target: [
                whatsappTemplate.wabaId,
                whatsappTemplate.name,
                whatsappTemplate.language,
              ],
              set: {
                templateId: template.id,
                category: template.category,
                status: template.status,
                components: template.components,
                updatedAt: new Date(),
              },
            });

          result.templatesSynced++;
        }

        log.info("Synced message templates", { count: result.templatesSynced });
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        result.errors.push(`Template sync failed: ${errorMsg}`);
        log.error("Failed to sync templates", { error: errorMsg });
      }

      // Update last sync timestamp
      await db
        .update(sourceAccount)
        .set({
          lastSyncAt: new Date(),
          lastSyncStatus: "success",
          lastSyncError: null,
          updatedAt: new Date(),
        })
        .where(eq(sourceAccount.id, sourceAccountId));

      result.success = true;

      log.info("WhatsApp sync completed", {
        sourceAccountId,
        phoneNumbersSynced: result.phoneNumbersSynced,
        templatesSynced: result.templatesSynced,
        errors: result.errors.length,
      });
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      result.errors.push(errorMsg);

      await db
        .update(sourceAccount)
        .set({
          lastSyncStatus: "error",
          lastSyncError: errorMsg,
          updatedAt: new Date(),
        })
        .where(eq(sourceAccount.id, sourceAccountId));

      log.error("WhatsApp sync failed", { sourceAccountId, error: errorMsg });
    }

    return result;
  },
});

// =============================================================================
// MESSAGE RECEIVED TASK
// =============================================================================

/**
 * Process an incoming WhatsApp message from webhook.
 * This task is triggered when a message is received via the webhook endpoint.
 */
export const whatsappMessageReceivedTask = task({
  id: "whatsapp-message-received",
  queue: { name: "whatsapp-messages", concurrencyLimit: 10 },
  retry: {
    maxAttempts: 3,
    minTimeoutInMs: 1000,
    maxTimeoutInMs: 30_000,
    factor: 2,
  },
  maxDuration: 120, // 2 minutes max

  run: async (payload: WhatsAppMessageReceivedPayload) => {
    const { wabaId, phoneNumberId, message: msg, contacts } = payload;

    log.info("Processing WhatsApp message", {
      wabaId,
      phoneNumberId,
      messageId: msg.id,
      from: msg.from,
      type: msg.type,
    });

    try {
      // Find the source account for this WABA
      const waba = await db.query.whatsappBusinessAccount.findFirst({
        where: eq(whatsappBusinessAccount.wabaId, wabaId),
        with: {
          sourceAccount: true,
        },
      });

      if (!waba) {
        log.error("WABA not found for incoming message", { wabaId });
        return { success: false, error: "WABA not found" };
      }

      const sourceAccountId = waba.sourceAccountId;

      // Get or create contact cache
      const contact = contacts?.[0];
      const contactName = contact?.profile?.name;

      await db
        .insert(whatsappContactCache)
        .values({
          id: randomUUID(),
          sourceAccountId,
          waId: msg.from,
          phoneNumber: `+${msg.from}`,
          profileName: contactName,
          pushName: contactName,
          messageCount: 1,
          lastMessageAt: new Date(Number.parseInt(msg.timestamp, 10) * 1000),
          lastFetchedAt: new Date(),
          createdAt: new Date(),
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: [
            whatsappContactCache.sourceAccountId,
            whatsappContactCache.waId,
          ],
          set: {
            profileName:
              contactName ?? sql`${whatsappContactCache.profileName}`,
            pushName: contactName ?? sql`${whatsappContactCache.pushName}`,
            messageCount: sql`${whatsappContactCache.messageCount} + 1`,
            lastMessageAt: new Date(Number.parseInt(msg.timestamp, 10) * 1000),
            lastFetchedAt: new Date(),
            updatedAt: new Date(),
          },
        });

      // Create or get conversation for this contact
      const conversationExternalId = msg.from;
      const existingConv = await db.query.conversation.findFirst({
        where: and(
          eq(conversation.sourceAccountId, sourceAccountId),
          eq(conversation.externalId, conversationExternalId)
        ),
      });

      const now = new Date();
      const sentAt = new Date(Number.parseInt(msg.timestamp, 10) * 1000);

      let convId: string;

      if (existingConv) {
        // Update existing conversation
        convId = existingConv.id;
        await db
          .update(conversation)
          .set({
            snippet: getMessageSnippet(msg),
            messageCount: sql`${conversation.messageCount} + 1`,
            lastMessageAt: sentAt,
            isRead: false,
            updatedAt: now,
          })
          .where(eq(conversation.id, convId));
      } else {
        // Create new conversation
        convId = randomUUID();
        await db.insert(conversation).values({
          id: convId,
          sourceAccountId,
          externalId: conversationExternalId,
          conversationType: "dm",
          title: contactName ?? formatPhoneNumber(msg.from),
          snippet: getMessageSnippet(msg),
          participantIds: [msg.from, phoneNumberId],
          messageCount: 1,
          firstMessageAt: sentAt,
          lastMessageAt: sentAt,
          isRead: false,
          isStarred: false,
          isArchived: false,
          metadata: {
            waId: msg.from,
            phoneNumberId,
            wabaId,
            contactName,
          },
          createdAt: now,
          updatedAt: now,
        });
      }

      // Insert message
      const messageId = randomUUID();
      await db.insert(message).values({
        id: messageId,
        conversationId: convId,
        externalId: msg.id,
        senderExternalId: msg.from,
        senderName: contactName,
        senderEmail: undefined,
        subject: undefined,
        bodyText: getMessageText(msg),
        sentAt,
        receivedAt: now,
        isFromUser: false, // Incoming message is from contact, not our user
        messageIndex: 0, // Will be updated
        hasAttachments: hasMedia(msg),
        metadata: {
          wamId: msg.id,
          messageType: msg.type,
          context: msg.context,
          reaction: msg.reaction,
        },
        createdAt: now,
        updatedAt: now,
      });

      // Insert WhatsApp-specific message metadata
      await db.insert(whatsappMessageMeta).values({
        id: randomUUID(),
        sourceAccountId,
        wamId: msg.id,
        phoneNumberId,
        fromWaId: msg.from,
        toWaId: undefined, // Incoming message
        messageType: msg.type,
        status: "received",
        statusTimestamp: sentAt,
        mediaId: getMediaId(msg),
        mediaMimeType: getMediaMimeType(msg),
        contextMessageId: msg.context?.id,
        isForwarded: msg.context?.forwarded,
        createdAt: now,
        updatedAt: now,
      });

      log.info("WhatsApp message processed", {
        messageId,
        conversationId: convId,
        from: msg.from,
      });

      // Trigger conversation analysis for intelligence extraction
      // Use debounce to avoid analyzing on every single message
      try {
        await analyzeWhatsAppConversationTask.trigger(
          { conversationId: convId },
          {
            debounce: {
              key: `whatsapp-analysis-${convId}`,
              delay: "30s", // Wait 30 seconds for more messages before analyzing
              mode: "trailing", // Use the latest trigger (most recent message)
            },
          }
        );
        log.info("Triggered WhatsApp conversation analysis", {
          conversationId: convId,
        });
      } catch (e) {
        log.warn("Failed to trigger WhatsApp conversation analysis", {
          error: e,
        });
      }

      return { success: true, messageId, conversationId: convId };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      log.error("Failed to process WhatsApp message", {
        messageId: msg.id,
        error: errorMsg,
      });
      throw error;
    }
  },
});

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Fetch message templates from WhatsApp API.
 */
type WhatsAppTemplateComponent = {
  type: "HEADER" | "BODY" | "FOOTER" | "BUTTONS";
  format?: string;
  text?: string;
  example?: { header_text?: string[]; body_text?: string[][] };
  buttons?: Array<{
    type: string;
    text: string;
    url?: string;
    phone_number?: string;
  }>;
};

async function fetchMessageTemplates(
  wabaId: string,
  accessToken: string
): Promise<
  Array<{
    id: string;
    name: string;
    language: string;
    category: string;
    status: string;
    components: WhatsAppTemplateComponent[];
  }>
> {
  const response = await fetch(
    `${WHATSAPP_API_BASE}/${wabaId}/message_templates?access_token=${accessToken}`
  );

  if (!response.ok) {
    throw new Error(`Failed to fetch templates: ${response.status}`);
  }

  const data = (await response.json()) as {
    data: Array<{
      id: string;
      name: string;
      language: string;
      category: string;
      status: string;
      components: WhatsAppTemplateComponent[];
    }>;
    error?: { message: string };
  };

  if (data.error) {
    throw new Error(`WhatsApp API error: ${data.error.message}`);
  }

  return data.data ?? [];
}

/**
 * Extract text content from a WhatsApp message.
 */
function getMessageText(
  msg: WhatsAppMessageReceivedPayload["message"]
): string {
  switch (msg.type) {
    case "text":
      return msg.text?.body ?? "";
    case "image":
      return msg.image?.caption ?? "[Image]";
    case "video":
      return msg.video?.caption ?? "[Video]";
    case "audio":
      return msg.audio?.voice ? "[Voice Message]" : "[Audio]";
    case "document":
      return (
        msg.document?.caption ??
        `[Document: ${msg.document?.filename ?? "file"}]`
      );
    case "sticker":
      return "[Sticker]";
    case "location":
      return msg.location?.name ?? msg.location?.address ?? "[Location]";
    case "contacts":
      return "[Contact Shared]";
    case "reaction":
      return `Reacted with ${msg.reaction?.emoji ?? ""}`;
    default:
      return "[Unknown Message Type]";
  }
}

/**
 * Get a short snippet for conversation preview.
 */
function getMessageSnippet(
  msg: WhatsAppMessageReceivedPayload["message"]
): string {
  const text = getMessageText(msg);
  return text.length > 100 ? `${text.slice(0, 97)}...` : text;
}

/**
 * Check if message has media attachments.
 */
function hasMedia(msg: WhatsAppMessageReceivedPayload["message"]): boolean {
  return ["image", "video", "audio", "document", "sticker"].includes(msg.type);
}

/**
 * Get media ID from message.
 */
function getMediaId(
  msg: WhatsAppMessageReceivedPayload["message"]
): string | undefined {
  switch (msg.type) {
    case "image":
      return msg.image?.id;
    case "video":
      return msg.video?.id;
    case "audio":
      return msg.audio?.id;
    case "document":
      return msg.document?.id;
    case "sticker":
      return msg.sticker?.id;
    default:
      return undefined;
  }
}

/**
 * Get media MIME type from message.
 */
function getMediaMimeType(
  msg: WhatsAppMessageReceivedPayload["message"]
): string | undefined {
  switch (msg.type) {
    case "image":
      return msg.image?.mime_type;
    case "video":
      return msg.video?.mime_type;
    case "audio":
      return msg.audio?.mime_type;
    case "document":
      return msg.document?.mime_type;
    case "sticker":
      return msg.sticker?.mime_type;
    default:
      return undefined;
  }
}

/**
 * Format a WhatsApp ID (phone number) for display.
 */
function formatPhoneNumber(waId: string): string {
  if (waId.length === 11 && waId.startsWith("1")) {
    return `+1 (${waId.slice(1, 4)}) ${waId.slice(4, 7)}-${waId.slice(7)}`;
  }
  return `+${waId}`;
}

// =============================================================================
// CONVERSATION ANALYSIS TASK
// =============================================================================

interface WhatsAppConversationAnalysisPayload {
  conversationId: string;
  force?: boolean;
}

interface WhatsAppConversationAnalysisResult {
  success: boolean;
  conversationId: string;
  claimsCreated: number;
  commitmentsCreated: number;
  decisionsCreated: number;
  error?: string;
}

/**
 * Analyze a WhatsApp conversation for intelligence extraction.
 * Uses Python backend for all AI processing.
 */
export const analyzeWhatsAppConversationTask = task({
  id: "whatsapp-conversation-analysis",
  queue: { name: "whatsapp-analysis", concurrencyLimit: 10 },
  retry: {
    maxAttempts: 3,
    minTimeoutInMs: 5000,
    maxTimeoutInMs: 60_000,
    factor: 2,
  },
  maxDuration: 180, // 3 minutes max

  run: async (
    payload: WhatsAppConversationAnalysisPayload
  ): Promise<WhatsAppConversationAnalysisResult> => {
    const { conversationId, force = false } = payload;

    log.info("Starting WhatsApp conversation analysis via Python backend", {
      conversationId,
      force,
    });

    const result: WhatsAppConversationAnalysisResult = {
      success: false,
      conversationId,
      claimsCreated: 0,
      commitmentsCreated: 0,
      decisionsCreated: 0,
    };

    try {
      // Verify Python backend is available
      const isHealthy = await checkIntelligenceBackendHealth();
      if (!isHealthy) {
        result.error = "Python intelligence backend is not available";
        return result;
      }

      // Get conversation with messages and source account
      const conv = await db.query.conversation.findFirst({
        where: eq(conversation.id, conversationId),
        with: {
          messages: {
            orderBy: (m, { asc }) => [asc(m.sentAt)],
          },
          sourceAccount: true,
        },
      });

      if (!conv) {
        result.error = "Conversation not found";
        return result;
      }

      // Skip if recently analyzed (unless forced)
      if (!force && conv.lastAnalyzedAt) {
        const hoursSinceAnalysis =
          (Date.now() - conv.lastAnalyzedAt.getTime()) / (1000 * 60 * 60);
        if (hoursSinceAnalysis < 24) {
          log.info("Skipping recently analyzed conversation", {
            conversationId,
            hoursSinceAnalysis,
          });
          result.success = true;
          return result;
        }
      }

      // Skip analysis if not enough content
      if (conv.messages.length === 0) {
        log.info("Skipping analysis - no messages", { conversationId });
        result.success = true;
        return result;
      }

      // Build content string from messages for Python backend
      const content = conv.messages
        .map((msg) => {
          const sender = msg.senderName ?? msg.senderExternalId ?? "Unknown";
          const timestamp = msg.sentAt?.toISOString() ?? "";
          return `[${timestamp}] ${sender}: ${msg.bodyText ?? ""}`;
        })
        .join("\n");

      // Call Python backend for intelligence extraction
      log.info("Calling Python backend for WhatsApp analysis", {
        conversationId,
        messageCount: conv.messages.length,
        contentLength: content.length,
      });

      const analysis = await callPythonIntelligence({
        content,
        organization_id: conv.sourceAccount.organizationId,
        source_type: "whatsapp",
        source_id: conv.externalId ?? conversationId,
        source_account_id: conv.sourceAccountId,
        conversation_id: conversationId,
      });

      log.info("Python backend analysis completed", {
        conversationId,
        claims: analysis.claims.length,
        commitments: analysis.commitments.length,
        decisions: analysis.decisions.length,
        risks: analysis.risks.length,
      });

      // Update result counts (Python already persisted to DB)
      result.claimsCreated = analysis.claims.length;
      result.commitmentsCreated = analysis.commitments.length;
      result.decisionsCreated = analysis.decisions.length;

      // Update conversation with analysis results
      const priorityTier =
        analysis.overall_confidence >= 0.8
          ? "urgent"
          : analysis.overall_confidence >= 0.6
            ? "high"
            : analysis.overall_confidence >= 0.4
              ? "medium"
              : "low";

      await db
        .update(conversation)
        .set({
          hasOpenLoops: analysis.commitments.length > 0,
          openLoopCount: analysis.commitments.length,
          priorityTier,
          urgencyScore: analysis.overall_confidence,
          importanceScore: analysis.overall_confidence,
          lastAnalyzedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(conversation.id, conversationId));

      // Note: Python backend handles commitment/decision/claim persistence
      // Only handle contact creation here

      // Extract and create/update contacts
      const contactEmails = new Set<string>();
      for (const msg of conv.messages) {
        if (msg.senderExternalId) {
          contactEmails.add(msg.senderExternalId);
        }
      }

      for (const waId of contactEmails) {
        // Check if contact exists
        const existingContact = await db.query.contact.findFirst({
          where: and(
            eq(contact.organizationId, conv.sourceAccount.organizationId),
            eq(contact.primaryEmail, `whatsapp:${waId}`)
          ),
        });

        // Get contact info from cache
        const cachedContact = await db.query.whatsappContactCache.findFirst({
          where: and(
            eq(whatsappContactCache.sourceAccountId, conv.sourceAccountId),
            eq(whatsappContactCache.waId, waId)
          ),
        });

        if (existingContact) {
          // Update existing contact
          await db
            .update(contact)
            .set({
              lastInteractionAt: conv.lastMessageAt ?? new Date(),
              totalMessages: sql`${contact.totalMessages} + 1`,
              updatedAt: new Date(),
            })
            .where(eq(contact.id, existingContact.id));
        } else {
          await db.insert(contact).values({
            id: randomUUID(),
            organizationId: conv.sourceAccount.organizationId,
            primaryEmail: `whatsapp:${waId}`,
            displayName: cachedContact?.profileName ?? formatPhoneNumber(waId),
            phone: formatPhoneNumber(waId),
            enrichmentSource: "whatsapp",
            lastInteractionAt: conv.lastMessageAt ?? new Date(),
            totalMessages: conv.messageCount ?? 1,
            metadata: {
              waId,
              sourceAccountId: conv.sourceAccountId,
              source: "whatsapp",
            },
          });
        }
      }

      // Note: Embedding generation and memory episodes are handled by the Python intelligence backend

      result.success = true;

      log.info("WhatsApp conversation analysis completed", {
        conversationId,
        claimsCreated: result.claimsCreated,
        commitmentsCreated: result.commitmentsCreated,
        decisionsCreated: result.decisionsCreated,
      });

      return result;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      result.error = errorMsg;
      log.error("WhatsApp conversation analysis failed", {
        conversationId,
        error: errorMsg,
      });
      return result;
    }
  },
});

/**
 * Batch analyze unprocessed WhatsApp conversations.
 */
export const analyzeWhatsAppConversationsBatchTask = task({
  id: "whatsapp-conversation-analysis-batch",
  queue: { name: "whatsapp-analysis", concurrencyLimit: 3 },
  retry: {
    maxAttempts: 2,
    minTimeoutInMs: 10_000,
    maxTimeoutInMs: 120_000,
    factor: 2,
  },
  maxDuration: 600, // 10 minutes max

  run: async (payload: {
    sourceAccountId: string;
    limit?: number;
    force?: boolean;
  }) => {
    const { sourceAccountId, limit = 50, force = false } = payload;

    log.info("Starting batch WhatsApp conversation analysis", {
      sourceAccountId,
      limit,
      force,
    });

    // Get unanalyzed conversations
    const whereClause = force
      ? eq(conversation.sourceAccountId, sourceAccountId)
      : and(
          eq(conversation.sourceAccountId, sourceAccountId),
          isNull(conversation.lastAnalyzedAt)
        );

    const conversations = await db.query.conversation.findMany({
      where: whereClause,
      orderBy: (c, { desc }) => [desc(c.lastMessageAt)],
      limit,
      columns: { id: true },
    });

    log.info("Found conversations for batch analysis", {
      sourceAccountId,
      count: conversations.length,
    });

    let processed = 0;
    let failed = 0;

    for (const conv of conversations) {
      try {
        await analyzeWhatsAppConversationTask.trigger({
          conversationId: conv.id,
          force,
        });
        processed++;
      } catch (error) {
        failed++;
        log.error("Failed to queue conversation for analysis", {
          conversationId: conv.id,
          error,
        });
      }
    }

    return {
      total: conversations.length,
      processed,
      failed,
    };
  },
});

// =============================================================================
// SCHEDULED SYNC
// =============================================================================

/**
 * Scheduled task to sync all WhatsApp accounts.
 * Runs every 15 minutes (less frequently than Slack since most data comes via webhooks).
 */
export const syncWhatsAppSchedule = schedules.task({
  id: "whatsapp-sync-schedule",
  cron: "*/15 * * * *", // Every 15 minutes
  run: async () => {
    log.info("Starting scheduled WhatsApp sync");

    // Get all active WhatsApp source accounts
    const whatsappAccounts = await db.query.sourceAccount.findMany({
      where: and(
        eq(sourceAccount.type, "whatsapp"),
        eq(sourceAccount.status, "connected")
      ),
      columns: { id: true },
    });

    if (whatsappAccounts.length === 0) {
      log.info("No WhatsApp accounts to sync");
      return { scheduled: true, accountsTriggered: 0 };
    }

    // Trigger sync for each account
    for (const account of whatsappAccounts) {
      await syncWhatsAppTask.trigger({
        sourceAccountId: account.id,
        fullSync: false,
      });

      // Also trigger batch analysis for any unprocessed conversations
      await analyzeWhatsAppConversationsBatchTask.trigger({
        sourceAccountId: account.id,
        limit: 20, // Process up to 20 unanalyzed conversations per sync
      });
    }

    log.info("Scheduled WhatsApp sync triggered", {
      accounts: whatsappAccounts.length,
    });

    return { scheduled: true, accountsTriggered: whatsappAccounts.length };
  },
});

// =============================================================================
// EXPORTS
// =============================================================================

export type {
  WhatsAppSyncPayload,
  WhatsAppSyncResult,
  WhatsAppMessageReceivedPayload,
  WhatsAppConversationAnalysisPayload,
  WhatsAppConversationAnalysisResult,
};
