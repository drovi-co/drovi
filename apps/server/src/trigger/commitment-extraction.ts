// =============================================================================
// COMMITMENT EXTRACTION TRIGGER.DEV TASKS
// =============================================================================
//
// Background tasks for extracting commitments from email threads.
// Processes claims from Thread Understanding Agent to create trackable commitments.
//

import {
  type CommitmentStatus,
  type CommitmentThreadContext,
  createCommitmentAgent,
  type PromiseClaimInput,
  type RequestClaimInput,
} from "@memorystack/ai/agents";
import { createNotification } from "@memorystack/api/routers/notifications";
import { db } from "@memorystack/db";
import {
  claim,
  commitment,
  contact,
  emailThread,
} from "@memorystack/db/schema";
import { task } from "@trigger.dev/sdk";
import { and, eq, inArray, or } from "drizzle-orm";
import { log } from "../lib/logger";

// =============================================================================
// TYPES
// =============================================================================

interface ExtractCommitmentsPayload {
  threadId: string;
  force?: boolean;
}

interface BatchExtractPayload {
  accountId: string;
  threadIds?: string[];
  limit?: number;
}

interface CommitmentExtractionResult {
  success: boolean;
  threadId: string;
  commitmentsCreated: number;
  error?: string;
}

// =============================================================================
// SINGLE THREAD COMMITMENT EXTRACTION
// =============================================================================

/**
 * Extract commitments from a single thread.
 * Called after thread analysis completes.
 */
export const extractCommitmentsTask = task({
  id: "commitment-extraction-single",
  queue: {
    name: "commitment-extraction",
    concurrencyLimit: 10,
  },
  retry: {
    maxAttempts: 3,
    minTimeoutInMs: 5000,
    maxTimeoutInMs: 30_000,
    factor: 2,
  },
  maxDuration: 120,
  run: async (
    payload: ExtractCommitmentsPayload
  ): Promise<CommitmentExtractionResult> => {
    const { threadId, force = false } = payload;

    log.info("Starting commitment extraction", { threadId, force });

    try {
      // Get thread with messages and claims
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
          commitmentsCreated: 0,
          error: "Thread not found",
        };
      }

      // Get promise and request claims for this thread
      const threadClaims = await db.query.claim.findMany({
        where: and(
          eq(claim.threadId, threadId),
          or(eq(claim.type, "promise"), eq(claim.type, "request")),
          eq(claim.isUserDismissed, false)
        ),
      });

      if (threadClaims.length === 0) {
        log.info("No promise/request claims to process", { threadId });
        return {
          success: true,
          threadId,
          commitmentsCreated: 0,
        };
      }

      // Check if we already extracted commitments (unless forced)
      if (!force) {
        const existingCommitments = await db.query.commitment.findFirst({
          where: eq(commitment.sourceThreadId, threadId),
        });
        if (existingCommitments) {
          log.info("Commitments already extracted for thread", { threadId });
          return {
            success: true,
            threadId,
            commitmentsCreated: 0,
            error: "Already processed",
          };
        }
      }

      // Build context for the agent
      const context: CommitmentThreadContext = {
        threadId: thread.id,
        accountId: thread.accountId,
        organizationId: thread.account.organizationId,
        userEmail: thread.account.email,
        subject: thread.subject ?? undefined,
        messages: thread.messages.map((m) => ({
          id: m.id,
          fromEmail: m.fromEmail,
          fromName: m.fromName ?? undefined,
          sentAt: m.sentAt ?? undefined,
          bodyText: m.bodyText ?? undefined,
          isFromUser: m.isFromUser,
        })),
      };

      // Split claims into promises and requests
      const promiseClaims: PromiseClaimInput[] = threadClaims
        .filter((c) => c.type === "promise")
        .map((c) => ({
          id: c.id,
          text: c.text,
          promisor: (c.metadata as { promisor?: string } | null)?.promisor,
          promisee: (c.metadata as { promisee?: string } | null)?.promisee,
          deadline: (c.metadata as { deadline?: string } | null)?.deadline,
          deadlineConfidence: (
            c.metadata as { deadlineConfidence?: number } | null
          )?.deadlineConfidence,
          isConditional: (c.metadata as { isConditional?: boolean } | null)
            ?.isConditional,
          condition: (c.metadata as { condition?: string } | null)?.condition,
          confidence: c.confidence,
          evidence: [
            {
              messageId: c.messageId || "",
              quotedText: c.quotedText || c.text,
            },
          ],
        }));

      const requestClaims: RequestClaimInput[] = threadClaims
        .filter((c) => c.type === "request")
        .map((c) => ({
          id: c.id,
          text: c.text,
          requester: (c.metadata as { requester?: string } | null)?.requester,
          requestee: (c.metadata as { requestee?: string } | null)?.requestee,
          deadline: (c.metadata as { deadline?: string } | null)?.deadline,
          priority: (c.metadata as { priority?: string } | null)?.priority,
          isExplicit: (c.metadata as { isExplicit?: boolean } | null)
            ?.isExplicit,
          confidence: c.confidence,
          evidence: [
            {
              messageId: c.messageId || "",
              quotedText: c.quotedText || c.text,
            },
          ],
        }));

      // Extract commitments
      const agent = createCommitmentAgent();
      const extractedCommitments = await agent.extractCommitments(
        context,
        promiseClaims,
        requestClaims
      );

      if (extractedCommitments.length === 0) {
        log.info("No commitments extracted", { threadId });
        return {
          success: true,
          threadId,
          commitmentsCreated: 0,
        };
      }

      // Save commitments to database
      const savedCount = await saveCommitments(
        extractedCommitments,
        thread.account.organizationId
      );

      // Create notifications for new commitments
      if (savedCount > 0) {
        const userId = thread.account.addedByUserId;
        for (const c of extractedCommitments) {
          const isOwedByMe = c.direction === "owed_by_me";
          await createNotification(
            userId,
            {
              type: isOwedByMe ? "warning" : "info",
              category: "commitment",
              title: isOwedByMe
                ? "New Commitment Made"
                : "New Commitment to Track",
              message: c.title,
              link: `/dashboard/commitments`,
              entityId: c.sourceClaimId ?? undefined,
              entityType: "commitment",
              priority: c.dueDate ? "high" : "normal",
              metadata: {
                confidence: c.confidence,
                direction: c.direction,
                threadId,
              },
            },
            "new"
          );
        }
      }

      log.info("Commitment extraction completed", {
        threadId,
        extracted: extractedCommitments.length,
        saved: savedCount,
      });

      return {
        success: true,
        threadId,
        commitmentsCreated: savedCount,
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      log.error("Commitment extraction failed", error, { threadId });

      return {
        success: false,
        threadId,
        commitmentsCreated: 0,
        error: errorMessage,
      };
    }
  },
});

