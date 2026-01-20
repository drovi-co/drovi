// =============================================================================
// TRIAGE ANALYSIS TRIGGER.DEV TASKS (PRD-07)
// =============================================================================
//
// Background tasks for email triage and inbox automation.
// Updated: 2026-01-13 - Uses AI_PROVIDER from environment
//

import {
  createTriageAgent,
  type TriageRule as TriageRuleType,
  type TriageSuggestion,
} from "@memorystack/ai/agents";
import { createNotification } from "@memorystack/api/routers/notifications";
import { db } from "@memorystack/db";
import {
  claim,
  contact,
  emailAccount,
  emailThread,
  triageResult,
  triageRule,
} from "@memorystack/db/schema";
import { task } from "@trigger.dev/sdk";
import { and, desc, eq, isNull } from "drizzle-orm";
import { log } from "../lib/logger";

// =============================================================================
// TYPES
// =============================================================================

interface TriageThreadPayload {
  threadId: string;
  accountId: string;
  force?: boolean;
}

interface TriageAccountPayload {
  accountId: string;
  limit?: number;
  onlyUnprocessed?: boolean;
}

interface TriageResult {
  success: boolean;
  threadId: string;
  suggestion?: TriageSuggestion;
  error?: string;
}

interface BatchTriageResult {
  success: boolean;
  processed: number;
  failed: number;
  suggestions: TriageSuggestion[];
}

// =============================================================================
// TRIAGE THREAD TASK
// =============================================================================

/**
 * Triage a single email thread.
 */
