// =============================================================================
// COMMITMENT DEDUPLICATION HELPERS
// =============================================================================
//
// Helpers for detecting duplicate commitments within the same source/conversation
// before inserting new records. This prevents duplicate raw commitments from
// being created, which would then all be processed into separate UIOs.
//

import { db } from "@memorystack/db";
import { commitment, decision } from "@memorystack/db/schema";
import { and, eq, gte } from "drizzle-orm";
import { log } from "../../lib/logger";

// =============================================================================
// TYPES
// =============================================================================

interface CommitmentDedupInput {
  organizationId: string;
  sourceConversationId: string;
  title: string;
  description?: string;
  dueDate?: Date | null;
  /** Time window to check for duplicates (default: 24 hours) */
  timeWindowHours?: number;
}

interface DecisionDedupInput {
  organizationId: string;
  sourceConversationId: string;
  title: string;
  statement: string;
  /** Time window to check for duplicates (default: 24 hours) */
  timeWindowHours?: number;
}

interface DedupResult {
  isDuplicate: boolean;
  existingId?: string;
  similarity?: number;
  reason?: string;
}

// =============================================================================
// TEXT SIMILARITY
// =============================================================================

/**
 * Calculate simple text similarity using Jaccard similarity on words.
 * Fast and good enough for catching obvious duplicates.
 */
function calculateTextSimilarity(textA: string, textB: string): number {
  const normalize = (text: string) =>
    text
      .toLowerCase()
      .replace(/[^\w\s]/g, "")
      .split(/\s+/)
      .filter((w) => w.length > 2);

  const wordsA = new Set(normalize(textA));
  const wordsB = new Set(normalize(textB));

  if (wordsA.size === 0 && wordsB.size === 0) {
    return 1;
  }
  if (wordsA.size === 0 || wordsB.size === 0) {
    return 0;
  }

  const intersection = new Set([...wordsA].filter((w) => wordsB.has(w)));
  const union = new Set([...wordsA, ...wordsB]);

  return intersection.size / union.size;
}

/**
 * Check if two dates are within the same day or week.
 */
function areDatesCompatible(
  dateA: Date | null | undefined,
  dateB: Date | null | undefined
): boolean {
  // If either is null, they're compatible (no conflict)
  if (!(dateA && dateB)) {
    return true;
  }

  const daysDiff = Math.abs(
    (dateA.getTime() - dateB.getTime()) / (1000 * 60 * 60 * 24)
  );

  // Within 7 days is considered compatible
  return daysDiff <= 7;
}

// =============================================================================
// COMMITMENT DEDUPLICATION
// =============================================================================

/**
 * Check if a commitment already exists in the same conversation.
 * Uses text similarity to detect duplicates even with slightly different wording.
 */
export async function checkExistingCommitment(
  input: CommitmentDedupInput
): Promise<DedupResult> {
  const {
    organizationId,
    sourceConversationId,
    title,
    description,
    dueDate,
    timeWindowHours = 24,
  } = input;

  const timeThreshold = new Date(Date.now() - timeWindowHours * 60 * 60 * 1000);

  try {
    // Find recent commitments in the same conversation
    const existingCommitments = await db.query.commitment.findMany({
      where: and(
        eq(commitment.organizationId, organizationId),
        eq(commitment.sourceConversationId, sourceConversationId),
        gte(commitment.createdAt, timeThreshold)
      ),
      columns: {
        id: true,
        title: true,
        description: true,
        dueDate: true,
      },
      limit: 50, // Check last 50 commitments in this conversation
    });

    if (existingCommitments.length === 0) {
      return { isDuplicate: false };
    }

    // Check for duplicates using text similarity
    const fullText = `${title} ${description || ""}`.trim();

    for (const existing of existingCommitments) {
      const existingText =
        `${existing.title} ${existing.description || ""}`.trim();
      const similarity = calculateTextSimilarity(fullText, existingText);

      // High similarity threshold for same-conversation duplicates
      if (similarity >= 0.7) {
        // Also check if due dates are compatible
        if (areDatesCompatible(dueDate, existing.dueDate)) {
          log.info("Found duplicate commitment in same conversation", {
            existingId: existing.id,
            similarity,
            sourceConversationId,
          });

          return {
            isDuplicate: true,
            existingId: existing.id,
            similarity,
            reason: `Similar commitment already exists in this conversation (${Math.round(similarity * 100)}% match)`,
          };
        }
      }

      // Exact title match is always a duplicate
      if (existing.title.toLowerCase() === title.toLowerCase()) {
        log.info("Found exact title match in same conversation", {
          existingId: existing.id,
          sourceConversationId,
        });

        return {
          isDuplicate: true,
          existingId: existing.id,
          similarity: 1.0,
          reason: "Exact title match in same conversation",
        };
      }
    }

    return { isDuplicate: false };
  } catch (error) {
    log.error("Error checking for duplicate commitment", error, {
      sourceConversationId,
    });
    // On error, allow the commitment (don't block)
    return { isDuplicate: false };
  }
}

