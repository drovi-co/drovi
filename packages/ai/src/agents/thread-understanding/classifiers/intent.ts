// =============================================================================
// INTENT CLASSIFIER
// =============================================================================
//
// Classifies threads by their primary intent.
//

import { generateObject } from "ai";
import { observability } from "../../../observability";
import { getDefaultModel } from "../../../providers/index";
import { buildIntentPrompt } from "../prompts/classification";
import {
  type IntentClassification,
  IntentClassificationSchema,
  type ThreadMessage,
} from "../types";

/**
 * Classify the intent of a thread.
 */
export async function classifyIntent(
  messages: ThreadMessage[],
  userEmail: string
): Promise<IntentClassification> {
  const trace = observability.trace({
    name: "intent-classifier",
    metadata: { messageCount: messages.length },
  });

  try {
    const prompt = buildIntentPrompt(messages, userEmail);

    const result = await generateObject({
      model: getDefaultModel(),
      schema: IntentClassificationSchema,
      prompt,
      temperature: 0.3,
    });

    trace.generation({
      name: "classify-intent",
      model: "claude-3-5-haiku",
      output: result.object,
    });

    return result.object;
  } catch (error) {
    trace.generation({
      name: "classify-intent-error",
      model: "claude-3-5-haiku",
      output: error instanceof Error ? error.message : "Unknown error",
      level: "ERROR",
    });

    // Return fallback
    return {
      intent: "other",
      confidence: 0,
      reasoning: "Classification failed",
      secondaryIntents: null,
    };
  }
}

/**
 * Batch classify multiple threads.
 */
export async function classifyIntentBatch(
  threads: Array<{ messages: ThreadMessage[]; userEmail: string }>
): Promise<IntentClassification[]> {
  return await Promise.all(
    threads.map(({ messages, userEmail }) =>
      classifyIntent(messages, userEmail)
    )
  );
}
