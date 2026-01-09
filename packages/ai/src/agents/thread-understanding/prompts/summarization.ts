// =============================================================================
// SUMMARIZATION PROMPTS
// =============================================================================
//
// Prompts for brief generation, timeline, open loops, and waiting-on analysis.
//

import type { ThreadMessage } from "../types";
import { formatMessagesForPrompt } from "./classification";

/**
 * Thread brief generation prompt.
 */
export const BRIEF_GENERATION_PROMPT = `You are generating a concise 3-line summary of an email thread.

The summary should answer:
1. WHAT is this thread about?
2. WHO are the key participants and what are their roles?
3. WHAT is the current state or what action is needed?

Thread:
{thread_content}

Context:
- User's email: {user_email}
- Thread subject: {subject}
- Total messages: {message_count}

Respond with JSON only:
{
  "summary": "<3 sentences maximum, clear and concise>",
  "keyPoints": [
    "<bullet point 1>",
    "<bullet point 2>",
    "<bullet point 3>"
  ],
  "actionRequired": true | false,
  "actionDescription": "<what action is needed if any>",
  "participants": [
    {
      "email": "<email>",
      "name": "<name if known>",
      "role": "initiator" | "responder" | "cc" | "key_participant"
    }
  ]
}`;

/**
 * Timeline generation prompt.
 */
export const TIMELINE_GENERATION_PROMPT = `You are creating a timeline of key events from an email thread.

Extract significant events in chronological order:
- Key messages and their purpose
- Decisions made
- Commitments/promises made
- Questions asked and answered
- Deadlines mentioned
- Any escalation or tone shifts

Thread:
{thread_content}

Message IDs and timestamps:
{message_timeline}

Respond with JSON only:
{
  "events": [
    {
      "timestamp": "<ISO datetime>",
      "messageId": "<message id>",
      "actor": "<email of person>",
      "event": "<description of what happened>",
      "type": "message" | "decision" | "commitment" | "question" | "answer" | "deadline" | "escalation"
    }
  ]
}`;

/**
 * Open loop detection prompt.
 */
export const OPEN_LOOP_DETECTION_PROMPT = `You are identifying "open loops" in an email thread.

Open loops are:
1. UNANSWERED QUESTIONS: Questions that were asked but never answered
2. PENDING REQUESTS: Requests made that haven't been confirmed as completed
3. UNFULFILLED PROMISES: Commitments made that aren't confirmed as done
4. AWAITING RESPONSE: Messages that seem to expect a reply but didn't get one

Thread:
{thread_content}

Message IDs for reference:
{message_ids}

User's email: {user_email}
Today's date: {current_date}

Identify all open loops and respond with JSON only:
{
  "openLoops": [
    {
      "type": "unanswered_question" | "pending_request" | "unfulfilled_promise" | "awaiting_response",
      "description": "<what is open/unresolved>",
      "owner": "<email of person who should resolve this>",
      "sourceMessageId": "<message where loop originated>",
      "sourceQuotedText": "<the specific text>",
      "age": <days since the loop was created, estimate from dates>,
      "priority": "low" | "medium" | "high"
    }
  ]
}`;

/**
 * Waiting-on analysis prompt.
 */
export const WAITING_ON_ANALYSIS_PROMPT = `You are analyzing who is waiting on whom in an email thread.

Determine:
1. Is the USER waiting on others? (others owe the user something)
2. Are OTHERS waiting on the user? (user owes others something)

For each waiting item, identify:
- Who is waiting
- What they are waiting for
- Since when (approximate date)

Thread:
{thread_content}

User's email: {user_email}
Today's date: {current_date}

Respond with JSON only:
{
  "isWaitingOnOthers": true | false,
  "isOthersWaitingOnUser": true | false,
  "waitingOn": [
    {
      "person": "<email of person user is waiting on>",
      "description": "<what user is waiting for>",
      "since": "<ISO date>"
    }
  ],
  "waitingFor": [
    {
      "person": "<email of person waiting on user>",
      "description": "<what they are waiting for from user>",
      "since": "<ISO date>"
    }
  ]
}`;

/**
 * Build brief generation prompt.
 */
export function buildBriefPrompt(
  messages: ThreadMessage[],
  userEmail: string,
  subject: string | undefined
): string {
  const content = formatMessagesForPrompt(messages, userEmail);
  return BRIEF_GENERATION_PROMPT.replace("{thread_content}", content)
    .replace("{user_email}", userEmail)
    .replace("{subject}", subject || "(no subject)")
    .replace("{message_count}", String(messages.length));
}

/**
 * Build timeline generation prompt.
 */
export function buildTimelinePrompt(
  messages: ThreadMessage[],
  userEmail: string
): string {
  const content = formatMessagesForPrompt(messages, userEmail);
  const messageTimeline = messages
    .map((m) => {
      const date = m.sentAt?.toISOString() || m.receivedAt?.toISOString() || "";
      return `${m.id}: ${date} from ${m.fromEmail}`;
    })
    .join("\n");

  return TIMELINE_GENERATION_PROMPT.replace(
    "{thread_content}",
    content
  ).replace("{message_timeline}", messageTimeline);
}

/**
 * Build open loop detection prompt.
 */
export function buildOpenLoopPrompt(
  messages: ThreadMessage[],
  userEmail: string
): string {
  const content = formatMessagesForPrompt(messages, userEmail);
  const messageIds = messages.map((m) => m.id).join(", ");
  const currentDate = new Date().toISOString().split("T")[0] ?? "";

  return OPEN_LOOP_DETECTION_PROMPT.replace("{thread_content}", content)
    .replace("{message_ids}", messageIds)
    .replace("{user_email}", userEmail)
    .replace("{current_date}", currentDate);
}

/**
 * Build waiting-on analysis prompt.
 */
export function buildWaitingOnPrompt(
  messages: ThreadMessage[],
  userEmail: string
): string {
  const content = formatMessagesForPrompt(messages, userEmail);
  const currentDate = new Date().toISOString().split("T")[0] ?? "";

  return WAITING_ON_ANALYSIS_PROMPT.replace("{thread_content}", content)
    .replace("{user_email}", userEmail)
    .replace("{current_date}", currentDate);
}
