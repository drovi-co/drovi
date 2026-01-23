// =============================================================================
// EMAIL SYNC TYPES
// =============================================================================

import type { EmailMessageData, EmailThreadData } from "../email-client/types";

/**
 * Sync job types
 */
export type SyncJobType = "incremental" | "backfill" | "on_demand";

/**
 * Backfill phases for multi-phase full history import.
 *
 * - priority: Last 90 days (immediate value, fast)
 * - extended: 90 days to 1 year (medium priority)
 * - archive: 1+ years to full history (background)
 * - complete: All phases finished
 */
export type BackfillPhase =
  | "priority"
  | "extended"
  | "archive"
  | "complete"
  | "idle";

/**
 * Date ranges for each backfill phase
 */
export const BACKFILL_PHASE_RANGES = {
  priority: { daysBack: 90, label: "Last 90 days" },
  extended: { daysBack: 365, fromDaysBack: 90, label: "90 days to 1 year" },
  archive: { fromDaysBack: 365, label: "1+ years (full history)" },
} as const;

/**
 * Concurrency settings per phase (optimized for speed)
 */
export const BACKFILL_CONCURRENCY = {
  priority: {
    threadFetchConcurrency: 10, // Increased for faster backfill (Gmail handles this well)
    batchSize: 50, // Larger batches for fewer DB round trips
    queueConcurrency: 5,
  },
  extended: {
    threadFetchConcurrency: 3,
    batchSize: 20,
    queueConcurrency: 3,
  },
  archive: {
    threadFetchConcurrency: 2,
    batchSize: 15,
    queueConcurrency: 2,
  },
} as const;

/**
 * Sync job status
 */
export type SyncJobStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

/**
 * Sync job record
 */
export interface SyncJob {
  id: string;
  accountId: string;
  organizationId: string;
  type: SyncJobType;
  status: SyncJobStatus;
  progress: number;
  totalItems?: number;
  processedItems: number;
  cursor?: string;
  errorMessage?: string;
  startedAt?: Date;
  completedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Sync result summary
 */
export interface SyncResult {
  success: boolean;
  jobId: string;
  accountId: string;
  type: SyncJobType;
  threadsProcessed: number;
  messagesProcessed: number;
  newThreads: number;
  updatedThreads: number;
  newMessages: number;
  updatedMessages: number;
  errors: SyncError[];
  duration: number;
  newCursor?: string;
}

/**
 * Sync error details
 */
export interface SyncError {
  code: string;
  message: string;
  threadId?: string;
  messageId?: string;
  retryable: boolean;
}

/**
 * Processing options for threads/messages
 */
export interface ProcessingOptions {
  /** Skip messages we've already processed */
  skipExisting?: boolean;
  /** Force reprocessing even if exists */
  forceUpdate?: boolean;
  /** Maximum items per batch */
  batchSize?: number;
}

/**
 * Processed thread result
 */
export interface ProcessedThread {
  thread: EmailThreadData;
  messages: EmailMessageData[];
  isNew: boolean;
  wasUpdated: boolean;
  /** Database conversation ID for this thread */
  conversationId: string;
}

/**
 * Batch processing result
 */
export interface BatchResult {
  processed: number;
  skipped: number;
  errors: SyncError[];
  threads: ProcessedThread[];
}

/**
 * Provider-specific sync options
 */
export interface ProviderSyncOptions {
  /** Starting cursor/historyId */
  cursor?: string;
  /** Maximum threads to fetch */
  maxThreads?: number;
  /** Labels/folders to include */
  labels?: string[];
  /** Date range start */
  after?: Date;
  /** Include spam/trash */
  includeSpamTrash?: boolean;
}

/**
 * Backfill configuration for phase-based import
 */
export interface BackfillConfig {
  /** Source account ID to backfill */
  sourceAccountId: string;
  /** Organization ID */
  organizationId: string;
  /** Current backfill phase */
  phase: BackfillPhase;
  /** Date range: start (older boundary) */
  afterDate?: Date;
  /** Date range: end (newer boundary) */
  beforeDate?: Date;
  /** Batch size for fetching */
  batchSize: number;
  /** Concurrency for parallel thread fetching */
  threadFetchConcurrency: number;
}

/**
 * Phase-specific backfill result
 */
export interface PhaseBackfillResult extends SyncResult {
  /** Phase that was processed */
  phase: BackfillPhase;
  /** Whether this phase is complete */
  phaseComplete: boolean;
  /** Estimated threads remaining in phase */
  threadsRemaining?: number;
}

/**
 * Sync schedule configuration
 */
export interface SyncScheduleConfig {
  /** Account ID */
  accountId: string;
  /** Interval in minutes */
  intervalMinutes: number;
  /** Whether sync is enabled */
  enabled: boolean;
}

/**
 * Event emitted when sync completes
 */
export interface SyncCompleteEvent {
  jobId: string;
  accountId: string;
  organizationId: string;
  result: SyncResult;
  timestamp: Date;
}

/**
 * Event emitted for new/updated threads (for downstream processing)
 */
export interface ThreadProcessedEvent {
  threadId: string;
  accountId: string;
  organizationId: string;
  isNew: boolean;
  messageCount: number;
  timestamp: Date;
}
