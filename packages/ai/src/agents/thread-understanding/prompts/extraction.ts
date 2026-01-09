// =============================================================================
// EXTRACTION PROMPTS
// =============================================================================
//
// Prompts for claim extraction: facts, promises, requests, questions, decisions.
//

import type { ThreadMessage } from "../types";
import { formatMessagesForPrompt } from "./classification";

/**
 * Fact extraction prompt.
 */
export const FACT_EXTRACTION_PROMPT = `You are extracting factual statements from an email thread.

Facts are:
- Objective statements about reality
- Specific dates, numbers, prices, quantities
- Stated information that could be verified
- References to documents, projects, or entities

NOT facts:
- Opinions or preferences
- Promises about future actions
- Questions
- Requests

Thread:
{thread_content}

Message IDs for reference:
{message_ids}

Extract all facts and respond with JSON only:
{
  "facts": [
    {
      "type": "fact",
      "text": "<the factual statement>",
      "normalizedText": "<cleaner version if needed>",
      "confidence": <0.0-1.0>,
      "evidence": [
        {
          "messageId": "<message id where fact appears>",
          "quotedText": "<exact text from email supporting this fact>"
        }
      ],
      "entities": [
        { "type": "date|amount|person|company|project|document", "value": "<extracted value>" }
      ],
      "temporalReference": "<date reference if applicable>"
    }
  ]
}`;

/**
 * Promise detection prompt.
 */
export const PROMISE_DETECTION_PROMPT = `You are detecting promises and commitments in an email thread.

Promises are:
- Statements where someone commits to doing something
- "I will...", "We'll...", "I'm going to..."
- Implicit commitments like "Consider it done"
- Conditional promises ("If X, I'll do Y")

Note who is making the promise and to whom.

Thread:
{thread_content}

Message IDs for reference:
{message_ids}

User's email: {user_email}

Extract all promises and respond with JSON only:
{
  "promises": [
    {
      "type": "promise",
      "text": "<the promise>",
      "confidence": <0.0-1.0>,
      "evidence": [
        {
          "messageId": "<message id>",
          "quotedText": "<exact text>"
        }
      ],
      "promisor": "<email of person making promise>",
      "promisee": "<email of recipient if clear>",
      "deadline": "<ISO date if mentioned>",
      "deadlineConfidence": <0.0-1.0 if deadline present>,
      "isConditional": true | false,
      "condition": "<the condition if conditional>"
    }
  ]
}`;

/**
 * Request detection prompt.
 */
export const REQUEST_DETECTION_PROMPT = `You are detecting requests and asks in an email thread.

Requests are:
- Explicit asks: "Can you...", "Please...", "Could you..."
- Implicit requests: "It would be great if...", "We need..."
- Task assignments: "You should...", "Make sure to..."

Note who is making the request and to whom.

Thread:
{thread_content}

Message IDs for reference:
{message_ids}

User's email: {user_email}

Extract all requests and respond with JSON only:
{
  "requests": [
    {
      "type": "request",
      "text": "<the request>",
      "confidence": <0.0-1.0>,
      "evidence": [
        {
          "messageId": "<message id>",
          "quotedText": "<exact text>"
        }
      ],
      "requester": "<email of person making request>",
      "requestee": "<email of recipient if clear>",
      "isExplicit": true | false,
      "deadline": "<ISO date if mentioned>",
      "priority": "low" | "medium" | "high"
    }
  ]
}`;

/**
 * Question identification prompt.
 */
export const QUESTION_IDENTIFICATION_PROMPT = `You are identifying questions in an email thread.

Find:
- Explicit questions (ending with ?)
- Implicit questions ("I wonder if...", "I'd like to know...")
- Rhetorical questions (mark as rhetorical)

Also determine if each question has been answered later in the thread.

Thread:
{thread_content}

Message IDs for reference:
{message_ids}

User's email: {user_email}

Extract all questions and respond with JSON only:
{
  "questions": [
    {
      "type": "question",
      "text": "<the question>",
      "confidence": <0.0-1.0>,
      "evidence": [
        {
          "messageId": "<message id>",
          "quotedText": "<exact text>"
        }
      ],
      "asker": "<email of person asking>",
      "isRhetorical": true | false,
      "isAnswered": true | false,
      "answerMessageId": "<message id of answer if answered>",
      "answerText": "<the answer if found>"
    }
  ]
}`;

/**
 * Decision detection prompt.
 */
export const DECISION_DETECTION_PROMPT = `You are detecting decisions in an email thread.

Decisions are:
- Final choices: "We decided...", "Let's go with...", "I've chosen..."
- Approvals: "Approved", "You have my sign-off"
- Rejections: "We won't...", "Declined"
- Agreements: "Agreed", "That works for me"

Note who made the decision and any rationale provided.

Thread:
{thread_content}

Message IDs for reference:
{message_ids}

Extract all decisions and respond with JSON only:
{
  "decisions": [
    {
      "type": "decision",
      "text": "<summary of decision>",
      "decision": "<the actual decision>",
      "confidence": <0.0-1.0>,
      "evidence": [
        {
          "messageId": "<message id>",
          "quotedText": "<exact text>"
        }
      ],
      "decisionMaker": "<email of decision maker if clear>",
      "rationale": "<reasoning if provided>",
      "alternatives": ["<alternative options mentioned>"]
    }
  ]
}`;

