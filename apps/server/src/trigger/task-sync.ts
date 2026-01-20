// =============================================================================
// TASK SYNC TRIGGER.DEV TASKS
// =============================================================================
//
// Background tasks for auto-creating task records for:
// - Conversations (from all sources: email, slack, whatsapp, etc.)
// - Commitments (extracted from conversations)
// - Decisions (extracted from conversations)
//
// Architecture: Every synced item automatically becomes a task in "backlog" status.
// This enables the Linear-style task management view across all sources.
//

import { db } from "@memorystack/db";
import type { TaskMetadata } from "@memorystack/db/schema";
import {
  commitment,
  conversation,
  decision,
  task,
} from "@memorystack/db/schema";
import { task as triggerTask } from "@trigger.dev/sdk";
import { and, eq, sql } from "drizzle-orm";
import { log } from "../lib/logger";

// =============================================================================
// TYPES
// =============================================================================

interface CreateTaskForConversationPayload {
  conversationId: string;
}

interface CreateTaskForCommitmentPayload {
  commitmentId: string;
}

interface CreateTaskForDecisionPayload {
  decisionId: string;
}

interface BatchCreateTasksPayload {
  organizationId: string;
  sourceType?: "conversation" | "commitment" | "decision";
  /** Maximum items to process in this batch */
  limit?: number;
  /** Skip items that already have tasks (for incremental sync) */
  skipExisting?: boolean;
}

interface TaskCreationResult {
  success: boolean;
  taskId?: string;
  error?: string;
  skipped?: boolean;
}

interface BatchTaskCreationResult {
  success: boolean;
  created: number;
  skipped: number;
  failed: number;
  errors: string[];
}

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Generate a URL for the source item
 */
function getSourceUrl(
  _sourceType: string,
  _sourceAccountType: string,
  _externalId: string
): string | undefined {
  // TODO: Implement proper URL generation based on source type
  // For now, return undefined - this can be enhanced later
  return undefined;
}

// =============================================================================
// CREATE TASK FOR CONVERSATION
// =============================================================================

/**
 * Create a task record for a conversation.
 * Called after conversation is synced from any source.
 */
