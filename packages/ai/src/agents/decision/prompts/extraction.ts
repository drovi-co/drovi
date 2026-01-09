// =============================================================================
// DECISION EXTRACTION PROMPTS
// =============================================================================
//
// Prompts for extracting decisions, rationale, and detecting supersession.
//

import type { DecisionClaimInput, DecisionThreadContext } from "../types";

/**
 * Format messages for decision extraction context.
 */
export function formatMessagesForDecision(
  context: DecisionThreadContext
): string {
  return context.messages
    .map((m, i) => {
      const isUser = m.isFromUser;
      const from = m.fromName ? `${m.fromName} <${m.fromEmail}>` : m.fromEmail;
      const date = m.sentAt?.toISOString() || "";
      const body = m.bodyText?.slice(0, 1500) || "";

      return `--- Message ${i + 1} ${isUser ? "[FROM USER]" : ""} ---
From: ${from}
Date: ${date}

${body}`;
    })
    .join("\n\n");
}

/**
 * Format decision claims for extraction.
 */
export function formatDecisionClaims(claims: DecisionClaimInput[]): string {
  return claims
    .map(
      (c, i) => `Decision Claim ${i + 1}:
  Text: "${c.text}"
  Decision: ${c.decision || "not specified"}
  Decision Maker: ${c.decisionMaker || "unknown"}
  Rationale: ${c.rationale || "none provided"}
  Alternatives: ${c.alternatives?.join(", ") || "none mentioned"}
  Confidence: ${c.confidence}`
    )
    .join("\n\n");
}

/**
 * Decision extraction prompt.
 */
export const DECISION_EXTRACTION_PROMPT = `You are analyzing email thread claims to extract actionable decisions with context.

Your task is to identify DECISIONS that should be recorded for future reference.

## User Context
- User email: {user_email}
- Today's date: {current_date}

## Decision Claims
{decision_claims}

## Thread Context
{thread_context}

## Instructions

For each genuine decision in the claims:

1. **Title**: Create a short, descriptive title (e.g., "Use Stripe for payments", "Quarterly release schedule")

2. **Statement**: The actual decision - what was decided
   - Should be clear and actionable
   - "We will use X" not "We might consider X"

3. **Rationale**: Why this decision was made
   - Look for reasoning in the thread
   - "Because...", "Since...", "Given that..."
   - Include trade-offs mentioned

4. **Alternatives**: Other options that were considered
   - "We could also...", "Another option was..."
   - Include pros/cons if discussed
   - Note why they were rejected

5. **Decision Maker**: Who made or approved the decision
   - Look for "I decided", "Approved by", "Let's go with"
   - May be group consensus

6. **Timing**: When the decision was made
   - Use the message date where decision was stated

## What to INCLUDE as decisions:
- Clear choices between alternatives ("Let's use Stripe")
- Approvals ("Approved", "Go ahead", "I agree")
- Policy/process decisions ("We'll release quarterly")
- Strategic choices ("Focus on enterprise first")

## What to EXCLUDE:
- Tentative suggestions without agreement
- Questions about what to decide
- Future plans without commitment
- Personal opinions without decision

## Confidence guidance:
- 0.9+: Explicit "we decided", "the decision is"
- 0.7-0.9: Clear agreement reached
- 0.5-0.7: Implicit decision from context
- <0.5: Uncertain, may need confirmation

Respond with JSON only:
{
  "decisions": [
    {
      "title": "<descriptive title>",
      "statement": "<what was decided>",
      "rationale": "<why, if available>",
      "topic": "<topic area>",
      "impactAreas": ["<affected areas>"],
      "alternatives": [
        {
          "title": "<option name>",
          "description": "<what it was>",
          "pros": ["<advantages>"],
          "cons": ["<disadvantages>"],
          "rejectionReason": "<why not chosen>"
        }
      ],
      "decisionMakerEmail": "<email or null>",
      "decisionMakerName": "<name or null>",
      "participantEmails": ["<other participants>"],
      "decidedAt": "<ISO date>",
      "isExplicit": true | false,
      "isTentative": true | false,
      "confidence": <0.0-1.0>,
      "reasoning": "<why this is a decision>"
    }
  ]
}`;

/**
 * Build decision extraction prompt.
 */
export function buildDecisionExtractionPrompt(
  context: DecisionThreadContext,
  decisionClaims: DecisionClaimInput[]
): string {
  const threadContent = formatMessagesForDecision(context);
  const claims = formatDecisionClaims(decisionClaims);
  const currentDate = new Date().toISOString().split("T")[0] ?? "";

  return DECISION_EXTRACTION_PROMPT.replace("{user_email}", context.userEmail)
    .replace("{current_date}", currentDate)
    .replace("{decision_claims}", claims || "None")
    .replace("{thread_context}", threadContent);
}

