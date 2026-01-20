// =============================================================================
// DEAD LETTER QUEUE UTILITIES
// =============================================================================
//
// Utilities for handling failed Trigger.dev tasks by writing them to a
// dead letter queue (DLQ) for manual review and retry.
//

import { db } from "@memorystack/db";
import { failedJob } from "@memorystack/db/schema";
import { and, desc, eq } from "drizzle-orm";

// =============================================================================
// TYPES
// =============================================================================

export interface DLQJobContext {
  accountId?: string;
  threadId?: string;
  organizationId?: string;
  metadata?: Record<string, unknown>;
}

export interface WriteToDeadLetterQueueOptions<T> {
  taskId: string;
  taskName?: string;
  triggerRunId?: string;
  payload: T;
  error: Error;
  attemptNumber: number;
  maxAttempts?: number;
  firstAttemptAt?: Date;
  context?: DLQJobContext;
}

// =============================================================================
// DLQ OPERATIONS
// =============================================================================

/**
 * Write a failed job to the dead letter queue.
 * Called when a task has exceeded its max retry attempts.
 */
export async function writeToDeadLetterQueue<T>(
  options: WriteToDeadLetterQueueOptions<T>
): Promise<string> {
  const {
    taskId,
    taskName,
    triggerRunId,
    payload,
    error,
    attemptNumber,
    maxAttempts,
    firstAttemptAt,
    context,
  } = options;

  const [inserted] = await db
    .insert(failedJob)
    .values({
      taskId,
      taskName,
      triggerRunId,
      payload: payload as Record<string, unknown>,
      errorMessage: error.message,
      errorStack: error.stack,
      errorCode: (error as Error & { code?: string }).code,
      attemptNumber,
      maxAttempts,
      firstAttemptAt,
      accountId: context?.accountId,
      threadId: context?.threadId,
      organizationId: context?.organizationId,
      metadata: context?.metadata,
    })
    .returning({ id: failedJob.id });

  console.log(
    `[DLQ] Task ${taskId} written to dead letter queue: ${inserted?.id}`
  );

  return inserted?.id ?? "";
}

/**
 * Mark a DLQ job as retried.
 * Called when manually retrying a failed job.
 */
export async function markAsRetried(jobId: string): Promise<void> {
  await db
    .update(failedJob)
    .set({
      status: "retried",
      retriedAt: new Date(),
    })
    .where(eq(failedJob.id, jobId));
}

/**
 * Mark a DLQ job as abandoned.
 * Called when deciding not to retry a failed job.
 */
export async function markAsAbandoned(
  jobId: string,
  userId: string,
  note?: string
): Promise<void> {
  await db
    .update(failedJob)
    .set({
      status: "abandoned",
      resolvedAt: new Date(),
      resolvedBy: userId,
      resolutionNote: note,
    })
    .where(eq(failedJob.id, jobId));
}

/**
 * Mark a DLQ job as resolved.
 * Called when the underlying issue has been fixed without retry.
 */
export async function markAsResolved(
  jobId: string,
  userId: string,
  note?: string
): Promise<void> {
  await db
    .update(failedJob)
    .set({
      status: "resolved",
      resolvedAt: new Date(),
      resolvedBy: userId,
      resolutionNote: note,
    })
    .where(eq(failedJob.id, jobId));
}

/**
 * Get pending DLQ jobs for review.
 */
export async function getPendingDLQJobs(options?: {
  organizationId?: string;
  taskId?: string;
  limit?: number;
  offset?: number;
}): Promise<(typeof failedJob.$inferSelect)[]> {
  const conditions = [eq(failedJob.status, "pending")];

  if (options?.organizationId) {
    conditions.push(eq(failedJob.organizationId, options.organizationId));
  }

  if (options?.taskId) {
    conditions.push(eq(failedJob.taskId, options.taskId));
  }

  return db
    .select()
    .from(failedJob)
    .where(and(...conditions))
    .orderBy(desc(failedJob.failedAt))
    .limit(options?.limit ?? 50)
    .offset(options?.offset ?? 0);
}

/**
 * Get DLQ job by ID.
 */
export async function getDLQJob(
  jobId: string
): Promise<typeof failedJob.$inferSelect | null> {
  const results = await db
    .select()
    .from(failedJob)
    .where(eq(failedJob.id, jobId))
    .limit(1);

  return results[0] ?? null;
}

// =============================================================================
// TASK WRAPPER
// =============================================================================

/**
 * Options for the DLQ-wrapped task execution.
 */
export interface DLQTaskOptions {
  /** Maximum number of retries before sending to DLQ */
  maxRetries?: number;
  /** Context extractor function to get context from payload */
  contextExtractor?: (payload: unknown) => DLQJobContext;
}

/**
 * Helper to check if an error indicates max retries reached.
 * Trigger.dev tasks typically throw with attempt info.
 */
export function shouldSendToDLQ(
  _error: Error,
  attemptNumber: number,
  maxRetries: number
): boolean {
  // Check if we've exceeded max retries
  return attemptNumber >= maxRetries;
}

/**
 * Error handler for Trigger.dev tasks that writes to DLQ on max retries.
 * Use this in the `onFailure` hook of your task.
 */
export async function handleTaskFailure<T>(
  taskId: string,
  taskName: string,
  payload: T,
  error: Error,
  attemptNumber: number,
  maxAttempts: number,
  triggerRunId?: string,
  context?: DLQJobContext
): Promise<void> {
  if (shouldSendToDLQ(error, attemptNumber, maxAttempts)) {
    await writeToDeadLetterQueue({
      taskId,
      taskName,
      triggerRunId,
      payload,
      error,
      attemptNumber,
      maxAttempts,
      context,
    });
  }
}
