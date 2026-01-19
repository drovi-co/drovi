// =============================================================================
// NOTION SYNC TRIGGER TASKS
// =============================================================================
//
// Trigger.dev tasks for syncing Notion workspace data and processing pages
// and comments into the multi-source intelligence platform.
//

import { logger, schedules, task } from "@trigger.dev/sdk/v3";
import { db } from "@memorystack/db";
import {
  claim,
  commitment,
  contact,
  conversation,
  type ConversationMetadata,
  decision,
  message,
  notionDatabase,
  notionPageCache,
  notionUserCache,
  notionWorkspace,
  sourceAccount,
} from "@memorystack/db/schema";
import { and, eq, isNull, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import {
  extractTextFromBlocks,
  getNotionBlocks,
  getNotionComments,
  getNotionPageTitle,
  searchNotion,
  type NotionBlock,
  type NotionComment,
  type NotionPage,
} from "@memorystack/auth/providers/notion";
import { safeDecryptToken } from "../lib/crypto/tokens";
import {
  analyzeThread,
  claimsToDbFormat,
  type ThreadInput,
  type ThreadMessage,
} from "@memorystack/ai/agents";
import { embedConversationTask } from "./embedding-generation";

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
        const settings = account.settings as { customSettings?: { botId?: string; ownerId?: string; ownerEmail?: string } } | null;
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

      let cursor: string | undefined = undefined;
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
          const errorMsg = error instanceof Error ? error.message : String(error);
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
                item as unknown as NotionDatabaseData,
                sourceAccountId,
                workspaceId,
                result
              );
            }
          }

          hasMore = searchResult.has_more;
          cursor = searchResult.next_cursor ?? undefined;

          await new Promise((resolve) => setTimeout(resolve, 350));
        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : String(error);
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

    if (existingCache && existingCache.notionUpdatedAt) {
      if (existingCache.notionUpdatedAt >= pageUpdatedAt) {
        // Page hasn't changed, skip
        return;
      }
    }

    // Get page content (blocks)
    let contentText = "";
    try {
      const blocks: NotionBlock[] = [];
      let blockCursor: string | undefined = undefined;
      let hasMoreBlocks = true;

      while (hasMoreBlocks) {
        const blockResult = await getNotionBlocks(accessToken, page.id, blockCursor);
        blocks.push(...blockResult.results);
        hasMoreBlocks = blockResult.has_more;
        blockCursor = blockResult.next_cursor ?? undefined;

        await new Promise((resolve) => setTimeout(resolve, 350));
      }

      contentText = extractTextFromBlocks(blocks);
    } catch (error) {
      log.warn("Failed to get page blocks", { pageId: page.id, error });
    }

    // Get page comments
    const comments: NotionComment[] = [];
    try {
      let commentCursor: string | undefined = undefined;
      let hasMoreComments = true;

      while (hasMoreComments) {
        const commentResult = await getNotionComments(accessToken, page.id, commentCursor);
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
    const parentId = parentType === "page_id"
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
        icon: page.icon?.emoji ?? page.icon?.external?.url ?? page.icon?.file?.url,
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
          icon: page.icon?.emoji ?? page.icon?.external?.url ?? page.icon?.file?.url,
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
    const conversationType = parentType === "database_id" ? "database_item" : "page";
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

    if (!existingConv) {
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
    } else {
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

      if (!existingPageMessage) {
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
      } else {
        await db
          .update(message)
          .set({
            bodyText: contentText,
            updatedAt: now,
          })
          .where(eq(message.id, existingPageMessage.id));
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

    log.info("Synced Notion page", { pageId: page.id, title, comments: comments.length });
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    result.errors.push(`Page sync failed for ${page.id}: ${errorMsg}`);
    log.error("Failed to sync Notion page", { pageId: page.id, error: errorMsg });
  }
}

/**
 * Sync Notion database metadata.
 */
async function syncNotionDatabaseMetadata(
  database: NotionDatabaseData,
  sourceAccountId: string,
  workspaceId: string,
  result: NotionSyncResult
): Promise<void> {
  try {
    const title = database.title.map((t) => t.plain_text).join("");
    const description = database.description.map((d) => d.plain_text).join("");

    const parentType = database.parent.type;
    const parentId = parentType === "page_id"
      ? database.parent.page_id
      : undefined;

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
        target: [notionDatabase.sourceAccountId, notionDatabase.notionDatabaseId],
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
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    result.errors.push(`Database sync failed for ${database.id}: ${errorMsg}`);
    log.error("Failed to sync Notion database", { databaseId: database.id, error: errorMsg });
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

  run: async (payload: NotionPageAnalysisPayload): Promise<NotionPageAnalysisResult> => {
    const { conversationId, force = false } = payload;

    log.info("Starting Notion page analysis", { conversationId, force });

    const result: NotionPageAnalysisResult = {
      success: false,
      conversationId,
      claimsCreated: 0,
      commitmentsCreated: 0,
      decisionsCreated: 0,
    };

    try {
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

      // Get settings for user identifier
      const settings = conv.sourceAccount.settings as {
        customSettings?: { ownerId?: string };
      } | null;
      const userIdentifier = settings?.customSettings?.ownerId ?? "";

      // Convert messages to ThreadMessage format for the agent
      const threadMessages: ThreadMessage[] = conv.messages.map((msg, index) => ({
        id: msg.id,
        providerMessageId: msg.externalId ?? msg.id,
        fromEmail: msg.senderExternalId ?? "unknown",
        fromName: msg.senderName ?? undefined,
        toRecipients: [],
        subject: msg.subject ?? undefined,
        bodyText: msg.bodyText ?? "",
        sentAt: msg.sentAt ?? undefined,
        receivedAt: msg.receivedAt ?? undefined,
        isFromUser: msg.senderExternalId === userIdentifier,
        messageIndex: index,
      }));

      // Build ThreadInput for the agent
      const threadInput: ThreadInput = {
        id: conversationId,
        accountId: conv.sourceAccountId,
        organizationId: conv.sourceAccount.organizationId,
        providerThreadId: conv.externalId ?? conversationId,
        subject: conv.title ?? "Notion Page",
        participantEmails: conv.participantIds ?? [],
        userEmail: userIdentifier,
        messages: threadMessages,
      };

      // Skip analysis if not enough content
      if (threadMessages.length === 0) {
        log.info("Skipping analysis - no messages", { conversationId });
        result.success = true;
        return result;
      }

      // Run the Thread Understanding Agent analysis
      log.info("Running thread analysis on Notion page", {
        conversationId,
        messageCount: threadMessages.length,
      });

      const analysis = await analyzeThread(threadInput);

      log.info("Thread analysis completed", {
        conversationId,
        claims: {
          facts: analysis.claims.facts.length,
          promises: analysis.claims.promises.length,
          requests: analysis.claims.requests.length,
          questions: analysis.claims.questions.length,
          decisions: analysis.claims.decisions.length,
        },
        openLoops: analysis.openLoops.length,
      });

      // Convert claims to DB format and store
      const dbClaims = claimsToDbFormat(analysis.claims, conversationId, conv.sourceAccount.organizationId);

      // Insert claims into database
      if (dbClaims.length > 0) {
        await db.insert(claim).values(
          dbClaims.map((c) => ({
            id: randomUUID(),
            organizationId: conv.sourceAccount.organizationId,
            conversationId,
            sourceAccountId: conv.sourceAccountId,
            type: c.type,
            text: c.text,
            confidence: c.confidence,
            extractedAt: new Date(),
            quotedText: c.quotedText,
            sourceMessageIds: c.sourceMessageIds,
            metadata: {
              sourceType: "notion" as const,
            },
          }))
        );
        result.claimsCreated = dbClaims.length;
      }

      // Update conversation with analysis results
      const urgencyScore = analysis.classification.urgency.score;
      const priorityTier = urgencyScore >= 0.8 ? "urgent" : urgencyScore >= 0.6 ? "high" : urgencyScore >= 0.4 ? "medium" : "low";

      await db
        .update(conversation)
        .set({
          briefSummary: analysis.brief?.summary,
          hasOpenLoops: analysis.openLoops.length > 0,
          openLoopCount: analysis.openLoops.length,
          priorityTier,
          urgencyScore: analysis.classification.urgency.score,
          importanceScore: analysis.classification.urgency.score,
          suggestedAction: analysis.brief?.actionRequired ? analysis.brief.actionDescription : null,
          lastAnalyzedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(conversation.id, conversationId));

      // Extract commitments from promises and requests
      const promiseClaims = analysis.claims.promises;
      const requestClaims = analysis.claims.requests;

      if (promiseClaims.length > 0 || requestClaims.length > 0) {
        log.info("Extracting commitments from Notion page", {
          conversationId,
          promises: promiseClaims.length,
          requests: requestClaims.length,
        });

        for (const promise of promiseClaims) {
          await db.insert(commitment).values({
            id: randomUUID(),
            organizationId: conv.sourceAccount.organizationId,
            sourceConversationId: conversationId,
            sourceAccountId: conv.sourceAccountId,
            title: promise.text.slice(0, 200),
            description: promise.text,
            status: "pending",
            confidence: promise.confidence,
            dueDate: promise.deadline ? new Date(promise.deadline) : undefined,
            direction: promise.promisor === userIdentifier ? "owed_by_me" : "owed_to_me",
            metadata: {
              sourceType: "notion" as const,
              sourceQuote: promise.evidence[0]?.quotedText,
              commitmentType: "promise" as const,
              promisorNotionId: promise.promisor,
              promiseeNotionId: promise.promisee ?? userIdentifier,
              isConditional: promise.isConditional,
              condition: promise.condition ?? undefined,
            },
          });
          result.commitmentsCreated++;
        }

        for (const request of requestClaims) {
          await db.insert(commitment).values({
            id: randomUUID(),
            organizationId: conv.sourceAccount.organizationId,
            sourceConversationId: conversationId,
            sourceAccountId: conv.sourceAccountId,
            title: request.text.slice(0, 200),
            description: request.text,
            status: "pending",
            confidence: request.confidence,
            dueDate: request.deadline ? new Date(request.deadline) : undefined,
            direction: request.requester === userIdentifier ? "owed_to_me" : "owed_by_me",
            metadata: {
              sourceType: "notion" as const,
              sourceQuote: request.evidence[0]?.quotedText,
              commitmentType: "request" as const,
              requesterNotionId: request.requester,
              requesteeNotionId: request.requestee ?? userIdentifier,
              isExplicit: request.isExplicit,
              priority: request.priority ?? undefined,
            },
          });
          result.commitmentsCreated++;
        }
      }

      // Extract decisions
      const decisionClaims = analysis.claims.decisions;

      if (decisionClaims.length > 0) {
        log.info("Extracting decisions from Notion page", {
          conversationId,
          decisions: decisionClaims.length,
        });

        for (const decisionClaim of decisionClaims) {
          await db.insert(decision).values({
            id: randomUUID(),
            organizationId: conv.sourceAccount.organizationId,
            sourceConversationId: conversationId,
            sourceAccountId: conv.sourceAccountId,
            title: decisionClaim.text.slice(0, 200),
            statement: decisionClaim.text,
            rationale: decisionClaim.rationale ?? undefined,
            confidence: decisionClaim.confidence,
            decidedAt: new Date(),
            metadata: {
              sourceType: "notion" as const,
              sourceQuote: decisionClaim.evidence[0]?.quotedText,
              decision: decisionClaim.decision,
              decisionMakerNotionId: decisionClaim.decisionMaker ?? undefined,
            },
          });
          result.decisionsCreated++;
        }
      }

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

        if (!existingContact) {
          await db.insert(contact).values({
            id: randomUUID(),
            organizationId: conv.sourceAccount.organizationId,
            primaryEmail: `notion:${notionUserId}`,
            displayName: cachedUser?.name ?? `Notion User ${notionUserId.slice(0, 8)}`,
            enrichmentSource: "notion",
            lastInteractionAt: conv.lastMessageAt ?? new Date(),
            totalMessages: conv.messageCount ?? 1,
            metadata: {
              notionUserId,
              sourceAccountId: conv.sourceAccountId,
              source: "notion",
            },
          });
        } else {
          await db
            .update(contact)
            .set({
              lastInteractionAt: conv.lastMessageAt ?? new Date(),
              totalMessages: sql`${contact.totalMessages} + 1`,
              updatedAt: new Date(),
            })
            .where(eq(contact.id, existingContact.id));
        }
      }

      // Trigger embedding generation for this conversation
      try {
        await embedConversationTask.trigger(
          { conversationId },
          {
            debounce: {
              key: `embedding-conversation-${conversationId}`,
              delay: "10s",
              mode: "trailing",
            },
          }
        );
        log.info("Triggered embedding generation for Notion page", { conversationId });
      } catch (e) {
        log.warn("Failed to trigger embedding generation", { conversationId, error: e });
      }

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
      log.error("Notion page analysis failed", { conversationId, error: errorMsg });
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
    minTimeoutInMs: 10000,
    maxTimeoutInMs: 120_000,
    factor: 2,
  },
  maxDuration: 600, // 10 minutes max

  run: async (payload: { sourceAccountId: string; limit?: number; force?: boolean }) => {
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

    log.info("Scheduled Notion sync triggered", { accounts: notionAccounts.length });

    return { scheduled: true, accountsTriggered: notionAccounts.length };
  },
});

// =============================================================================
// EXPORTS
// =============================================================================

export type {
  NotionSyncPayload,
  NotionSyncResult,
  NotionPageAnalysisPayload,
  NotionPageAnalysisResult,
};
