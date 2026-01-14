// =============================================================================
// URGENCY SCORER
// =============================================================================
//
// Scores thread urgency based on deadlines, language, and context.
//

import { generateObject } from "ai";
import { observability } from "../../../observability";
import { getDefaultModel } from "../../../providers/index";
import { buildUrgencyPrompt } from "../prompts/classification";
import {
  type ThreadMessage,
  type UrgencyScore,
  UrgencyScoreSchema,
} from "../types";

/**
 * Score the urgency of a thread.
 */
export async function scoreUrgency(
  messages: ThreadMessage[],
  userEmail: string
): Promise<UrgencyScore> {
  const trace = observability.trace({
    name: "urgency-scorer",
    metadata: { messageCount: messages.length },
  });

  try {
    const prompt = buildUrgencyPrompt(messages, userEmail);

    const result = await generateObject({
      model: getDefaultModel(),
      schema: UrgencyScoreSchema,
      prompt,
      temperature: 0.3,
    });

    trace.generation({
      name: "score-urgency",
      model: "claude-3-5-haiku",
      output: result.object,
    });

    return result.object;
  } catch (error) {
    trace.generation({
      name: "score-urgency-error",
      model: "claude-3-5-haiku",
      output: error instanceof Error ? error.message : "Unknown error",
      level: "ERROR",
    });

    // Return fallback
    return {
      score: 0.3,
      level: "medium",
      reasoning: "Urgency scoring failed",
      signals: [],
    };
  }
}

/**
 * Quick heuristic urgency check (without LLM).
 * Useful for pre-filtering or fallback.
 */
export function quickUrgencyCheck(messages: ThreadMessage[]): {
  hasExplicitUrgency: boolean;
  hasDeadline: boolean;
  signals: string[];
} {
  const urgencyPatterns = [
    /urgent/i,
    /asap/i,
    /immediately/i,
    /critical/i,
    /time.?sensitive/i,
    /as soon as possible/i,
    /by (today|tomorrow|end of day|eod|cob)/i,
  ];

  const deadlinePatterns = [
    /by (monday|tuesday|wednesday|thursday|friday|saturday|sunday)/i,
    /by \d{1,2}(\/|-)\d{1,2}/i,
    /deadline/i,
    /due (date|by)/i,
    /before \w+ \d{1,2}/i,
  ];

  const signals: string[] = [];
  let hasExplicitUrgency = false;
  let hasDeadline = false;

  for (const message of messages) {
    const text = message.bodyText || "";

    for (const pattern of urgencyPatterns) {
      if (pattern.test(text)) {
        hasExplicitUrgency = true;
        const match = text.match(pattern);
        if (match) {
          signals.push(match[0]);
        }
      }
    }

    for (const pattern of deadlinePatterns) {
      if (pattern.test(text)) {
        hasDeadline = true;
        const match = text.match(pattern);
        if (match) {
          signals.push(match[0]);
        }
      }
    }
  }

  return { hasExplicitUrgency, hasDeadline, signals: [...new Set(signals)] };
}
