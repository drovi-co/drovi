// =============================================================================
// COMMITMENT EXTRACTION PROMPTS
// =============================================================================
//
// Prompts for extracting commitments from promise and request claims.
//

import type {
  CommitmentThreadContext,
  PromiseClaimInput,
  RequestClaimInput,
} from "../types";

/**
 * Format messages for commitment extraction context.
 */
export function formatMessagesForCommitment(
  context: CommitmentThreadContext
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
 * Format promise claims for extraction.
 */
export function formatPromiseClaims(claims: PromiseClaimInput[]): string {
  return claims
    .map(
      (c, i) => `Promise ${i + 1}:
  Text: "${c.text}"
  Promisor: ${c.promisor || "unknown"}
  Promisee: ${c.promisee || "unknown"}
  Deadline mentioned: ${c.deadline || "none"}
  Conditional: ${c.isConditional ? `Yes - "${c.condition}"` : "No"}
  Confidence: ${c.confidence}`
    )
    .join("\n\n");
}

/**
 * Format request claims for extraction.
 */
export function formatRequestClaims(claims: RequestClaimInput[]): string {
  return claims
    .map(
      (c, i) => `Request ${i + 1}:
  Text: "${c.text}"
  Requester: ${c.requester || "unknown"}
  Requestee: ${c.requestee || "unknown"}
  Deadline mentioned: ${c.deadline || "none"}
  Priority: ${c.priority || "unknown"}
  Explicit: ${c.isExplicit ? "Yes" : "No"}
  Confidence: ${c.confidence}`
    )
    .join("\n\n");
}

/**
 * Commitment extraction prompt.
 */
export const COMMITMENT_EXTRACTION_PROMPT = `You are analyzing email thread claims to extract actionable commitments.

Your task is to convert PROMISES and REQUESTS into trackable commitments with clear ownership and deadlines.

## User Context
- User email: {user_email}
- Today's date: {current_date}

## Promise Claims
{promise_claims}

## Request Claims
{request_claims}

## Thread Context
{thread_context}

## Instructions

For each promise or request that represents a genuine commitment:

1. **Title**: Create a short, actionable title (e.g., "Send Q4 report", "Review contract")

2. **Parties**:
   - Debtor: Who owes the commitment (must fulfill it)
   - Creditor: Who is owed the commitment (expects fulfillment)
   - Use email addresses when available

3. **Due Date**:
   - Parse explicit dates ("by Friday", "March 15th")
   - Handle relative dates ("next week", "in 3 days") based on message date
   - Mark confidence based on clarity

4. **Priority**: Infer from urgency language
   - urgent: "ASAP", "immediately", "critical"
   - high: "important", "priority", explicit short deadline
   - medium: normal requests, reasonable deadlines
   - low: "when you get a chance", "no rush"

5. **Conditional**: Mark if commitment depends on something else

## What to INCLUDE as commitments:
- Clear promises ("I'll send...", "We will deliver...")
- Accepted requests (request + acknowledgment)
- Explicit task assignments
- Volunteered actions

## What to EXCLUDE:
- Vague intentions without clear deliverable
- Questions without commitment
- Past actions already completed
- Rhetorical or hypothetical promises

Respond with JSON only:
{
  "commitments": [
    {
      "title": "<actionable title>",
      "description": "<optional details>",
      "debtorEmail": "<email or null>",
      "debtorName": "<name or null>",
      "creditorEmail": "<email or null>",
      "creditorName": "<name or null>",
      "dueDateText": "<original text mentioning date>",
      "dueDate": "<ISO date if determinable>",
      "dueDateConfidence": <0.0-1.0>,
      "priority": "low" | "medium" | "high" | "urgent",
      "isConditional": true | false,
      "condition": "<condition if applicable>",
      "confidence": <0.0-1.0>,
      "reasoning": "<why this is a commitment>"
    }
  ]
}`;

/**
 * Build commitment extraction prompt.
 */
export function buildCommitmentExtractionPrompt(
  context: CommitmentThreadContext,
  promiseClaims: PromiseClaimInput[],
  requestClaims: RequestClaimInput[]
): string {
  const threadContent = formatMessagesForCommitment(context);
  const promises = formatPromiseClaims(promiseClaims);
  const requests = formatRequestClaims(requestClaims);
  const currentDate = new Date().toISOString().split("T")[0] ?? "";

  return COMMITMENT_EXTRACTION_PROMPT.replace("{user_email}", context.userEmail)
    .replace("{current_date}", currentDate)
    .replace("{promise_claims}", promises || "None")
    .replace("{request_claims}", requests || "None")
    .replace("{thread_context}", threadContent);
}

/**
 * Status detection prompt.
 */
export const STATUS_DETECTION_PROMPT = `You are analyzing new messages in an email thread to detect commitment status changes.

## Existing Commitments
{existing_commitments}

## New Messages
{new_messages}

## Instructions

Look for signals that indicate status changes:

### Completion signals:
- "Done", "Completed", "Sent", "Finished"
- Delivery of promised item (attachment, link)
- Confirmation of receipt

### Cancellation signals:
- "Never mind", "No longer needed", "Cancelled"
- Explicit withdrawal

### Progress signals:
- "Working on it", "In progress", "Started"
- Partial delivery

### Waiting signals:
- "Blocked by...", "Waiting for..."
- Dependency on external factor

For each status change detected, provide evidence from the message.

Respond with JSON only:
{
  "statusChanges": [
    {
      "commitmentTitle": "<which commitment>",
      "newStatus": "pending" | "in_progress" | "completed" | "cancelled" | "waiting",
      "reason": "<why status changed>",
      "confidence": <0.0-1.0>,
      "evidenceQuote": "<relevant quote from message>"
    }
  ]
}`;

/**
 * Build status detection prompt.
 */
export function buildStatusDetectionPrompt(
  existingCommitments: Array<{ title: string; status: string; dueDate?: Date }>,
  newMessages: Array<{
    fromEmail: string;
    bodyText?: string;
    sentAt?: Date;
  }>
): string {
  const commitments = existingCommitments
    .map(
      (c) =>
        `- "${c.title}" (status: ${c.status}${c.dueDate ? `, due: ${c.dueDate.toISOString().split("T")[0]}` : ""})`
    )
    .join("\n");

  const messages = newMessages
    .map((m, i) => {
      const date = m.sentAt?.toISOString() || "";
      return `Message ${i + 1} from ${m.fromEmail} (${date}):\n${m.bodyText?.slice(0, 1000) || ""}`;
    })
    .join("\n\n");

  return STATUS_DETECTION_PROMPT.replace(
    "{existing_commitments}",
    commitments || "None"
  ).replace("{new_messages}", messages);
}

/**
 * Follow-up generation prompt.
 */
export const FOLLOWUP_GENERATION_PROMPT = `You are generating a follow-up email for an overdue commitment.

## Commitment Details
Title: {commitment_title}
Description: {commitment_description}
Due Date: {due_date}
Days Overdue: {days_overdue}
Owed By: {debtor_name} ({debtor_email})
Previous Reminders: {reminder_count}

## Original Context
{original_context}

## Relationship Context
Communication frequency: {communication_frequency}
Last interaction: {last_interaction}

## Instructions

Generate a follow-up email that:
1. Is {tone} in tone
2. References the original commitment
3. Provides context without being accusatory
4. Has a clear ask

Tone guidelines:
- friendly: Casual, assumes good intent, uses soft language
- professional: Business-appropriate, factual, polite
- urgent: Direct, emphasizes importance, requests immediate response

Respond with JSON only:
{
  "subject": "<email subject line>",
  "body": "<email body>",
  "tone": "friendly" | "professional" | "urgent"
}`;

/**
 * Build follow-up generation prompt.
 */
export function buildFollowUpPrompt(
  commitment: {
    title: string;
    description?: string;
    dueDate?: Date;
    debtorName?: string;
    debtorEmail?: string;
  },
  daysOverdue: number,
  reminderCount: number,
  tone: "friendly" | "professional" | "urgent",
  originalContext?: string
): string {
  return FOLLOWUP_GENERATION_PROMPT.replace(
    "{commitment_title}",
    commitment.title
  )
    .replace("{commitment_description}", commitment.description || "N/A")
    .replace(
      "{due_date}",
      commitment.dueDate?.toISOString().split("T")[0] ?? "Not specified"
    )
    .replace("{days_overdue}", String(daysOverdue))
    .replace("{debtor_name}", commitment.debtorName || "Unknown")
    .replace("{debtor_email}", commitment.debtorEmail || "Unknown")
    .replace("{reminder_count}", String(reminderCount))
    .replace("{original_context}", originalContext || "Not available")
    .replace("{communication_frequency}", "Unknown")
    .replace("{last_interaction}", "Unknown")
    .replace("{tone}", tone);
}
