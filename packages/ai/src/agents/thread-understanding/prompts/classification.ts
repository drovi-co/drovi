// =============================================================================
// CLASSIFICATION PROMPTS
// =============================================================================
//
// Prompts for thread classification: intent, urgency, sentiment, thread type.
//

import type { ThreadMessage } from "../types";

/**
 * Format messages for LLM input.
 */
export function formatMessagesForPrompt(
  messages: ThreadMessage[],
  userEmail: string
): string {
  return messages
    .map((m, i) => {
      const isUser = m.fromEmail === userEmail || m.isFromUser;
      const from = m.fromName ? `${m.fromName} <${m.fromEmail}>` : m.fromEmail;
      const to = m.toRecipients.map((r) => r.email).join(", ");
      const date = m.sentAt?.toISOString() || m.receivedAt?.toISOString() || "";
      const body = m.bodyText?.slice(0, 2000) || "";

      return `--- Message ${i + 1} ${isUser ? "[FROM USER]" : ""} ---
From: ${from}
To: ${to}
Date: ${date}
${m.subject ? `Subject: ${m.subject}` : ""}

${body}`;
    })
    .join("\n\n");
}

/**
 * Intent classification prompt.
 */
export const INTENT_CLASSIFICATION_PROMPT = `You are analyzing an email thread to determine its primary intent.

Your task is to classify the thread into ONE primary category based on the overall purpose of the conversation.

Categories:
- approval_request: Seeking approval, sign-off, or permission
- negotiation: Back-and-forth discussion on terms, pricing, or details
- scheduling: Arranging meetings, calls, or events
- information_sharing: Sharing updates, reports, or information
- question: Asking for information or clarification
- task_assignment: Assigning work or responsibilities to someone
- feedback: Providing or requesting feedback on work
- complaint: Expressing dissatisfaction or reporting issues
- follow_up: Following up on previous communication or tasks
- introduction: Introducing people or making connections
- thank_you: Expressing gratitude or appreciation
- other: Doesn't fit other categories

Thread:
{thread_content}

Analyze the thread and respond with JSON only:
{
  "intent": "<category>",
  "confidence": <0.0-1.0>,
  "reasoning": "<brief explanation of why this intent>",
  "secondaryIntents": ["<optional secondary intents>"]
}`;

/**
 * Urgency scoring prompt.
 */
export const URGENCY_SCORING_PROMPT = `You are analyzing an email thread to determine its urgency level.

Consider these signals:
1. Explicit deadlines ("by Friday", "ASAP", "urgent")
2. Urgency language ("immediately", "critical", "time-sensitive")
3. Escalation indicators ("following up again", "second request")
4. Time-sensitive context (events, meetings, opportunities)
5. Sender importance and relationship

Thread:
{thread_content}

Today's date: {current_date}

Analyze the thread and respond with JSON only:
{
  "score": <0.0-1.0>,
  "level": "low" | "medium" | "high" | "urgent",
  "reasoning": "<brief explanation>",
  "signals": [
    {
      "type": "explicit_deadline" | "urgency_language" | "sender_importance" | "time_sensitive" | "escalation",
      "text": "<quoted text if applicable>",
      "weight": <0.0-1.0>
    }
  ]
}

Score guidelines:
- 0.0-0.3: Low urgency (informational, no deadlines)
- 0.3-0.6: Medium urgency (soft deadlines, normal priority)
- 0.6-0.8: High urgency (explicit deadlines, important sender)
- 0.8-1.0: Urgent (immediate action needed, escalated)`;

/**
 * Sentiment analysis prompt.
 */
export const SENTIMENT_ANALYSIS_PROMPT = `You are analyzing the sentiment across an email thread conversation.

Your task is to:
1. Score overall thread sentiment (-1 to 1)
2. Score each message individually
3. Detect if sentiment is escalating (getting more negative)
4. Identify dominant emotions

Sentiment scale:
- -1.0: Very negative (angry, hostile)
- -0.5: Negative (frustrated, disappointed)
- 0.0: Neutral (professional, factual)
- 0.5: Positive (friendly, appreciative)
- 1.0: Very positive (enthusiastic, grateful)

Thread:
{thread_content}

Message IDs for reference:
{message_ids}

Respond with JSON only:
{
  "overall": <-1.0 to 1.0>,
  "trend": "improving" | "stable" | "declining" | "volatile",
  "messages": [
    {
      "messageId": "<id>",
      "sentiment": <-1.0 to 1.0>,
      "dominant_emotion": "neutral" | "positive" | "negative" | "frustrated" | "appreciative" | "urgent" | "confused"
    }
  ],
  "escalationDetected": true | false,
  "escalationReason": "<if detected, explain why>"
}`;

/**
 * Thread type detection prompt.
 */
export const THREAD_TYPE_PROMPT = `You are analyzing the structure of an email thread.

Thread types:
- single_message: Only one message, no replies
- back_and_forth: Two-way conversation between primarily 2 people
- broadcast: One-to-many communication (newsletters, announcements)
- chain_reply: Long reply chain, multiple participants
- forward_chain: Thread built from forwards
- group_discussion: Multiple people actively discussing

Thread:
{thread_content}

Message count: {message_count}
Unique participants: {participant_count}

Respond with JSON only:
{
  "type": "<thread_type>",
  "confidence": <0.0-1.0>,
  "messageCount": <number>,
  "participantCount": <number>,
  "backAndForthCount": <number of back-and-forth exchanges if applicable>,
  "hasForward": true | false
}`;

/**
 * Build intent classification prompt with thread content.
 */
export function buildIntentPrompt(
  messages: ThreadMessage[],
  userEmail: string
): string {
  const content = formatMessagesForPrompt(messages, userEmail);
  return INTENT_CLASSIFICATION_PROMPT.replace("{thread_content}", content);
}

/**
 * Build urgency scoring prompt with thread content.
 */
export function buildUrgencyPrompt(
  messages: ThreadMessage[],
  userEmail: string
): string {
  const content = formatMessagesForPrompt(messages, userEmail);
  const currentDate = new Date().toISOString().split("T")[0] ?? "";
  return URGENCY_SCORING_PROMPT.replace("{thread_content}", content).replace(
    "{current_date}",
    currentDate
  );
}

/**
 * Build sentiment analysis prompt with thread content.
 */
export function buildSentimentPrompt(
  messages: ThreadMessage[],
  userEmail: string
): string {
  const content = formatMessagesForPrompt(messages, userEmail);
  const messageIds = messages.map((m) => m.id).join(", ");
  return SENTIMENT_ANALYSIS_PROMPT.replace("{thread_content}", content).replace(
    "{message_ids}",
    messageIds
  );
}

/**
 * Build thread type prompt with thread content.
 */
export function buildThreadTypePrompt(
  messages: ThreadMessage[],
  userEmail: string
): string {
  const content = formatMessagesForPrompt(messages, userEmail);
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

  return THREAD_TYPE_PROMPT.replace("{thread_content}", content)
    .replace("{message_count}", String(messages.length))
    .replace("{participant_count}", String(participantEmails.size));
}
