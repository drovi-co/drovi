// =============================================================================
// SENTIMENT ANALYZER
// =============================================================================
//
// Analyzes sentiment across thread messages, detecting escalation.
//

import { generateObject } from "ai";
import { observability } from "../../../observability";
import { getDefaultModel } from "../../../providers/index";
import { buildSentimentPrompt } from "../prompts/classification";
import {
  type SentimentAnalysis,
  SentimentAnalysisSchema,
  type ThreadMessage,
} from "../types";

/**
 * Analyze sentiment across a thread.
 */
export async function analyzeSentiment(
  messages: ThreadMessage[],
  userEmail: string
): Promise<SentimentAnalysis> {
  const trace = observability.trace({
    name: "sentiment-analyzer",
    metadata: { messageCount: messages.length },
  });

  try {
    const prompt = buildSentimentPrompt(messages, userEmail);

    const result = await generateObject({
      model: getDefaultModel(),
      schema: SentimentAnalysisSchema,
      prompt,
      temperature: 0.3,
    });

    trace.generation({
      name: "analyze-sentiment",
      model: "claude-3-5-haiku",
      output: result.object,
    });

    return result.object;
  } catch (error) {
    trace.generation({
      name: "analyze-sentiment-error",
      model: "claude-3-5-haiku",
      output: error instanceof Error ? error.message : "Unknown error",
      level: "ERROR",
    });

    // Return fallback with neutral sentiment
    return {
      overall: 0,
      trend: "stable",
      messages: messages.map((m) => ({
        messageId: m.id,
        sentiment: 0,
        dominant_emotion: "neutral" as const,
      })),
      escalationDetected: false,
    };
  }
}

/**
 * Calculate sentiment trend from message scores.
 */
export function calculateSentimentTrend(
  messageSentiments: Array<{ sentiment: number }>
): "improving" | "stable" | "declining" | "volatile" {
  if (messageSentiments.length < 2) {
    return "stable";
  }

  const scores = messageSentiments.map((m) => m.sentiment);
  const firstHalf = scores.slice(0, Math.floor(scores.length / 2));
  const secondHalf = scores.slice(Math.floor(scores.length / 2));

  const firstAvg = firstHalf.reduce((a, b) => a + b, 0) / firstHalf.length;
  const secondAvg = secondHalf.reduce((a, b) => a + b, 0) / secondHalf.length;

  // Calculate variance for volatility check
  const variance =
    scores.reduce((sum, s) => sum + (s - (firstAvg + secondAvg) / 2) ** 2, 0) /
    scores.length;

  if (variance > 0.3) {
    return "volatile";
  }
  if (secondAvg - firstAvg > 0.2) {
    return "improving";
  }
  if (firstAvg - secondAvg > 0.2) {
    return "declining";
  }
  return "stable";
}

/**
 * Quick heuristic sentiment check (without LLM).
 * Useful for pre-filtering or fallback.
 */
export function quickSentimentCheck(messages: ThreadMessage[]): {
  hasNegativeSignals: boolean;
  hasPositiveSignals: boolean;
  signals: string[];
} {
  const negativePatterns = [
    /frustrated/i,
    /disappointed/i,
    /unacceptable/i,
    /angry/i,
    /upset/i,
    /concerned/i,
    /issue/i,
    /problem/i,
    /complaint/i,
    /escalat/i,
  ];

  const positivePatterns = [
    /thank/i,
    /appreciate/i,
    /great/i,
    /excellent/i,
    /happy/i,
    /pleased/i,
    /wonderful/i,
    /perfect/i,
  ];

  const signals: string[] = [];
  let hasNegativeSignals = false;
  let hasPositiveSignals = false;

  for (const message of messages) {
    const text = message.bodyText || "";

    for (const pattern of negativePatterns) {
      if (pattern.test(text)) {
        hasNegativeSignals = true;
        const match = text.match(pattern);
        if (match) {
          signals.push(`negative: ${match[0]}`);
        }
      }
    }

    for (const pattern of positivePatterns) {
      if (pattern.test(text)) {
        hasPositiveSignals = true;
        const match = text.match(pattern);
        if (match) {
          signals.push(`positive: ${match[0]}`);
        }
      }
    }
  }

  return {
    hasNegativeSignals,
    hasPositiveSignals,
    signals: [...new Set(signals)],
  };
}
