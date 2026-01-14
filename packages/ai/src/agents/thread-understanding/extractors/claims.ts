// =============================================================================
// CLAIM EXTRACTOR
// =============================================================================
//
// Extracts facts, promises, requests, questions, and decisions from threads.
//

import { generateObject } from "ai";
import { z } from "zod";
import { observability } from "../../../observability";
import { getDefaultModel } from "../../../providers/index";
import {
  buildCombinedExtractionPrompt,
  buildDecisionPrompt,
  buildFactPrompt,
  buildPromisePrompt,
  buildQuestionPrompt,
  buildRequestPrompt,
} from "../prompts/extraction";
import {
  type DecisionClaim,
  DecisionClaimSchema,
  type ExtractedClaims,
  type FactClaim,
  FactClaimSchema,
  type PromiseClaim,
  PromiseClaimSchema,
  type QuestionClaim,
  QuestionClaimSchema,
  type RequestClaim,
  RequestClaimSchema,
  type ThreadMessage,
} from "../types";

// =============================================================================
// COMBINED EXTRACTION (RECOMMENDED)
// =============================================================================

/**
 * Schema for combined extraction response.
 */
const CombinedExtractionSchema = z.object({
  facts: z.array(FactClaimSchema),
  promises: z.array(PromiseClaimSchema),
  requests: z.array(RequestClaimSchema),
  questions: z.array(QuestionClaimSchema),
  decisions: z.array(DecisionClaimSchema),
});

/**
 * Extract all claim types in a single LLM call (more efficient).
 */
export async function extractAllClaims(
  messages: ThreadMessage[],
  userEmail: string,
  minConfidence = 0.5
): Promise<ExtractedClaims> {
  const trace = observability.trace({
    name: "claim-extractor-combined",
    metadata: { messageCount: messages.length },
  });

  try {
    const prompt = buildCombinedExtractionPrompt(messages, userEmail);

    const result = await generateObject({
      model: getDefaultModel(),
      schema: CombinedExtractionSchema,
      prompt,
      temperature: 0.2,
    });

    trace.generation({
      name: "extract-all-claims",
      model: "claude-3-5-sonnet",
      output: {
        facts: result.object.facts.length,
        promises: result.object.promises.length,
        requests: result.object.requests.length,
        questions: result.object.questions.length,
        decisions: result.object.decisions.length,
      },
    });

    // Filter by minimum confidence
    return {
      facts: result.object.facts.filter((c) => c.confidence >= minConfidence),
      promises: result.object.promises.filter(
        (c) => c.confidence >= minConfidence
      ),
      requests: result.object.requests.filter(
        (c) => c.confidence >= minConfidence
      ),
      questions: result.object.questions.filter(
        (c) => c.confidence >= minConfidence
      ),
      decisions: result.object.decisions.filter(
        (c) => c.confidence >= minConfidence
      ),
      other: [],
    };
  } catch (error) {
    console.error("[extractAllClaims] Error:", error instanceof Error ? error.message : error);
    console.error("[extractAllClaims] Stack:", error instanceof Error ? error.stack : "");

    trace.generation({
      name: "extract-all-claims-error",
      model: "claude-3-5-sonnet",
      output: error instanceof Error ? error.message : "Unknown error",
      level: "ERROR",
    });

    // Return empty claims
    return {
      facts: [],
      promises: [],
      requests: [],
      questions: [],
      decisions: [],
      other: [],
    };
  }
}

// =============================================================================
// INDIVIDUAL EXTRACTORS (FOR SPECIFIC NEEDS)
// =============================================================================

/**
 * Extract facts from thread.
 */
export async function extractFacts(
  messages: ThreadMessage[],
  userEmail: string
): Promise<FactClaim[]> {
  const trace = observability.trace({
    name: "fact-extractor",
    metadata: { messageCount: messages.length },
  });

  try {
    const prompt = buildFactPrompt(messages, userEmail);

    const result = await generateObject({
      model: getDefaultModel(),
      schema: z.object({ facts: z.array(FactClaimSchema) }),
      prompt,
      temperature: 0.2,
    });

    trace.generation({
      name: "extract-facts",
      model: "claude-3-5-haiku",
      output: { count: result.object.facts.length },
    });

    return result.object.facts;
  } catch (error) {
    trace.generation({
      name: "extract-facts-error",
      model: "claude-3-5-haiku",
      output: error instanceof Error ? error.message : "Unknown error",
      level: "ERROR",
    });
    return [];
  }
}

