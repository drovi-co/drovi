// =============================================================================
// SERVER-SIDE POSTHOG ANALYTICS
// =============================================================================
//
// PostHog analytics for server-side event tracking.
// Used for tracking backend events like AI operations, sync completions, etc.
//

import { env } from "@memorystack/env/server";
import { PostHog } from "posthog-node";

// =============================================================================
// TYPES
// =============================================================================

/**
 * Server-side analytics events.
 */
export type ServerAnalyticsEvent =
  // Processing events
  | "thread_processed"
  | "message_processed"
  | "commitment_extracted"
  | "decision_extracted"
  | "claim_extracted"
  // Sync events
  | "email_sync_started"
  | "email_sync_completed"
  | "email_sync_failed"
  // AI operations
  | "ai_operation_started"
  | "ai_operation_completed"
  | "ai_operation_failed"
  // Credits
  | "credits_consumed"
  | "credits_purchased"
  // Background jobs
  | "job_started"
  | "job_completed"
  | "job_failed"
  | "job_sent_to_dlq"
  // Webhooks
  | "webhook_received"
  | "webhook_processed"
  | "webhook_failed"
  // API usage
  | "api_request"
  | "api_rate_limited";

/**
 * Properties for server analytics events.
 */
export interface ServerEventProperties {
  // User context
  userId?: string;
  organizationId?: string;
  accountId?: string;

  // AI operation properties
  model?: string;
  provider?: string;
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  latencyMs?: number;
  costCents?: number;

  // Extraction properties
  itemsExtracted?: number;
  confidence?: number;
  threadId?: string;

  // Sync properties
  messageCount?: number;
  threadCount?: number;
  durationMs?: number;
  errorMessage?: string;

  // Job properties
  taskId?: string;
  triggerRunId?: string;
  attemptNumber?: number;

  // API properties
  endpoint?: string;
  method?: string;
  statusCode?: number;

  // Generic properties
  [key: string]: unknown;
}

// =============================================================================
// CLIENT
// =============================================================================

let client: PostHog | null = null;

/**
 * Get or create the PostHog client.
 */
function getClient(): PostHog | null {
  if (!env.POSTHOG_PROJECT_KEY) {
    return null;
  }

  if (!client) {
    client = new PostHog(env.POSTHOG_PROJECT_KEY, {
      host: env.POSTHOG_HOST,
      flushAt: 20, // Flush after 20 events
      flushInterval: 10000, // Flush every 10 seconds
    });
  }

  return client;
}

// =============================================================================
// TRACKING FUNCTIONS
// =============================================================================

/**
 * Track a server-side event.
 */