/**
 * Rationale extraction prompt (for deeper analysis).
 */
export const RATIONALE_EXTRACTION_PROMPT = `You are analyzing an email thread to extract the rationale behind a decision.

## The Decision
Title: {decision_title}
Statement: {decision_statement}

## Thread Context
{thread_context}

## Instructions

Find and extract the reasoning behind this decision:

1. Look for explicit rationale:
   - "Because...", "The reason is...", "Given that..."
   - Comparisons with alternatives
   - References to requirements or constraints

2. Look for implicit rationale:
   - Problems being solved
   - Goals mentioned
   - Constraints or limitations discussed

3. Find supporting evidence:
   - Quotes from messages that support the rationale
   - Data or facts referenced

Respond with JSON only:
{
  "rationale": "<complete reasoning for the decision>",
  "supportingEvidence": ["<quote 1>", "<quote 2>"],
  "confidence": <0.0-1.0>,
  "isExplicit": true | false
}`;

/**
 * Build rationale extraction prompt.
 */
export function buildRationaleExtractionPrompt(
  decision: { title: string; statement: string },
  threadContext: string
): string {
  return RATIONALE_EXTRACTION_PROMPT.replace("{decision_title}", decision.title)
    .replace("{decision_statement}", decision.statement)
    .replace("{thread_context}", threadContext);
}

/**
 * Supersession detection prompt.
 */
export const SUPERSESSION_DETECTION_PROMPT = `You are analyzing whether a new decision supersedes existing decisions.

## New Decision
Title: {new_decision_title}
Statement: {new_decision_statement}
Topic: {new_decision_topic}
Date: {new_decision_date}

## Existing Decisions (on similar topics)
{existing_decisions}

## Instructions

Determine if the new decision:
1. Reverses a previous decision (complete change)
2. Modifies/evolves a previous decision (refinement)
3. Is independent (no relationship)

For each supersession:
- Identify which old decision is affected
- Explain why it's superseded
- Note if it's a reversal or evolution

Respond with JSON only:
{
  "supersessions": [
    {
      "oldDecisionTitle": "<title of superseded decision>",
      "newDecisionTitle": "<title of new decision>",
      "reason": "<why the old decision is superseded>",
      "isReversal": true | false,
      "confidence": <0.0-1.0>
    }
  ]
}`;

/**
 * Build supersession detection prompt.
 */
export function buildSupersessionPrompt(
  newDecision: {
    title: string;
    statement: string;
    topic?: string;
    decidedAt: string;
  },
  existingDecisions: Array<{
    id: string;
    title: string;
    statement: string;
    decidedAt: Date;
  }>
): string {
  const existing = existingDecisions
    .map(
      (d) =>
        `- "${d.title}": ${d.statement} (decided: ${d.decidedAt.toISOString().split("T")[0]})`
    )
    .join("\n");

  return SUPERSESSION_DETECTION_PROMPT.replace(
    "{new_decision_title}",
    newDecision.title
  )
    .replace("{new_decision_statement}", newDecision.statement)
    .replace("{new_decision_topic}", newDecision.topic || "unspecified")
    .replace("{new_decision_date}", newDecision.decidedAt)
    .replace("{existing_decisions}", existing || "None");
}

/**
 * Decision query prompt.
 */
export const DECISION_QUERY_PROMPT = `You are answering a question about past decisions.

## Question
{query}

## Relevant Decisions
{decisions}

## Instructions

Based on the decisions provided:
1. Identify which decisions are most relevant to the question
2. Score their relevance (0-1)
3. Summarize key points relevant to the query
4. If possible, provide a direct answer

Respond with JSON only:
{
  "relevantDecisions": [
    {
      "title": "<decision title>",
      "relevance": <0.0-1.0>,
      "summary": "<brief summary>",
      "keyPoints": ["<relevant point 1>", "<relevant point 2>"]
    }
  ],
  "answer": "<direct answer if applicable>"
}`;

/**
 * Build decision query prompt.
 */
export function buildDecisionQueryPrompt(
  query: string,
  decisions: Array<{
    id: string;
    title: string;
    statement: string;
    rationale?: string;
    decidedAt: Date;
  }>
): string {
  const decisionList = decisions
    .map(
      (d) =>
        `Decision: "${d.title}"
  Statement: ${d.statement}
  Rationale: ${d.rationale || "Not recorded"}
  Decided: ${d.decidedAt.toISOString().split("T")[0]}`
    )
    .join("\n\n");

  return DECISION_QUERY_PROMPT.replace("{query}", query).replace(
    "{decisions}",
    decisionList || "No decisions found"
  );
}
