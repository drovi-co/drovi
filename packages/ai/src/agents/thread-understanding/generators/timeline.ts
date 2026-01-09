// =============================================================================
// TIMELINE GENERATOR
// =============================================================================
//
// Generates chronological timeline of thread events.
//

import { generateObject } from "ai";
import { z } from "zod";
import { observability } from "../../../observability";
import { getModel } from "../../../providers/index";
import { buildTimelinePrompt } from "../prompts/summarization";
import {
  type ThreadMessage,
  type TimelineEvent,
  TimelineEventSchema,
} from "../types";

/**
 * Generate a timeline for a thread.
 */
export async function generateTimeline(
  messages: ThreadMessage[],
  userEmail: string
): Promise<TimelineEvent[]> {
  // For simple threads, use heuristic
  if (messages.length <= 2) {
    return heuristicTimeline(messages);
  }

  const trace = observability.trace({
    name: "timeline-generator",
    metadata: { messageCount: messages.length },
  });

  try {
    const prompt = buildTimelinePrompt(messages, userEmail);

    const result = await generateObject({
      model: getModel("anthropic", "claude-3-5-haiku-20241022"),
      schema: z.object({ events: z.array(TimelineEventSchema) }),
      prompt,
      temperature: 0.3,
    });

    trace.generation({
      name: "generate-timeline",
      model: "claude-3-5-haiku",
      output: { eventCount: result.object.events.length },
    });

    return result.object.events;
  } catch (error) {
    trace.generation({
      name: "generate-timeline-error",
      model: "claude-3-5-haiku",
      output: error instanceof Error ? error.message : "Unknown error",
      level: "ERROR",
    });

    // Fall back to heuristic
    return heuristicTimeline(messages);
  }
}

/**
 * Generate basic timeline from messages (no LLM).
 */
export function heuristicTimeline(messages: ThreadMessage[]): TimelineEvent[] {
  return messages.map((m) => {
    const timestamp =
      m.sentAt?.toISOString() ||
      m.receivedAt?.toISOString() ||
      new Date().toISOString();

    return {
      timestamp,
      messageId: m.id,
      actor: m.fromEmail,
      event: m.subject
        ? `Sent: ${m.subject}`
        : `Message from ${m.fromName || m.fromEmail}`,
      type: "message" as const,
    };
  });
}
