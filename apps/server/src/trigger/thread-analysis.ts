// =============================================================================
// THREAD ANALYSIS TRIGGER.DEV TASKS
// =============================================================================
//
// Background tasks for analyzing email threads using the Thread Understanding Agent.
// Processes threads after sync to extract intelligence.
//

import {
  analyzeThread,
  claimsToDbFormat,
  type DbClaimFormat,
  type OpenLoop,
  type ThreadInput,
} from "@memorystack/ai/agents";
import { db } from "@memorystack/db";
import { claim, contact, emailThread } from "@memorystack/db/schema";
import { task } from "@trigger.dev/sdk";
import { and, eq, isNull, lt, or } from "drizzle-orm";
import { log } from "../lib/logger";
import { extractCommitmentsTask } from "./commitment-extraction";
import { extractDecisionsTask } from "./decision-extraction";
import { embedThreadTask } from "./embedding-generation";
import { analyzeContactTask } from "./relationship-analysis";
import { analyzeIncomingMessageTask } from "./risk-analysis";
import { triageThreadTask } from "./triage-analysis";

// =============================================================================
// TYPES
// =============================================================================

interface AnalyzeThreadPayload {
  threadId: string;
  force?: boolean;
}

interface AnalyzeBatchPayload {
  accountId: string;
  threadIds?: string[];
  limit?: number;
  force?: boolean;
}

interface AnalysisResult {
  success: boolean;
  threadId: string;
  claimsCreated: number;
  error?: string;
}

// =============================================================================
// SINGLE THREAD ANALYSIS TASK
// =============================================================================

/**
 * Analyze a single thread.
 * Triggered after sync or on-demand.
 */
