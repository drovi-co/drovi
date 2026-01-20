// =============================================================================
// UNIFIED OBJECT PROCESSING TRIGGER.DEV TASKS
// =============================================================================
//
// Background tasks for processing Unified Intelligence Objects (UIOs).
// Handles deduplication, update detection, embedding generation, and backfilling.
//

import {
  createDeduplicationAgent,
  createUpdateDetectionAgent,
  type ExtractedCommitmentForDedup,
} from "@memorystack/ai/agents";
import { db, schema } from "@memorystack/db";
import { task } from "@trigger.dev/sdk";
import { and, desc, eq, isNull } from "drizzle-orm";
import { log } from "../lib/logger";

// =============================================================================
// TYPES
// =============================================================================

interface ProcessCommitmentPayload {
  organizationId: string;
  commitment: ExtractedCommitmentForDedup;
  sourceType: string;
  sourceAccountId?: string;
  conversationId?: string;
  messageId?: string;
  emailThreadId?: string;
  emailMessageId?: string;
  sourceName?: string;
  messageTimestamp?: string;
  originalCommitmentId?: string;
  originalDecisionId?: string;
  originalClaimId?: string;
}

interface DetectUpdatesPayload {
  organizationId: string;
  messageId: string;
  messageContent: string;
  senderEmail?: string;
  senderName?: string;
  senderContactId?: string;
  timestamp: string;
  sourceType: string;
  sourceAccountId?: string;
  conversationId?: string;
  threadSubject?: string;
}

interface EmbedUIOPayload {
  uioId: string;
}

interface BackfillPayload {
  organizationId: string;
  limit?: number;
  offset?: number;
}

interface ProcessDecisionPayload {
  organizationId: string;
  decision: {
    id: string;
    title: string;
    statement?: string;
    rationale?: string;
    decidedAt: Date;
    confidence: number;
    ownerContactIds: string[];
    participantContactIds: string[];
    sourceQuote?: string;
  };
  sourceType: string;
  sourceAccountId?: string;
  conversationId?: string;
  messageId?: string;
  emailThreadId?: string;
  emailMessageId?: string;
  sourceName?: string;
  messageTimestamp?: string;
  originalDecisionId?: string;
  originalClaimId?: string;
}

// =============================================================================
// PROCESS NEW COMMITMENT INTO UIO SYSTEM
// =============================================================================

/**
 * Process a new commitment into the UIO system.
 * Checks for duplicates and creates/merges accordingly.
 */
