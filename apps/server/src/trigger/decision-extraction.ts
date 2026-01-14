// =============================================================================
// DECISION EXTRACTION TRIGGER.DEV TASKS
// =============================================================================
//
// Background tasks for extracting decisions from email threads.
// Processes claims from Thread Understanding Agent to create searchable decisions.
//

import {
  createDecisionAgent,
  type DecisionClaimInput,
  type DecisionThreadContext,
} from "@memorystack/ai/agents";
import { createNotification } from "@memorystack/api/routers/notifications";
import { db } from "@memorystack/db";
import {
  claim,
  contact,
  decision,
  emailThread,
} from "@memorystack/db/schema";
import { task } from "@trigger.dev/sdk";
import { and, desc, eq, inArray } from "drizzle-orm";
import { log } from "../lib/logger";

// =============================================================================
// TYPES
// =============================================================================

interface ExtractDecisionsPayload {
  threadId: string;
  force?: boolean;
}

interface BatchExtractPayload {
  accountId: string;
  threadIds?: string[];
  limit?: number;
}

interface DecisionExtractionResult {
  success: boolean;
  threadId: string;
  decisionsCreated: number;
  supersessionsDetected: number;
  error?: string;
}

// =============================================================================
// SINGLE THREAD DECISION EXTRACTION
// =============================================================================

/**
 * Extract decisions from a single thread.
 * Called after thread analysis completes.
 */
export const extractDecisionsTask = task({
  id: "decision-extraction-single",
  queue: {
    name: "decision-extraction",
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
    payload: ExtractDecisionsPayload
  ): Promise<DecisionExtractionResult> => {
    const { threadId, force = false } = payload;

    log.info("Starting decision extraction", { threadId, force });

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
          decisionsCreated: 0,
          supersessionsDetected: 0,
          error: "Thread not found",
        };
      }

      // Get decision claims for this thread
      const threadClaims = await db.query.claim.findMany({
        where: and(
          eq(claim.threadId, threadId),
          eq(claim.type, "decision"),
          eq(claim.isUserDismissed, false)
        ),
      });

      if (threadClaims.length === 0) {
        log.info("No decision claims to process", { threadId });
        return {
          success: true,
          threadId,
          decisionsCreated: 0,
          supersessionsDetected: 0,
        };
      }

      // Check if we already extracted decisions (unless forced)
      if (!force) {
        const existingDecisions = await db.query.decision.findFirst({
          where: eq(decision.sourceThreadId, threadId),
        });
        if (existingDecisions) {
          log.info("Decisions already extracted for thread", { threadId });
          return {
            success: true,
            threadId,
            decisionsCreated: 0,
            supersessionsDetected: 0,
            error: "Already processed",
          };
        }
      }

      // Build context for the agent
      const context: DecisionThreadContext = {
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

      // Convert claims to decision claim inputs
      const decisionClaims: DecisionClaimInput[] = threadClaims.map((c) => ({
        id: c.id,
        text: c.text,
        decision: (c.metadata as { decision?: string } | null)?.decision,
        decisionMaker: (c.metadata as { decisionMaker?: string } | null)
          ?.decisionMaker,
        rationale: (c.metadata as { rationale?: string } | null)?.rationale,
        alternatives: (c.metadata as { alternatives?: string[] } | null)
          ?.alternatives,
        confidence: c.confidence,
        evidence: [
          {
            messageId: c.messageId || "",
            quotedText: c.quotedText || c.text,
          },
        ],
      }));

      // Extract decisions
      const agent = createDecisionAgent();
      const extractedDecisions = await agent.extractDecisions(
        context,
        decisionClaims
      );

      if (extractedDecisions.length === 0) {
        log.info("No decisions extracted", { threadId });
        return {
          success: true,
          threadId,
          decisionsCreated: 0,
          supersessionsDetected: 0,
        };
      }

      // Get existing decisions for supersession detection
      const existingDecisions = await db.query.decision.findMany({
        where: and(
          eq(decision.organizationId, thread.account.organizationId),
          eq(decision.isUserDismissed, false)
        ),
        orderBy: [desc(decision.decidedAt)],
        limit: 100, // Check against recent decisions
      });

      // Save decisions and detect supersessions
      let supersessionsDetected = 0;
      const savedCount = await saveDecisions(
        extractedDecisions,
        thread.account.organizationId,
        agent,
        existingDecisions,
        (count) => {
          supersessionsDetected = count;
        }
      );

      // Create notifications for new decisions
      if (savedCount > 0) {
        const userId = thread.account.addedByUserId;
        for (const d of extractedDecisions) {
          await createNotification(
            userId,
            {
              type: "success",
              category: "decision",
              title: "Decision Recorded",
              message: d.title,
              link: `/dashboard/decisions`,
              entityId: d.sourceClaimId ?? undefined,
              entityType: "decision",
              priority: "normal",
              metadata: {
                topic: d.topic,
                confidence: d.confidence,
                threadId,
              },
            },
            "new"
          );
        }
      }

      // Create notifications for superseded decisions
      if (supersessionsDetected > 0) {
        const userId = thread.account.addedByUserId;
        await createNotification(
          userId,
          {
            type: "info",
            category: "decision",
            title: "Decision Updated",
            message: `${supersessionsDetected} previous decision${supersessionsDetected > 1 ? "s have" : " has"} been superseded`,
            link: `/dashboard/decisions`,
            priority: "normal",
            metadata: {
              supersessionsCount: supersessionsDetected,
              threadId,
            },
          },
          "superseded"
        );
      }

      log.info("Decision extraction completed", {
        threadId,
        extracted: extractedDecisions.length,
        saved: savedCount,
        supersessions: supersessionsDetected,
      });

      return {
        success: true,
        threadId,
        decisionsCreated: savedCount,
        supersessionsDetected,
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      log.error("Decision extraction failed", error, { threadId });

      return {
        success: false,
        threadId,
        decisionsCreated: 0,
        supersessionsDetected: 0,
        error: errorMessage,
      };
    }
  },
});

