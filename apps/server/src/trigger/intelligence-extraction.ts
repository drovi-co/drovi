// =============================================================================
// INTELLIGENCE EXTRACTION TRIGGER.DEV TASKS
// =============================================================================
//
// Intelligence extraction pipeline using Python backend (drovi-intelligence).
// All AI processing happens in Python - this is the primary extraction path.
// Python backend handles: extraction, graph persistence, memory episodes.
//

import { task } from "@trigger.dev/sdk";
import { log } from "../lib/logger";
import {
  callPythonIntelligence,
  checkIntelligenceBackendHealth,
  streamPythonIntelligence,
  type AnalyzeResponse,
} from "../lib/intelligence-backend";

// =============================================================================
// TYPES
// =============================================================================

/** Supported source types for intelligence extraction */
type SourceType =
  | "email"
  | "slack"
  | "calendar"
  | "notion"
  | "whatsapp"
  | "google_docs"
  | "raw"
  | "document";

interface ExtractIntelligencePayload {
  organizationId: string;
  sourceType: SourceType;
  content: string;
  sourceId?: string;
  sourceAccountId?: string;
  conversationId?: string;
  messageId?: string;
  userEmail?: string;
  userName?: string;
}

interface ExtractionResult {
  success: boolean;
  organizationId: string;
  sourceType: string;
  claims: number;
  commitments: number;
  decisions: number;
  risks: number;
  confidence: number;
  durationMs: number;
  extractedData: {
    claims: unknown[];
    commitments: unknown[];
    decisions: unknown[];
    risks: unknown[];
  };
}

// =============================================================================
// MAIN INTELLIGENCE EXTRACTION TASK
// =============================================================================

/**
 * Extract intelligence from content using Python backend.
 *
 * The Python backend (drovi-intelligence) handles:
 * - LangGraph orchestrator with 11 extraction nodes
 * - PostgreSQL persistence of UIOs
 * - FalkorDB graph persistence
 * - Memory episodes for temporal awareness
 */
export const orchestratorExtractTask = task({
  id: "orchestrator-extract",
  queue: {
    name: "intelligence-extraction",
    concurrencyLimit: 10,
  },
  retry: {
    maxAttempts: 3,
    minTimeoutInMs: 5000,
    maxTimeoutInMs: 60_000,
    factor: 2,
  },
  maxDuration: 180,
  run: async (payload: ExtractIntelligencePayload): Promise<ExtractionResult> => {
    const {
      organizationId,
      sourceType,
      content,
      sourceId,
      sourceAccountId,
      conversationId,
      userEmail,
      userName,
    } = payload;

    log.info("Starting intelligence extraction via Python backend", {
      organizationId,
      sourceType,
      contentLength: content.length,
    });

    // Verify Python backend is available
    const isHealthy = await checkIntelligenceBackendHealth();
    if (!isHealthy) {
      throw new Error("Python intelligence backend is not available");
    }

    try {
      // Call Python backend for extraction
      const result = await callPythonIntelligence({
        content,
        organization_id: organizationId,
        source_type: sourceType,
        source_id: sourceId,
        source_account_id: sourceAccountId,
        conversation_id: conversationId,
        user_email: userEmail,
        user_name: userName,
      });

      log.info("Intelligence extraction complete", {
        organizationId,
        sourceType,
        analysisId: result.analysis_id,
        claims: result.claims.length,
        commitments: result.commitments.length,
        decisions: result.decisions.length,
        risks: result.risks.length,
        durationMs: result.duration_ms,
        needsReview: result.needs_review,
      });

      // Return extraction results
      // Note: Python backend already handles persistence to PostgreSQL and FalkorDB
      return {
        success: true,
        organizationId,
        sourceType,
        claims: result.claims.length,
        commitments: result.commitments.length,
        decisions: result.decisions.length,
        risks: result.risks.length,
        confidence: result.overall_confidence,
        durationMs: result.duration_ms,
        extractedData: {
          claims: result.claims,
          commitments: result.commitments,
          decisions: result.decisions,
          risks: result.risks,
        },
      };
    } catch (error) {
      log.error("Intelligence extraction failed", error);
      throw error;
    }
  },
});

