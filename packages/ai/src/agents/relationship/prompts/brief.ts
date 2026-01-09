// =============================================================================
// MEETING BRIEF PROMPTS
// =============================================================================
//
// LLM prompts for generating meeting briefs and context summaries.
//

import type {
  ContactOpenLoop,
  RecentInteraction,
  ThreadContext,
} from "../types";

// =============================================================================
// RECENT HISTORY SUMMARY
// =============================================================================

/**
 * Build prompt for summarizing recent interaction history.
 */
export function buildRecentHistorySummaryPrompt(
  contactName: string,
  contactEmail: string,
  threads: ThreadContext[]
): string {
  const threadDetails = threads.slice(0, 10).map((t) => {
    const messages = t.messages.slice(0, 5).map((m) => ({
      from: m.isFromUser ? "You" : contactName,
      preview: m.bodyText?.slice(0, 300) ?? "",
    }));

    return `
Thread: ${t.subject ?? "(no subject)"}
ID: ${t.threadId}
Date: ${t.lastMessageAt.toISOString().split("T")[0]}
Messages: ${t.messageCount}

Recent messages:
${messages.map((m) => `[${m.from}]: ${m.preview}...`).join("\n")}
`;
  });

  return `You are an expert at summarizing professional email interactions.

Contact: ${contactName} (${contactEmail})

Recent email threads:
${threadDetails.join("\n---\n")}

For each thread, provide:
1. A concise summary (1-2 sentences) of what was discussed
2. The overall sentiment (positive, neutral, or negative)
3. Key topics discussed
4. Whether there's an open loop (unanswered question, pending action, etc.)

Focus on the substance of the conversation, not just the subject line.

Respond with JSON matching this schema:
{
  "interactions": [
    {
      "threadId": "the thread ID from above",
      "summary": "1-2 sentence summary of the thread",
      "sentiment": "positive" | "neutral" | "negative",
      "topics": ["topic1", "topic2"],
      "hasOpenLoop": boolean
    }
  ]
}`;
}

// =============================================================================
// MEETING BRIEF GENERATION
// =============================================================================

/**
 * Build prompt for generating a comprehensive meeting brief.
 */
export function buildMeetingBriefPrompt(
  contact: {
    name: string;
    email: string;
    title?: string;
    company?: string;
  },
  relationshipStats: {
    firstContact: Date;
    totalThreads: number;
    totalMessages: number;
    lastInteraction: Date;
    healthScore: number;
    isVip: boolean;
  },
  recentInteractions: RecentInteraction[],
  openLoops: ContactOpenLoop[]
): string {
  const interactionSummary = recentInteractions
    .slice(0, 5)
    .map(
      (i) => `
- ${i.date.toISOString().split("T")[0]}: ${i.subject}
  Summary: ${i.summary}
  Sentiment: ${i.sentiment}
  Topics: ${i.topics.join(", ")}
  ${i.hasOpenLoop ? "⚠️ Has open loop" : ""}
`
    )
    .join("\n");

  const openLoopSummary = openLoops
    .map(
      (l) => `
- [${l.type}] ${l.title}
  Direction: ${l.direction === "owed_by_contact" ? "They owe you" : "You owe them"}
  ${l.dueDate ? `Due: ${l.dueDate.toISOString().split("T")[0]}` : ""}
  ${l.daysOverdue ? `⚠️ ${l.daysOverdue} days overdue` : ""}
`
    )
    .join("\n");

  return `You are an expert executive assistant preparing a meeting brief.

## Contact Profile
Name: ${contact.name}
Email: ${contact.email}
Title: ${contact.title ?? "Unknown"}
Company: ${contact.company ?? "Unknown"}

## Relationship Overview
- First contact: ${relationshipStats.firstContact.toISOString().split("T")[0]}
- Total conversations: ${relationshipStats.totalThreads}
- Total messages exchanged: ${relationshipStats.totalMessages}
- Last interaction: ${relationshipStats.lastInteraction.toISOString().split("T")[0]}
- Relationship health: ${Math.round(relationshipStats.healthScore * 100)}%
- VIP status: ${relationshipStats.isVip ? "Yes" : "No"}

## Recent Interactions
${interactionSummary || "No recent interactions"}

## Open Loops
${openLoopSummary || "No open loops"}

Generate a meeting brief with:

1. **Talking Points** (3-5 items): Key things to mention or follow up on based on recent history
2. **Suggested Topics** (2-4 items): Topics that would be valuable to discuss
3. **Relationship Insights** (2-3 items): Observations about the relationship health and patterns
4. **Potential Concerns** (0-2 items): Any red flags or issues to be aware of

Be specific and actionable. Reference actual conversations and commitments.

Respond with JSON matching this schema:
{
  "talkingPoints": ["specific talking point 1", "specific talking point 2", ...],
  "suggestedTopics": ["topic 1", "topic 2", ...],
  "relationshipInsights": ["insight 1", "insight 2", ...],
  "potentialConcerns": ["concern 1", ...] (can be empty array)
}`;
}

// =============================================================================
// OPEN LOOP DETECTION
// =============================================================================

/**
 * Build prompt for detecting open loops in email threads.
 */