// =============================================================================
// DECISION DEDUPLICATION
// =============================================================================

/**
 * Check if a decision already exists in the same conversation.
 */
export async function checkExistingDecision(
  input: DecisionDedupInput
): Promise<DedupResult> {
  const {
    organizationId,
    sourceConversationId,
    title,
    statement,
    timeWindowHours = 24,
  } = input;

  const timeThreshold = new Date(Date.now() - timeWindowHours * 60 * 60 * 1000);

  try {
    // Find recent decisions in the same conversation
    const existingDecisions = await db.query.decision.findMany({
      where: and(
        eq(decision.organizationId, organizationId),
        eq(decision.sourceConversationId, sourceConversationId),
        gte(decision.createdAt, timeThreshold)
      ),
      columns: {
        id: true,
        title: true,
        statement: true,
      },
      limit: 50,
    });

    if (existingDecisions.length === 0) {
      return { isDuplicate: false };
    }

    // Check for duplicates
    const fullText = `${title} ${statement}`.trim();

    for (const existing of existingDecisions) {
      const existingText = `${existing.title} ${existing.statement}`.trim();
      const similarity = calculateTextSimilarity(fullText, existingText);

      if (similarity >= 0.7) {
        log.info("Found duplicate decision in same conversation", {
          existingId: existing.id,
          similarity,
          sourceConversationId,
        });

        return {
          isDuplicate: true,
          existingId: existing.id,
          similarity,
          reason: `Similar decision already exists in this conversation (${Math.round(similarity * 100)}% match)`,
        };
      }

      // Exact statement match
      if (existing.statement.toLowerCase() === statement.toLowerCase()) {
        return {
          isDuplicate: true,
          existingId: existing.id,
          similarity: 1.0,
          reason: "Exact statement match in same conversation",
        };
      }
    }

    return { isDuplicate: false };
  } catch (error) {
    log.error("Error checking for duplicate decision", error, {
      sourceConversationId,
    });
    return { isDuplicate: false };
  }
}

// =============================================================================
// ORGANIZATION-WIDE DEDUPLICATION
// =============================================================================

/**
 * Check for duplicate commitments across ALL sources in the organization.
 * Uses a more relaxed threshold since cross-source duplicates may have
 * different wording.
 *
 * This is called when we want to check if the same commitment was already
 * extracted from a different source (e.g., Slack and Email discussing same thing).
 */
export async function checkOrganizationWideCommitment(
  input: Omit<CommitmentDedupInput, "sourceConversationId"> & {
    sourceConversationId?: string;
  }
): Promise<DedupResult> {
  const {
    organizationId,
    sourceConversationId,
    title,
    description,
    dueDate,
    timeWindowHours = 168, // 7 days for org-wide
  } = input;

  const timeThreshold = new Date(Date.now() - timeWindowHours * 60 * 60 * 1000);

  try {
    // Find recent commitments in the organization (excluding current conversation)
    const whereConditions = [
      eq(commitment.organizationId, organizationId),
      gte(commitment.createdAt, timeThreshold),
    ];

    const existingCommitments = await db.query.commitment.findMany({
      where: and(...whereConditions),
      columns: {
        id: true,
        title: true,
        description: true,
        dueDate: true,
        sourceConversationId: true,
      },
      limit: 100,
      orderBy: (c, { desc }) => [desc(c.createdAt)],
    });

    if (existingCommitments.length === 0) {
      return { isDuplicate: false };
    }

    const fullText = `${title} ${description || ""}`.trim();

    for (const existing of existingCommitments) {
      // Skip if same conversation (handled by checkExistingCommitment)
      if (
        sourceConversationId &&
        existing.sourceConversationId === sourceConversationId
      ) {
        continue;
      }

      const existingText =
        `${existing.title} ${existing.description || ""}`.trim();
      const similarity = calculateTextSimilarity(fullText, existingText);

      // Higher threshold for cross-source (0.8) since wording may differ
      if (similarity >= 0.8 && areDatesCompatible(dueDate, existing.dueDate)) {
        log.info("Found potential cross-source duplicate commitment", {
          existingId: existing.id,
          similarity,
          existingConversation: existing.sourceConversationId,
          newConversation: sourceConversationId,
        });

        return {
          isDuplicate: true,
          existingId: existing.id,
          similarity,
          reason: `Similar commitment exists in another conversation (${Math.round(similarity * 100)}% match)`,
        };
      }
    }

    return { isDuplicate: false };
  } catch (error) {
    log.error("Error checking for org-wide duplicate commitment", error, {
      organizationId,
    });
    return { isDuplicate: false };
  }
}
