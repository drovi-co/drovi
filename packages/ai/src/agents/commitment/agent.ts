// =============================================================================
// COMMITMENT AGENT (Agent 2)
// =============================================================================
//
// Extracts and tracks commitments from email threads.
// Converts promises and requests into trackable commitments with parties and dates.
//

import { generateObject } from "ai";
import { observability } from "../../observability";
import { getModel } from "../../providers/index";
import { extractDueDate, mergeDateExtractions } from "./extractors/dates";
import {
  identifyParties,
  mergePartyIdentifications,
} from "./extractors/parties";
import {
  buildCommitmentExtractionPrompt,
  buildFollowUpPrompt,
  buildStatusDetectionPrompt,
} from "./prompts/extraction";
import {
  CommitmentExtractionResponseSchema,
  type CommitmentStatus,
  type CommitmentThreadContext,
  type DailyDigest,
  type ExtractedCommitment,
  type FollowUpDraft,
  FollowUpGenerationResponseSchema,
  type OverdueCommitment,
  type PromiseClaimInput,
  type RequestClaimInput,
  type StatusChange,
  StatusDetectionResponseSchema,
} from "./types";

// Model version for tracking
const MODEL_VERSION = "1.0.0";

/**
 * Commitment Agent
 *
 * Extracts commitments from email claims and tracks their lifecycle.
 */
export class CommitmentAgent {
  /**
   * Extract commitments from promise and request claims.
   */
  async extractCommitments(
    context: CommitmentThreadContext,
    promiseClaims: PromiseClaimInput[],
    requestClaims: RequestClaimInput[]
  ): Promise<ExtractedCommitment[]> {
    const trace = observability.trace({
      name: "commitment-extraction",
      metadata: {
        threadId: context.threadId,
        promiseCount: promiseClaims.length,
        requestCount: requestClaims.length,
      },
    });

    // If no claims to process, return early
    if (promiseClaims.length === 0 && requestClaims.length === 0) {
      return [];
    }

    try {
      const prompt = buildCommitmentExtractionPrompt(
        context,
        promiseClaims,
        requestClaims
      );

      const result = await generateObject({
        model: getModel("anthropic", "claude-3-5-haiku-20241022"),
        schema: CommitmentExtractionResponseSchema,
        prompt,
        temperature: 0.3,
      });

      const commitments: ExtractedCommitment[] = [];

      for (const llmCommitment of result.object.commitments) {
        // Find the source claim
        const sourceClaim = findSourceClaim(
          llmCommitment,
          promiseClaims,
          requestClaims
        );

        // Extract due date using both LLM and heuristic
        const heuristicDate = extractDueDate(
          llmCommitment.dueDateText || "",
          getMessageDate(context, sourceClaim)
        );
        const dueDate = mergeDateExtractions(
          {
            date: llmCommitment.dueDate,
            confidence: llmCommitment.dueDateConfidence,
            text: llmCommitment.dueDateText,
          },
          heuristicDate
        );

        // Identify parties using both LLM and heuristic
        const messageContext = getMessageContext(context, sourceClaim);
        const claimContext = getClaimContext(sourceClaim);
        const heuristicParties = identifyParties(
          claimContext,
          messageContext,
          context.userEmail
        );
        const parties = mergePartyIdentifications(
          {
            debtorEmail: llmCommitment.debtorEmail ?? undefined,
            debtorName: llmCommitment.debtorName ?? undefined,
            creditorEmail: llmCommitment.creditorEmail ?? undefined,
            creditorName: llmCommitment.creditorName ?? undefined,
          },
          heuristicParties,
          context.userEmail
        );

        commitments.push({
          title: llmCommitment.title,
          description: llmCommitment.description,
          debtor: parties.debtor,
          creditor: parties.creditor,
          direction: parties.direction,
          dueDate,
          priority: llmCommitment.priority,
          status: "pending",
          sourceClaimId: sourceClaim?.id || "",
          sourceThreadId: context.threadId,
          sourceMessageId: sourceClaim?.evidence[0]?.messageId,
          confidence: llmCommitment.confidence,
          isConditional: llmCommitment.isConditional,
          condition: llmCommitment.condition,
          metadata: {
            reasoning: llmCommitment.reasoning,
          },
        });
      }

      trace.generation({
        name: "extract-commitments",
        model: "claude-3-5-haiku",
        output: { count: commitments.length },
      });

      return commitments;
    } catch (error) {
      trace.generation({
        name: "extract-commitments-error",
        model: "claude-3-5-haiku",
        output: error instanceof Error ? error.message : "Unknown error",
        level: "ERROR",
      });
      throw error;
    }
  }