// =============================================================================
// BATCH DECISION EXTRACTION
// =============================================================================

/**
 * Extract decisions from multiple threads.
 */
export const batchExtractDecisionsTask = task({
  id: "decision-extraction-batch",
  queue: {
    name: "decision-extraction-batch",
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

    log.info("Starting batch decision extraction", {
      accountId,
      providedCount: threadIds?.length,
      limit,
    });

    // Get threads to process
    let threadsToProcess: string[];

    if (threadIds) {
      threadsToProcess = threadIds;
    } else {
      // Find threads with decision claims that don't have decisions yet
      const threadsWithClaims = await db.query.claim.findMany({
        where: eq(claim.type, "decision"),
        columns: { threadId: true },
      });

      const uniqueThreadIds = [
        ...new Set(
          threadsWithClaims.map((c) => c.threadId).filter(Boolean) as string[]
        ),
      ];

      // Filter to threads without existing decisions
      const threadsWithDecisions = await db.query.decision.findMany({
        where: inArray(decision.sourceThreadId, uniqueThreadIds),
        columns: { sourceThreadId: true },
      });

      const processedThreadIds = new Set(
        threadsWithDecisions
          .map((d) => d.sourceThreadId)
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
        chunk.map((threadId) => extractDecisionsTask.trigger({ threadId }))
      );

      processed += handles.length;
    }

    log.info("Batch decision extraction completed", {
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
// HELPER FUNCTIONS
// =============================================================================

/**
 * Save extracted decisions to database.
 */
async function saveDecisions(
  extractedDecisions: Awaited<
    ReturnType<ReturnType<typeof createDecisionAgent>["extractDecisions"]>
  >,
  organizationId: string,
  agent: ReturnType<typeof createDecisionAgent>,
  existingDecisions: Array<{
    id: string;
    title: string;
    statement: string;
    topic?: string | null;
    decidedAt: Date;
  }>,
  onSupersessionCount: (count: number) => void
): Promise<number> {
  let saved = 0;
  let supersessionCount = 0;

  for (const d of extractedDecisions) {
    // Find or create contacts for owners
    const ownerContactIds: string[] = [];
    const participantContactIds: string[] = [];

    if (d.owners) {
      for (const owner of d.owners) {
        if (owner.email) {
          const ownerContact = await findOrCreateContact(
            owner.email,
            owner.name,
            organizationId
          );
          if (ownerContact) {
            ownerContactIds.push(ownerContact.id);
          }
        }
      }
    }

    if (d.participants) {
      for (const participant of d.participants) {
        if (participant.email) {
          const participantContact = await findOrCreateContact(
            participant.email,
            participant.name,
            organizationId
          );
          if (participantContact) {
            participantContactIds.push(participantContact.id);
          }
        }
      }
    }

    // Detect supersession
    let supersedes: string | undefined;

    if (existingDecisions.length > 0) {
      const supersessions = await agent.detectSupersession(
        d,
        existingDecisions.map((ed) => ({
          id: ed.id,
          title: ed.title,
          statement: ed.statement,
          topic: ed.topic ?? undefined,
          decidedAt: ed.decidedAt,
        }))
      );

      if (supersessions.length > 0 && supersessions[0]) {
        supersedes = supersessions[0].supersededDecisionId;
        supersessionCount++;

        // Update the old decision to point to this one
        // (We'll set supersededById after we get the new decision's ID)
      }
    }

    // Insert decision
    const [insertedDecision] = await db
      .insert(decision)
      .values({
        organizationId,
        claimId: d.sourceClaimId || null,
        title: d.title,
        statement: d.statement,
        rationale: d.rationale,
        alternatives: d.alternatives as Array<{
          title: string;
          description?: string;
          pros?: string[];
          cons?: string[];
          rejected?: boolean;
        }>,
        ownerContactIds,
        participantContactIds,
        decidedAt: new Date(d.decidedAt),
        confidence: d.confidence,
        supersedes,
        sourceThreadId: d.sourceThreadId,
        sourceMessageIds: d.sourceMessageIds,
        topicIds: d.topic ? [d.topic] : [],
        metadata: d.metadata as Record<string, unknown>,
      })
      .returning({ id: decision.id });

    // Update superseded decision if applicable
    if (supersedes && insertedDecision) {
      await db
        .update(decision)
        .set({
          supersededById: insertedDecision.id,
          supersededAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(decision.id, supersedes));
    }

    saved++;
  }

  onSupersessionCount(supersessionCount);
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
