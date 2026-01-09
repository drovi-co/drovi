// =============================================================================
// ANSWER GENERATION PROMPTS
// =============================================================================
//
// LLM prompts for generating answers with citations from retrieved evidence.
//

import { z } from "zod";

// =============================================================================
// SCHEMAS
// =============================================================================

/**
 * Evidence item for answer generation.
 */
export const EvidenceItemSchema = z.object({
  id: z.string(),
  type: z.enum(["message", "thread", "claim", "decision", "commitment"]),
  content: z.string(),
  metadata: z.object({
    threadId: z.string().optional(),
    threadSubject: z.string().optional(),
    messageDate: z.date().optional(),
    sender: z.string().optional(),
    claimType: z.string().optional(),
    confidence: z.number().optional(),
  }),
  relevanceScore: z.number(),
});

export type EvidenceItem = z.infer<typeof EvidenceItemSchema>;

/**
 * Citation in the answer.
 */
export const CitationSchema = z.object({
  id: z.string(),
  evidenceId: z.string(),
  text: z.string(),
  startIndex: z.number(),
  endIndex: z.number(),
});

export type Citation = z.infer<typeof CitationSchema>;

/**
 * Generated answer with citations.
 */
export const GeneratedAnswerSchema = z.object({
  answer: z.string(),
  citations: z.array(CitationSchema),
  confidence: z.number().min(0).max(1),
  followUpQuestions: z.array(z.string()).optional(),
  caveats: z.array(z.string()).optional(),
});

export type GeneratedAnswer = z.infer<typeof GeneratedAnswerSchema>;

// =============================================================================
// PROMPTS
// =============================================================================

/**
 * Build the answer generation system prompt.
 */
export function buildAnswerGenerationSystemPrompt(): string {
  return `You are an expert assistant that answers questions based on email evidence.

Your task is to:
1. Analyze the provided evidence (email messages, claims, decisions, commitments)
2. Generate a comprehensive answer to the user's question
3. Cite your sources using [1], [2], etc. references
4. Express appropriate uncertainty when evidence is incomplete

## Guidelines

### Accuracy
- Only make claims that are directly supported by the evidence
- If you're uncertain, say so explicitly
- Don't extrapolate beyond what the evidence shows

### Citations
- Every factual claim should have a citation
- Use [1], [2], etc. to reference evidence
- Multiple citations can support the same claim: [1][3]

### Completeness
- Address all aspects of the user's question
- If evidence is missing for some parts, acknowledge this
- Suggest follow-up questions if the query could be refined

### Tone
- Be professional and concise
- Use bullet points for lists
- Highlight key information

## Response Format
Provide a JSON response with:
- answer: The full answer with inline citations
- citations: Array mapping citation numbers to evidence IDs
- confidence: Overall confidence (0-1) in the answer
- followUpQuestions: Optional suggestions for related queries
- caveats: Any important limitations or caveats`;
}

/**
 * Build the answer generation user prompt.
 */
export function buildAnswerGenerationUserPrompt(
  query: string,
  evidence: EvidenceItem[]
): string {
  const evidenceText = evidence
    .map((e, i) => {
      const parts = [`[Evidence ${i + 1}]`];
      parts.push(`Type: ${e.type}`);

      if (e.metadata.threadSubject) {
        parts.push(`Subject: ${e.metadata.threadSubject}`);
      }
      if (e.metadata.sender) {
        parts.push(`From: ${e.metadata.sender}`);
      }
      if (e.metadata.messageDate) {
        parts.push(
          `Date: ${e.metadata.messageDate.toISOString().split("T")[0]}`
        );
      }
      if (e.metadata.claimType) {
        parts.push(`Claim Type: ${e.metadata.claimType}`);
      }

      parts.push(`Content: ${e.content}`);
      parts.push(`Relevance: ${(e.relevanceScore * 100).toFixed(0)}%`);

      return parts.join("\n");
    })
    .join("\n\n---\n\n");

  return `Question: "${query}"

## Available Evidence

${evidenceText}

## Task

Based on the evidence above, provide a comprehensive answer to the question.

Remember to:
1. Cite evidence using [1], [2], etc.
2. Express uncertainty if evidence is incomplete
3. Be concise but thorough

Respond with JSON:
{
  "answer": "Your answer with [1] style citations",
  "citations": [
    {
      "id": "unique-id",
      "evidenceId": "evidence-id-from-above",
      "text": "the cited portion of the answer",
      "startIndex": 0,
      "endIndex": 50
    }
  ],
  "confidence": 0.85,
  "followUpQuestions": ["Optional follow-up question 1", "..."],
  "caveats": ["Any important limitations", "..."]
}`;
}

