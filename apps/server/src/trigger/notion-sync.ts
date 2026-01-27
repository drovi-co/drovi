// =============================================================================
// NOTION SYNC TRIGGER TASKS
// =============================================================================
//
// Trigger.dev tasks for syncing Notion workspace data and processing pages
// and comments into the multi-source intelligence platform.
//

import { randomUUID } from "node:crypto";
import {
  extractTextFromBlocks,
  extractTextFromProperties,
  getNotionBlocks,
  getNotionComments,
  getNotionPageTitle,
  type NotionBlock,
  type NotionComment,
  type NotionPage,
  queryNotionDatabase,
  searchNotion,
} from "@memorystack/auth/providers/notion";
import { db } from "@memorystack/db";
import {
  type ConversationMetadata,
  contact,
  conversation,
  message,
  notionDatabase,
  notionPageCache,
  notionUserCache,
  notionWorkspace,
  sourceAccount,
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

interface NotionSyncPayload {
  /** Source account ID for Notion workspace */
  sourceAccountId: string;
  /** Whether to do a full sync vs incremental */
  fullSync?: boolean;
}

interface NotionSyncResult {
  success: boolean;
  sourceAccountId: string;
  pagesSynced: number;
  databasesSynced: number;
  conversationsCreated: number;
  errors: string[];
}

// =============================================================================
// MAIN NOTION SYNC TASK
// =============================================================================

/**
 * Sync Notion workspace data including pages and databases.
 */
export const syncNotionTask = task({
  id: "notion-sync",
  queue: { name: "notion-sync", concurrencyLimit: 3 },
  retry: {
    maxAttempts: 3,
    minTimeoutInMs: 5000,
    maxTimeoutInMs: 60_000,
    factor: 2,
  },
  maxDuration: 600, // 10 minutes max

  run: async (payload: NotionSyncPayload): Promise<NotionSyncResult> => {
    const { sourceAccountId, fullSync = false } = payload;

    const result: NotionSyncResult = {
      success: false,
      sourceAccountId,
      pagesSynced: 0,
      databasesSynced: 0,
      conversationsCreated: 0,
      errors: [],
    };

    log.info("Starting Notion sync", { sourceAccountId, fullSync });

    try {
      // Get source account
      const account = await db.query.sourceAccount.findFirst({
        where: eq(sourceAccount.id, sourceAccountId),
      });

      if (!account) {
        result.errors.push("Source account not found");
        return result;
      }

      if (account.type !== "notion") {
        result.errors.push("Source account is not a Notion account");
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

      // Get or create workspace record
      const workspaceId = account.externalId ?? "";
      let workspace = await db.query.notionWorkspace.findFirst({
        where: and(
          eq(notionWorkspace.sourceAccountId, sourceAccountId),
          eq(notionWorkspace.notionWorkspaceId, workspaceId)
        ),
      });

      if (!workspace) {
        const settings = account.settings as {
          customSettings?: {
            botId?: string;
            ownerId?: string;
            ownerEmail?: string;
          };
        } | null;
        await db.insert(notionWorkspace).values({
          id: randomUUID(),
          sourceAccountId,
          notionWorkspaceId: workspaceId,
          notionBotId: settings?.customSettings?.botId,
          name: account.displayName,
          ownerId: settings?.customSettings?.ownerId,
          ownerEmail: settings?.customSettings?.ownerEmail,
          createdAt: new Date(),
          updatedAt: new Date(),
        });

        workspace = await db.query.notionWorkspace.findFirst({
          where: and(
            eq(notionWorkspace.sourceAccountId, sourceAccountId),
            eq(notionWorkspace.notionWorkspaceId, workspaceId)
          ),
        });
      }

      // Search for pages
      log.info("Searching for Notion pages", { sourceAccountId });

      let cursor: string | undefined;
      let hasMore = true;

      while (hasMore) {
        try {
          const searchResult = await searchNotion(accessToken, {
            filter: { property: "object", value: "page" },
            sort: { direction: "descending", timestamp: "last_edited_time" },
            startCursor: cursor,
            pageSize: 100,
          });

          for (const item of searchResult.results) {
            if (item.object === "page") {
              const page = item as NotionPage;
              await syncNotionPage(
                accessToken,
                page,
                sourceAccountId,
                workspaceId,
                account.organizationId,
                result
              );
            }
          }

          hasMore = searchResult.has_more;
          cursor = searchResult.next_cursor ?? undefined;

          // Rate limiting: Notion allows 3 requests/second
          await new Promise((resolve) => setTimeout(resolve, 350));
        } catch (error) {
          const errorMsg =
            error instanceof Error ? error.message : String(error);
          result.errors.push(`Page search failed: ${errorMsg}`);
          log.error("Failed to search pages", { error: errorMsg });
          hasMore = false;
        }
      }

      // Search for databases
      log.info("Searching for Notion databases", { sourceAccountId });

      cursor = undefined;
      hasMore = true;

      while (hasMore) {
        try {
          const searchResult = await searchNotion(accessToken, {
            filter: { property: "object", value: "database" },
            sort: { direction: "descending", timestamp: "last_edited_time" },
            startCursor: cursor,
            pageSize: 100,
          });

          for (const item of searchResult.results) {
            if (item.object === "database") {
              await syncNotionDatabaseMetadata(
                accessToken,
                item as unknown as NotionDatabaseData,
                sourceAccountId,
                workspaceId,
                account.organizationId,
                result
              );
            }
          }

          hasMore = searchResult.has_more;
          cursor = searchResult.next_cursor ?? undefined;

          await new Promise((resolve) => setTimeout(resolve, 350));
        } catch (error) {
          const errorMsg =
            error instanceof Error ? error.message : String(error);
          result.errors.push(`Database search failed: ${errorMsg}`);
          log.error("Failed to search databases", { error: errorMsg });
          hasMore = false;
        }
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

      if (workspace) {
        await db
          .update(notionWorkspace)
          .set({
            lastSyncAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(notionWorkspace.id, workspace.id));
      }

      result.success = true;

      log.info("Notion sync completed", {
        sourceAccountId,
        pagesSynced: result.pagesSynced,
        databasesSynced: result.databasesSynced,
        conversationsCreated: result.conversationsCreated,
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

      log.error("Notion sync failed", { sourceAccountId, error: errorMsg });
    }

    return result;
  },
});

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

interface NotionDatabaseData {
  id: string;
  title: Array<{ plain_text: string }>;
  description: Array<{ plain_text: string }>;
  parent: { type: string; page_id?: string; workspace?: boolean };
  url: string;
  archived: boolean;
  in_trash: boolean;
  created_time: string;
  last_edited_time: string;
  properties: Record<string, unknown>;
}

/**
 * Sync a single Notion page.
 */
async function syncNotionPage(
  accessToken: string,
  page: NotionPage,
  sourceAccountId: string,
  workspaceId: string,
  _organizationId: string,
  result: NotionSyncResult
): Promise<void> {
  try {
    // Get page title
    const title = getNotionPageTitle(page);

    // Check if page is already cached and unchanged
    const existingCache = await db.query.notionPageCache.findFirst({
      where: and(
        eq(notionPageCache.sourceAccountId, sourceAccountId),
        eq(notionPageCache.notionPageId, page.id)
      ),
    });

    const pageUpdatedAt = new Date(page.last_edited_time);

    // Check if conversation exists and has messages
    let needsReprocessing = false;
    if (existingCache) {
      // Look up the conversation by externalId (page.id)
      const existingConv = await db.query.conversation.findFirst({
        where: and(
          eq(conversation.sourceAccountId, sourceAccountId),
          eq(conversation.externalId, page.id)
        ),
        columns: { id: true },
      });

      if (existingConv) {
        const existingMessages = await db.query.message.findFirst({
          where: eq(message.conversationId, existingConv.id),
          columns: { id: true },
        });
        if (!existingMessages) {
          needsReprocessing = true;
          log.info("Re-processing page without messages", { pageId: page.id });
        }
      }
    }

    if (
      !needsReprocessing &&
      existingCache &&
      existingCache.notionUpdatedAt &&
      existingCache.notionUpdatedAt >= pageUpdatedAt
    ) {
      // Page hasn't changed and has messages, skip
      return;
    }

    // Get page content (blocks)
    let contentText = "";
    try {
      const blocks: NotionBlock[] = [];
      let blockCursor: string | undefined;
      let hasMoreBlocks = true;

      while (hasMoreBlocks) {
        const blockResult = await getNotionBlocks(
          accessToken,
          page.id,
          blockCursor
        );
        blocks.push(...blockResult.results);
        hasMoreBlocks = blockResult.has_more;
        blockCursor = blockResult.next_cursor ?? undefined;

        await new Promise((resolve) => setTimeout(resolve, 350));
      }

      contentText = extractTextFromBlocks(blocks);
    } catch (error) {
      log.warn("Failed to get page blocks", { pageId: page.id, error });
    }

    // If no block content, extract from properties (for database entries)
    if (!contentText && page.properties) {
      const propsText = extractTextFromProperties(page.properties);
      if (propsText) {
        contentText = propsText;
        log.info("Using properties text for database entry", {
          pageId: page.id,
          textLength: propsText.length,
        });
      }
    }

    // Get page comments
    const comments: NotionComment[] = [];
    try {
      let commentCursor: string | undefined;
      let hasMoreComments = true;

      while (hasMoreComments) {
        const commentResult = await getNotionComments(
          accessToken,
          page.id,
          commentCursor
        );
        comments.push(...commentResult.results);
        hasMoreComments = commentResult.has_more;
        commentCursor = commentResult.next_cursor ?? undefined;

        await new Promise((resolve) => setTimeout(resolve, 350));
      }
    } catch (error) {
      log.warn("Failed to get page comments", { pageId: page.id, error });
    }

    // Upsert page cache
    const parentType = page.parent.type;
    const parentId =
      parentType === "page_id"
        ? (page.parent as { page_id: string }).page_id
        : parentType === "database_id"
          ? (page.parent as { database_id: string }).database_id
          : undefined;

    const pageCacheId = existingCache?.id ?? randomUUID();

    await db
      .insert(notionPageCache)
      .values({
        id: pageCacheId,
        sourceAccountId,
        notionPageId: page.id,
        notionWorkspaceId: workspaceId,
        parentType,
        parentId,
        title,
        icon:
          page.icon?.emoji ?? page.icon?.external?.url ?? page.icon?.file?.url,
        coverUrl: page.cover?.external?.url ?? page.cover?.file?.url,
        url: page.url,
        isArchived: page.archived,
        isInTrash: page.in_trash,
        isDatabase: parentType === "database_id",
        notionCreatedAt: new Date(page.created_time),
        notionUpdatedAt: pageUpdatedAt,
        createdByUserId: page.created_by?.id,
        lastEditedByUserId: page.last_edited_by?.id,
        lastContentSyncAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [notionPageCache.sourceAccountId, notionPageCache.notionPageId],
        set: {
          title,
          icon:
            page.icon?.emoji ??
            page.icon?.external?.url ??
            page.icon?.file?.url,
          coverUrl: page.cover?.external?.url ?? page.cover?.file?.url,
          url: page.url,
          isArchived: page.archived,
          isInTrash: page.in_trash,
          notionUpdatedAt: pageUpdatedAt,
          lastEditedByUserId: page.last_edited_by?.id,
          lastContentSyncAt: new Date(),
          updatedAt: new Date(),
        },
      });

    result.pagesSynced++;

    // Skip archived/trashed pages for conversation creation
    if (page.archived || page.in_trash) {
      return;
    }

    // Create or update conversation
    const conversationType =
      parentType === "database_id" ? "database_item" : "page";
    const existingConv = await db.query.conversation.findFirst({
      where: and(
        eq(conversation.sourceAccountId, sourceAccountId),
        eq(conversation.externalId, page.id)
      ),
    });

    const convId = existingConv?.id ?? randomUUID();
    const now = new Date();

    // Build participant IDs from creators and commenters
    const participantIds = new Set<string>();
    if (page.created_by?.id) {
      participantIds.add(page.created_by.id);
    }
    if (page.last_edited_by?.id) {
      participantIds.add(page.last_edited_by.id);
    }
    for (const comment of comments) {
      if (comment.created_by?.id) {
        participantIds.add(comment.created_by.id);
      }
    }

    const metadata: ConversationMetadata = {
      pageId: page.id,
      workspaceId,
      url: page.url,
      databaseId: parentType === "database_id" ? parentId : undefined,
      parentType,
      parentId: parentType === "page_id" ? parentId : undefined,
    };

    if (existingConv) {
      await db
        .update(conversation)
        .set({
          title,
          snippet: contentText.slice(0, 200),
          participantIds: [...participantIds],
          messageCount: 1 + comments.length,
          lastMessageAt: pageUpdatedAt,
          metadata,
          updatedAt: now,
        })
        .where(eq(conversation.id, convId));
    } else {
      await db.insert(conversation).values({
        id: convId,
        sourceAccountId,
        externalId: page.id,
        conversationType,
        title,
        snippet: contentText.slice(0, 200),
        participantIds: [...participantIds],
        messageCount: 1 + comments.length,
        firstMessageAt: new Date(page.created_time),
        lastMessageAt: pageUpdatedAt,
        isRead: true,
        isStarred: false,
        isArchived: false,
        metadata,
        createdAt: now,
        updatedAt: now,
      });

      result.conversationsCreated++;
    }

    // Create/update messages for page content and comments
    // First message is the page content
    if (contentText) {
      const existingPageMessage = await db.query.message.findFirst({
        where: and(
          eq(message.conversationId, convId),
          eq(message.externalId, page.id)
        ),
      });

      if (existingPageMessage) {
        await db
          .update(message)
          .set({
            bodyText: contentText,
            updatedAt: now,
          })
          .where(eq(message.id, existingPageMessage.id));
      } else {
        await db.insert(message).values({
          id: randomUUID(),
          conversationId: convId,
          externalId: page.id,
          senderExternalId: page.created_by?.id ?? "unknown",
          senderName: undefined,
          subject: title,
          bodyText: contentText,
          sentAt: new Date(page.created_time),
          receivedAt: new Date(page.created_time),
          isFromUser: false,
          messageIndex: 0,
          hasAttachments: false,
          metadata: {
            isPageContent: true,
          },
          createdAt: now,
          updatedAt: now,
        });
      }
    }

    // Add comments as messages
    for (const [index, comment] of comments.entries()) {
      const commentText = comment.rich_text.map((rt) => rt.plain_text).join("");

      const existingComment = await db.query.message.findFirst({
        where: and(
          eq(message.conversationId, convId),
          eq(message.externalId, comment.id)
        ),
      });

      if (!existingComment) {
        await db.insert(message).values({
          id: randomUUID(),
          conversationId: convId,
          externalId: comment.id,
          senderExternalId: comment.created_by?.id ?? "unknown",
          senderName: undefined,
          subject: undefined,
          bodyText: commentText,
          sentAt: new Date(comment.created_time),
          receivedAt: new Date(comment.created_time),
          isFromUser: false,
          messageIndex: index + 1,
          hasAttachments: false,
          metadata: {
            discussionId: comment.discussion_id,
            parentType: comment.parent.type,
            parentId:
              comment.parent.type === "page_id"
                ? (comment.parent as { page_id: string }).page_id
                : (comment.parent as { block_id: string }).block_id,
          },
          createdAt: now,
          updatedAt: now,
        });
      }
    }

    // Trigger analysis
    await analyzeNotionPageTask.trigger(
      { conversationId: convId },
      {
        debounce: {
          key: `notion-analysis-${convId}`,
          delay: "30s",
          mode: "trailing",
        },
      }
    );

    log.info("Synced Notion page", {
      pageId: page.id,
      title,
      comments: comments.length,
    });
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    result.errors.push(`Page sync failed for ${page.id}: ${errorMsg}`);
    log.error("Failed to sync Notion page", {
      pageId: page.id,
      error: errorMsg,
    });
  }
}

/**
 * Sync Notion database metadata and its entries.
 */
async function syncNotionDatabaseMetadata(
  accessToken: string,
  database: NotionDatabaseData,
  sourceAccountId: string,
  workspaceId: string,
  organizationId: string,
  result: NotionSyncResult
): Promise<void> {
  try {
    const title = database.title.map((t) => t.plain_text).join("");
    const description = database.description.map((d) => d.plain_text).join("");

    const parentType = database.parent.type;
    const parentId =
      parentType === "page_id" ? database.parent.page_id : undefined;

    await db
      .insert(notionDatabase)
      .values({
        id: randomUUID(),
        sourceAccountId,
        notionDatabaseId: database.id,
        notionWorkspaceId: workspaceId,
        parentType,
        parentId,
        title,
        description,
        url: database.url,
        isArchived: database.archived,
        isInTrash: database.in_trash,
        properties: database.properties,
        notionCreatedAt: new Date(database.created_time),
        notionUpdatedAt: new Date(database.last_edited_time),
        lastSyncAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [
          notionDatabase.sourceAccountId,
          notionDatabase.notionDatabaseId,
        ],
        set: {
          title,
          description,
          url: database.url,
          isArchived: database.archived,
          isInTrash: database.in_trash,
          properties: database.properties,
          notionUpdatedAt: new Date(database.last_edited_time),
          lastSyncAt: new Date(),
          updatedAt: new Date(),
        },
      });

    result.databasesSynced++;

    log.info("Synced Notion database", { databaseId: database.id, title });

    // Query and sync database entries (pages inside this database)
    if (!(database.archived || database.in_trash)) {
      try {
        let entryCursor: string | undefined;
        let hasMoreEntries = true;

        while (hasMoreEntries) {
          const entriesResult = await queryNotionDatabase(
            accessToken,
            database.id,
            {
              sorts: [
                { timestamp: "last_edited_time", direction: "descending" },
              ],
              startCursor: entryCursor,
              pageSize: 100,
            }
          );

          for (const entry of entriesResult.results) {
            // Each entry is a page inside the database
            await syncNotionPage(
              accessToken,
              entry,
              sourceAccountId,
              workspaceId,
              organizationId,
              result
            );
          }

          hasMoreEntries = entriesResult.has_more;
          entryCursor = entriesResult.next_cursor ?? undefined;

          // Rate limiting
          await new Promise((resolve) => setTimeout(resolve, 350));
        }
      } catch (entryError) {
        const errorMsg =
          entryError instanceof Error ? entryError.message : String(entryError);
        log.warn("Failed to sync database entries", {
          databaseId: database.id,
          error: errorMsg,
        });
      }
    }
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    result.errors.push(`Database sync failed for ${database.id}: ${errorMsg}`);
    log.error("Failed to sync Notion database", {
      databaseId: database.id,
      error: errorMsg,
    });
  }
}

// =============================================================================
// CONVERSATION ANALYSIS TASK
// =============================================================================

interface NotionPageAnalysisPayload {
  conversationId: string;
  force?: boolean;
}

interface NotionPageAnalysisResult {
  success: boolean;
  conversationId: string;
  claimsCreated: number;
  commitmentsCreated: number;
  decisionsCreated: number;
  error?: string;
}

/**
 * Analyze a Notion page conversation for intelligence extraction.
 * Uses Python backend for all AI processing.
 */
export const analyzeNotionPageTask = task({
  id: "notion-page-analysis",
  queue: { name: "notion-analysis", concurrencyLimit: 10 },
  retry: {
    maxAttempts: 3,
    minTimeoutInMs: 5000,
    maxTimeoutInMs: 60_000,
    factor: 2,
  },
  maxDuration: 180, // 3 minutes max

  run: async (
    payload: NotionPageAnalysisPayload
  ): Promise<NotionPageAnalysisResult> => {
    const { conversationId, force = false } = payload;

    log.info("Starting Notion page analysis via Python backend", {
      conversationId,
      force,
    });

    const result: NotionPageAnalysisResult = {
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
      log.info("Calling Python backend for Notion page analysis", {
        conversationId,
        messageCount: conv.messages.length,
        contentLength: content.length,
      });

      const analysis = await callPythonIntelligence({
        content,
        organization_id: conv.sourceAccount.organizationId,
        source_type: "notion",
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

      // Extract and create/update contacts from Notion users
      const participantNotionIds = new Set<string>();
      for (const msg of conv.messages) {
        if (msg.senderExternalId) {
          participantNotionIds.add(msg.senderExternalId);
        }
      }

      for (const notionUserId of participantNotionIds) {
        // Check if contact exists
        const existingContact = await db.query.contact.findFirst({
          where: and(
            eq(contact.organizationId, conv.sourceAccount.organizationId),
            eq(contact.primaryEmail, `notion:${notionUserId}`)
          ),
        });

        // Get cached user info
        const cachedUser = await db.query.notionUserCache.findFirst({
          where: and(
            eq(notionUserCache.sourceAccountId, conv.sourceAccountId),
            eq(notionUserCache.notionUserId, notionUserId)
          ),
        });

        if (existingContact) {
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
            primaryEmail: `notion:${notionUserId}`,
            displayName:
              cachedUser?.name ?? `Notion User ${notionUserId.slice(0, 8)}`,
            enrichmentSource: "notion",
            lastInteractionAt: conv.lastMessageAt ?? new Date(),
            totalMessages: conv.messageCount ?? 1,
            metadata: {
              notionUserId,
              sourceAccountId: conv.sourceAccountId,
              source: "notion",
            },
          });
        }
      }

      // Note: Embedding generation and memory episodes are handled by the Python intelligence backend

      result.success = true;

      log.info("Notion page analysis completed", {
        conversationId,
        claimsCreated: result.claimsCreated,
        commitmentsCreated: result.commitmentsCreated,
        decisionsCreated: result.decisionsCreated,
      });

      return result;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      result.error = errorMsg;
      log.error("Notion page analysis failed", {
        conversationId,
        error: errorMsg,
      });
      return result;
    }
  },
});

/**
 * Batch analyze unprocessed Notion pages.
 */
export const analyzeNotionPagesBatchTask = task({
  id: "notion-page-analysis-batch",
  queue: { name: "notion-analysis", concurrencyLimit: 3 },
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

    log.info("Starting batch Notion page analysis", {
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
        await analyzeNotionPageTask.trigger({
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
 * Scheduled task to sync all Notion accounts.
 * Runs every 15 minutes.
 */
export const syncNotionSchedule = schedules.task({
  id: "notion-sync-schedule",
  cron: "*/15 * * * *", // Every 15 minutes
  run: async () => {
    log.info("Starting scheduled Notion sync");

    // Get all active Notion source accounts
    const notionAccounts = await db.query.sourceAccount.findMany({
      where: and(
        eq(sourceAccount.type, "notion"),
        eq(sourceAccount.status, "connected")
      ),
      columns: { id: true },
    });

    if (notionAccounts.length === 0) {
      log.info("No Notion accounts to sync");
      return { scheduled: true, accountsTriggered: 0 };
    }

    // Trigger sync for each account
    for (const account of notionAccounts) {
      await syncNotionTask.trigger({
        sourceAccountId: account.id,
        fullSync: false,
      });

      // Also trigger batch analysis for any unprocessed pages
      await analyzeNotionPagesBatchTask.trigger({
        sourceAccountId: account.id,
        limit: 20,
      });
    }

    log.info("Scheduled Notion sync triggered", {
      accounts: notionAccounts.length,
    });

    return { scheduled: true, accountsTriggered: notionAccounts.length };
  },
});

// =============================================================================
// EPISODE HELPERS
// =============================================================================
// EXPORTS
// =============================================================================

export type {
  NotionSyncPayload,
  NotionSyncResult,
  NotionPageAnalysisPayload,
  NotionPageAnalysisResult,
};
