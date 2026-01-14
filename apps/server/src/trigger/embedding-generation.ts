// =============================================================================
// EMBEDDING GENERATION TRIGGER.DEV TASKS
// =============================================================================
//
// Background tasks for generating vector embeddings for semantic search.
// Processes messages, threads, and claims to build the vector index.
//

import {
  aggregateEmbeddings,
  calculateInputHash,
  DEFAULT_EMBEDDING_MODEL,
  generateClaimEmbedding,
  generateMessageEmbedding,
} from "@memorystack/ai/embeddings";
import { db } from "@memorystack/db";
import {
  claim,
  claimEmbedding,
  emailMessage,
  emailThread,
  messageEmbedding,
  threadEmbedding,
} from "@memorystack/db/schema";
import { task } from "@trigger.dev/sdk";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { log } from "../lib/logger";

// =============================================================================
// TYPES
// =============================================================================

interface EmbedMessagePayload {
  messageId: string;
  force?: boolean;
}

interface EmbedThreadPayload {
  threadId: string;
  force?: boolean;
  aggregationMethod?: "mean" | "max_pool";
}

interface EmbedClaimPayload {
  claimId: string;
  force?: boolean;
}

interface EmbedBatchPayload {
  accountId: string;
  type: "messages" | "threads" | "claims";
  limit?: number;
  force?: boolean;
}

interface EmbeddingResult {
  success: boolean;
  id: string;
  tokenCount?: number;
  error?: string;
}

interface BatchEmbeddingResult {
  success: boolean;
  processed: number;
  failed: number;
  totalTokens: number;
  errors?: string[];
}

// =============================================================================
// MESSAGE EMBEDDING TASK
// =============================================================================

/**
 * Generate embedding for a single message.
 */