export const triageThreadTask = task({
  id: "triage-thread",
  queue: {
    name: "triage",
    concurrencyLimit: 10,
  },
  retry: {
    maxAttempts: 3,
    minTimeoutInMs: 2000,
    maxTimeoutInMs: 15_000,
    factor: 2,
  },
  maxDuration: 60,
  run: async (payload: TriageThreadPayload): Promise<TriageResult> => {
    const { threadId, accountId, force = false } = payload;

    log.info("Triaging thread", { threadId, accountId, force });

    try {
      // Check if already triaged
      if (!force) {
        const existing = await db.query.triageResult.findFirst({
          where: eq(triageResult.threadId, threadId),
        });

        if (existing && isRecent(existing.createdAt)) {
          log.info("Thread already triaged recently", { threadId });
          return {
            success: true,
            threadId,
            suggestion: {
              threadId,
              action: existing.suggestedAction,
              confidence: existing.confidence,
              reasoning: existing.reasoning ?? "",
              priority: {
                tier: existing.priorityTier as
                  | "urgent"
                  | "high"
                  | "medium"
                  | "low",
                urgencyScore: existing.urgencyScore,
                importanceScore: existing.importanceScore,
                combinedScore:
                  (existing.urgencyScore + existing.importanceScore) / 2,
                factors: { urgency: {}, importance: {} },
                reasoning: "",
              },
              usedLLM: existing.usedLlm,
            },
          };
        }
      }

      // Get thread with claims
      const thread = await db.query.emailThread.findFirst({
        where: eq(emailThread.id, threadId),
        with: {
          messages: {
            orderBy: (m, { desc: descOrder }) => [descOrder(m.sentAt)],
            limit: 1,
          },
        },
      });

      if (!thread) {
        return { success: false, threadId, error: "Thread not found" };
      }

      // Get claims for the thread
      const threadClaims = await db.query.claim.findMany({
        where: eq(claim.threadId, threadId),
      });

      // Get sender contact info
      const senderEmail = thread.messages[0]?.fromEmail;
      const senderContact = senderEmail
        ? await db.query.contact.findFirst({
            where: eq(contact.primaryEmail, senderEmail),
          })
        : null;

      // Get organization rules for this account
      const rules = await db.query.triageRule.findMany({
        where: and(
          eq(triageRule.accountId, accountId),
          eq(triageRule.enabled, true)
        ),
      });

      // Build thread input for triage agent
      const participantEmails = thread.participantEmails ?? [];
      const threadInput = {
        id: thread.id,
        subject: thread.subject ?? "",
        snippet: thread.snippet ?? undefined,
        bodyText: thread.messages[0]?.bodyText ?? undefined,
        sender: senderEmail ?? "",
        senderName: thread.messages[0]?.fromName ?? undefined,
        senderIsVIP: senderContact?.isVip ?? false,
        senderIsInternal: senderContact?.isInternal ?? false,
        participants: participantEmails.map((email) => ({
          address: email,
        })),
        lastMessageAt: thread.lastMessageAt ?? new Date(),
        messageCount: thread.messageCount ?? 1,
        classification: thread.intentClassification ?? undefined,
        claims: threadClaims.map((c) => ({
          type: c.type,
          content: c.text,
          dueDate: undefined, // Claims don't have dueDate directly
        })),
      };

      // Convert rules to expected format
      const triageRules: TriageRuleType[] = rules.map((r) => ({
        id: r.id,
        name: r.name,
        description: r.description ?? "",
        trigger: r.trigger as TriageRuleType["trigger"],
        action: r.action as TriageRuleType["action"],
        actionValue: r.actionValue ?? undefined,
        enabled: r.enabled,
        createdAt: r.createdAt,
        hitCount: r.hitCount,
      }));

      // Triage the thread
      const triageAgent = createTriageAgent();
      const suggestion = await triageAgent.triageThread(threadInput, {
        rules: triageRules,
      });

      // Save result - cast action and priority to match enum types
      type TriageAction =
        | "respond"
        | "archive"
        | "delegate"
        | "schedule"
        | "wait"
        | "escalate"
        | "review";
      type PriorityTier = "urgent" | "high" | "medium" | "low";

      await db
        .insert(triageResult)
        .values({
          threadId,
          accountId,
          suggestedAction: suggestion.action as TriageAction,
          confidence: suggestion.confidence,
          reasoning: suggestion.reasoning,
          priorityTier: suggestion.priority.tier as PriorityTier,
          urgencyScore: suggestion.priority.urgencyScore,
          importanceScore: suggestion.priority.importanceScore,
          usedLlm: suggestion.usedLLM,
          details: suggestion.details as Record<string, unknown> | null,
        })
        .onConflictDoUpdate({
          target: triageResult.threadId,
          set: {
            suggestedAction: suggestion.action as TriageAction,
            confidence: suggestion.confidence,
            reasoning: suggestion.reasoning,
            priorityTier: suggestion.priority.tier as PriorityTier,
            urgencyScore: suggestion.priority.urgencyScore,
            importanceScore: suggestion.priority.importanceScore,
            usedLlm: suggestion.usedLLM,
            details: suggestion.details as Record<string, unknown> | null,
            updatedAt: new Date(),
          },
        });

      log.info("Thread triaged successfully", {
        threadId,
        action: suggestion.action,
        priority: suggestion.priority.tier,
      });

      // Create notifications for urgent or high-priority emails
      if (
        suggestion.priority.tier === "urgent" ||
        suggestion.priority.importanceScore > 0.8
      ) {
        // Get the user ID from the account
        const account = await db.query.emailAccount.findFirst({
          where: eq(emailAccount.id, accountId),
          columns: { addedByUserId: true },
        });

        if (account) {
          const senderName =
            thread.messages[0]?.fromName ?? senderEmail ?? "Unknown sender";
          const subcategory =
            suggestion.priority.tier === "urgent" ? "urgent" : "important";

          await createNotification(
            account.addedByUserId,
            {
              type: "warning",
              category: "email",
              title:
                suggestion.priority.tier === "urgent"
                  ? "Urgent Email Requires Attention"
                  : "Important Email",
              message: `From ${senderName}: ${thread.subject ?? "No subject"}`,
              link: `/dashboard/email/thread/${threadId}`,
              priority:
                suggestion.priority.tier === "urgent" ? "urgent" : "high",
              actionRequired: suggestion.action === "respond",
              actionType:
                suggestion.action === "respond" ? "respond" : "review",
              entityId: threadId,
              entityType: "thread",
              metadata: {
                senderEmail,
                urgencyScore: suggestion.priority.urgencyScore,
                importanceScore: suggestion.priority.importanceScore,
              },
            },
            subcategory
          );
        }
      }

      return { success: true, threadId, suggestion };
    } catch (error) {
      log.error("Failed to triage thread", {
        threadId,
        error: error instanceof Error ? error.message : "Unknown error",
      });

      return {
        success: false,
        threadId,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  },
});

// =============================================================================
// BATCH TRIAGE TASK
// =============================================================================

/**
 * Triage all threads for an account.
 */
export const triageAccountTask = task({
  id: "triage-account",
  queue: {
    name: "triage-batch",
    concurrencyLimit: 3,
  },
  retry: {
    maxAttempts: 2,
    minTimeoutInMs: 10_000,
    maxTimeoutInMs: 60_000,
    factor: 2,
  },
  maxDuration: 300, // 5 minutes
  run: async (payload: TriageAccountPayload): Promise<BatchTriageResult> => {
    const { accountId, limit = 50, onlyUnprocessed = true } = payload;

    log.info("Starting batch triage", { accountId, limit, onlyUnprocessed });

    let processed = 0;
    let failed = 0;
    const suggestions: TriageSuggestion[] = [];

    try {
      // Get threads to process
      let threads;

      if (onlyUnprocessed) {
        // Get threads without triage results
        threads = await db
          .select({
            id: emailThread.id,
            subject: emailThread.subject,
            snippet: emailThread.snippet,
            lastMessageAt: emailThread.lastMessageAt,
            messageCount: emailThread.messageCount,
            intentClassification: emailThread.intentClassification,
            participantEmails: emailThread.participantEmails,
          })
          .from(emailThread)
          .leftJoin(triageResult, eq(emailThread.id, triageResult.threadId))
          .where(
            and(eq(emailThread.accountId, accountId), isNull(triageResult.id))
          )
          .orderBy(desc(emailThread.lastMessageAt))
          .limit(limit);
      } else {
        threads = await db.query.emailThread.findMany({
          where: eq(emailThread.accountId, accountId),
          orderBy: desc(emailThread.lastMessageAt),
          limit,
        });
      }

      // Process each thread
      for (const thread of threads) {
        const result = await triageThreadTask.triggerAndWait({
          threadId: thread.id,
          accountId,
          force: !onlyUnprocessed,
        });

        // Access output from the TaskRunResult
        if (result.ok && result.output.success && result.output.suggestion) {
          processed++;
          suggestions.push(result.output.suggestion);
        } else {
          failed++;
        }
      }

      log.info("Batch triage completed", { accountId, processed, failed });

      return {
        success: failed === 0,
        processed,
        failed,
        suggestions,
      };
    } catch (error) {
      log.error("Batch triage failed", {
        accountId,
        error: error instanceof Error ? error.message : "Unknown error",
      });

      return {
        success: false,
        processed,
        failed: failed + 1,
        suggestions,
      };
    }
  },
});

// =============================================================================
// INBOX SUMMARY TASK
// =============================================================================

/**
 * Generate an inbox summary for an account.
 */
export const generateInboxSummaryTask = task({
  id: "triage-inbox-summary",
  queue: {
    name: "triage",
    concurrencyLimit: 5,
  },
  retry: {
    maxAttempts: 2,
    minTimeoutInMs: 5000,
    maxTimeoutInMs: 30_000,
    factor: 2,
  },
  maxDuration: 60,
  run: async (payload: { accountId: string }) => {
    const { accountId } = payload;

    log.info("Generating inbox summary", { accountId });

    try {
      // Get recent triage results
      const results = await db.query.triageResult.findMany({
        where: eq(triageResult.accountId, accountId),
        orderBy: desc(triageResult.createdAt),
        limit: 100,
      });

      if (results.length === 0) {
        return {
          success: true,
          summary: {
            summary: "No emails to summarize.",
            focusRecommendation: "Your inbox is clear!",
            stats: {
              total: 0,
              urgent: 0,
              high: 0,
              medium: 0,
              low: 0,
              needsResponse: 0,
              canArchive: 0,
            },
          },
        };
      }

      // Convert to suggestions
      const suggestions: TriageSuggestion[] = results.map((r) => ({
        threadId: r.threadId,
        action: r.suggestedAction,
        confidence: r.confidence,
        reasoning: r.reasoning ?? "",
        priority: {
          tier: r.priorityTier as "urgent" | "high" | "medium" | "low",
          urgencyScore: r.urgencyScore,
          importanceScore: r.importanceScore,
          combinedScore: (r.urgencyScore + r.importanceScore) / 2,
          factors: { urgency: {}, importance: {} },
          reasoning: "",
        },
        usedLLM: r.usedLlm,
      }));

      const triageAgent = createTriageAgent();
      const summary = await triageAgent.generateInboxSummary(suggestions);

      log.info("Inbox summary generated", { accountId });

      return { success: true, summary };
    } catch (error) {
      log.error("Failed to generate inbox summary", {
        accountId,
        error: error instanceof Error ? error.message : "Unknown error",
      });

      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  },
});

// =============================================================================
// HELPERS
// =============================================================================

/**
 * Check if a date is recent (within last hour).
 */
function isRecent(date: Date): boolean {
  const hourAgo = new Date(Date.now() - 60 * 60 * 1000);
  return date > hourAgo;
}
