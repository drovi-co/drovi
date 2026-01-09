// =============================================================================
// THREAD TYPE DETECTOR
// =============================================================================
//
// Detects the structure type of email threads.
//

import { generateObject } from "ai";
import { observability } from "../../../observability";
import { getModel } from "../../../providers/index";
import { buildThreadTypePrompt } from "../prompts/classification";
import {
  type ThreadMessage,
  type ThreadTypeResult,
  ThreadTypeResultSchema,
} from "../types";

/**
 * Detect the type/structure of a thread.
 */
export async function detectThreadType(
  messages: ThreadMessage[],
  userEmail: string
): Promise<ThreadTypeResult> {
  // For simple cases, use heuristics
  const heuristic = heuristicThreadType(messages);
  if (heuristic.confidence >= 0.9) {
    return heuristic;
  }

  const trace = observability.trace({
    name: "thread-type-detector",
    metadata: { messageCount: messages.length },
  });

  try {
    const prompt = buildThreadTypePrompt(messages, userEmail);

    const result = await generateObject({
      model: getModel("anthropic", "claude-3-5-haiku-20241022"),
      schema: ThreadTypeResultSchema,
      prompt,
      temperature: 0.3,
    });

    trace.generation({
      name: "detect-thread-type",
      model: "claude-3-5-haiku",
      output: result.object,
    });

    return result.object;
  } catch (error) {
    trace.generation({
      name: "detect-thread-type-error",
      model: "claude-3-5-haiku",
      output: error instanceof Error ? error.message : "Unknown error",
      level: "ERROR",
    });

    // Return heuristic fallback
    return heuristic;
  }
}

/**
 * Heuristic thread type detection (fast, no LLM).
 */
export function heuristicThreadType(
  messages: ThreadMessage[]
): ThreadTypeResult {
  const participantEmails = new Set<string>();
  for (const m of messages) {
    participantEmails.add(m.fromEmail);
    for (const r of m.toRecipients) {
      participantEmails.add(r.email);
    }
    for (const r of m.ccRecipients || []) {
      participantEmails.add(r.email);
    }
  }

  const messageCount = messages.length;
  const participantCount = participantEmails.size;

  // Check for forwards
  const hasForward = messages.some(
    (m) =>
      m.bodyText?.includes("---------- Forwarded message") ||
      m.bodyText?.includes("Begin forwarded message") ||
      m.subject?.toLowerCase().startsWith("fwd:") ||
      m.subject?.toLowerCase().startsWith("fw:")
  );

  // Single message
  if (messageCount === 1) {
    return {
      type: "single_message",
      confidence: 1.0,
      messageCount,
      participantCount,
      hasForward,
    };
  }

  // Forward chain
  if (hasForward && messageCount <= 3) {
    return {
      type: "forward_chain",
      confidence: 0.8,
      messageCount,
      participantCount,
      hasForward: true,
    };
  }

  // Back and forth between 2 people
  if (participantCount === 2) {
    // Count alternations
    let alternations = 0;
    for (let i = 1; i < messages.length; i++) {
      const current = messages[i];
      const previous = messages[i - 1];
      if (current && previous && current.fromEmail !== previous.fromEmail) {
        alternations++;
      }
    }
    return {
      type: "back_and_forth",
      confidence: 0.9,
      messageCount,
      participantCount,
      backAndForthCount: alternations,
      hasForward,
    };
  }

  // Group discussion (many participants, multiple messages)
  if (participantCount > 3 && messageCount > 2) {
    return {
      type: "group_discussion",
      confidence: 0.7,
      messageCount,
      participantCount,
      hasForward,
    };
  }

  // Broadcast (one sender, many recipients)
  const senders = new Set(messages.map((m) => m.fromEmail));
  if (senders.size === 1 && participantCount > 3) {
    return {
      type: "broadcast",
      confidence: 0.8,
      messageCount,
      participantCount,
      hasForward,
    };
  }

  // Chain reply (many messages, growing participant list)
  if (messageCount > 3) {
    return {
      type: "chain_reply",
      confidence: 0.6,
      messageCount,
      participantCount,
      hasForward,
    };
  }

  // Default to back_and_forth with lower confidence
  return {
    type: "back_and_forth",
    confidence: 0.5,
    messageCount,
    participantCount,
    hasForward,
  };
}
