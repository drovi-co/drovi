// =============================================================================
// GOOGLE DOCS SYNC TRIGGER TASKS
// =============================================================================
//
// Trigger.dev tasks for syncing Google Docs workspace data and processing
// documents and comments into the multi-source intelligence platform.
//

import { randomUUID } from "node:crypto";
import {
  extractTextFromGoogleDoc,
  type GoogleDriveComment,
  type GoogleDriveFile,
  getGoogleDocComments,
  getGoogleDocContent,
  listGoogleDocs,
  refreshGoogleDocsToken,
} from "@memorystack/auth/providers/google-docs";
import { db } from "@memorystack/db";
import {
  type ConversationMetadata,
  contact,
  conversation,
  googleDocsCommentCache,
  googleDocsDocument,
  message,
  sourceAccount,
} from "@memorystack/db/schema";
import { logger, schedules, task } from "@trigger.dev/sdk/v3";
import { and, eq, isNull, sql } from "drizzle-orm";
import { safeDecryptToken, safeEncryptToken } from "../lib/crypto/tokens";
import {
  callPythonIntelligence,
  checkIntelligenceBackendHealth,
} from "../lib/intelligence-backend";

const log = logger;

// =============================================================================
// TYPES
// =============================================================================

interface GoogleDocsSyncPayload {
  /** Source account ID for Google Docs */
  sourceAccountId: string;
  /** Whether to do a full sync vs incremental */
  fullSync?: boolean;
}

interface GoogleDocsSyncResult {
  success: boolean;
  sourceAccountId: string;
  documentsSynced: number;
  conversationsCreated: number;
  errors: string[];
}

// =============================================================================
// MAIN GOOGLE DOCS SYNC TASK
// =============================================================================

/**
 * Sync Google Docs workspace data including documents and comments.
 */