// =============================================================================
// SPECIALIZED PROMPTS
// =============================================================================

/**
 * Build prompt for answering decision-related questions.
 */
export function buildDecisionAnswerPrompt(
  query: string,
  decisions: EvidenceItem[]
): string {
  const decisionText = decisions
    .map((d, i) => {
      return `[Decision ${i + 1}]
Subject: ${d.metadata.threadSubject ?? "Unknown"}
Date: ${d.metadata.messageDate?.toISOString().split("T")[0] ?? "Unknown"}
Decision: ${d.content}
Confidence: ${((d.metadata.confidence ?? 0) * 100).toFixed(0)}%
Relevance: ${(d.relevanceScore * 100).toFixed(0)}%`;
    })
    .join("\n\n");

  return `Question about decisions: "${query}"

## Relevant Decisions

${decisionText}

## Task

Synthesize the relevant decisions and answer the question. If decisions contradict or supersede each other, explain the timeline and current state.

Include:
1. The final/current decision (if applicable)
2. The rationale behind the decision
3. Any alternatives that were considered
4. Key participants in the decision

Respond with JSON matching the standard answer format with citations.`;
}

/**
 * Build prompt for answering commitment-related questions.
 */
export function buildCommitmentAnswerPrompt(
  query: string,
  commitments: EvidenceItem[]
): string {
  const commitmentText = commitments
    .map((c, i) => {
      return `[Commitment ${i + 1}]
Subject: ${c.metadata.threadSubject ?? "Unknown"}
Date: ${c.metadata.messageDate?.toISOString().split("T")[0] ?? "Unknown"}
Commitment: ${c.content}
Relevance: ${(c.relevanceScore * 100).toFixed(0)}%`;
    })
    .join("\n\n");

  return `Question about commitments: "${query}"

## Relevant Commitments

${commitmentText}

## Task

Analyze the commitments and answer the question. Include:
1. Open/pending commitments
2. Status of each commitment (if known)
3. Due dates or deadlines
4. Who made the commitment and to whom

Respond with JSON matching the standard answer format with citations.`;
}

/**
 * Build prompt for summarizing a topic.
 */
export function buildTopicSummaryPrompt(
  topic: string,
  evidence: EvidenceItem[]
): string {
  const evidenceText = evidence
    .map((e, i) => {
      return `[${i + 1}] (${e.type}, ${e.metadata.messageDate?.toISOString().split("T")[0] ?? "Unknown"})
${e.content.slice(0, 500)}...`;
    })
    .join("\n\n");

  return `Topic to summarize: "${topic}"

## Related Evidence

${evidenceText}

## Task

Provide a comprehensive summary of this topic based on the email evidence. Include:
1. Key points and main themes
2. Timeline of important events
3. Key people involved
4. Current status or outcome
5. Any open questions or unresolved issues

Respond with JSON matching the standard answer format, but structure the answer as a summary.`;
}

// =============================================================================
// NO ANSWER PROMPT
// =============================================================================

/**
 * Build prompt for generating a "no answer found" response.
 */
export function buildNoAnswerPrompt(query: string): string {
  return `The user asked: "${query}"

Unfortunately, no relevant evidence was found in the email archive to answer this question.

Generate a helpful response that:
1. Acknowledges the question couldn't be answered from available emails
2. Suggests possible reasons (e.g., topic not discussed via email, different keywords, time range)
3. Offers alternative queries that might work better
4. Suggests other places to look for this information

Respond with JSON:
{
  "answer": "A helpful message explaining why no answer was found",
  "citations": [],
  "confidence": 0,
  "followUpQuestions": ["Alternative queries to try"],
  "caveats": ["Why the search might have missed relevant emails"]
}`;
}

// =============================================================================
// RESPONSE SCHEMAS
// =============================================================================

export const AnswerGenerationResponseSchema = GeneratedAnswerSchema;