// =============================================================================
// BATCH COMMITMENT EXTRACTION
// =============================================================================

/**
 * Extract commitments from multiple threads.
 */
export const batchExtractCommitmentsTask = task({
  id: "commitment-extraction-batch",
  queue: {
    name: "commitment-extraction-batch",
    concurrencyLimit: 3,
  },
  retry: {
    maxAttempts: 2,
    minTimeoutInMs: 10_000,
    maxTimeoutInMs: 60_000,
    factor: 2,
  },
  maxDuration: 600,
  run: async (
    payload: BatchExtractPayload
  ): Promise<{
    success: boolean;
    total: number;
    processed: number;
    errors: string[];
  }> => {
    const { accountId, threadIds, limit = 50 } = payload;

    log.info("Starting batch commitment extraction", {
      accountId,
      providedCount: threadIds?.length,
      limit,
    });

    // Get threads to process
    let threadsToProcess: string[];

    if (threadIds) {
      threadsToProcess = threadIds;
    } else {
      // Find threads with promise/request claims that don't have commitments yet
      const threadsWithClaims = await db.query.claim.findMany({
        where: or(eq(claim.type, "promise"), eq(claim.type, "request")),
        columns: { threadId: true },
      });

      const uniqueThreadIds = [
        ...new Set(
          threadsWithClaims.map((c) => c.threadId).filter(Boolean) as string[]
        ),
      ];

      // Filter to threads without existing commitments
      const threadsWithCommitments = await db.query.commitment.findMany({
        where: inArray(commitment.sourceThreadId, uniqueThreadIds),
        columns: { sourceThreadId: true },
      });

      const processedThreadIds = new Set(
        threadsWithCommitments
          .map((c) => c.sourceThreadId)
          .filter(Boolean) as string[]
      );

      threadsToProcess = uniqueThreadIds
        .filter((id) => !processedThreadIds.has(id))
        .slice(0, limit);
    }

    if (threadsToProcess.length === 0) {
      return {
        success: true,
        total: 0,
        processed: 0,
        errors: [],
      };
    }

    log.info("Found threads to process", { count: threadsToProcess.length });

    // Process threads
    const errors: string[] = [];
    let processed = 0;

    // Process in chunks
    const chunkSize = 10;
    for (let i = 0; i < threadsToProcess.length; i += chunkSize) {
      const chunk = threadsToProcess.slice(i, i + chunkSize);

      // Trigger tasks in parallel
      const handles = await Promise.all(
        chunk.map((threadId) => extractCommitmentsTask.trigger({ threadId }))
      );

      processed += handles.length;
    }

    log.info("Batch commitment extraction completed", {
      total: threadsToProcess.length,
      processed,
      errors: errors.length,
    });

    return {
      success: errors.length === 0,
      total: threadsToProcess.length,
      processed,
      errors,
    };
  },
});