export const syncGoogleDocsTask = task({
  id: "google-docs-sync",
  queue: { name: "google-docs-sync", concurrencyLimit: 3 },
  retry: {
    maxAttempts: 3,
    minTimeoutInMs: 5000,
    maxTimeoutInMs: 60_000,
    factor: 2,
  },
  maxDuration: 600, // 10 minutes max

  run: async (
    payload: GoogleDocsSyncPayload
  ): Promise<GoogleDocsSyncResult> => {
    const { sourceAccountId, fullSync = false } = payload;

    const result: GoogleDocsSyncResult = {
      success: false,
      sourceAccountId,
      documentsSynced: 0,
      conversationsCreated: 0,
      errors: [],
    };

    log.info("Starting Google Docs sync", { sourceAccountId, fullSync });

    try {
      // Get source account
      const account = await db.query.sourceAccount.findFirst({
        where: eq(sourceAccount.id, sourceAccountId),
      });

      if (!account) {
        result.errors.push("Source account not found");
        return result;
      }

      if (account.type !== "google_docs") {
        result.errors.push("Source account is not a Google Docs account");
        return result;
      }

      // Decrypt access token
      let accessToken = account.accessToken
        ? await safeDecryptToken(account.accessToken)
        : null;

      if (!accessToken) {
        result.errors.push("No access token found");
        return result;
      }

      // Check if token needs refresh
      if (account.tokenExpiresAt && account.tokenExpiresAt < new Date()) {
        log.info("Access token expired, refreshing", { sourceAccountId });

        if (!account.refreshToken) {
          result.errors.push("No refresh token found");
          return result;
        }

        const refreshToken = await safeDecryptToken(account.refreshToken);
        if (!refreshToken) {
          result.errors.push("Failed to decrypt refresh token");
          return result;
        }

        try {
          const newTokens = await refreshGoogleDocsToken(refreshToken);
          accessToken = newTokens.access_token;

          // Update stored tokens
          await db
            .update(sourceAccount)
            .set({
              accessToken: await safeEncryptToken(newTokens.access_token),
              tokenExpiresAt: new Date(
                Date.now() + newTokens.expires_in * 1000
              ),
              updatedAt: new Date(),
            })
            .where(eq(sourceAccount.id, sourceAccountId));
        } catch (error) {
          const errorMsg =
            error instanceof Error ? error.message : String(error);
          result.errors.push(`Token refresh failed: ${errorMsg}`);
          return result;
        }
      }

      // List Google Docs documents
      log.info("Listing Google Docs documents", { sourceAccountId });

      let pageToken: string | undefined;
      let hasMore = true;

      while (hasMore) {
        try {
          const listResult = await listGoogleDocs(accessToken, {
            pageToken,
            pageSize: 100,
            orderBy: "modifiedTime desc",
          });

          for (const file of listResult.files) {
            await syncGoogleDoc(
              accessToken,
              file,
              sourceAccountId,
              account.organizationId,
              result
            );
          }

          hasMore = !!listResult.nextPageToken;
          pageToken = listResult.nextPageToken;

          // Rate limiting: Google allows 300 queries/minute
          await new Promise((resolve) => setTimeout(resolve, 200));
        } catch (error) {
          const errorMsg =
            error instanceof Error ? error.message : String(error);
          result.errors.push(`Document list failed: ${errorMsg}`);
          log.error("Failed to list documents", { error: errorMsg });
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

      result.success = true;

      log.info("Google Docs sync completed", {
        sourceAccountId,
        documentsSynced: result.documentsSynced,
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

      log.error("Google Docs sync failed", {
        sourceAccountId,
        error: errorMsg,
      });
    }

    return result;
  },
});

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Sync a single Google Doc.
 */
async function syncGoogleDoc(
  accessToken: string,
  file: GoogleDriveFile,
  sourceAccountId: string,
  _organizationId: string,
  result: GoogleDocsSyncResult
): Promise<void> {
  try {
    // Check if document is already cached and unchanged
    const existingDoc = await db.query.googleDocsDocument.findFirst({
      where: and(
        eq(googleDocsDocument.sourceAccountId, sourceAccountId),
        eq(googleDocsDocument.googleDocumentId, file.id)
      ),
    });

    const docModifiedAt = file.modifiedTime
      ? new Date(file.modifiedTime)
      : new Date();

    if (
      existingDoc &&
      existingDoc.googleModifiedAt &&
      existingDoc.googleModifiedAt >= docModifiedAt
    ) {
      // Document hasn't changed, skip
      return;
    }

    // Get document content
    let contentText = "";
    try {
      const doc = await getGoogleDocContent(accessToken, file.id);
      contentText = extractTextFromGoogleDoc(doc);
    } catch (error) {
      log.warn("Failed to get document content", {
        documentId: file.id,
        error,
      });
    }

    // Get document comments
    const comments: GoogleDriveComment[] = [];
    try {
      let commentPageToken: string | undefined;
      let hasMoreComments = true;

      while (hasMoreComments) {
        const commentResult = await getGoogleDocComments(accessToken, file.id, {
          pageToken: commentPageToken,
        });
        comments.push(...commentResult.comments);
        hasMoreComments = !!commentResult.nextPageToken;
        commentPageToken = commentResult.nextPageToken;

        await new Promise((resolve) => setTimeout(resolve, 200));
      }
    } catch (error) {
      log.warn("Failed to get document comments", {
        documentId: file.id,
        error,
      });
    }

    // Upsert document cache
    const docCacheId = existingDoc?.id ?? randomUUID();

    await db
      .insert(googleDocsDocument)
      .values({
        id: docCacheId,
        sourceAccountId,
        googleDocumentId: file.id,
        title: file.name,
        mimeType: file.mimeType,
        description: file.description,
        parentFolderId: file.parents?.[0],
        webViewLink: file.webViewLink,
        iconLink: file.iconLink,
        thumbnailLink: file.thumbnailLink,
        isStarred: file.starred ?? false,
        isTrashed: file.trashed ?? false,
        fileSize: file.size ? Number.parseInt(file.size, 10) : undefined,
        ownerEmail: file.owners?.[0]?.emailAddress,
        ownerName: file.owners?.[0]?.displayName,
        lastModifiedByEmail: file.lastModifyingUser?.emailAddress,
        lastModifiedByName: file.lastModifyingUser?.displayName,
        canEdit: file.capabilities?.canEdit ?? false,
        canComment: file.capabilities?.canComment ?? false,
        canShare: file.capabilities?.canShare ?? false,
        canDownload: file.capabilities?.canDownload ?? false,
        googleCreatedAt: file.createdTime
          ? new Date(file.createdTime)
          : undefined,
        googleModifiedAt: docModifiedAt,
        lastContentSyncAt: new Date(),
        lastCommentSyncAt: new Date(),
        revisionId: file.version,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [
          googleDocsDocument.sourceAccountId,
          googleDocsDocument.googleDocumentId,
        ],
        set: {
          title: file.name,
          description: file.description,
          webViewLink: file.webViewLink,
          isStarred: file.starred ?? false,
          isTrashed: file.trashed ?? false,
          lastModifiedByEmail: file.lastModifyingUser?.emailAddress,
          lastModifiedByName: file.lastModifyingUser?.displayName,
          googleModifiedAt: docModifiedAt,
          lastContentSyncAt: new Date(),
          lastCommentSyncAt: new Date(),
          revisionId: file.version,
          updatedAt: new Date(),
        },
      });

    result.documentsSynced++;

    // Skip trashed documents for conversation creation
    if (file.trashed) {
      return;
    }

    // Create or update conversation
    const existingConv = await db.query.conversation.findFirst({
      where: and(
        eq(conversation.sourceAccountId, sourceAccountId),
        eq(conversation.externalId, file.id)
      ),
    });

    const convId = existingConv?.id ?? randomUUID();
    const now = new Date();

    // Build participant emails from owner, editor, and commenters
    const participantEmails = new Set<string>();
    if (file.owners?.[0]?.emailAddress) {
      participantEmails.add(file.owners[0].emailAddress);
    }
    if (file.lastModifyingUser?.emailAddress) {
      participantEmails.add(file.lastModifyingUser.emailAddress);
    }
    for (const comment of comments) {
      if (comment.author?.emailAddress) {
        participantEmails.add(comment.author.emailAddress);
      }
      if (comment.replies) {
        for (const reply of comment.replies) {
          if (reply.author?.emailAddress) {
            participantEmails.add(reply.author.emailAddress);
          }
        }
      }
    }

    const metadata: ConversationMetadata = {
      documentId: file.id,
      url: file.webViewLink ?? undefined,
      mimeType: file.mimeType ?? undefined,
      folderId: file.parents?.[0],
    };

    // Count total messages (doc content + comments + replies)
    let totalMessageCount = 1; // Document content
    totalMessageCount += comments.length;
    for (const comment of comments) {
      if (comment.replies) {
        totalMessageCount += comment.replies.filter((r) => !r.deleted).length;
      }
    }

    if (existingConv) {
      await db
        .update(conversation)
        .set({
          title: file.name,
          snippet: contentText.slice(0, 200),
          participantIds: [...participantEmails],
          messageCount: totalMessageCount,
          lastMessageAt: docModifiedAt,
          isStarred: file.starred ?? false,
          metadata,
          updatedAt: now,
        })
        .where(eq(conversation.id, convId));
    } else {
      await db.insert(conversation).values({
        id: convId,
        sourceAccountId,
        externalId: file.id,
        conversationType: "document",
        title: file.name,
        snippet: contentText.slice(0, 200),
        participantIds: [...participantEmails],
        messageCount: totalMessageCount,
        firstMessageAt: file.createdTime ? new Date(file.createdTime) : now,
        lastMessageAt: docModifiedAt,
        isRead: true,
        isStarred: file.starred ?? false,
        isArchived: false,
        metadata,
        createdAt: now,
        updatedAt: now,
      });

      result.conversationsCreated++;
    }

    // Create/update messages for document content and comments
    // First message is the document content
    if (contentText) {
      const existingDocMessage = await db.query.message.findFirst({
        where: and(
          eq(message.conversationId, convId),
          eq(message.externalId, file.id)
        ),
      });

      if (existingDocMessage) {
        await db
          .update(message)
          .set({
            bodyText: contentText,
            updatedAt: now,
          })
          .where(eq(message.id, existingDocMessage.id));
      } else {
        await db.insert(message).values({
          id: randomUUID(),
          conversationId: convId,
          externalId: file.id,
          senderExternalId: file.owners?.[0]?.emailAddress ?? "unknown",
          senderName: file.owners?.[0]?.displayName,
          senderEmail: file.owners?.[0]?.emailAddress,
          subject: file.name,
          bodyText: contentText,
          sentAt: file.createdTime ? new Date(file.createdTime) : now,
          receivedAt: file.createdTime ? new Date(file.createdTime) : now,
          isFromUser: false,
          messageIndex: 0,
          hasAttachments: false,
          metadata: {
            isDocumentContent: true,
          },
          createdAt: now,
          updatedAt: now,
        });
      }
    }

    // Flatten comments and replies, sorted by creation time
    type CommentItem = {
      id: string;
      content: string;
      authorEmail?: string;
      authorName?: string;
      createdAt: Date;
      isResolved?: boolean;
      anchor?: string;
      quotedContent?: string;
      isReply: boolean;
      parentCommentId?: string;
    };

    const allComments: CommentItem[] = [];

    for (const comment of comments) {
      allComments.push({
        id: comment.id,
        content: comment.content,
        authorEmail: comment.author?.emailAddress,
        authorName: comment.author?.displayName,
        createdAt: new Date(comment.createdTime),
        isResolved: comment.resolved,
        anchor: comment.anchor,
        quotedContent: comment.quotedFileContent?.value,
        isReply: false,
      });

      if (comment.replies) {
        for (const reply of comment.replies) {
          if (!reply.deleted) {
            allComments.push({
              id: reply.id,
              content: reply.content,
              authorEmail: reply.author?.emailAddress,
              authorName: reply.author?.displayName,
              createdAt: new Date(reply.createdTime),
              isReply: true,
              parentCommentId: comment.id,
            });
          }
        }
      }
    }

    // Sort by creation time
    allComments.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());

    // Add comments as messages
    for (const [index, commentItem] of allComments.entries()) {
      const existingComment = await db.query.message.findFirst({
        where: and(
          eq(message.conversationId, convId),
          eq(message.externalId, commentItem.id)
        ),
      });

      if (!existingComment) {
        await db.insert(message).values({
          id: randomUUID(),
          conversationId: convId,
          externalId: commentItem.id,
          senderExternalId: commentItem.authorEmail ?? "unknown",
          senderName: commentItem.authorName,
          senderEmail: commentItem.authorEmail,
          subject: undefined,
          bodyText: commentItem.content,
          sentAt: commentItem.createdAt,
          receivedAt: commentItem.createdAt,
          isFromUser: false,
          messageIndex: index + 1,
          hasAttachments: false,
          metadata: {
            isReply: commentItem.isReply,
            parentCommentId: commentItem.parentCommentId,
            isResolved: commentItem.isResolved,
            anchor: commentItem.anchor,
            quotedContent: commentItem.quotedContent,
          },
          createdAt: now,
          updatedAt: now,
        });
      }

      // Cache comment if it's not a reply
      if (!commentItem.isReply) {
        await db
          .insert(googleDocsCommentCache)
          .values({
            id: randomUUID(),
            documentId: docCacheId,
            googleCommentId: commentItem.id,
            googleDocumentId: file.id,
            content: commentItem.content,
            anchor: commentItem.anchor,
            quotedContent: commentItem.quotedContent,
            authorEmail: commentItem.authorEmail,
            authorName: commentItem.authorName,
            isResolved: commentItem.isResolved ?? false,
            replyCount:
              comments
                .find((c) => c.id === commentItem.id)
                ?.replies?.filter((r) => !r.deleted).length ?? 0,
            googleCreatedAt: commentItem.createdAt,
            googleModifiedAt: commentItem.createdAt,
            createdAt: now,
            updatedAt: now,
          })
          .onConflictDoUpdate({
            target: [
              googleDocsCommentCache.documentId,
              googleDocsCommentCache.googleCommentId,
            ],
            set: {
              content: commentItem.content,
              isResolved: commentItem.isResolved ?? false,
              updatedAt: now,
            },
          });
      }
    }

    // Trigger analysis
    await analyzeGoogleDocTask.trigger(
      { conversationId: convId },
      {
        debounce: {
          key: `google-docs-analysis-${convId}`,
          delay: "30s",
          mode: "trailing",
        },
      }
    );

    log.info("Synced Google Doc", {
      documentId: file.id,
      title: file.name,
      comments: comments.length,
    });
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    result.errors.push(`Document sync failed for ${file.id}: ${errorMsg}`);
    log.error("Failed to sync Google Doc", {
      documentId: file.id,
      error: errorMsg,
    });
  }
}

// =============================================================================
// CONVERSATION ANALYSIS TASK
// =============================================================================

interface GoogleDocAnalysisPayload {
  conversationId: string;
  force?: boolean;
}

interface GoogleDocAnalysisResult {
  success: boolean;
  conversationId: string;
  claimsCreated: number;
  commitmentsCreated: number;
  decisionsCreated: number;
  error?: string;
}

/**
 * Analyze a Google Doc conversation for intelligence extraction.
 * Uses Python backend for all AI processing.
 */
export const analyzeGoogleDocTask = task({
  id: "google-docs-analysis",
  queue: { name: "google-docs-analysis", concurrencyLimit: 10 },
  retry: {
    maxAttempts: 3,
    minTimeoutInMs: 5000,
    maxTimeoutInMs: 60_000,
    factor: 2,
  },
  maxDuration: 180, // 3 minutes max

  run: async (
    payload: GoogleDocAnalysisPayload
  ): Promise<GoogleDocAnalysisResult> => {
    const { conversationId, force = false } = payload;

    log.info("Starting Google Doc analysis via Python backend", {
      conversationId,
      force,
    });

    const result: GoogleDocAnalysisResult = {
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
          const sender = msg.senderName ?? msg.senderEmail ?? msg.senderExternalId ?? "Unknown";
          const timestamp = msg.sentAt?.toISOString() ?? "";
          return `[${timestamp}] ${sender}: ${msg.bodyText ?? ""}`;
        })
        .join("\n");

      // Call Python backend for intelligence extraction
      log.info("Calling Python backend for Google Doc analysis", {
        conversationId,
        messageCount: conv.messages.length,
        contentLength: content.length,
      });

      const analysis = await callPythonIntelligence({
        content,
        organization_id: conv.sourceAccount.organizationId,
        source_type: "google_docs",
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

      // Extract and create/update contacts from email participants
      const participantEmailsSet = new Set<string>();
      for (const msg of conv.messages) {
        if (msg.senderEmail) {
          participantEmailsSet.add(msg.senderEmail);
        }
      }

      for (const email of participantEmailsSet) {
        // Check if contact exists
        const existingContact = await db.query.contact.findFirst({
          where: and(
            eq(contact.organizationId, conv.sourceAccount.organizationId),
            eq(contact.primaryEmail, email)
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
            primaryEmail: email,
            displayName: email.split("@")[0],
            enrichmentSource: "google_docs",
            lastInteractionAt: conv.lastMessageAt ?? new Date(),
            totalMessages: conv.messageCount ?? 1,
            metadata: {
              sourceAccountId: conv.sourceAccountId,
              source: "google_docs",
            },
          });
        }
      }

      // Note: Embedding generation and memory episodes are handled by the Python intelligence backend

      result.success = true;

      log.info("Google Doc analysis completed", {
        conversationId,
        claimsCreated: result.claimsCreated,
        commitmentsCreated: result.commitmentsCreated,
        decisionsCreated: result.decisionsCreated,
      });

      return result;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      result.error = errorMsg;
      log.error("Google Doc analysis failed", {
        conversationId,
        error: errorMsg,
      });
      return result;
    }
  },
});

/**
 * Batch analyze unprocessed Google Docs.
 */
export const analyzeGoogleDocsBatchTask = task({
  id: "google-docs-analysis-batch",
  queue: { name: "google-docs-analysis", concurrencyLimit: 3 },
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

    log.info("Starting batch Google Docs analysis", {
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
        await analyzeGoogleDocTask.trigger({
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
 * Scheduled task to sync all Google Docs accounts.
 * Runs every 15 minutes.
 */
export const syncGoogleDocsSchedule = schedules.task({
  id: "google-docs-sync-schedule",
  cron: "*/15 * * * *", // Every 15 minutes
  run: async () => {
    log.info("Starting scheduled Google Docs sync");

    // Get all active Google Docs source accounts
    const googleDocsAccounts = await db.query.sourceAccount.findMany({
      where: and(
        eq(sourceAccount.type, "google_docs"),
        eq(sourceAccount.status, "connected")
      ),
      columns: { id: true },
    });

    if (googleDocsAccounts.length === 0) {
      log.info("No Google Docs accounts to sync");
      return { scheduled: true, accountsTriggered: 0 };
    }

    // Trigger sync for each account
    for (const account of googleDocsAccounts) {
      await syncGoogleDocsTask.trigger({
        sourceAccountId: account.id,
        fullSync: false,
      });

      // Also trigger batch analysis for any unprocessed documents
      await analyzeGoogleDocsBatchTask.trigger({
        sourceAccountId: account.id,
        limit: 20,
      });
    }

    log.info("Scheduled Google Docs sync triggered", {
      accounts: googleDocsAccounts.length,
    });

    return { scheduled: true, accountsTriggered: googleDocsAccounts.length };
  },
});


// =============================================================================
// EXPORTS
// =============================================================================

export type {
  GoogleDocsSyncPayload,
  GoogleDocsSyncResult,
  GoogleDocAnalysisPayload,
  GoogleDocAnalysisResult,
};
