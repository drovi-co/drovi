// =============================================================================
// WAITING-ON ANALYZER
// =============================================================================
//
// Analyzes who is waiting on whom in a thread.
//

import { generateObject } from "ai";
import { observability } from "../../../observability";
import { getDefaultModel } from "../../../providers/index";
import { buildWaitingOnPrompt } from "../prompts/summarization";
import {
  type ExtractedClaims,
  type ThreadMessage,
  type WaitingOn,
  WaitingOnSchema,
} from "../types";

/**
 * Analyze waiting-on relationships in a thread.
 */
export async function analyzeWaitingOn(
  messages: ThreadMessage[],
  userEmail: string,
  claims?: ExtractedClaims
): Promise<WaitingOn> {
  // If we have claims, try to derive waiting-on from them
  if (claims) {
    const derived = deriveWaitingOnFromClaims(claims, userEmail);
    if (derived.waitingOn.length > 0 || derived.waitingFor.length > 0) {
      return derived;
    }
  }

  const trace = observability.trace({
    name: "waiting-on-analyzer",
    metadata: { messageCount: messages.length },
  });

  try {
    const prompt = buildWaitingOnPrompt(messages, userEmail);

    const result = await generateObject({
      model: getDefaultModel(),
      schema: WaitingOnSchema,
      prompt,
      temperature: 0.3,
    });

    trace.generation({
      name: "analyze-waiting-on",
      model: "claude-3-5-haiku",
      output: result.object,
    });

    return result.object;
  } catch (error) {
    trace.generation({
      name: "analyze-waiting-on-error",
      model: "claude-3-5-haiku",
      output: error instanceof Error ? error.message : "Unknown error",
      level: "ERROR",
    });

    // Fall back to derived if available
    if (claims) {
      return deriveWaitingOnFromClaims(claims, userEmail);
    }

    return {
      isWaitingOnOthers: false,
      isOthersWaitingOnUser: false,
      waitingOn: [],
      waitingFor: [],
    };
  }
}

/**
 * Derive waiting-on from extracted claims.
 */
function deriveWaitingOnFromClaims(
  claims: ExtractedClaims,
  userEmail: string
): WaitingOn {
  const waitingOn: WaitingOn["waitingOn"] = [];
  const waitingFor: WaitingOn["waitingFor"] = [];

  // Promises owed TO user = user waiting on others
  for (const promise of claims.promises) {
    if (promise.promisee === userEmail && promise.promisor !== userEmail) {
      waitingOn.push({
        person: promise.promisor,
        description: promise.text,
        since: promise.deadline,
      });
    }
  }

  // Promises BY user = others waiting on user
  for (const promise of claims.promises) {
    if (promise.promisor === userEmail && promise.promisee) {
      waitingFor.push({
        person: promise.promisee,
        description: promise.text,
        since: promise.deadline,
      });
    }
  }

  // Requests TO user = others waiting on user
  for (const request of claims.requests) {
    if (request.requestee === userEmail && request.requester !== userEmail) {
      waitingFor.push({
        person: request.requester,
        description: request.text,
        since: null,
      });
    }
  }

  // Requests BY user = user waiting on others
  for (const request of claims.requests) {
    if (request.requester === userEmail && request.requestee) {
      waitingOn.push({
        person: request.requestee,
        description: request.text,
        since: null,
      });
    }
  }

  // Unanswered questions TO user = others waiting
  for (const question of claims.questions) {
    if (!(question.isAnswered || question.isRhetorical)) {
      // If question was asked by user, user is waiting
      if (question.asker === userEmail) {
        // We don't know who should answer, so skip
        continue;
      }
      // If question was asked to user (implied), others waiting
      waitingFor.push({
        person: question.asker,
        description: question.text,
        since: null,
      });
    }
  }

  return {
    isWaitingOnOthers: waitingOn.length > 0,
    isOthersWaitingOnUser: waitingFor.length > 0,
    waitingOn,
    waitingFor,
  };
}