// =============================================================================
// STATUS UPDATE TASK
// =============================================================================

/**
 * Update commitment status based on new thread activity.
 */
export const updateCommitmentStatusTask = task({
  id: "commitment-status-update",
  queue: {
    name: "commitment-extraction",
    concurrencyLimit: 10,
  },
  run: async (payload: {
    threadId: string;
    newMessageIds: string[];
  }): Promise<{ updated: number }> => {
    const { threadId, newMessageIds } = payload;

    // Get existing commitments for this thread
    const existingCommitments = await db.query.commitment.findMany({
      where: and(
        eq(commitment.sourceThreadId, threadId),
        inArray(commitment.status, ["pending", "in_progress", "waiting"])
      ),
    });

    if (existingCommitments.length === 0) {
      return { updated: 0 };
    }

    // Get new messages
    const thread = await db.query.emailThread.findFirst({
      where: eq(emailThread.id, threadId),
      with: {
        messages: {
          where: (m, { inArray: inArr }) => inArr(m.id, newMessageIds),
        },
        account: true,
      },
    });

    if (!thread || thread.messages.length === 0) {
      return { updated: 0 };
    }

    // Use agent to detect status changes
    const agent = createCommitmentAgent();
    const statusChanges = await agent.detectStatusChanges(
      existingCommitments.map((c) => ({
        id: c.id,
        title: c.title,
        status: c.status as CommitmentStatus,
        dueDate: c.dueDate ?? undefined,
      })),
      thread.messages.map((m) => ({
        id: m.id,
        fromEmail: m.fromEmail,
        bodyText: m.bodyText ?? undefined,
        sentAt: m.sentAt ?? undefined,
      }))
    );

    // Apply status changes
    let updated = 0;
    for (const change of statusChanges) {
      // Find matching commitment by title
      const matchingCommitment = existingCommitments.find((c) =>
        c.title.toLowerCase().includes(change.reason.toLowerCase())
      );

      if (matchingCommitment && change.confidence > 0.6) {
        await db
          .update(commitment)
          .set({
            status: change.newStatus,
            completedAt:
              change.newStatus === "completed" ? new Date() : undefined,
            completedVia:
              change.newStatus === "completed" ? "detected" : undefined,
            updatedAt: new Date(),
          })
          .where(eq(commitment.id, matchingCommitment.id));
        updated++;
      }
    }

    log.info("Commitment status update completed", {
      threadId,
      checked: existingCommitments.length,
      updated,
    });

    return { updated };
  },
});

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Save extracted commitments to database.
 */
async function saveCommitments(
  extractedCommitments: Awaited<
    ReturnType<ReturnType<typeof createCommitmentAgent>["extractCommitments"]>
  >,
  organizationId: string
): Promise<number> {
  let saved = 0;

  for (const c of extractedCommitments) {
    // Find or create contacts for debtor/creditor
    let debtorContactId: string | undefined;
    let creditorContactId: string | undefined;

    if (c.debtor?.email) {
      const debtorContact = await findOrCreateContact(
        c.debtor.email,
        c.debtor.name,
        organizationId
      );
      debtorContactId = debtorContact?.id;
    }

    if (c.creditor?.email) {
      const creditorContact = await findOrCreateContact(
        c.creditor.email,
        c.creditor.name,
        organizationId
      );
      creditorContactId = creditorContact?.id;
    }

    // Insert commitment
    await db.insert(commitment).values({
      organizationId,
      claimId: c.sourceClaimId || null,
      debtorContactId: debtorContactId || null,
      creditorContactId: creditorContactId || null,
      direction: c.direction,
      title: c.title,
      description: c.description,
      dueDate: c.dueDate?.date ? new Date(c.dueDate.date) : null,
      dueDateConfidence: c.dueDate?.confidence,
      dueDateSource: c.dueDate?.source,
      dueDateOriginalText: c.dueDate?.originalText,
      status: c.status,
      priority: c.priority,
      sourceThreadId: c.sourceThreadId,
      sourceMessageId: c.sourceMessageId,
      confidence: c.confidence,
      metadata: c.metadata as Record<string, unknown>,
    });

    saved++;
  }

  return saved;
}

/**
 * Find or create a contact by email.
 */
async function findOrCreateContact(
  email: string,
  name: string | undefined,
  organizationId: string
): Promise<{ id: string } | undefined> {
  // Try to find existing contact
  const existing = await db.query.contact.findFirst({
    where: and(
      eq(contact.primaryEmail, email.toLowerCase()),
      eq(contact.organizationId, organizationId)
    ),
    columns: { id: true },
  });

  if (existing) {
    return existing;
  }

  // Create new contact
  const [newContact] = await db
    .insert(contact)
    .values({
      organizationId,
      primaryEmail: email.toLowerCase(),
      displayName: name,
    })
    .returning({ id: contact.id });

  return newContact;
}