/**
 * Combined extraction prompt for efficiency.
 */
export const COMBINED_EXTRACTION_PROMPT = `You are extracting structured information from an email thread. Extract ALL of the following:

1. FACTS: Objective statements, dates, numbers, specific information
2. PROMISES: Commitments to do something ("I will...", "We'll...")
3. REQUESTS: Asks for someone to do something ("Can you...", "Please...")
4. QUESTIONS: Questions asked (both explicit ? and implicit)
5. DECISIONS: Final choices, approvals, rejections

Thread:
{thread_content}

Message IDs for reference:
{message_ids}

User's email: {user_email}
Today's date: {current_date}

Respond with JSON only:
{
  "facts": [
    {
      "type": "fact",
      "text": "<the fact>",
      "confidence": <0.0-1.0>,
      "evidence": [{ "messageId": "<id>", "quotedText": "<text>" }],
      "entities": [{ "type": "<type>", "value": "<value>" }],
      "temporalReference": "<date if applicable>"
    }
  ],
  "promises": [
    {
      "type": "promise",
      "text": "<the promise>",
      "confidence": <0.0-1.0>,
      "evidence": [{ "messageId": "<id>", "quotedText": "<text>" }],
      "promisor": "<email>",
      "promisee": "<email>",
      "deadline": "<ISO date>",
      "deadlineConfidence": <0.0-1.0>,
      "isConditional": true | false,
      "condition": "<if conditional>"
    }
  ],
  "requests": [
    {
      "type": "request",
      "text": "<the request>",
      "confidence": <0.0-1.0>,
      "evidence": [{ "messageId": "<id>", "quotedText": "<text>" }],
      "requester": "<email>",
      "requestee": "<email>",
      "isExplicit": true | false,
      "deadline": "<ISO date>",
      "priority": "low" | "medium" | "high"
    }
  ],
  "questions": [
    {
      "type": "question",
      "text": "<the question>",
      "confidence": <0.0-1.0>,
      "evidence": [{ "messageId": "<id>", "quotedText": "<text>" }],
      "asker": "<email>",
      "isRhetorical": true | false,
      "isAnswered": true | false,
      "answerMessageId": "<if answered>",
      "answerText": "<the answer>"
    }
  ],
  "decisions": [
    {
      "type": "decision",
      "text": "<summary>",
      "decision": "<the decision>",
      "confidence": <0.0-1.0>,
      "evidence": [{ "messageId": "<id>", "quotedText": "<text>" }],
      "decisionMaker": "<email>",
      "rationale": "<reasoning>",
      "alternatives": ["<options>"]
    }
  ]
}`;

/**
 * Build fact extraction prompt.
 */
export function buildFactPrompt(
  messages: ThreadMessage[],
  userEmail: string
): string {
  const content = formatMessagesForPrompt(messages, userEmail);
  const messageIds = messages.map((m) => m.id).join(", ");
  return FACT_EXTRACTION_PROMPT.replace("{thread_content}", content).replace(
    "{message_ids}",
    messageIds
  );
}

/**
 * Build promise detection prompt.
 */
export function buildPromisePrompt(
  messages: ThreadMessage[],
  userEmail: string
): string {
  const content = formatMessagesForPrompt(messages, userEmail);
  const messageIds = messages.map((m) => m.id).join(", ");
  return PROMISE_DETECTION_PROMPT.replace("{thread_content}", content)
    .replace("{message_ids}", messageIds)
    .replace("{user_email}", userEmail);
}

/**
 * Build request detection prompt.
 */
export function buildRequestPrompt(
  messages: ThreadMessage[],
  userEmail: string
): string {
  const content = formatMessagesForPrompt(messages, userEmail);
  const messageIds = messages.map((m) => m.id).join(", ");
  return REQUEST_DETECTION_PROMPT.replace("{thread_content}", content)
    .replace("{message_ids}", messageIds)
    .replace("{user_email}", userEmail);
}

/**
 * Build question identification prompt.
 */
export function buildQuestionPrompt(
  messages: ThreadMessage[],
  userEmail: string
): string {
  const content = formatMessagesForPrompt(messages, userEmail);
  const messageIds = messages.map((m) => m.id).join(", ");
  return QUESTION_IDENTIFICATION_PROMPT.replace("{thread_content}", content)
    .replace("{message_ids}", messageIds)
    .replace("{user_email}", userEmail);
}

/**
 * Build decision detection prompt.
 */
export function buildDecisionPrompt(
  messages: ThreadMessage[],
  userEmail: string
): string {
  const content = formatMessagesForPrompt(messages, userEmail);
  const messageIds = messages.map((m) => m.id).join(", ");
  return DECISION_DETECTION_PROMPT.replace("{thread_content}", content).replace(
    "{message_ids}",
    messageIds
  );
}

/**
 * Build combined extraction prompt (more efficient for full extraction).
 */
export function buildCombinedExtractionPrompt(
  messages: ThreadMessage[],
  userEmail: string
): string {
  const content = formatMessagesForPrompt(messages, userEmail);
  const messageIds = messages.map((m) => m.id).join(", ");
  const currentDate = new Date().toISOString().split("T")[0] ?? "";
  return COMBINED_EXTRACTION_PROMPT.replace("{thread_content}", content)
    .replace("{message_ids}", messageIds)
    .replace("{user_email}", userEmail)
    .replace("{current_date}", currentDate);
}