export function buildOpenLoopDetectionPrompt(
  contactName: string,
  threads: ThreadContext[]
): string {
  const threadDetails = threads.slice(0, 10).map((t) => {
    const messages = t.messages.map((m) => ({
      from: m.isFromUser ? "You" : contactName,
      date: m.sentAt?.toISOString().split("T")[0] ?? "Unknown",
      content: m.bodyText?.slice(0, 500) ?? "",
    }));

    return `
Thread: ${t.subject ?? "(no subject)"}
ID: ${t.threadId}

Messages:
${messages.map((m) => `[${m.date}] ${m.from}: ${m.content}...`).join("\n\n")}
`;
  });

  return `You are an expert at identifying unresolved items in email conversations.

Contact: ${contactName}

Email threads to analyze:
${threadDetails.join("\n---\n")}

Identify any "open loops" - unresolved items that need follow-up:

1. **Commitments**: Promises made by either party that haven't been fulfilled
2. **Questions**: Questions asked that weren't answered
3. **Requests**: Requests made that are pending response

For each open loop, determine:
- Type: commitment, question, or request
- Title: Brief description of the open loop
- Direction: Is it owed BY the contact to you, or owed TO the contact by you?
- Due date: If a deadline was mentioned
- Thread ID: Which thread this came from

Respond with JSON:
{
  "openLoops": [
    {
      "type": "commitment" | "question" | "request",
      "title": "brief description",
      "direction": "owed_by_contact" | "owed_to_contact",
      "dueDate": "ISO date string or null",
      "threadId": "thread ID",
      "threadSubject": "subject of the thread"
    }
  ]
}`;
}

// =============================================================================
// RESPONSE TIME PREDICTION
// =============================================================================

/**
 * Build prompt for predicting response time.
 */
export function buildResponseTimePredictionPrompt(
  contactName: string,
  historicalResponseTimes: number[], // in minutes
  messageContext: {
    isUrgent: boolean;
    isQuestion: boolean;
    isRequest: boolean;
    dayOfWeek: number;
    hourOfDay: number;
  }
): string {
  const avgTime =
    historicalResponseTimes.length > 0
      ? historicalResponseTimes.reduce((a, b) => a + b, 0) /
        historicalResponseTimes.length
      : 0;

  const minTime =
    historicalResponseTimes.length > 0
      ? Math.min(...historicalResponseTimes)
      : 0;

  const maxTime =
    historicalResponseTimes.length > 0
      ? Math.max(...historicalResponseTimes)
      : 0;

  const dayNames = [
    "Sunday",
    "Monday",
    "Tuesday",
    "Wednesday",
    "Thursday",
    "Friday",
    "Saturday",
  ];

  return `You are an expert at predicting email response times.

Contact: ${contactName}

Historical response time statistics:
- Average response time: ${Math.round(avgTime)} minutes
- Fastest response: ${Math.round(minTime)} minutes
- Slowest response: ${Math.round(maxTime)} minutes
- Sample size: ${historicalResponseTimes.length} responses

Current message context:
- Day of week: ${dayNames[messageContext.dayOfWeek]}
- Time of day: ${messageContext.hourOfDay}:00
- Is urgent: ${messageContext.isUrgent}
- Contains question: ${messageContext.isQuestion}
- Contains request: ${messageContext.isRequest}

Based on this information, predict:
1. Expected response time in minutes
2. Confidence level (0-1)
3. Range (minimum and maximum likely response time)
4. Factors affecting the prediction

Consider:
- Business hours vs. off-hours
- Weekday vs. weekend
- Urgency indicators
- Historical patterns

Respond with JSON:
{
  "predictedMinutes": number,
  "confidence": number between 0 and 1,
  "range": {
    "min": number,
    "max": number
  },
  "factors": [
    {
      "factor": "name of factor",
      "impact": "faster" | "slower",
      "description": "brief explanation"
    }
  ]
}`;
}

// =============================================================================
// RELATIONSHIP SUMMARY
// =============================================================================

/**
 * Build prompt for generating a relationship summary.
 */
export function buildRelationshipSummaryPrompt(
  contact: {
    name: string;
    email: string;
    title?: string;
    company?: string;
  },
  metrics: {
    totalThreads: number;
    totalMessages: number;
    avgResponseTimeMinutes: number;
    responseRate: number;
    initiationRatio: number;
    topTopics: string[];
  },
  healthIndicators: {
    frequencyTrend: "increasing" | "stable" | "decreasing";
    sentimentTrend: number; // -1 to 1
    isAtRisk: boolean;
    riskReasons: string[];
  }
): string {
  return `You are an expert at analyzing professional relationships.

## Contact
Name: ${contact.name}
Email: ${contact.email}
Title: ${contact.title ?? "Unknown"}
Company: ${contact.company ?? "Unknown"}

## Communication Metrics
- Total conversations: ${metrics.totalThreads}
- Total messages: ${metrics.totalMessages}
- Average response time: ${Math.round(metrics.avgResponseTimeMinutes)} minutes
- Response rate: ${Math.round(metrics.responseRate * 100)}%
- Initiation ratio: ${metrics.initiationRatio.toFixed(2)} (>1 means you initiate more)
- Top topics: ${metrics.topTopics.join(", ")}

## Health Indicators
- Frequency trend: ${healthIndicators.frequencyTrend}
- Sentiment trend: ${healthIndicators.sentimentTrend > 0 ? "Improving" : healthIndicators.sentimentTrend < 0 ? "Declining" : "Stable"}
- At risk: ${healthIndicators.isAtRisk ? "Yes" : "No"}
${healthIndicators.riskReasons.length > 0 ? `- Risk reasons: ${healthIndicators.riskReasons.join(", ")}` : ""}

Generate a brief relationship summary (2-3 paragraphs) that:
1. Describes the nature and history of this professional relationship
2. Highlights communication patterns and engagement level
3. Provides actionable recommendations for maintaining or improving the relationship

Be specific and reference the metrics provided.

Respond with JSON:
{
  "summary": "2-3 paragraph summary",
  "relationshipType": "client" | "vendor" | "colleague" | "partner" | "prospect" | "other",
  "engagementLevel": "high" | "medium" | "low",
  "recommendations": ["recommendation 1", "recommendation 2", ...]
}`;
}