/**
 * Extract promises from thread.
 */
export async function extractPromises(
  messages: ThreadMessage[],
  userEmail: string
): Promise<PromiseClaim[]> {
  const trace = observability.trace({
    name: "promise-extractor",
    metadata: { messageCount: messages.length },
  });

  try {
    const prompt = buildPromisePrompt(messages, userEmail);

    const result = await generateObject({
      model: getDefaultModel(),
      schema: z.object({ promises: z.array(PromiseClaimSchema) }),
      prompt,
      temperature: 0.2,
    });

    trace.generation({
      name: "extract-promises",
      model: "claude-3-5-haiku",
      output: { count: result.object.promises.length },
    });

    return result.object.promises;
  } catch (error) {
    trace.generation({
      name: "extract-promises-error",
      model: "claude-3-5-haiku",
      output: error instanceof Error ? error.message : "Unknown error",
      level: "ERROR",
    });
    return [];
  }
}

/**
 * Extract requests from thread.
 */
export async function extractRequests(
  messages: ThreadMessage[],
  userEmail: string
): Promise<RequestClaim[]> {
  const trace = observability.trace({
    name: "request-extractor",
    metadata: { messageCount: messages.length },
  });

  try {
    const prompt = buildRequestPrompt(messages, userEmail);

    const result = await generateObject({
      model: getDefaultModel(),
      schema: z.object({ requests: z.array(RequestClaimSchema) }),
      prompt,
      temperature: 0.2,
    });

    trace.generation({
      name: "extract-requests",
      model: "claude-3-5-haiku",
      output: { count: result.object.requests.length },
    });

    return result.object.requests;
  } catch (error) {
    trace.generation({
      name: "extract-requests-error",
      model: "claude-3-5-haiku",
      output: error instanceof Error ? error.message : "Unknown error",
      level: "ERROR",
    });
    return [];
  }
}

/**
 * Extract questions from thread.
 */
export async function extractQuestions(
  messages: ThreadMessage[],
  userEmail: string
): Promise<QuestionClaim[]> {
  const trace = observability.trace({
    name: "question-extractor",
    metadata: { messageCount: messages.length },
  });

  try {
    const prompt = buildQuestionPrompt(messages, userEmail);

    const result = await generateObject({
      model: getDefaultModel(),
      schema: z.object({ questions: z.array(QuestionClaimSchema) }),
      prompt,
      temperature: 0.2,
    });

    trace.generation({
      name: "extract-questions",
      model: "claude-3-5-haiku",
      output: { count: result.object.questions.length },
    });

    return result.object.questions;
  } catch (error) {
    trace.generation({
      name: "extract-questions-error",
      model: "claude-3-5-haiku",
      output: error instanceof Error ? error.message : "Unknown error",
      level: "ERROR",
    });
    return [];
  }
}

/**
 * Extract decisions from thread.
 */
export async function extractDecisions(
  messages: ThreadMessage[],
  userEmail: string
): Promise<DecisionClaim[]> {
  const trace = observability.trace({
    name: "decision-extractor",
    metadata: { messageCount: messages.length },
  });

  try {
    const prompt = buildDecisionPrompt(messages, userEmail);

    const result = await generateObject({
      model: getDefaultModel(),
      schema: z.object({ decisions: z.array(DecisionClaimSchema) }),
      prompt,
      temperature: 0.2,
    });

    trace.generation({
      name: "extract-decisions",
      model: "claude-3-5-haiku",
      output: { count: result.object.decisions.length },
    });

    return result.object.decisions;
  } catch (error) {
    trace.generation({
      name: "extract-decisions-error",
      model: "claude-3-5-haiku",
      output: error instanceof Error ? error.message : "Unknown error",
      level: "ERROR",
    });
    return [];
  }
}

/**
 * Extract claims individually in parallel (alternative to combined).
 */
export async function extractClaimsParallel(
  messages: ThreadMessage[],
  userEmail: string
): Promise<ExtractedClaims> {
  const [facts, promises, requests, questions, decisions] = await Promise.all([
    extractFacts(messages, userEmail),
    extractPromises(messages, userEmail),
    extractRequests(messages, userEmail),
    extractQuestions(messages, userEmail),
    extractDecisions(messages, userEmail),
  ]);

  return {
    facts,
    promises,
    requests,
    questions,
    decisions,
    other: [],
  };
}