export const processCommitmentTask = task({
  id: "uio-process-commitment",
  queue: {
    name: "uio-processing",
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
    payload: ProcessCommitmentPayload
  ): Promise<{
    success: boolean;
    action: "created" | "merged" | "pending_review";
    uioId?: string;
    error?: string;
  }> => {
    const {
      organizationId,
      commitment,
      sourceType,
      sourceAccountId,
      conversationId,
      messageId,
      emailThreadId,
      emailMessageId,
      sourceName,
      messageTimestamp,
      originalCommitmentId,
      originalDecisionId,
      originalClaimId,
    } = payload;

    log.info("Processing commitment into UIO system", {
      organizationId,
      title: commitment.title,
      sourceType,
    });

    try {
      // Use deduplication agent to check for duplicates
      const deduplicationAgent = createDeduplicationAgent(db);
      const result = await deduplicationAgent.checkForDuplicates({
        organizationId,
        newCommitment: {
          ...commitment,
          dueDate: commitment.dueDate ? new Date(commitment.dueDate) : null,
        },
        sourceType,
        sourceConversationId: conversationId || "",
        sourceMessageId: messageId,
        sourceAccountId,
      });

      let uio: typeof schema.unifiedIntelligenceObject.$inferSelect;
      let action: "created" | "merged" | "pending_review";

      const sourceContext = {
        organizationId,
        sourceType,
        sourceAccountId,
        conversationId,
        messageId,
        emailThreadId,
        emailMessageId,
        sourceName,
        messageTimestamp: messageTimestamp
          ? new Date(messageTimestamp)
          : undefined,
      };

      switch (result.action) {
        case "create_new": {
          // Create new UIO
          const ownerContactId = await resolveContactFromEmail(
            commitment.debtorEmail || commitment.creditorEmail,
            organizationId
          );

          const [newUio] = await db
            .insert(schema.unifiedIntelligenceObject)
            .values({
              organizationId,
              type: "commitment",
              status: "active",
              canonicalTitle: commitment.title,
              canonicalDescription: commitment.description,
              dueDate: commitment.dueDate ? new Date(commitment.dueDate) : null,
              dueDateConfidence: commitment.dueDateConfidence,
              dueDateLastUpdatedAt: new Date(),
              ownerContactId,
              participantContactIds: [],
              overallConfidence: commitment.confidence,
              firstSeenAt: new Date(),
              lastUpdatedAt: new Date(),
              lastActivitySourceType:
                sourceType as (typeof schema.sourceTypeEnum.enumValues)[number],
            })
            .returning();

          if (!newUio) {
            throw new Error("Failed to create UIO");
          }

          uio = newUio;
          action = "created";

          // Add source reference
          await addSourceToUIO(newUio.id, sourceContext, commitment, "origin", {
            originalCommitmentId,
            originalDecisionId,
            originalClaimId,
          });

          // Add timeline event
          await addTimelineEvent(newUio.id, {
            eventType: "created",
            eventDescription: `Created from ${sourceType}`,
            sourceType,
            sourceId: conversationId,
            sourceName,
            confidence: commitment.confidence,
          });

          // Trigger embedding generation
          await embedUIOTask.trigger({ uioId: newUio.id });

          break;
        }

        case "merge_into": {
          if (!result.targetUioId) {
            throw new Error("merge_into action requires targetUioId");
          }

          // Update existing UIO
          const existingUio =
            await db.query.unifiedIntelligenceObject.findFirst({
              where: eq(
                schema.unifiedIntelligenceObject.id,
                result.targetUioId
              ),
            });

          if (!existingUio) {
            throw new Error(`UIO ${result.targetUioId} not found`);
          }

          // Update if we have more confident info
          const updates: Partial<
            typeof schema.unifiedIntelligenceObject.$inferInsert
          > = {
            lastUpdatedAt: new Date(),
            lastActivitySourceType:
              sourceType as (typeof schema.sourceTypeEnum.enumValues)[number],
          };

          if (
            commitment.dueDate &&
            (!existingUio.dueDate ||
              (commitment.dueDateConfidence ?? 0) >
                (existingUio.dueDateConfidence ?? 0))
          ) {
            updates.dueDate = new Date(commitment.dueDate);
            updates.dueDateConfidence = commitment.dueDateConfidence;
            updates.dueDateLastUpdatedAt = new Date();
          }

          await db
            .update(schema.unifiedIntelligenceObject)
            .set(updates)
            .where(eq(schema.unifiedIntelligenceObject.id, result.targetUioId));

          uio = {
            ...existingUio,
            ...updates,
          } as typeof schema.unifiedIntelligenceObject.$inferSelect;
          action = "merged";

          // Add source reference
          await addSourceToUIO(
            result.targetUioId,
            sourceContext,
            commitment,
            "update",
            {
              originalCommitmentId,
              originalDecisionId,
              originalClaimId,
            }
          );

          // Add timeline event
          await addTimelineEvent(result.targetUioId, {
            eventType: "source_added",
            eventDescription: `Mentioned in ${sourceType}`,
            sourceType,
            sourceId: conversationId,
            sourceName,
            messageId,
            quotedText: commitment.sourceQuote,
            confidence: commitment.confidence,
          });

          // Re-generate embedding
          await embedUIOTask.trigger({ uioId: result.targetUioId });

          break;
        }

        case "pending_review": {
          // Create new UIO and deduplication candidate
          const ownerContactId = await resolveContactFromEmail(
            commitment.debtorEmail || commitment.creditorEmail,
            organizationId
          );

          const [newUio] = await db
            .insert(schema.unifiedIntelligenceObject)
            .values({
              organizationId,
              type: "commitment",
              status: "active",
              canonicalTitle: commitment.title,
              canonicalDescription: commitment.description,
              dueDate: commitment.dueDate ? new Date(commitment.dueDate) : null,
              dueDateConfidence: commitment.dueDateConfidence,
              dueDateLastUpdatedAt: new Date(),
              ownerContactId,
              participantContactIds: [],
              overallConfidence: commitment.confidence,
              firstSeenAt: new Date(),
              lastUpdatedAt: new Date(),
              lastActivitySourceType:
                sourceType as (typeof schema.sourceTypeEnum.enumValues)[number],
            })
            .returning();

          if (!newUio) {
            throw new Error("Failed to create UIO");
          }

          uio = newUio;
          action = "pending_review";

          // Add source reference
          await addSourceToUIO(newUio.id, sourceContext, commitment, "origin", {
            originalCommitmentId,
            originalDecisionId,
            originalClaimId,
          });

          // Add timeline event
          await addTimelineEvent(newUio.id, {
            eventType: "created",
            eventDescription: `Created from ${sourceType} (pending deduplication review)`,
            sourceType,
            sourceId: conversationId,
            sourceName,
            confidence: commitment.confidence,
          });

          // Create deduplication candidate
          if (result.targetUioId) {
            await db.insert(schema.deduplicationCandidate).values({
              organizationId,
              sourceObjectId: newUio.id,
              targetObjectId: result.targetUioId,
              semanticSimilarity: result.scores?.semanticSimilarity ?? 0,
              partyMatchScore: result.scores?.partyMatchScore,
              temporalScore: result.scores?.temporalScore,
              overallScore: result.scores?.overallScore ?? result.confidence,
              matchReasons: result.matchReasons,
              matchExplanation: result.explanation,
              status: "pending_review",
              expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
            });
          }

          // Trigger embedding generation
          await embedUIOTask.trigger({ uioId: newUio.id });

          break;
        }
      }

      // Link original commitment/decision to UIO if provided
      if (originalCommitmentId) {
        await db
          .update(schema.commitment)
          .set({ unifiedObjectId: uio.id })
          .where(eq(schema.commitment.id, originalCommitmentId));
      }

      if (originalDecisionId) {
        await db
          .update(schema.decision)
          .set({ unifiedObjectId: uio.id })
          .where(eq(schema.decision.id, originalDecisionId));
      }

      log.info("Commitment processed into UIO system", {
        uioId: uio.id,
        action,
        confidence: result.confidence,
      });

      return {
        success: true,
        action,
        uioId: uio.id,
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      log.error("Failed to process commitment into UIO", error, {
        organizationId,
        title: commitment.title,
      });

      return {
        success: false,
        action: "created",
        error: errorMessage,
      };
    }
  },
});

// =============================================================================
// PROCESS NEW DECISION INTO UIO SYSTEM
// =============================================================================

/**
 * Process a new decision into the UIO system.
 * Creates a UIO for the decision with proper source tracking.
 */
export const processDecisionTask = task({
  id: "uio-process-decision",
  queue: {
    name: "uio-processing",
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
    payload: ProcessDecisionPayload
  ): Promise<{
    success: boolean;
    action: "created" | "merged";
    uioId?: string;
    error?: string;
  }> => {
    const {
      organizationId,
      decision,
      sourceType,
      sourceAccountId,
      conversationId,
      messageId,
      emailThreadId,
      emailMessageId,
      sourceName,
      messageTimestamp,
      originalDecisionId,
    } = payload;

    log.info("Processing decision into UIO system", {
      organizationId,
      title: decision.title,
      sourceType,
    });

    try {
      // For decisions, we generally create a new UIO rather than merge
      // since decisions are typically unique events
      const ownerContactId = decision.ownerContactIds[0] ?? null;

      const [newUio] = await db
        .insert(schema.unifiedIntelligenceObject)
        .values({
          organizationId,
          type: "decision",
          status: "active",
          canonicalTitle: decision.title,
          canonicalDescription: decision.statement ?? decision.rationale,
          ownerContactId,
          participantContactIds: decision.participantContactIds,
          overallConfidence: decision.confidence,
          firstSeenAt: decision.decidedAt,
          lastUpdatedAt: new Date(),
          lastActivitySourceType:
            sourceType as (typeof schema.sourceTypeEnum.enumValues)[number],
        })
        .returning();

      if (!newUio) {
        throw new Error("Failed to create UIO for decision");
      }

      // Add source reference
      await db.insert(schema.unifiedObjectSource).values({
        unifiedObjectId: newUio.id,
        sourceType:
          sourceType as (typeof schema.sourceTypeEnum.enumValues)[number],
        sourceAccountId,
        role: "origin",
        conversationId,
        messageId,
        emailThreadId,
        emailMessageId,
        originalDecisionId,
        quotedText: decision.sourceQuote,
        extractedTitle: decision.title,
        confidence: decision.confidence,
        sourceTimestamp: messageTimestamp
          ? new Date(messageTimestamp)
          : undefined,
        detectionMethod: "extraction",
      });

      // Add timeline event
      await db.insert(schema.unifiedObjectTimeline).values({
        unifiedObjectId: newUio.id,
        eventType: "created",
        eventDescription: `Decision recorded from ${sourceType}`,
        sourceType: sourceType as
          | (typeof schema.sourceTypeEnum.enumValues)[number]
          | undefined,
        sourceId: conversationId,
        sourceName,
        messageId,
        quotedText: decision.sourceQuote,
        confidence: decision.confidence,
        triggeredBy: "system",
        eventAt: decision.decidedAt,
      });

      // Link original decision to UIO
      if (originalDecisionId) {
        await db
          .update(schema.decision)
          .set({ unifiedObjectId: newUio.id })
          .where(eq(schema.decision.id, originalDecisionId));
      }

      // Trigger embedding generation
      await embedUIOTask.trigger({ uioId: newUio.id });

      log.info("Decision processed into UIO system", {
        uioId: newUio.id,
        title: decision.title,
      });

      return {
        success: true,
        action: "created",
        uioId: newUio.id,
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      log.error("Failed to process decision into UIO", error, {
        organizationId,
        title: decision.title,
      });

      return {
        success: false,
        action: "created",
        error: errorMessage,
      };
    }
  },
});

// =============================================================================
// DETECT UPDATES TO UIOS FROM NEW MESSAGES
// =============================================================================

/**
 * Detect updates to existing UIOs from a new message.
 */
export const detectUpdatesTask = task({
  id: "uio-detect-updates",
  queue: {
    name: "uio-processing",
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
    payload: DetectUpdatesPayload
  ): Promise<{
    success: boolean;
    updatesFound: number;
    uiosUpdated: string[];
    error?: string;
  }> => {
    const {
      organizationId,
      messageId,
      messageContent,
      senderEmail,
      senderName,
      senderContactId,
      timestamp,
      sourceType,
      sourceAccountId,
      conversationId,
      threadSubject,
    } = payload;

    log.info("Detecting UIO updates from message", {
      organizationId,
      messageId,
      sourceType,
    });

    try {
      const updateDetectionAgent = createUpdateDetectionAgent(db);

      const result = await updateDetectionAgent.detectUpdates({
        organizationId,
        message: {
          id: messageId,
          content: messageContent,
          senderEmail,
          senderName,
          senderContactId,
          timestamp: new Date(timestamp),
          sourceType,
          conversationId,
          threadSubject,
        },
        sourceAccountId,
      });

      if (!result.hasUpdates) {
        log.info("No UIO updates detected", { messageId });
        return {
          success: true,
          updatesFound: 0,
          uiosUpdated: [],
        };
      }

      // Apply updates
      await updateDetectionAgent.applyUpdates(
        {
          organizationId,
          message: {
            id: messageId,
            content: messageContent,
            senderEmail,
            senderName,
            senderContactId,
            timestamp: new Date(timestamp),
            sourceType,
            conversationId,
            threadSubject,
          },
          sourceAccountId,
        },
        result.references
      );

      const uiosUpdated = result.references.map((r) => r.uioId);

      log.info("UIO updates applied", {
        messageId,
        updatesFound: result.references.length,
        uiosUpdated,
      });

      return {
        success: true,
        updatesFound: result.references.length,
        uiosUpdated,
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      log.error("Failed to detect UIO updates", error, { messageId });

      return {
        success: false,
        updatesFound: 0,
        uiosUpdated: [],
        error: errorMessage,
      };
    }
  },
});

// =============================================================================
// GENERATE UIO EMBEDDING
// =============================================================================

/**
 * Generate or update embedding for a UIO.
 */
export const embedUIOTask = task({
  id: "uio-embed",
  queue: {
    name: "uio-embedding",
    concurrencyLimit: 20,
  },
  retry: {
    maxAttempts: 3,
    minTimeoutInMs: 2000,
    maxTimeoutInMs: 15_000,
    factor: 2,
  },
  maxDuration: 60,
  run: async (
    payload: EmbedUIOPayload
  ): Promise<{
    success: boolean;
    error?: string;
  }> => {
    const { uioId } = payload;

    log.info("Generating UIO embedding", { uioId });

    try {
      const uio = await db.query.unifiedIntelligenceObject.findFirst({
        where: eq(schema.unifiedIntelligenceObject.id, uioId),
      });

      if (!uio) {
        return { success: false, error: "UIO not found" };
      }

      // Build text for embedding
      const text = `[${uio.type.toUpperCase()}] ${uio.canonicalTitle}\n${uio.canonicalDescription ?? ""}`;

      // Generate embedding
      const response = await fetch(
        `${process.env.EMBEDDING_SERVICE_URL || "https://api.openai.com/v1"}/embeddings`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
          },
          body: JSON.stringify({
            model: "text-embedding-3-small",
            input: text,
          }),
        }
      );

      if (!response.ok) {
        throw new Error(`Embedding generation failed: ${response.statusText}`);
      }

      const data = (await response.json()) as {
        data: Array<{ embedding: number[] }>;
      };
      const embedding = data.data[0]?.embedding;

      if (!embedding) {
        throw new Error("No embedding returned");
      }

      // Upsert embedding
      await db
        .insert(schema.unifiedObjectEmbedding)
        .values({
          unifiedObjectId: uioId,
          embedding,
          model: "text-embedding-3-small",
          inputHash: hashString(text),
          status: "completed",
        })
        .onConflictDoUpdate({
          target: schema.unifiedObjectEmbedding.unifiedObjectId,
          set: {
            embedding,
            inputHash: hashString(text),
            status: "completed",
            updatedAt: new Date(),
          },
        });

      log.info("UIO embedding generated", { uioId });

      return { success: true };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      log.error("Failed to generate UIO embedding", error, { uioId });

      return { success: false, error: errorMessage };
    }
  },
});

// =============================================================================
// BACKFILL EXISTING COMMITMENTS TO UIOS
// =============================================================================

/**
 * Migrate existing commitments to UIOs.
 */
export const backfillUIOsTask = task({
  id: "uio-backfill",
  queue: {
    name: "uio-backfill",
    concurrencyLimit: 2,
  },
  retry: {
    maxAttempts: 2,
    minTimeoutInMs: 10_000,
    maxTimeoutInMs: 60_000,
    factor: 2,
  },
  maxDuration: 600,
  run: async (
    payload: BackfillPayload
  ): Promise<{
    success: boolean;
    processed: number;
    created: number;
    merged: number;
    errors: number;
  }> => {
    const { organizationId, limit = 100, offset = 0 } = payload;

    log.info("Starting UIO backfill", { organizationId, limit, offset });

    try {
      // Get commitments without UIO links
      const commitments = await db.query.commitment.findMany({
        where: and(
          eq(schema.commitment.organizationId, organizationId),
          isNull(schema.commitment.unifiedObjectId)
        ),
        limit,
        offset,
        orderBy: [desc(schema.commitment.createdAt)],
        with: {
          debtor: true,
          creditor: true,
        },
      });

      if (commitments.length === 0) {
        return {
          success: true,
          processed: 0,
          created: 0,
          merged: 0,
          errors: 0,
        };
      }

      let created = 0;
      let merged = 0;
      let errors = 0;

      for (const commitment of commitments) {
        try {
          // Extract source type from metadata, default to "email" for legacy data
          const metadata = commitment.metadata as {
            sourceType?: string;
          } | null;
          const sourceType = (metadata?.sourceType ??
            "email") as ProcessCommitmentPayload["sourceType"];
          const isEmail = sourceType === "email";

          const result = await processCommitmentTask.triggerAndWait({
            organizationId,
            commitment: {
              id: commitment.id,
              title: commitment.title,
              description: commitment.description ?? undefined,
              dueDate: commitment.dueDate,
              dueDateConfidence: commitment.dueDateConfidence ?? undefined,
              debtorContactId: commitment.debtorContactId ?? undefined,
              debtorEmail: commitment.debtor?.primaryEmail ?? undefined,
              debtorName: commitment.debtor?.displayName ?? undefined,
              creditorContactId: commitment.creditorContactId ?? undefined,
              creditorEmail: commitment.creditor?.primaryEmail ?? undefined,
              creditorName: commitment.creditor?.displayName ?? undefined,
              confidence: commitment.confidence ?? 0.7,
            },
            sourceType,
            conversationId: commitment.sourceThreadId ?? undefined, // Generic conversation ID
            emailThreadId: isEmail
              ? (commitment.sourceThreadId ?? undefined)
              : undefined,
            emailMessageId: isEmail
              ? (commitment.sourceMessageId ?? undefined)
              : undefined,
            originalCommitmentId: commitment.id,
          });

          if (result.ok && result.output.success) {
            if (
              result.output.action === "created" ||
              result.output.action === "pending_review"
            ) {
              created++;
            } else {
              merged++;
            }
          } else {
            errors++;
          }
        } catch {
          errors++;
        }
      }

      log.info("UIO backfill completed", {
        organizationId,
        processed: commitments.length,
        created,
        merged,
        errors,
      });

      // Schedule next batch if there are more
      if (commitments.length === limit) {
        await backfillUIOsTask.trigger({
          organizationId,
          limit,
          offset: offset + limit,
        });
      }

      return {
        success: errors === 0,
        processed: commitments.length,
        created,
        merged,
        errors,
      };
    } catch (error) {
      log.error("UIO backfill failed", error, { organizationId });
      return {
        success: false,
        processed: 0,
        created: 0,
        merged: 0,
        errors: 1,
      };
    }
  },
});

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

async function resolveContactFromEmail(
  email: string | undefined,
  organizationId: string
): Promise<string | null> {
  if (!email) return null;

  const contact = await db.query.contact.findFirst({
    where: and(
      eq(schema.contact.organizationId, organizationId),
      eq(schema.contact.primaryEmail, email.toLowerCase())
    ),
  });

  return contact?.id ?? null;
}

async function addSourceToUIO(
  uioId: string,
  context: {
    organizationId: string;
    sourceType: string;
    sourceAccountId?: string;
    conversationId?: string;
    messageId?: string;
    emailThreadId?: string;
    emailMessageId?: string;
    sourceName?: string;
    messageTimestamp?: Date;
  },
  commitment: ExtractedCommitmentForDedup,
  role: "origin" | "update" | "confirmation" | "context",
  links: {
    originalCommitmentId?: string;
    originalDecisionId?: string;
    originalClaimId?: string;
  }
): Promise<void> {
  await db.insert(schema.unifiedObjectSource).values({
    unifiedObjectId: uioId,
    sourceType:
      context.sourceType as (typeof schema.sourceTypeEnum.enumValues)[number],
    sourceAccountId: context.sourceAccountId,
    role,
    conversationId: context.conversationId,
    messageId: context.messageId,
    emailThreadId: context.emailThreadId,
    emailMessageId: context.emailMessageId,
    originalCommitmentId: links.originalCommitmentId,
    originalDecisionId: links.originalDecisionId,
    originalClaimId: links.originalClaimId,
    quotedText: commitment.sourceQuote,
    extractedTitle: commitment.title,
    extractedDueDate: commitment.dueDate
      ? new Date(commitment.dueDate)
      : undefined,
    confidence: commitment.confidence,
    sourceTimestamp: context.messageTimestamp,
    detectionMethod: "extraction",
  });
}

async function addTimelineEvent(
  uioId: string,
  event: {
    eventType:
      | "created"
      | "status_changed"
      | "due_date_changed"
      | "due_date_confirmed"
      | "participant_added"
      | "source_added"
      | "merged"
      | "user_verified"
      | "user_corrected"
      | "auto_completed";
    eventDescription: string;
    sourceType?: string;
    sourceId?: string;
    sourceName?: string;
    messageId?: string;
    quotedText?: string;
    confidence?: number;
  }
): Promise<void> {
  await db.insert(schema.unifiedObjectTimeline).values({
    unifiedObjectId: uioId,
    eventType: event.eventType,
    eventDescription: event.eventDescription,
    sourceType: event.sourceType as
      | (typeof schema.sourceTypeEnum.enumValues)[number]
      | undefined,
    sourceId: event.sourceId,
    sourceName: event.sourceName,
    messageId: event.messageId,
    quotedText: event.quotedText,
    confidence: event.confidence,
    triggeredBy: "system",
    eventAt: new Date(),
  });
}

function hashString(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash;
  }
  return hash.toString(16);
}