export const createTaskForConversationTask = triggerTask({
  id: "task-create-for-conversation",
  queue: {
    name: "task-sync",
    concurrencyLimit: 20,
  },
  retry: {
    maxAttempts: 3,
    minTimeoutInMs: 1000,
    maxTimeoutInMs: 10_000,
    factor: 2,
  },
  run: async (
    payload: CreateTaskForConversationPayload
  ): Promise<TaskCreationResult> => {
    const { conversationId } = payload;

    try {
      // Get conversation with source account
      const conv = await db.query.conversation.findFirst({
        where: eq(conversation.id, conversationId),
        with: {
          sourceAccount: true,
        },
      });

      if (!conv) {
        return {
          success: false,
          error: "Conversation not found",
        };
      }

      // Check if task already exists
      const existingTask = await db.query.task.findFirst({
        where: eq(task.sourceConversationId, conversationId),
        columns: { id: true },
      });

      if (existingTask) {
        return {
          success: true,
          taskId: existingTask.id,
          skipped: true,
        };
      }

      // Create task with proper fields from conversation schema
      const title =
        conv.title ||
        conv.snippet?.slice(0, 100) ||
        `${conv.conversationType ?? "Message"} from ${conv.sourceAccount.type}`;

      // Build description from available AI analysis
      const descriptionParts: string[] = [];
      if (conv.briefSummary) {
        descriptionParts.push(conv.briefSummary);
      }
      if (conv.suggestedAction) {
        descriptionParts.push(
          `\n**Suggested action:** ${conv.suggestedAction}`
        );
      }
      if (conv.snippet && !conv.briefSummary) {
        descriptionParts.push(conv.snippet);
      }
      const description = descriptionParts.join("\n") || undefined;

      // Determine priority from urgency/importance scores
      const urgency = conv.urgencyScore ?? 0;
      const importance = conv.importanceScore ?? 0;
      const priorityScore = Math.max(urgency, importance);
      const priority =
        priorityScore >= 0.8
          ? ("urgent" as const)
          : priorityScore >= 0.6
            ? ("high" as const)
            : priorityScore >= 0.4
              ? ("medium" as const)
              : priorityScore >= 0.2
                ? ("low" as const)
                : ("no_priority" as const);

      const metadata: TaskMetadata = {
        sourceUrl: getSourceUrl(
          "conversation",
          conv.sourceAccount.type,
          conv.externalId
        ),
        sourceTitle: conv.title ?? undefined,
        sourceAccountType: conv.sourceAccount.type,
        sourceAccountId: conv.sourceAccount.id,
        sourceSnippet: conv.snippet ?? undefined,
      };

      const [newTask] = await db
        .insert(task)
        .values({
          organizationId: conv.sourceAccount.organizationId,
          title: title.slice(0, 500),
          description,
          sourceType: "conversation",
          sourceConversationId: conversationId,
          status: "backlog",
          priority,
          metadata,
        })
        .onConflictDoNothing()
        .returning({ id: task.id });

      log.info("Created task for conversation", {
        conversationId,
        taskId: newTask?.id,
      });

      return {
        success: true,
        taskId: newTask?.id,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      log.error("Failed to create task for conversation", error, {
        conversationId,
      });
      return {
        success: false,
        error: message,
      };
    }
  },
});

// =============================================================================
// CREATE TASK FOR COMMITMENT
// =============================================================================

/**
 * Create a task record for a commitment.
 * Called after commitment is extracted from a conversation.
 */
export const createTaskForCommitmentTask = triggerTask({
  id: "task-create-for-commitment",
  queue: {
    name: "task-sync",
    concurrencyLimit: 20,
  },
  retry: {
    maxAttempts: 3,
    minTimeoutInMs: 1000,
    maxTimeoutInMs: 10_000,
    factor: 2,
  },
  run: async (
    payload: CreateTaskForCommitmentPayload
  ): Promise<TaskCreationResult> => {
    const { commitmentId } = payload;

    try {
      // Get commitment
      const comm = await db.query.commitment.findFirst({
        where: eq(commitment.id, commitmentId),
      });

      if (!comm) {
        return {
          success: false,
          error: "Commitment not found",
        };
      }

      if (!comm.organizationId) {
        return {
          success: false,
          error: "Commitment has no organization",
        };
      }

      // Check if task already exists
      const existingTask = await db.query.task.findFirst({
        where: eq(task.sourceCommitmentId, commitmentId),
        columns: { id: true },
      });

      if (existingTask) {
        return {
          success: true,
          taskId: existingTask.id,
          skipped: true,
        };
      }

      // Create task with proper fields from commitment schema
      const metadata: TaskMetadata = {
        sourceTitle: comm.title,
        sourceSnippet: comm.description ?? undefined,
      };

      const [newTask] = await db
        .insert(task)
        .values({
          organizationId: comm.organizationId,
          title: comm.title.slice(0, 500),
          description: comm.description,
          sourceType: "commitment",
          sourceCommitmentId: commitmentId,
          status: "backlog",
          priority:
            comm.priority === "urgent"
              ? "urgent"
              : comm.priority === "high"
                ? "high"
                : comm.priority === "medium"
                  ? "medium"
                  : "low",
          dueDate: comm.dueDate ?? undefined,
          metadata,
        })
        .onConflictDoNothing()
        .returning({ id: task.id });

      log.info("Created task for commitment", {
        commitmentId,
        taskId: newTask?.id,
      });

      return {
        success: true,
        taskId: newTask?.id,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      log.error("Failed to create task for commitment", error, {
        commitmentId,
      });
      return {
        success: false,
        error: message,
      };
    }
  },
});

// =============================================================================
// CREATE TASK FOR DECISION
// =============================================================================

/**
 * Create a task record for a decision.
 * Called after decision is extracted from a conversation.
 */
export const createTaskForDecisionTask = triggerTask({
  id: "task-create-for-decision",
  queue: {
    name: "task-sync",
    concurrencyLimit: 20,
  },
  retry: {
    maxAttempts: 3,
    minTimeoutInMs: 1000,
    maxTimeoutInMs: 10_000,
    factor: 2,
  },
  run: async (
    payload: CreateTaskForDecisionPayload
  ): Promise<TaskCreationResult> => {
    const { decisionId } = payload;

    try {
      // Get decision
      const dec = await db.query.decision.findFirst({
        where: eq(decision.id, decisionId),
      });

      if (!dec) {
        return {
          success: false,
          error: "Decision not found",
        };
      }

      if (!dec.organizationId) {
        return {
          success: false,
          error: "Decision has no organization",
        };
      }

      // Check if task already exists
      const existingTask = await db.query.task.findFirst({
        where: eq(task.sourceDecisionId, decisionId),
        columns: { id: true },
      });

      if (existingTask) {
        return {
          success: true,
          taskId: existingTask.id,
          skipped: true,
        };
      }

      // Create task with proper fields from decision schema
      const metadata: TaskMetadata = {
        sourceTitle: dec.title,
        sourceSnippet: dec.statement,
      };

      const [newTask] = await db
        .insert(task)
        .values({
          organizationId: dec.organizationId,
          title: dec.title.slice(0, 500),
          description:
            dec.statement +
            (dec.rationale ? `\n\nRationale: ${dec.rationale}` : ""),
          sourceType: "decision",
          sourceDecisionId: decisionId,
          status: "backlog",
          priority: "no_priority",
          metadata,
        })
        .onConflictDoNothing()
        .returning({ id: task.id });

      log.info("Created task for decision", {
        decisionId,
        taskId: newTask?.id,
      });

      return {
        success: true,
        taskId: newTask?.id,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      log.error("Failed to create task for decision", error, {
        decisionId,
      });
      return {
        success: false,
        error: message,
      };
    }
  },
});

// =============================================================================
// BATCH CREATE TASKS (FOR SYNC)
// =============================================================================

/**
 * Create tasks for multiple items after a sync.
 * Can be called after conversation sync, commitment extraction, or decision extraction.
 */
export const batchCreateTasksTask = triggerTask({
  id: "task-batch-create",
  queue: {
    name: "task-sync",
    concurrencyLimit: 5,
  },
  retry: {
    maxAttempts: 2,
    minTimeoutInMs: 5000,
    maxTimeoutInMs: 30_000,
    factor: 2,
  },
  run: async (
    payload: BatchCreateTasksPayload
  ): Promise<BatchTaskCreationResult> => {
    const {
      organizationId,
      sourceType,
      limit = 100,
      skipExisting = true,
    } = payload;

    const result: BatchTaskCreationResult = {
      success: true,
      created: 0,
      skipped: 0,
      failed: 0,
      errors: [],
    };

    try {
      // Process conversations
      if (!sourceType || sourceType === "conversation") {
        const conversations = await db.query.conversation.findMany({
          where: skipExisting
            ? sql`${conversation.id} NOT IN (SELECT source_conversation_id FROM task WHERE source_conversation_id IS NOT NULL)`
            : undefined,
          with: {
            sourceAccount: {
              columns: {
                id: true,
                organizationId: true,
                type: true,
              },
            },
          },
          limit,
        });

        // Filter by organization
        const orgConversations = conversations.filter(
          (c) => c.sourceAccount.organizationId === organizationId
        );

        for (const conv of orgConversations) {
          try {
            const res = await createTaskForConversationTask.triggerAndWait({
              conversationId: conv.id,
            });

            if (res.ok && res.output.success) {
              if (res.output.skipped) {
                result.skipped++;
              } else {
                result.created++;
              }
            } else {
              result.failed++;
              if (!res.ok || res.output.error) {
                result.errors.push(
                  `Conversation ${conv.id}: ${res.ok ? res.output.error : "Task failed"}`
                );
              }
            }
          } catch (error) {
            result.failed++;
            result.errors.push(
              `Conversation ${conv.id}: ${error instanceof Error ? error.message : "Unknown error"}`
            );
          }
        }
      }

      // Process commitments
      if (!sourceType || sourceType === "commitment") {
        const commitments = await db.query.commitment.findMany({
          where: and(
            eq(commitment.organizationId, organizationId),
            skipExisting
              ? sql`${commitment.id} NOT IN (SELECT source_commitment_id FROM task WHERE source_commitment_id IS NOT NULL)`
              : undefined
          ),
          columns: { id: true },
          limit,
        });

        for (const comm of commitments) {
          try {
            const res = await createTaskForCommitmentTask.triggerAndWait({
              commitmentId: comm.id,
            });

            if (res.ok && res.output.success) {
              if (res.output.skipped) {
                result.skipped++;
              } else {
                result.created++;
              }
            } else {
              result.failed++;
              if (!res.ok || res.output.error) {
                result.errors.push(
                  `Commitment ${comm.id}: ${res.ok ? res.output.error : "Task failed"}`
                );
              }
            }
          } catch (error) {
            result.failed++;
            result.errors.push(
              `Commitment ${comm.id}: ${error instanceof Error ? error.message : "Unknown error"}`
            );
          }
        }
      }

      // Process decisions
      if (!sourceType || sourceType === "decision") {
        const decisions = await db.query.decision.findMany({
          where: and(
            eq(decision.organizationId, organizationId),
            skipExisting
              ? sql`${decision.id} NOT IN (SELECT source_decision_id FROM task WHERE source_decision_id IS NOT NULL)`
              : undefined
          ),
          columns: { id: true },
          limit,
        });

        for (const dec of decisions) {
          try {
            const res = await createTaskForDecisionTask.triggerAndWait({
              decisionId: dec.id,
            });

            if (res.ok && res.output.success) {
              if (res.output.skipped) {
                result.skipped++;
              } else {
                result.created++;
              }
            } else {
              result.failed++;
              if (!res.ok || res.output.error) {
                result.errors.push(
                  `Decision ${dec.id}: ${res.ok ? res.output.error : "Task failed"}`
                );
              }
            }
          } catch (error) {
            result.failed++;
            result.errors.push(
              `Decision ${dec.id}: ${error instanceof Error ? error.message : "Unknown error"}`
            );
          }
        }
      }

      log.info("Batch task creation completed", {
        organizationId,
        sourceType,
        created: result.created,
        skipped: result.skipped,
        failed: result.failed,
      });

      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      log.error("Batch task creation failed", error, {
        organizationId,
        sourceType,
      });
      return {
        ...result,
        success: false,
        errors: [...result.errors, message],
      };
    }
  },
});

// =============================================================================
// BACKFILL TASK
// =============================================================================

/**
 * Backfill tasks for all existing items in an organization.
 * Should be run once after deploying the task system.
 */
export const backfillTasksTask = triggerTask({
  id: "task-backfill",
  queue: {
    name: "task-sync-backfill",
    concurrencyLimit: 1,
  },
  retry: {
    maxAttempts: 1,
  },
  maxDuration: 3600, // 1 hour max
  run: async (payload: {
    organizationId: string;
  }): Promise<BatchTaskCreationResult> => {
    const { organizationId } = payload;

    log.info("Starting task backfill", { organizationId });

    const totalResult: BatchTaskCreationResult = {
      success: true,
      created: 0,
      skipped: 0,
      failed: 0,
      errors: [],
    };

    const batchSize = 100;
    let hasMore = true;

    // Backfill conversations
    while (hasMore) {
      const result = await batchCreateTasksTask.triggerAndWait({
        organizationId,
        sourceType: "conversation",
        limit: batchSize,
        skipExisting: true,
      });

      if (result.ok) {
        totalResult.created += result.output.created;
        totalResult.skipped += result.output.skipped;
        totalResult.failed += result.output.failed;
        totalResult.errors.push(...result.output.errors);

        hasMore = result.output.created > 0;
      } else {
        hasMore = false;
        totalResult.errors.push("Batch create conversations failed");
      }
    }

    // Backfill commitments
    hasMore = true;
    while (hasMore) {
      const result = await batchCreateTasksTask.triggerAndWait({
        organizationId,
        sourceType: "commitment",
        limit: batchSize,
        skipExisting: true,
      });

      if (result.ok) {
        totalResult.created += result.output.created;
        totalResult.skipped += result.output.skipped;
        totalResult.failed += result.output.failed;
        totalResult.errors.push(...result.output.errors);

        hasMore = result.output.created > 0;
      } else {
        hasMore = false;
        totalResult.errors.push("Batch create commitments failed");
      }
    }

    // Backfill decisions
    hasMore = true;
    while (hasMore) {
      const result = await batchCreateTasksTask.triggerAndWait({
        organizationId,
        sourceType: "decision",
        limit: batchSize,
        skipExisting: true,
      });

      if (result.ok) {
        totalResult.created += result.output.created;
        totalResult.skipped += result.output.skipped;
        totalResult.failed += result.output.failed;
        totalResult.errors.push(...result.output.errors);

        hasMore = result.output.created > 0;
      } else {
        hasMore = false;
        totalResult.errors.push("Batch create decisions failed");
      }
    }

    log.info("Task backfill completed", {
      organizationId,
      created: totalResult.created,
      skipped: totalResult.skipped,
      failed: totalResult.failed,
    });

    return totalResult;
  },
});

// =============================================================================
// EXPORTS
// =============================================================================

export type {
  CreateTaskForConversationPayload,
  CreateTaskForCommitmentPayload,
  CreateTaskForDecisionPayload,
  BatchCreateTasksPayload,
  TaskCreationResult,
  BatchTaskCreationResult,
};