export const analyzeThreadTask = task({
  id: "thread-analysis-single",
  queue: {
    name: "thread-analysis",
    concurrencyLimit: 10,
  },
  retry: {
    maxAttempts: 3,
    minTimeoutInMs: 5000,
    maxTimeoutInMs: 30_000,
    factor: 2,
  },
  maxDuration: 120, // 2 minutes max per thread
  run: async (payload: AnalyzeThreadPayload): Promise<AnalysisResult> => {
    const { threadId, force = false } = payload;

    log.info("Starting thread analysis", { threadId, force });

    try {
      // Get thread with messages
      const thread = await db.query.emailThread.findFirst({
        where: eq(emailThread.id, threadId),
        with: {
          messages: {
            orderBy: (m, { asc }) => [asc(m.messageIndex)],
          },
          account: true,
        },
      });

      if (!thread) {
        return {
          success: false,
          threadId,
          claimsCreated: 0,
          error: "Thread not found",
        };
      }

      // Skip if recently analyzed (unless forced)
      if (!force && thread.lastAnalyzedAt) {
        const hoursSinceAnalysis =
          (Date.now() - thread.lastAnalyzedAt.getTime()) / (1000 * 60 * 60);
        if (hoursSinceAnalysis < 24) {
          log.info("Skipping recently analyzed thread", {
            threadId,
            hoursSinceAnalysis,
          });
          return {
            success: true,
            threadId,
            claimsCreated: 0,
            error: "Recently analyzed",
          };
        }
      }

      // Build thread input
      const threadInput = buildThreadInput(thread, thread.messages);

      // Run analysis
      const analysis = await analyzeThread(threadInput);

      // Save results to database
      await saveAnalysisResults(thread.id, analysis, thread.account);

      log.info("Thread analysis completed", {
        threadId,
        claims: {
          facts: analysis.claims.facts.length,
          promises: analysis.claims.promises.length,
          requests: analysis.claims.requests.length,
          questions: analysis.claims.questions.length,
          decisions: analysis.claims.decisions.length,
        },
        openLoops: analysis.openLoops.length,
        duration: analysis.processingDuration,
      });

      const totalClaims =
        analysis.claims.facts.length +
        analysis.claims.promises.length +
        analysis.claims.requests.length +
        analysis.claims.questions.length +
        analysis.claims.decisions.length;

      // Trigger downstream AI agents for deeper extraction
      const hasPromisesOrRequests =
        analysis.claims.promises.length > 0 ||
        analysis.claims.requests.length > 0;
      const hasDecisions = analysis.claims.decisions.length > 0;

      // 1. Commitment Extraction (if promises/requests found)
      if (hasPromisesOrRequests) {
        log.info("Triggering commitment extraction", { threadId });
        await extractCommitmentsTask.trigger({ threadId });
      }

      // 2. Decision Extraction (if decisions found)
      if (hasDecisions) {
        log.info("Triggering decision extraction", { threadId });
        await extractDecisionsTask.trigger({ threadId });
      }

      // 3. Triage Analysis (always - for inbox automation)
      log.info("Triggering triage analysis", { threadId });
      await triageThreadTask.trigger({
        threadId,
        accountId: thread.accountId,
      });

      // 4. Embedding Generation (always - for semantic search)
      log.info("Triggering embedding generation", { threadId });
      await embedThreadTask.trigger({ threadId });

      // 5. Risk Analysis (for each new message in thread)
      const newMessages = thread.messages.filter(
        (m) => !m.isFromUser // Analyze incoming messages for risk
      );
      for (const message of newMessages.slice(-3)) {
        // Last 3 incoming messages
        log.info("Triggering risk analysis for message", {
          threadId,
          messageId: message.id,
        });
        await analyzeIncomingMessageTask.trigger({
          messageId: message.id,
          accountId: thread.accountId,
          threadId,
        });
      }

      // 6. Extract and create contacts, then trigger relationship analysis
      const extractedContactIds = await extractAndUpsertContacts(
        thread.account.organizationId,
        thread.messages,
        thread.account.email
      );

      log.info("Extracted contacts from thread", {
        threadId,
        contactCount: extractedContactIds.length,
      });

      // Trigger relationship analysis for each contact
      for (const contactId of extractedContactIds) {
        log.info("Triggering relationship analysis for contact", {
          threadId,
          contactId,
        });
        await analyzeContactTask.trigger({ contactId });
      }

      return {
        success: true,
        threadId,
        claimsCreated: totalClaims,
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      log.error("Thread analysis failed", error, { threadId });

      return {
        success: false,
        threadId,
        claimsCreated: 0,
        error: errorMessage,
      };
    }
  },
});

// =============================================================================
// BATCH ANALYSIS TASK
// =============================================================================

/**
 * Analyze multiple threads in batch.
 * Useful for processing backfilled threads.
 */
export const batchAnalyzeThreadsTask = task({
  id: "thread-analysis-batch",
  queue: {
    name: "thread-analysis-batch",
    concurrencyLimit: 3,
  },
  retry: {
    maxAttempts: 2,
    minTimeoutInMs: 10_000,
    maxTimeoutInMs: 60_000,
    factor: 2,
  },
  maxDuration: 600, // 10 minutes max for batch
  run: async (
    payload: AnalyzeBatchPayload
  ): Promise<{
    success: boolean;
    total: number;
    analyzed: number;
    failed: number;
    errors: string[];
  }> => {
    const { accountId, threadIds, limit = 50, force = false } = payload;

    log.info("Starting batch thread analysis", {
      accountId,
      threadIdsProvided: threadIds?.length,
      limit,
    });

    // Get threads to analyze
    let threadsToAnalyze: string[];

    if (threadIds) {
      threadsToAnalyze = threadIds;
    } else {
      // Find unanalyzed or stale threads
      const staleThreshold = new Date();
      staleThreshold.setDate(staleThreshold.getDate() - 7); // Re-analyze after 7 days

      const threads = await db.query.emailThread.findMany({
        where: and(
          eq(emailThread.accountId, accountId),
          or(
            isNull(emailThread.lastAnalyzedAt),
            lt(emailThread.lastAnalyzedAt, staleThreshold)
          )
        ),
        columns: { id: true },
        limit,
        orderBy: (t, { desc }) => [desc(t.lastMessageAt)], // Prioritize recent threads
      });

      threadsToAnalyze = threads.map((t) => t.id);
    }

    if (threadsToAnalyze.length === 0) {
      return {
        success: true,
        total: 0,
        analyzed: 0,
        failed: 0,
        errors: [],
      };
    }

    log.info("Found threads to analyze", { count: threadsToAnalyze.length });

    // Process threads (trigger individual tasks for reliability)
    const results: AnalysisResult[] = [];
    const errors: string[] = [];

    // Process in chunks of 10 for better throughput
    const chunkSize = 10;
    for (let i = 0; i < threadsToAnalyze.length; i += chunkSize) {
      const chunk = threadsToAnalyze.slice(i, i + chunkSize);

      // Trigger tasks in parallel
      const handles = await Promise.all(
        chunk.map((threadId) => analyzeThreadTask.trigger({ threadId, force }))
      );

      // Wait for results (with timeout)
      for (const handle of handles) {
        try {
          // Note: In production, you might want to use batchTriggerAndWait
          // For now, we just trigger and move on
          results.push({
            success: true,
            threadId: handle.id,
            claimsCreated: 0,
          });
        } catch (error) {
          errors.push(error instanceof Error ? error.message : "Unknown error");
        }
      }
    }

    const analyzed = results.filter((r) => r.success).length;
    const failed = results.filter((r) => !r.success).length;

    log.info("Batch analysis completed", {
      total: threadsToAnalyze.length,
      analyzed,
      failed,
    });

    return {
      success: failed === 0,
      total: threadsToAnalyze.length,
      analyzed,
      failed,
      errors,
    };
  },
});

// =============================================================================
// AUTO-ANALYSIS TASK
// =============================================================================

/**
 * Automatically analyze new threads after sync.
 * Called from sync tasks when new threads are discovered.
 */
export const autoAnalyzeNewThreadsTask = task({
  id: "thread-analysis-auto",
  queue: {
    name: "thread-analysis",
    concurrencyLimit: 10,
  },
  run: async (payload: {
    accountId: string;
    threadIds: string[];
  }): Promise<{ triggered: number }> => {
    const { accountId, threadIds } = payload;

    if (threadIds.length === 0) {
      return { triggered: 0 };
    }

    log.info("Auto-triggering thread analysis for new threads", {
      accountId,
      count: threadIds.length,
    });

    // Trigger analysis for each thread
    let triggered = 0;
    for (const threadId of threadIds) {
      await analyzeThreadTask.trigger({ threadId });
      triggered++;
    }

    return { triggered };
  },
});

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Build ThreadInput from database models.
 */
function buildThreadInput(
  thread: {
    id: string;
    accountId: string;
    providerThreadId: string;
    subject: string | null;
    participantEmails: string[] | null;
    account: { organizationId: string; email: string };
  },
  messages: Array<{
    id: string;
    providerMessageId: string;
    fromEmail: string;
    fromName: string | null;
    toRecipients: unknown;
    ccRecipients: unknown;
    subject: string | null;
    bodyText: string | null;
    bodyHtml: string | null;
    sentAt: Date | null;
    receivedAt: Date | null;
    isFromUser: boolean;
    messageIndex: number;
  }>
): ThreadInput {
  return {
    id: thread.id,
    accountId: thread.accountId,
    organizationId: thread.account.organizationId,
    providerThreadId: thread.providerThreadId,
    subject: thread.subject ?? undefined,
    participantEmails: thread.participantEmails ?? undefined,
    userEmail: thread.account.email,
    messages: messages.map((m) => ({
      id: m.id,
      providerMessageId: m.providerMessageId,
      fromEmail: m.fromEmail,
      fromName: m.fromName ?? undefined,
      toRecipients:
        (m.toRecipients as Array<{ email: string; name?: string }>) || [],
      ccRecipients:
        (m.ccRecipients as Array<{ email: string; name?: string }>) || [],
      subject: m.subject ?? undefined,
      bodyText: m.bodyText ?? undefined,
      bodyHtml: m.bodyHtml ?? undefined,
      sentAt: m.sentAt ?? undefined,
      receivedAt: m.receivedAt ?? undefined,
      isFromUser: m.isFromUser,
      messageIndex: m.messageIndex,
    })),
  };
}

/**
 * Save analysis results to database.
 */
async function saveAnalysisResults(
  threadId: string,
  analysis: Awaited<ReturnType<typeof analyzeThread>>,
  account: { organizationId: string }
): Promise<void> {
  const organizationId = account.organizationId;

  // Convert claims to database format
  const dbClaims = claimsToDbFormat(analysis.claims, threadId, organizationId);

  await db.transaction(async (tx) => {
    // Delete existing claims for this thread (to handle re-analysis)
    await tx.delete(claim).where(eq(claim.threadId, threadId));

    // Insert new claims
    if (dbClaims.length > 0) {
      await tx.insert(claim).values(
        dbClaims.map((c: DbClaimFormat) => ({
          ...c,
          extractedAt: new Date(),
          extractionModel: "claude-3-5-sonnet",
          extractionVersion: analysis.modelVersion,
        }))
      );
    }

    // Update thread with analysis results
    await tx
      .update(emailThread)
      .set({
        // Classification
        intentClassification: analysis.classification.intent.intent,
        urgencyScore: analysis.classification.urgency.score,
        importanceScore: analysis.classification.urgency.score, // Use urgency for now
        sentimentScore: analysis.classification.sentiment.overall,

        // Brief
        briefSummary: analysis.brief.summary,

        // Open loops
        hasOpenLoops: analysis.openLoops.length > 0,
        openLoopCount: analysis.openLoops.length,

        // Triage suggestions (from classification)
        suggestedAction: getSuggestedAction(analysis),
        priorityTier: analysis.classification.urgency.level,

        // Analysis tracking
        lastAnalyzedAt: new Date(),
        analysisVersion: analysis.modelVersion,

        updatedAt: new Date(),
      })
      .where(eq(emailThread.id, threadId));
  });
}

/**
 * Derive suggested action from analysis.
 */
function getSuggestedAction(
  analysis: Awaited<ReturnType<typeof analyzeThread>>
): string {
  const { intent } = analysis.classification.intent;
  const { openLoops } = analysis;
  const { isOthersWaitingOnUser } = analysis.waitingOn;

  // If others are waiting on user, suggest response
  if (isOthersWaitingOnUser) {
    return "respond";
  }

  // If there are unanswered questions from user
  if (openLoops.some((l: OpenLoop) => l.type === "unanswered_question")) {
    return "follow_up";
  }

  // Intent-based suggestions
  switch (intent) {
    case "approval_request":
      return "review";
    case "task_assignment":
      return "respond";
    case "question":
      return "respond";
    case "scheduling":
      return "respond";
    case "feedback":
      return "review";
    case "complaint":
      return "respond";
    case "information_sharing":
      return "archive";
    case "thank_you":
      return "archive";
    default:
      return "review";
  }
}

/**
 * Extract and upsert contacts from thread messages.
 * Returns the list of created/updated contact IDs.
 */
async function extractAndUpsertContacts(
  organizationId: string,
  messages: Array<{
    fromEmail: string;
    fromName: string | null;
    isFromUser: boolean;
    toRecipients: unknown;
    ccRecipients: unknown;
  }>,
  userEmail: string
): Promise<string[]> {
  const contactIds: string[] = [];
  const seenEmails = new Set<string>();
  const userEmailLower = userEmail.toLowerCase();

  // Extract all participants (excluding user)
  const participants: Array<{ email: string; name?: string }> = [];

  for (const message of messages) {
    // Add sender if not user
    if (!message.isFromUser && message.fromEmail) {
      const email = message.fromEmail.toLowerCase();
      if (!seenEmails.has(email) && email !== userEmailLower) {
        seenEmails.add(email);
        participants.push({
          email: message.fromEmail,
          name: message.fromName ?? undefined,
        });
      }
    }

    // Add recipients
    const toRecipients =
      (message.toRecipients as Array<{ email: string; name?: string }>) || [];
    const ccRecipients =
      (message.ccRecipients as Array<{ email: string; name?: string }>) || [];

    for (const recipient of [...toRecipients, ...ccRecipients]) {
      if (recipient.email) {
        const email = recipient.email.toLowerCase();
        if (!seenEmails.has(email) && email !== userEmailLower) {
          seenEmails.add(email);
          participants.push(recipient);
        }
      }
    }
  }

  // Upsert contacts
  for (const participant of participants) {
    const email = participant.email.toLowerCase();

    // Check if contact exists
    const existing = await db.query.contact.findFirst({
      where: eq(contact.primaryEmail, email),
    });

    if (existing) {
      // Update last interaction
      await db
        .update(contact)
        .set({
          lastInteractionAt: new Date(),
          totalMessages: (existing.totalMessages ?? 0) + 1,
          updatedAt: new Date(),
        })
        .where(eq(contact.id, existing.id));

      contactIds.push(existing.id);
    } else {
      // Create new contact
      const [newContact] = await db
        .insert(contact)
        .values({
          organizationId,
          primaryEmail: email,
          displayName: participant.name ?? email.split("@")[0],
          firstInteractionAt: new Date(),
          lastInteractionAt: new Date(),
          totalMessages: 1,
          totalThreads: 1,
        })
        .returning();

      if (newContact) {
        contactIds.push(newContact.id);
        log.info("Created new contact", {
          contactId: newContact.id,
          email,
        });
      }
    }
  }

  return contactIds;
}