  /**
   * Detect status changes in commitments from new messages.
   */
  async detectStatusChanges(
    existingCommitments: Array<{
      id: string;
      title: string;
      status: CommitmentStatus;
      dueDate?: Date;
    }>,
    newMessages: Array<{
      id: string;
      fromEmail: string;
      bodyText?: string;
      sentAt?: Date;
    }>
  ): Promise<StatusChange[]> {
    if (existingCommitments.length === 0 || newMessages.length === 0) {
      return [];
    }

    const trace = observability.trace({
      name: "status-detection",
      metadata: {
        commitmentCount: existingCommitments.length,
        messageCount: newMessages.length,
      },
    });

    try {
      const prompt = buildStatusDetectionPrompt(
        existingCommitments.map((c) => ({
          title: c.title,
          status: c.status,
          dueDate: c.dueDate,
        })),
        newMessages
      );

      const result = await generateObject({
        model: getModel("anthropic", "claude-3-5-haiku-20241022"),
        schema: StatusDetectionResponseSchema,
        prompt,
        temperature: 0.2,
      });

      const changes: StatusChange[] = result.object.statusChanges.map(
        (change) => ({
          newStatus: change.newStatus,
          reason: change.reason,
          confidence: change.confidence,
          detectedAt: new Date().toISOString(),
          sourceMessageId: newMessages.at(-1)?.id,
          evidenceQuote: change.evidenceQuote,
        })
      );

      trace.generation({
        name: "detect-status-changes",
        model: "claude-3-5-haiku",
        output: { count: changes.length },
      });

      return changes;
    } catch (error) {
      trace.generation({
        name: "detect-status-changes-error",
        model: "claude-3-5-haiku",
        output: error instanceof Error ? error.message : "Unknown error",
        level: "ERROR",
      });
      return [];
    }
  }

  /**
   * Find overdue commitments.
   */
  findOverdueCommitments(
    commitments: Array<{
      id: string;
      title: string;
      status: CommitmentStatus;
      dueDate?: Date | null;
      direction: string;
      debtorEmail?: string | null;
      creditorEmail?: string | null;
      sourceThreadId?: string | null;
      lastReminderAt?: Date | null;
      reminderCount: number;
    }>
  ): OverdueCommitment[] {
    const now = new Date();
    const overdue: OverdueCommitment[] = [];

    for (const c of commitments) {
      // Skip non-pending/in-progress commitments
      if (!["pending", "in_progress", "waiting"].includes(c.status)) {
        continue;
      }

      // Skip if no due date
      if (!c.dueDate) {
        continue;
      }

      const daysOverdue = Math.floor(
        (now.getTime() - c.dueDate.getTime()) / (1000 * 60 * 60 * 24)
      );

      if (daysOverdue > 0) {
        overdue.push({
          id: c.id,
          title: c.title,
          dueDate: c.dueDate,
          daysOverdue,
          direction: c.direction as "owed_by_me" | "owed_to_me",
          debtorEmail: c.debtorEmail ?? undefined,
          creditorEmail: c.creditorEmail ?? undefined,
          sourceThreadId: c.sourceThreadId ?? undefined,
          lastReminderAt: c.lastReminderAt ?? undefined,
          reminderCount: c.reminderCount,
        });
      }
    }

    // Sort by days overdue (most overdue first)
    return overdue.sort((a, b) => b.daysOverdue - a.daysOverdue);
  }