export function trackServerEvent(
  event: ServerAnalyticsEvent,
  distinctId: string,
  properties?: ServerEventProperties
): void {
  const posthog = getClient();
  if (!posthog) return;

  try {
    posthog.capture({
      distinctId,
      event,
      properties: {
        ...properties,
        $lib: "posthog-node",
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error("[Analytics] Failed to track server event:", error);
  }
}

/**
 * Track an AI operation with token usage.
 */
export function trackAIOperation(
  userId: string,
  options: {
    operation: string;
    model: string;
    provider: string;
    inputTokens: number;
    outputTokens: number;
    latencyMs: number;
    success: boolean;
    organizationId?: string;
    threadId?: string;
    errorMessage?: string;
  }
): void {
  const posthog = getClient();
  if (!posthog) return;

  const event = options.success ? "ai_operation_completed" : "ai_operation_failed";

  trackServerEvent(event, userId, {
    operation: options.operation,
    model: options.model,
    provider: options.provider,
    inputTokens: options.inputTokens,
    outputTokens: options.outputTokens,
    totalTokens: options.inputTokens + options.outputTokens,
    latencyMs: options.latencyMs,
    organizationId: options.organizationId,
    threadId: options.threadId,
    errorMessage: options.errorMessage,
    // Estimate cost (rough approximation)
    costCents: estimateCost(options.model, options.inputTokens, options.outputTokens),
  });
}

/**
 * Track a sync operation.
 */
export function trackSyncOperation(
  userId: string,
  options: {
    accountId: string;
    provider: "gmail" | "outlook" | "slack" | "whatsapp";
    messageCount: number;
    threadCount: number;
    durationMs: number;
    success: boolean;
    organizationId?: string;
    errorMessage?: string;
  }
): void {
  const event = options.success ? "email_sync_completed" : "email_sync_failed";

  trackServerEvent(event, userId, {
    accountId: options.accountId,
    provider: options.provider,
    messageCount: options.messageCount,
    threadCount: options.threadCount,
    durationMs: options.durationMs,
    organizationId: options.organizationId,
    errorMessage: options.errorMessage,
  });
}

/**
 * Track extraction results.
 */
export function trackExtraction(
  userId: string,
  options: {
    type: "commitment" | "decision" | "claim";
    itemsExtracted: number;
    averageConfidence: number;
    threadId: string;
    organizationId?: string;
  }
): void {
  const eventMap = {
    commitment: "commitment_extracted",
    decision: "decision_extracted",
    claim: "claim_extracted",
  } as const;

  trackServerEvent(eventMap[options.type], userId, {
    itemsExtracted: options.itemsExtracted,
    confidence: options.averageConfidence,
    threadId: options.threadId,
    organizationId: options.organizationId,
  });
}

/**
 * Track credit consumption.
 */
export function trackCreditsConsumed(
  userId: string,
  options: {
    amount: number;
    operation: string;
    organizationId?: string;
    remainingCredits?: number;
  }
): void {
  trackServerEvent("credits_consumed", userId, {
    creditAmount: options.amount,
    operation: options.operation,
    organizationId: options.organizationId,
    remainingCredits: options.remainingCredits,
  });
}

/**
 * Track a job sent to the dead letter queue.
 */
export function trackJobDLQ(
  userId: string,
  options: {
    taskId: string;
    taskName?: string;
    triggerRunId?: string;
    errorMessage?: string;
    attemptNumber: number;
    organizationId?: string;
  }
): void {
  trackServerEvent("job_sent_to_dlq", userId, {
    taskId: options.taskId,
    taskName: options.taskName,
    triggerRunId: options.triggerRunId,
    errorMessage: options.errorMessage,
    attemptNumber: options.attemptNumber,
    organizationId: options.organizationId,
  });
}

/**
 * Set user properties on the server side.
 */
export function setServerUserProperties(
  userId: string,
  properties: Record<string, unknown>
): void {
  const posthog = getClient();
  if (!posthog) return;

  try {
    posthog.identify({
      distinctId: userId,
      properties,
    });
  } catch (error) {
    console.error("[Analytics] Failed to set user properties:", error);
  }
}

/**
 * Set organization group properties.
 */
export function setOrganizationProperties(
  _userId: string,
  organizationId: string,
  properties: Record<string, unknown>
): void {
  const posthog = getClient();
  if (!posthog) return;

  try {
    posthog.groupIdentify({
      groupType: "organization",
      groupKey: organizationId,
      properties,
    });
  } catch (error) {
    console.error("[Analytics] Failed to set organization properties:", error);
  }
}

// =============================================================================
// SHUTDOWN
// =============================================================================

/**
 * Flush and shutdown the PostHog client.
 * Should be called during graceful shutdown.
 */
export async function shutdownAnalytics(): Promise<void> {
  if (client) {
    try {
      await client.shutdown();
      console.log("[Analytics] PostHog client shut down");
    } catch (error) {
      console.error("[Analytics] Failed to shutdown PostHog:", error);
    }
    client = null;
  }
}

// =============================================================================
// HELPERS
// =============================================================================

/**
 * Estimate cost in cents based on model and token usage.
 * This is a rough approximation - actual costs may vary.
 */
function estimateCost(model: string, inputTokens: number, outputTokens: number): number {
  // Cost per 1M tokens in cents (approximate)
  const costs: Record<string, { input: number; output: number }> = {
    "claude-3-5-sonnet": { input: 300, output: 1500 },
    "claude-3-5-haiku": { input: 80, output: 400 },
    "claude-3-opus": { input: 1500, output: 7500 },
    "gpt-4-turbo": { input: 1000, output: 3000 },
    "gpt-4o": { input: 250, output: 1000 },
    "gpt-4o-mini": { input: 15, output: 60 },
    "gemini-2.5-flash": { input: 7.5, output: 30 },
    "gemini-1.5-pro": { input: 125, output: 500 },
  };

  // Find matching cost tier (default to gpt-4o-mini pricing)
  let costTier: { input: number; output: number } = { input: 15, output: 60 };
  for (const [key, value] of Object.entries(costs)) {
    if (model.includes(key)) {
      costTier = value;
      break;
    }
  }

  const inputCost = (inputTokens / 1_000_000) * costTier.input;
  const outputCost = (outputTokens / 1_000_000) * costTier.output;

  return Math.round((inputCost + outputCost) * 100) / 100;
}

// =============================================================================
// UTILITY EXPORTS
// =============================================================================

/**
 * Check if server analytics is enabled.
 */
export function isServerAnalyticsEnabled(): boolean {
  return !!env.POSTHOG_PROJECT_KEY;
}