// =============================================================================
// STREAMING EXTRACTION TASK
// =============================================================================

/**
 * Extract intelligence with streaming progress updates via Python backend.
 * Uses SSE streaming from Python for real-time progress.
 */
export const orchestratorExtractStreamTask = task({
  id: "orchestrator-extract-stream",
  queue: {
    name: "intelligence-extraction",
    concurrencyLimit: 5,
  },
  retry: {
    maxAttempts: 2,
    minTimeoutInMs: 5000,
    maxTimeoutInMs: 60_000,
    factor: 2,
  },
  maxDuration: 300,
  run: async (payload: ExtractIntelligencePayload): Promise<ExtractionResult> => {
    const {
      organizationId,
      sourceType,
      content,
      sourceId,
      sourceAccountId,
      conversationId,
      userEmail,
      userName,
    } = payload;

    log.info("Starting streaming extraction via Python backend", {
      organizationId,
      sourceType,
      contentLength: content.length,
    });

    // Collect results from stream
    const claims: unknown[] = [];
    const commitments: unknown[] = [];
    const decisions: unknown[] = [];
    const risks: unknown[] = [];
    let confidence = 0;
    let durationMs = 0;

    try {
      await streamPythonIntelligence(
        {
          content,
          organization_id: organizationId,
          source_type: sourceType,
          source_id: sourceId,
          source_account_id: sourceAccountId,
          conversation_id: conversationId,
          user_email: userEmail,
          user_name: userName,
        },
        (event) => {
          log.debug("Streaming event received", { type: event.type });

          // Collect final results when complete
          if (event.type === "complete" && event.data) {
            const output = event.data as AnalyzeResponse;
            claims.push(...output.claims);
            commitments.push(...output.commitments);
            decisions.push(...output.decisions);
            risks.push(...output.risks);
            confidence = output.overall_confidence;
            durationMs = output.duration_ms;
          }
        }
      );

      log.info("Streaming extraction complete", {
        organizationId,
        claims: claims.length,
        commitments: commitments.length,
        decisions: decisions.length,
        risks: risks.length,
      });

      return {
        success: true,
        organizationId,
        sourceType,
        claims: claims.length,
        commitments: commitments.length,
        decisions: decisions.length,
        risks: risks.length,
        confidence,
        durationMs,
        extractedData: {
          claims,
          commitments,
          decisions,
          risks,
        },
      };
    } catch (error) {
      log.error("Streaming extraction failed", error);
      throw error;
    }
  },
});

// =============================================================================
// BATCH EXTRACTION TASK
// =============================================================================

interface BatchItem {
  id: string;
  content: string;
  sourceType?: SourceType;
}

interface BatchExtractPayload {
  organizationId: string;
  items: BatchItem[];
  sourceType?: SourceType;
}

/**
 * Extract intelligence from multiple content items in batch.
 */
export const orchestratorBatchExtractTask = task({
  id: "orchestrator-extract-batch",
  queue: {
    name: "intelligence-extraction-batch",
    concurrencyLimit: 2,
  },
  retry: {
    maxAttempts: 2,
  },
  maxDuration: 600,
  run: async (payload: BatchExtractPayload) => {
    const { organizationId, items, sourceType = "raw" } = payload;

    log.info("Starting batch orchestrator extraction", {
      organizationId,
      itemCount: items.length,
    });

    const results: Array<{
      id: string;
      success: boolean;
      handleId?: string;
      error?: string;
    }> = [];

    for (const item of items) {
      try {
        const handle = await orchestratorExtractTask.trigger({
          organizationId,
          sourceType: item.sourceType ?? sourceType,
          content: item.content,
          sourceId: item.id,
        });

        results.push({
          id: item.id,
          success: true,
          handleId: handle.id,
        });
      } catch (error) {
        log.error(`Failed to trigger extraction for item ${item.id}`, error);
        results.push({
          id: item.id,
          success: false,
          error: error instanceof Error ? error.message : "Unknown error",
        });
      }
    }

    return {
      success: true,
      organizationId,
      totalItems: items.length,
      successfulTriggers: results.filter((r) => r.success).length,
      failedTriggers: results.filter((r) => !r.success).length,
      results,
    };
  },
});