  /**
   * Generate follow-up draft for an overdue commitment.
   */
  async generateFollowUp(
    commitment: {
      id: string;
      title: string;
      description?: string;
      dueDate?: Date;
      debtorName?: string;
      debtorEmail?: string;
    },
    daysOverdue: number,
    reminderCount: number,
    originalContext?: string
  ): Promise<FollowUpDraft> {
    const trace = observability.trace({
      name: "followup-generation",
      metadata: {
        commitmentId: commitment.id,
        daysOverdue,
        reminderCount,
      },
    });

    // Determine tone based on overdue days and reminder count
    let tone: "friendly" | "professional" | "urgent" = "friendly";
    if (daysOverdue > 14 || reminderCount > 2) {
      tone = "urgent";
    } else if (daysOverdue > 7 || reminderCount > 0) {
      tone = "professional";
    }

    try {
      const prompt = buildFollowUpPrompt(
        commitment,
        daysOverdue,
        reminderCount,
        tone,
        originalContext
      );

      const result = await generateObject({
        model: getModel("anthropic", "claude-3-5-haiku-20241022"),
        schema: FollowUpGenerationResponseSchema,
        prompt,
        temperature: 0.5,
      });

      trace.generation({
        name: "generate-followup",
        model: "claude-3-5-haiku",
        output: { tone: result.object.tone },
      });

      return {
        subject: result.object.subject,
        body: result.object.body,
        tone: result.object.tone,
        includesContext: !!originalContext,
        commitmentId: commitment.id,
      };
    } catch (error) {
      trace.generation({
        name: "generate-followup-error",
        model: "claude-3-5-haiku",
        output: error instanceof Error ? error.message : "Unknown error",
        level: "ERROR",
      });

      // Return fallback
      return {
        subject: `Follow-up: ${commitment.title}`,
        body: `Hi,\n\nI wanted to follow up on "${commitment.title}" which was due ${daysOverdue} days ago.\n\nCould you provide an update?\n\nThanks`,
        tone: "professional",
        includesContext: false,
        commitmentId: commitment.id,
      };
    }
  }

  /**
   * Generate daily digest for a user.
   */
  generateDailyDigest(
    userId: string,
    organizationId: string,
    commitments: Array<{
      id: string;
      title: string;
      status: CommitmentStatus;
      dueDate?: Date | null;
      direction: string;
      debtorEmail?: string | null;
      creditorEmail?: string | null;
      sourceThreadId?: string | null;
      lastReminderAt?: Date | null;
      reminderCount: number;
    }>
  ): DailyDigest {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const nextWeek = new Date(today);
    nextWeek.setDate(nextWeek.getDate() + 7);

    const owedByMe = {
      overdue: [] as OverdueCommitment[],
      dueToday: [] as OverdueCommitment[],
      upcoming: [] as OverdueCommitment[],
    };
    const owedToMe = {
      overdue: [] as OverdueCommitment[],
      dueToday: [] as OverdueCommitment[],
      upcoming: [] as OverdueCommitment[],
    };

    for (const c of commitments) {
      // Skip non-active commitments
      if (!["pending", "in_progress", "waiting"].includes(c.status)) {
        continue;
      }

      const item: OverdueCommitment = {
        id: c.id,
        title: c.title,
        dueDate: c.dueDate || new Date(),
        daysOverdue: c.dueDate
          ? Math.floor(
              (now.getTime() - c.dueDate.getTime()) / (1000 * 60 * 60 * 24)
            )
          : 0,
        direction: c.direction as "owed_by_me" | "owed_to_me",
        debtorEmail: c.debtorEmail ?? undefined,
        creditorEmail: c.creditorEmail ?? undefined,
        sourceThreadId: c.sourceThreadId ?? undefined,
        lastReminderAt: c.lastReminderAt ?? undefined,
        reminderCount: c.reminderCount,
      };

      const bucket = c.direction === "owed_by_me" ? owedByMe : owedToMe;

      if (!c.dueDate) {
        // No due date - put in upcoming
        bucket.upcoming.push(item);
      } else if (c.dueDate < today) {
        bucket.overdue.push(item);
      } else if (c.dueDate.toDateString() === today.toDateString()) {
        bucket.dueToday.push(item);
      } else if (c.dueDate <= nextWeek) {
        bucket.upcoming.push(item);
      }
    }

    // Sort each bucket
    const sortByDaysOverdue = (a: OverdueCommitment, b: OverdueCommitment) =>
      b.daysOverdue - a.daysOverdue;

    owedByMe.overdue.sort(sortByDaysOverdue);
    owedByMe.upcoming.sort((a, b) => a.dueDate.getTime() - b.dueDate.getTime());
    owedToMe.overdue.sort(sortByDaysOverdue);
    owedToMe.upcoming.sort((a, b) => a.dueDate.getTime() - b.dueDate.getTime());

    const totalOpen =
      owedByMe.overdue.length +
      owedByMe.dueToday.length +
      owedByMe.upcoming.length +
      owedToMe.overdue.length +
      owedToMe.dueToday.length +
      owedToMe.upcoming.length;

    return {
      userId,
      organizationId,
      generatedAt: now,
      owedByMe,
      owedToMe,
      totalOpen,
    };
  }
}

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Find the source claim for an extracted commitment.
 */
