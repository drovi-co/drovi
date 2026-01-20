// =============================================================================
// BRIEF GENERATOR
// =============================================================================
//
// Generates 3-line thread summaries.
//

import { generateObject } from "ai";
import { observability } from "../../../observability";
import { getDefaultModel } from "../../../providers/index";
import { buildBriefPrompt } from "../prompts/summarization";
import {
  type ThreadBrief,
  ThreadBriefSchema,
  type ThreadMessage,
} from "../types";

/**
 * Generate a brief summary for a thread.
 */
export async function generateBrief(
  messages: ThreadMessage[],
  userEmail: string,
  subject: string | undefined
): Promise<ThreadBrief> {
  const trace = observability.trace({
    name: "brief-generator",
    metadata: { messageCount: messages.length, subject },
  });

  try {
    const prompt = buildBriefPrompt(messages, userEmail, subject);

    const result = await generateObject({
      model: getDefaultModel(),
      schema: ThreadBriefSchema,
      prompt,
      temperature: 0.4,
    });

    trace.generation({
      name: "generate-brief",
      model: "default",
      output: result.object,
    });

    return result.object;
  } catch (error) {
    console.error(
      "[generateBrief] Error:",
      error instanceof Error ? error.message : error
    );
    console.error(
      "[generateBrief] Stack:",
      error instanceof Error ? error.stack : ""
    );

    trace.generation({
      name: "generate-brief-error",
      model: "default",
      output: error instanceof Error ? error.message : "Unknown error",
      level: "ERROR",
    });

    // Return minimal fallback brief
    const participants = getParticipants(messages, userEmail);
    return {
      summary: subject || "Email thread",
      keyPoints: [],
      actionRequired: false,
      actionDescription: null,
      participants,
    };
  }
}

/**
 * Extract participants from messages (fallback for brief generation).
 */
function getParticipants(
  messages: ThreadMessage[],
  _userEmail: string
): ThreadBrief["participants"] {
  const participantMap = new Map<
    string,
    { name?: string; role: ThreadBrief["participants"][0]["role"] }
  >();

  // First message sender is initiator
  const firstMessage = messages[0];
  if (firstMessage) {
    participantMap.set(firstMessage.fromEmail, {
      name: firstMessage.fromName,
      role: "initiator",
    });
  }

  // Track responders and CC
  for (const message of messages.slice(1)) {
    if (!participantMap.has(message.fromEmail)) {
      participantMap.set(message.fromEmail, {
        name: message.fromName,
        role: "responder",
      });
    }

    for (const cc of message.ccRecipients || []) {
      if (!participantMap.has(cc.email)) {
        participantMap.set(cc.email, {
          name: cc.name,
          role: "cc",
        });
      }
    }
  }

  return Array.from(participantMap.entries()).map(([email, data]) => ({
    email,
    name: data.name ?? null,
    role: data.role,
  }));
}
