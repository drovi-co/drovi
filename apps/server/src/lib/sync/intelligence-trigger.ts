// =============================================================================
// INTELLIGENCE EXTRACTION TRIGGER FOR SYNC
// =============================================================================
//
// Triggers intelligence extraction in parallel during email sync/backfill.
// Uses fire-and-forget pattern for speed - extractions run asynchronously.
//

import { log } from "../logger";
import { orchestratorExtractTask } from "../../trigger/intelligence-extraction";
import type { ProcessedThread } from "./types";

// =============================================================================
// CONFIGURATION
// =============================================================================

/** Maximum concurrent extraction triggers per batch - keep low to avoid queue overflow */
const MAX_CONCURRENT_TRIGGERS = 5;

/** Delay between trigger batches to avoid overwhelming the queue */
const TRIGGER_BATCH_DELAY_MS = 100;

/** Minimum content length to trigger extraction */
const MIN_CONTENT_LENGTH = 50;

// =============================================================================
// TYPES
// =============================================================================

interface ExtractionTriggerResult {
  triggered: number;
  failed: number;
  skipped: number;
  errors: string[];
}

interface ConversationForExtraction {
  conversationId: string;
  organizationId: string;
  sourceAccountId: string;
  content: string;
  subject?: string;
}

// =============================================================================
// MAIN TRIGGER FUNCTION
// =============================================================================

/**
 * Trigger intelligence extraction for processed threads.
 *
 * Fires extraction tasks in parallel without waiting for completion.
 * This allows the sync to continue while extractions run in the background.
 *
 * @param threads - Processed threads from the sync batch
 * @param organizationId - Organization ID for the extractions
 * @param sourceAccountId - Source account ID
 * @returns Trigger statistics
 */
export async function triggerIntelligenceExtraction(
  threads: ProcessedThread[],
  organizationId: string,
  sourceAccountId: string
): Promise<ExtractionTriggerResult> {
  const result: ExtractionTriggerResult = {
    triggered: 0,
    failed: 0,
    skipped: 0,
    errors: [],
  };

  // Filter to only new threads (not updates to existing)
  const newThreads = threads.filter((t) => t.isNew && t.conversationId);

  if (newThreads.length === 0) {
    return result;
  }

  log.debug("Preparing intelligence extraction for batch", {
    totalThreads: threads.length,
    newThreads: newThreads.length,
    organizationId,
  });

  // Prepare conversations for extraction
  const conversations: ConversationForExtraction[] = [];

  for (const thread of newThreads) {
    // Combine all message content for extraction
    const messageContent = thread.messages
      ?.map((m) => {
        const from = m.from?.name || m.from?.email || "Unknown";
        const subject = m.subject ? `Subject: ${m.subject}\n` : "";
        const body = m.bodyText || m.snippet || "";
        return `From: ${from}\n${subject}${body}`;
      })
      .join("\n\n---\n\n");

    if (!messageContent || messageContent.trim().length < MIN_CONTENT_LENGTH) {
      result.skipped++;
      continue;
    }

    conversations.push({
      conversationId: thread.conversationId,
      organizationId,
      sourceAccountId,
      content: messageContent,
      subject: thread.messages?.[0]?.subject,
    });
  }

  if (conversations.length === 0) {
    log.debug("No conversations with meaningful content to extract", {
      skipped: newThreads.length,
    });
    return result;
  }

  // Trigger extractions in batches for controlled parallelism
  for (let i = 0; i < conversations.length; i += MAX_CONCURRENT_TRIGGERS) {
    const batch = conversations.slice(i, i + MAX_CONCURRENT_TRIGGERS);

    // Fire all triggers in this batch concurrently
    const triggerPromises = batch.map(async (conv) => {
      try {
        // Fire and forget - don't await the extraction result
        await orchestratorExtractTask.trigger({
          organizationId: conv.organizationId,
          sourceType: "email",
          content: conv.content,
          sourceId: conv.conversationId,
          sourceAccountId: conv.sourceAccountId,
          conversationId: conv.conversationId,
        });

        return { success: true, conversationId: conv.conversationId };
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : "Unknown error";
        return { success: false, conversationId: conv.conversationId, error: errorMsg };
      }
    });

    // Wait for all triggers in this batch to be sent
    const batchResults = await Promise.all(triggerPromises);

    for (const res of batchResults) {
      if (res.success) {
        result.triggered++;
      } else {
        result.failed++;
        if (res.error) {
          result.errors.push(`${res.conversationId}: ${res.error}`);
        }
      }
    }

    // Small delay between batches to avoid overwhelming Trigger.dev
    if (i + MAX_CONCURRENT_TRIGGERS < conversations.length) {
      await new Promise((resolve) => setTimeout(resolve, TRIGGER_BATCH_DELAY_MS));
    }
  }

  log.info("Intelligence extraction triggers complete", {
    triggered: result.triggered,
    failed: result.failed,
    organizationId,
  });

  return result;
}

/**
 * Trigger extraction for a single conversation.
 * Used during incremental sync for immediate extraction.
 */
export async function triggerSingleExtraction(
  conversationId: string,
  organizationId: string,
  sourceAccountId: string,
  content: string
): Promise<boolean> {
  try {
    await orchestratorExtractTask.trigger({
      organizationId,
      sourceType: "email",
      content,
      sourceId: conversationId,
      sourceAccountId,
      conversationId,
    });
    return true;
  } catch (error) {
    log.error("Failed to trigger extraction", error, {
      conversationId,
      organizationId,
    });
    return false;
  }
}
