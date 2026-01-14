// =============================================================================
// OPEN LOOP DETECTOR
// =============================================================================
//
// Detects unanswered questions and pending items in threads.
//

import { generateObject } from "ai";
import { z } from "zod";
import { observability } from "../../../observability";
import { getDefaultModel } from "../../../providers/index";
import { buildOpenLoopPrompt } from "../prompts/summarization";
import {
  type ExtractedClaims,
  type OpenLoop,
  OpenLoopSchema,
  type ThreadMessage,
} from "../types";

/**
 * Detect open loops in a thread.
 */
export async function detectOpenLoops(
  messages: ThreadMessage[],
  userEmail: string,
  claims?: ExtractedClaims
): Promise<OpenLoop[]> {
  // If we have extracted claims, we can use them to find unanswered questions
  if (claims) {
    const claimBasedLoops = findOpenLoopsFromClaims(claims, messages);
    if (claimBasedLoops.length > 0) {
      return claimBasedLoops;
    }
  }

  const trace = observability.trace({
    name: "open-loop-detector",
    metadata: { messageCount: messages.length },
  });

  try {
    const prompt = buildOpenLoopPrompt(messages, userEmail);

    const result = await generateObject({
      model: getDefaultModel(),
      schema: z.object({ openLoops: z.array(OpenLoopSchema) }),
      prompt,
      temperature: 0.3,
    });

    trace.generation({
      name: "detect-open-loops",
      model: "claude-3-5-haiku",
      output: { count: result.object.openLoops.length },
    });

    return result.object.openLoops;
  } catch (error) {
    trace.generation({
      name: "detect-open-loops-error",
      model: "claude-3-5-haiku",
      output: error instanceof Error ? error.message : "Unknown error",
      level: "ERROR",
    });

    // Fall back to claim-based if available
    if (claims) {
      return findOpenLoopsFromClaims(claims, messages);
    }

    return [];
  }
}

/**
 * Find open loops from extracted claims.
 */
function findOpenLoopsFromClaims(
  claims: ExtractedClaims,
  messages: ThreadMessage[]
): OpenLoop[] {
  const openLoops: OpenLoop[] = [];

  // Find unanswered questions
  for (const question of claims.questions) {
    if (!(question.isAnswered || question.isRhetorical)) {
      const sourceMessage = messages.find(
        (m) => m.id === question.evidence[0]?.messageId
      );
      const age = sourceMessage?.sentAt
        ? Math.floor(
            (Date.now() - sourceMessage.sentAt.getTime()) /
              (1000 * 60 * 60 * 24)
          )
        : undefined;

      openLoops.push({
        type: "unanswered_question",
        description: question.text,
        owner: question.asker,
        sourceMessageId: question.evidence[0]?.messageId || "",
        sourceQuotedText: question.evidence[0]?.quotedText || question.text,
        age,
        priority: "medium",
      });
    }
  }

  // Find pending requests (requests without a response from requestee)
  const lastMessageFrom = messages.at(-1)?.fromEmail;
  for (const request of claims.requests) {
    // If the last message wasn't from the requestee, it might be pending
    if (request.requestee && lastMessageFrom !== request.requestee) {
      const sourceMessage = messages.find(
        (m) => m.id === request.evidence[0]?.messageId
      );
      const age = sourceMessage?.sentAt
        ? Math.floor(
            (Date.now() - sourceMessage.sentAt.getTime()) /
              (1000 * 60 * 60 * 24)
          )
        : undefined;

      openLoops.push({
        type: "pending_request",
        description: request.text,
        owner: request.requestee,
        sourceMessageId: request.evidence[0]?.messageId || "",
        sourceQuotedText: request.evidence[0]?.quotedText || request.text,
        age,
        priority: request.priority || "medium",
      });
    }
  }

  return openLoops;
}

/**
 * Count open loops by type.
 */
export function countOpenLoops(openLoops: OpenLoop[]): {
  unansweredQuestions: number;
  pendingRequests: number;
  unfulfilledPromises: number;
  awaitingResponse: number;
  total: number;
} {
  return {
    unansweredQuestions: openLoops.filter(
      (l) => l.type === "unanswered_question"
    ).length,
    pendingRequests: openLoops.filter((l) => l.type === "pending_request")
      .length,
    unfulfilledPromises: openLoops.filter(
      (l) => l.type === "unfulfilled_promise"
    ).length,
    awaitingResponse: openLoops.filter((l) => l.type === "awaiting_response")
      .length,
    total: openLoops.length,
  };
}