export const embedMessageTask = task({
  id: "embedding-message",
  queue: {
    name: "embeddings",
    concurrencyLimit: 20,
  },
  retry: {
    maxAttempts: 3,
    minTimeoutInMs: 2000,
    maxTimeoutInMs: 15_000,
    factor: 2,
  },
  maxDuration: 30,
  run: async (payload: EmbedMessagePayload): Promise<EmbeddingResult> => {
    const { messageId, force = false } = payload;

    log.info("Generating message embedding", { messageId, force });

    try {
      // Get message
      const message = await db.query.emailMessage.findFirst({
        where: eq(emailMessage.id, messageId),
      });

      if (!message) {
        return { success: false, id: messageId, error: "Message not found" };
      }

      // Check if embedding already exists
      if (!force) {
        const existing = await db.query.messageEmbedding.findFirst({
          where: eq(messageEmbedding.messageId, messageId),
        });

        if (existing) {
          // Check if content changed by comparing hashes
          const textToEmbed = buildMessageText(
            message.subject,
            message.bodyText
          );
          const currentHash = calculateInputHash(textToEmbed);

          if (existing.inputHash === currentHash) {
            log.info("Message embedding already up to date", { messageId });
            return {
              success: true,
              id: messageId,
              tokenCount: existing.tokenCount ?? 0,
            };
          }
        }
      }

      // Generate embedding
      const result = await generateMessageEmbedding(
        message.subject,
        message.bodyText ?? ""
      );

      // Upsert embedding
      await db
        .insert(messageEmbedding)
        .values({
          messageId,
          embedding: result.embedding,
          model: result.model,
          tokenCount: result.tokenCount,
          inputHash: result.inputHash,
          status: "completed",
        })
        .onConflictDoUpdate({
          target: messageEmbedding.messageId,
          set: {
            embedding: result.embedding,
            model: result.model,
            tokenCount: result.tokenCount,
            inputHash: result.inputHash,
            status: "completed",
            updatedAt: new Date(),
          },
        });

      log.info("Message embedding generated", {
        messageId,
        tokenCount: result.tokenCount,
      });

      return { success: true, id: messageId, tokenCount: result.tokenCount };
    } catch (error) {
      log.error("Failed to generate message embedding", {
        messageId,
        error: error instanceof Error ? error.message : "Unknown error",
      });

      // Mark as failed
      await db
        .insert(messageEmbedding)
        .values({
          messageId,
          embedding: new Array(1536).fill(0), // Placeholder
          model: DEFAULT_EMBEDDING_MODEL,
          status: "failed",
          errorMessage:
            error instanceof Error ? error.message : "Unknown error",
        })
        .onConflictDoUpdate({
          target: messageEmbedding.messageId,
          set: {
            status: "failed",
            errorMessage:
              error instanceof Error ? error.message : "Unknown error",
            updatedAt: new Date(),
          },
        });

      return {
        success: false,
        id: messageId,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  },
});

// =============================================================================
// THREAD EMBEDDING TASK
// =============================================================================

/**
 * Generate aggregated embedding for a thread from its messages.
 */
export const embedThreadTask = task({
  id: "embedding-thread",
  queue: {
    name: "embeddings",
    concurrencyLimit: 15,
  },
  retry: {
    maxAttempts: 3,
    minTimeoutInMs: 3000,
    maxTimeoutInMs: 20_000,
    factor: 2,
  },
  maxDuration: 60,
  run: async (payload: EmbedThreadPayload): Promise<EmbeddingResult> => {
    const { threadId, force = false, aggregationMethod = "mean" } = payload;

    log.info("Generating thread embedding", {
      threadId,
      force,
      aggregationMethod,
    });

    try {
      // Get thread with message embeddings
      const thread = await db.query.emailThread.findFirst({
        where: eq(emailThread.id, threadId),
        with: {
          messages: {
            orderBy: (m, { asc }) => [asc(m.messageIndex)],
          },
        },
      });

      if (!thread) {
        return { success: false, id: threadId, error: "Thread not found" };
      }

      if (thread.messages.length === 0) {
        return {
          success: false,
          id: threadId,
          error: "Thread has no messages",
        };
      }

      // Get embeddings for all messages
      const messageIds = thread.messages.map((m) => m.id);
      const existingEmbeddings = await db.query.messageEmbedding.findMany({
        where: and(
          inArray(messageEmbedding.messageId, messageIds),
          eq(messageEmbedding.status, "completed")
        ),
      });

      // If not all messages have embeddings, generate them first
      if (existingEmbeddings.length < messageIds.length) {
        const embeddedIds = new Set(existingEmbeddings.map((e) => e.messageId));
        const missingIds = messageIds.filter((id) => !embeddedIds.has(id));

        log.info("Generating missing message embeddings", {
          threadId,
          missingCount: missingIds.length,
        });

        // Generate embeddings for messages that don't have them
        for (const msgId of missingIds) {
          await embedMessageTask.triggerAndWait({ messageId: msgId });
        }

        // Re-fetch embeddings
        const refreshedEmbeddings = await db.query.messageEmbedding.findMany({
          where: and(
            inArray(messageEmbedding.messageId, messageIds),
            eq(messageEmbedding.status, "completed")
          ),
        });

        if (refreshedEmbeddings.length === 0) {
          return {
            success: false,
            id: threadId,
            error: "No message embeddings available",
          };
        }
      }

      // Re-fetch all embeddings
      const allEmbeddings = await db.query.messageEmbedding.findMany({
        where: and(
          inArray(messageEmbedding.messageId, messageIds),
          eq(messageEmbedding.status, "completed")
        ),
      });

      // Aggregate embeddings
      const embeddingVectors = allEmbeddings.map(
        (e) => e.embedding as number[]
      );
      const aggregatedEmbedding = aggregateEmbeddings(
        embeddingVectors,
        aggregationMethod
      );

      // Calculate total tokens
      const totalTokens = allEmbeddings.reduce(
        (sum, e) => sum + (e.tokenCount ?? 0),
        0
      );

      // Build input hash for the thread (based on message count and latest update)
      const inputHash = calculateInputHash(
        `${thread.id}:${thread.messages.length}:${thread.updatedAt?.toISOString()}`
      );

      // Check if we need to update
      if (!force) {
        const existing = await db.query.threadEmbedding.findFirst({
          where: eq(threadEmbedding.threadId, threadId),
        });

        if (
          existing &&
          existing.inputHash === inputHash &&
          existing.messageCount === thread.messages.length
        ) {
          log.info("Thread embedding already up to date", { threadId });
          return {
            success: true,
            id: threadId,
            tokenCount: existing.totalTokens ?? 0,
          };
        }
      }

      // Upsert thread embedding
      await db
        .insert(threadEmbedding)
        .values({
          threadId,
          embedding: aggregatedEmbedding,
          aggregationMethod,
          model: DEFAULT_EMBEDDING_MODEL,
          messageCount: thread.messages.length,
          totalTokens,
          inputHash,
          status: "completed",
        })
        .onConflictDoUpdate({
          target: threadEmbedding.threadId,
          set: {
            embedding: aggregatedEmbedding,
            aggregationMethod,
            messageCount: thread.messages.length,
            totalTokens,
            inputHash,
            status: "completed",
            updatedAt: new Date(),
          },
        });

      log.info("Thread embedding generated", {
        threadId,
        messageCount: thread.messages.length,
        totalTokens,
      });

      return { success: true, id: threadId, tokenCount: totalTokens };
    } catch (error) {
      log.error("Failed to generate thread embedding", {
        threadId,
        error: error instanceof Error ? error.message : "Unknown error",
      });

      return {
        success: false,
        id: threadId,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  },
});

// =============================================================================
// CLAIM EMBEDDING TASK
// =============================================================================

/**
 * Generate embedding for a claim (decision, commitment, etc.).
 */
export const embedClaimTask = task({
  id: "embedding-claim",
  queue: {
    name: "embeddings",
    concurrencyLimit: 20,
  },
  retry: {
    maxAttempts: 3,
    minTimeoutInMs: 2000,
    maxTimeoutInMs: 15_000,
    factor: 2,
  },
  maxDuration: 30,
  run: async (payload: EmbedClaimPayload): Promise<EmbeddingResult> => {
    const { claimId, force = false } = payload;

    log.info("Generating claim embedding", { claimId, force });

    try {
      // Get claim
      const claimRecord = await db.query.claim.findFirst({
        where: eq(claim.id, claimId),
      });

      if (!claimRecord) {
        return { success: false, id: claimId, error: "Claim not found" };
      }

      // Check if embedding already exists
      const textToEmbed = buildClaimText(claimRecord);
      const inputHash = calculateInputHash(textToEmbed);

      if (!force) {
        const existing = await db.query.claimEmbedding.findFirst({
          where: eq(claimEmbedding.claimId, claimId),
        });

        if (existing && existing.inputHash === inputHash) {
          log.info("Claim embedding already up to date", { claimId });
          return {
            success: true,
            id: claimId,
            tokenCount: existing.tokenCount ?? 0,
          };
        }
      }

      // Generate embedding
      const result = await generateClaimEmbedding(
        claimRecord.type,
        claimRecord.content,
        claimRecord.threadId ?? undefined
      );

      // Upsert embedding
      await db
        .insert(claimEmbedding)
        .values({
          claimId,
          embedding: result.embedding,
          model: result.model,
          tokenCount: result.tokenCount,
          inputHash: result.inputHash,
          status: "completed",
        })
        .onConflictDoUpdate({
          target: claimEmbedding.claimId,
          set: {
            embedding: result.embedding,
            model: result.model,
            tokenCount: result.tokenCount,
            inputHash: result.inputHash,
            status: "completed",
          },
        });

      log.info("Claim embedding generated", {
        claimId,
        tokenCount: result.tokenCount,
      });

      return { success: true, id: claimId, tokenCount: result.tokenCount };
    } catch (error) {
      log.error("Failed to generate claim embedding", {
        claimId,
        error: error instanceof Error ? error.message : "Unknown error",
      });

      return {
        success: false,
        id: claimId,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  },
});

// =============================================================================
// BATCH EMBEDDING TASK
// =============================================================================

/**
 * Process batch of items for embedding generation.
 */
export const embedBatchTask = task({
  id: "embedding-batch",
  queue: {
    name: "embeddings-batch",
    concurrencyLimit: 5,
  },
  retry: {
    maxAttempts: 2,
    minTimeoutInMs: 10_000,
    maxTimeoutInMs: 60_000,
    factor: 2,
  },
  maxDuration: 300, // 5 minutes
  run: async (payload: EmbedBatchPayload): Promise<BatchEmbeddingResult> => {
    const { accountId, type, limit = 100, force = false } = payload;

    log.info("Starting batch embedding", { accountId, type, limit, force });

    let processed = 0;
    let failed = 0;
    let totalTokens = 0;
    const errors: string[] = [];

    try {
      if (type === "messages") {
        // Find messages without embeddings
        const messages = await db
          .select({ id: emailMessage.id })
          .from(emailMessage)
          .innerJoin(emailThread, eq(emailMessage.threadId, emailThread.id))
          .leftJoin(
            messageEmbedding,
            eq(emailMessage.id, messageEmbedding.messageId)
          )
          .where(
            and(
              eq(emailThread.accountId, accountId),
              force ? undefined : isNull(messageEmbedding.id)
            )
          )
          .limit(limit);

        for (const msg of messages) {
          const result = await embedMessageTask.triggerAndWait({
            messageId: msg.id,
            force,
          });

          if (result.success) {
            processed++;
            totalTokens += result.tokenCount ?? 0;
          } else {
            failed++;
            if (result.error) {
              errors.push(`${msg.id}: ${result.error}`);
            }
          }
        }
      } else if (type === "threads") {
        // Find threads without embeddings
        const threads = await db
          .select({ id: emailThread.id })
          .from(emailThread)
          .leftJoin(
            threadEmbedding,
            eq(emailThread.id, threadEmbedding.threadId)
          )
          .where(
            and(
              eq(emailThread.accountId, accountId),
              force ? undefined : isNull(threadEmbedding.id)
            )
          )
          .limit(limit);

        for (const thread of threads) {
          const result = await embedThreadTask.triggerAndWait({
            threadId: thread.id,
            force,
          });

          if (result.success) {
            processed++;
            totalTokens += result.tokenCount ?? 0;
          } else {
            failed++;
            if (result.error) {
              errors.push(`${thread.id}: ${result.error}`);
            }
          }
        }
      } else if (type === "claims") {
        // Find claims without embeddings
        const claims = await db
          .select({ id: claim.id, threadId: claim.threadId })
          .from(claim)
          .innerJoin(emailThread, eq(claim.threadId, emailThread.id))
          .leftJoin(claimEmbedding, eq(claim.id, claimEmbedding.claimId))
          .where(
            and(
              eq(emailThread.accountId, accountId),
              force ? undefined : isNull(claimEmbedding.id)
            )
          )
          .limit(limit);

        for (const c of claims) {
          const result = await embedClaimTask.triggerAndWait({
            claimId: c.id,
            force,
          });

          if (result.success) {
            processed++;
            totalTokens += result.tokenCount ?? 0;
          } else {
            failed++;
            if (result.error) {
              errors.push(`${c.id}: ${result.error}`);
            }
          }
        }
      }

      log.info("Batch embedding completed", {
        accountId,
        type,
        processed,
        failed,
        totalTokens,
      });

      return {
        success: failed === 0,
        processed,
        failed,
        totalTokens,
        errors: errors.length > 0 ? errors.slice(0, 10) : undefined,
      };
    } catch (error) {
      log.error("Batch embedding failed", {
        accountId,
        type,
        error: error instanceof Error ? error.message : "Unknown error",
      });

      return {
        success: false,
        processed,
        failed: failed + 1,
        totalTokens,
        errors: [error instanceof Error ? error.message : "Unknown error"],
      };
    }
  },
});

// =============================================================================
// HELPERS
// =============================================================================

/**
 * Build text for message embedding.
 */
function buildMessageText(subject: string | null, body: string | null): string {
  const parts: string[] = [];

  if (subject) {
    parts.push(`Subject: ${subject}`);
  }

  if (body) {
    parts.push(body);
  }

  return parts.join("\n\n");
}

/**
 * Build text for claim embedding.
 */
function buildClaimText(claimRecord: {
  type: string;
  content: string;
  threadId: string | null;
}): string {
  return `[${claimRecord.type.toUpperCase()}] ${claimRecord.content}`;
}