function findSourceClaim(
  commitment: { title: string; reasoning: string },
  promiseClaims: PromiseClaimInput[],
  requestClaims: RequestClaimInput[]
): PromiseClaimInput | RequestClaimInput | undefined {
  // Try to match by text similarity
  const allClaims = [...promiseClaims, ...requestClaims];

  for (const claim of allClaims) {
    // Simple check: if the commitment title or reasoning mentions the claim text
    if (
      commitment.title
        .toLowerCase()
        .includes(claim.text.substring(0, 30).toLowerCase()) ||
      commitment.reasoning
        .toLowerCase()
        .includes(claim.text.substring(0, 30).toLowerCase())
    ) {
      return claim;
    }
  }

  // Return first claim as fallback
  return allClaims[0];
}

/**
 * Get the date of the message containing the claim.
 */
function getMessageDate(
  context: CommitmentThreadContext,
  claim?: PromiseClaimInput | RequestClaimInput
): Date {
  if (claim?.evidence[0]?.messageId) {
    const message = context.messages.find(
      (m) => m.id === claim.evidence[0]?.messageId
    );
    if (message?.sentAt) {
      return message.sentAt;
    }
  }
  return new Date();
}

/**
 * Get message context for party identification.
 */
function getMessageContext(
  context: CommitmentThreadContext,
  claim?: PromiseClaimInput | RequestClaimInput
): {
  fromEmail: string;
  fromName?: string;
  toEmails?: string[];
  isFromUser: boolean;
} {
  if (claim?.evidence[0]?.messageId) {
    const message = context.messages.find(
      (m) => m.id === claim.evidence[0]?.messageId
    );
    if (message) {
      return {
        fromEmail: message.fromEmail,
        fromName: message.fromName,
        isFromUser: message.isFromUser,
      };
    }
  }

  // Fall back to last message
  const lastMessage = context.messages.at(-1);
  return {
    fromEmail: lastMessage?.fromEmail || "",
    fromName: lastMessage?.fromName,
    isFromUser: lastMessage?.isFromUser,
  };
}

/**
 * Get claim context for party identification.
 */
function getClaimContext(claim?: PromiseClaimInput | RequestClaimInput): {
  promisor?: string;
  promisee?: string;
  requester?: string;
  requestee?: string;
} {
  if (!claim) return {};

  if ("promisor" in claim) {
    return {
      promisor: claim.promisor,
      promisee: claim.promisee,
    };
  }

  if ("requester" in claim) {
    return {
      requester: claim.requester,
      requestee: claim.requestee,
    };
  }

  return {};
}

// =============================================================================
// EXPORTS
// =============================================================================

/**
 * Create a new Commitment Agent instance.
 */
export function createCommitmentAgent(): CommitmentAgent {
  return new CommitmentAgent();
}

/**
 * Extract commitments from a thread (convenience function).
 */
export async function extractCommitments(
  context: CommitmentThreadContext,
  promiseClaims: PromiseClaimInput[],
  requestClaims: RequestClaimInput[]
): Promise<ExtractedCommitment[]> {
  const agent = new CommitmentAgent();
  return await agent.extractCommitments(context, promiseClaims, requestClaims);
}
