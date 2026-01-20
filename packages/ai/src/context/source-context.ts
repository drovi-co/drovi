// =============================================================================
// SOURCE CONTEXT PROVIDER
// =============================================================================
//
// Provides source-specific context for AI prompts.
// Different communication channels have distinct patterns that affect extraction.
//

// =============================================================================
// TYPES
// =============================================================================

/**
 * Supported source types.
 */
export type SourceType =
  | "email"
  | "slack"
  | "whatsapp"
  | "calendar"
  | "notion"
  | "docs";

/**
 * Source-specific metadata that can enhance extraction.
 */
export interface SourceMetadata {
  sourceType: SourceType;

  // Email-specific
  hasSubjectLine?: boolean;
  hasSignature?: boolean;
  isReply?: boolean;
  isForwarded?: boolean;

  // Slack-specific
  reactions?: Array<{ emoji: string; count: number }>;
  threadDepth?: number;
  channelType?: "public" | "private" | "dm" | "group_dm";
  mentionCount?: number;

  // WhatsApp-specific
  isGroupMessage?: boolean;
  groupSize?: number;
  hasMedia?: boolean;

  // Calendar-specific
  attendeeCount?: number;
  attendeeResponses?: Record<string, "accepted" | "declined" | "tentative" | "pending">;
  isRecurring?: boolean;
  meetingDuration?: number;

  // Document-specific
  hasCheckboxes?: boolean;
  hasProperties?: boolean;
  documentType?: "page" | "database" | "doc" | "sheet";
}

/**
 * Source-specific prompt context.
 */
export interface SourceContext {
  sourceType: SourceType;
  promptAdditions: string;
  extractionHints: string[];
  commitmentSignals: string[];
  decisionSignals: string[];
  urgencyIndicators: string[];
}

// =============================================================================
// SOURCE CONTEXTS
// =============================================================================

const EMAIL_CONTEXT: SourceContext = {
  sourceType: "email",
  promptAdditions: `
## Email-Specific Context
- Subject lines often indicate intent (RE:, FW:, urgent, action required)
- Signatures may contain role/authority information
- Reply chains show conversation evolution
- CC/BCC recipients indicate stakeholders
- Formal language is more common
- "Please" and "Could you" often indicate requests
- Deadlines are often explicit with dates/times
`,
  extractionHints: [
    "Check subject line for urgency indicators",
    "Identify sender's role from signature",
    "Track commitment chains through replies",
    "Note CC'd stakeholders as potential verifiers",
  ],
  commitmentSignals: [
    '"I will"',
    '"I\'ll"',
    '"We will"',
    '"I commit to"',
    '"I promise"',
    '"You can expect"',
    '"I\'ll have it to you by"',
    '"Action item:"',
    '"I\'ll follow up"',
  ],
  decisionSignals: [
    '"We have decided"',
    '"The decision is"',
    '"Going forward, we will"',
    '"We\'ve agreed to"',
    '"Final decision:"',
    '"Approved"',
    '"Rejected"',
    '"Selected option"',
  ],
  urgencyIndicators: [
    "URGENT",
    "ASAP",
    "EOD",
    "by end of day",
    "immediately",
    "critical",
    "time-sensitive",
    "deadline",
  ],
};

const SLACK_CONTEXT: SourceContext = {
  sourceType: "slack",
  promptAdditions: `
## Slack-Specific Context
- Emoji reactions are significant signals:
  - :thumbsup: / :heavy_check_mark: = agreement/approval
  - :eyes: = acknowledged/reviewing
  - :+1: = agreement
  - :100: = strong agreement
  - :question: = needs clarification
- Thread replies indicate engagement and discussion depth
- @mentions create implicit accountability
- Channel context matters: #urgent vs #random vs #general
- Informal language is common - "I'll" statements are commitment indicators
- Short messages are normal - don't require formal structure
- Messages often reference previous context with "^" or "this"
`,
  extractionHints: [
    "Reactions of :thumbsup: or :heavy_check_mark: indicate approval",
    "@mentions create implicit ownership",
    "Thread depth indicates importance of discussion",
    "Channel name provides context for urgency",
    "Pinned messages may contain decisions",
  ],
  commitmentSignals: [
    '"I\'ll"',
    '"on it"',
    '"will do"',
    '"got it"',
    '"taking this"',
    '"I can"',
    '"I\'ll handle"',
    '"mine"',
    '"assigned to me"',
    ":raised_hand:",
  ],
  decisionSignals: [
    '"let\'s go with"',
    '"decided"',
    '"we\'re going with"',
    '"final answer"',
    '"confirmed"',
    '"approved"',
    ":white_check_mark: on decision messages",
    "Multiple :thumbsup: reactions (consensus)",
  ],
  urgencyIndicators: [
    "@here",
    "@channel",
    ":rotating_light:",
    ":fire:",
    "URGENT",
    "asap",
    ":warning:",
    "blocking",
    "blocker",
  ],
};

const WHATSAPP_CONTEXT: SourceContext = {
  sourceType: "whatsapp",
  promptAdditions: `
## WhatsApp-Specific Context
- Messages are typically brief and informal
- Emoji usage is heavy - interpret emoji meanings
- Voice messages may be transcribed (check for [voice message] markers)
- Group messages require understanding group dynamics
- Read receipts (blue ticks) indicate message was seen
- Messages may be replies to earlier messages (check quoted content)
- Time gaps between messages indicate different conversation sessions
- Forwarded messages are marked [Forwarded]
`,
  extractionHints: [
    "Brief messages can still contain commitments",
    "Emoji like thumbs up often = agreement",
    "Group consensus may emerge from multiple agreeing messages",
    "Voice message transcriptions may be informal",
    "Check quoted replies for context",
  ],
  commitmentSignals: [
    '"ok"',
    '"sure"',
    '"will do"',
    '"on it"',
    '"done"',
    ":thumbsup:",
    ":ok_hand:",
    '"I\'ll"',
    '"tmrw"',
    '"later"',
  ],
  decisionSignals: [
    '"let\'s do"',
    '"go ahead"',
    '"confirmed"',
    '"final"',
    "Group consensus (multiple agreements)",
    ":white_check_mark:",
  ],
  urgencyIndicators: [
    "!!",
    "URGENT",
    "asap",
    "now",
    "emergency",
    ":warning:",
    "Multiple messages in quick succession",
  ],
};

const CALENDAR_CONTEXT: SourceContext = {
  sourceType: "calendar",
  promptAdditions: `
## Calendar-Specific Context
- Meeting attendance status is a form of commitment:
  - "Accepted" = committed to attend
  - "Tentative" = conditional commitment
  - "Declined" = explicit non-commitment
- Recurring meetings indicate ongoing commitments
- Meeting descriptions often contain pre-work or follow-up items
- Attendee list indicates stakeholders
- Meeting title often indicates purpose/decision to be made
- Location/video link indicates meeting format expectations
`,
  extractionHints: [
    "Accepted attendance = commitment to attend",
    "Meeting prep items in description = pre-meeting commitments",
    "Action items from meeting notes = post-meeting commitments",
    "Recurring meetings = ongoing time commitments",
  ],
  commitmentSignals: [
    "Attendance: Accepted",
    '"will prepare"',
    '"will present"',
    '"action item:"',
    '"follow-up:"',
    '"pre-read:"',
    "Meeting organizer responsibilities",
  ],
  decisionSignals: [
    '"decision meeting"',
    '"review and approve"',
    '"go/no-go"',
    '"final decision"',
    "Meeting outcomes in notes",
    '"agreed in meeting"',
  ],
  urgencyIndicators: [
    "High importance flag",
    "Short notice meetings",
    '"urgent"',
    '"emergency"',
    "Meetings outside business hours",
  ],
};

const NOTION_CONTEXT: SourceContext = {
  sourceType: "notion",
  promptAdditions: `
## Notion-Specific Context
- Checkboxes indicate task status:
  - [ ] = pending/incomplete
  - [x] = completed
- Properties in databases have semantic meaning
- @mentions create assignments
- Comments indicate discussion/feedback
- Page hierarchy indicates organizational structure
- Databases may have status properties (To Do, In Progress, Done)
- Relations between pages indicate connections
`,
  extractionHints: [
    "Unchecked checkboxes = pending commitments",
    "Checked checkboxes = completed commitments",
    "@mentions = assigned person",
    "Status properties indicate progress",
    "Due date properties = deadlines",
  ],
  commitmentSignals: [
    "Unchecked checkbox items",
    "Assignee property filled",
    "Due date set",
    "Status = To Do or In Progress",
    "@mention with action",
  ],
  decisionSignals: [
    "Status = Approved/Decided",
    "Decision log entries",
    "Completed vote/poll",
    "Signed-off items",
    "Locked/archived decisions",
  ],
  urgencyIndicators: [
    "Priority: High/Urgent",
    "Due date approaching",
    "Overdue items",
    "Blocking tag",
    "Red status indicators",
  ],
};

const DOCS_CONTEXT: SourceContext = {
  sourceType: "docs",
  promptAdditions: `
## Google Docs-Specific Context
- Comments indicate discussions and feedback
- Suggestions mode shows proposed changes
- Resolved comments may contain decisions
- Document sharing permissions indicate stakeholders
- Version history shows evolution
- Action items may be in comments or document body
`,
  extractionHints: [
    "Unresolved comments may contain open commitments",
    "Resolved comments may contain decisions",
    "Accepted suggestions = approved changes",
    "@mentions in comments = assigned actions",
  ],
  commitmentSignals: [
    "@mention with action in comment",
    "Action item markers (AI, TODO)",
    "Assigned comments",
    "Unresolved comment with commitment",
  ],
  decisionSignals: [
    "Resolved comment with decision",
    "Accepted suggestion",
    "Signed section",
    "Approved marker",
    "Final version notation",
  ],
  urgencyIndicators: [
    "Deadline in comment",
    "Blocking comment",
    "Urgent tag",
    "Review needed marker",
  ],
};

// =============================================================================
// CONTEXT MAP
// =============================================================================

const SOURCE_CONTEXTS: Record<SourceType, SourceContext> = {
  email: EMAIL_CONTEXT,
  slack: SLACK_CONTEXT,
  whatsapp: WHATSAPP_CONTEXT,
  calendar: CALENDAR_CONTEXT,
  notion: NOTION_CONTEXT,
  docs: DOCS_CONTEXT,
};

// =============================================================================
// FUNCTIONS
// =============================================================================

/**
 * Get the context for a specific source type.
 */
export function getSourceContext(sourceType: SourceType): SourceContext {
  return SOURCE_CONTEXTS[sourceType];
}

/**
 * Get prompt additions for a source type.
 */
export function getSourcePromptAdditions(sourceType: SourceType): string {
  return SOURCE_CONTEXTS[sourceType].promptAdditions;
}

/**
 * Get commitment signals for a source type.
 */
export function getCommitmentSignals(sourceType: SourceType): string[] {
  return SOURCE_CONTEXTS[sourceType].commitmentSignals;
}

/**
 * Get decision signals for a source type.
 */
export function getDecisionSignals(sourceType: SourceType): string[] {
  return SOURCE_CONTEXTS[sourceType].decisionSignals;
}

/**
 * Get urgency indicators for a source type.
 */
export function getUrgencyIndicators(sourceType: SourceType): string[] {
  return SOURCE_CONTEXTS[sourceType].urgencyIndicators;
}

/**
 * Build enhanced context from source metadata.
 */
export function buildEnhancedContext(metadata: SourceMetadata): string {
  const baseContext = getSourceContext(metadata.sourceType);
  const additions: string[] = [baseContext.promptAdditions];

  // Add source-specific metadata context
  if (metadata.sourceType === "slack") {
    if (metadata.reactions && metadata.reactions.length > 0) {
      const reactionStr = metadata.reactions
        .map((r) => `${r.emoji} (${r.count})`)
        .join(", ");
      additions.push(`\nMessage reactions: ${reactionStr}`);
    }
    if (metadata.threadDepth !== undefined) {
      additions.push(`\nThread depth: ${metadata.threadDepth} replies`);
    }
    if (metadata.mentionCount !== undefined && metadata.mentionCount > 0) {
      additions.push(`\n@mentions in message: ${metadata.mentionCount}`);
    }
    if (metadata.channelType) {
      additions.push(`\nChannel type: ${metadata.channelType}`);
    }
  }

  if (metadata.sourceType === "whatsapp") {
    if (metadata.isGroupMessage) {
      additions.push(`\nGroup message with ${metadata.groupSize ?? "unknown"} members`);
    }
    if (metadata.hasMedia) {
      additions.push("\nMessage includes media attachment");
    }
  }

  if (metadata.sourceType === "calendar") {
    if (metadata.attendeeCount !== undefined) {
      additions.push(`\nMeeting has ${metadata.attendeeCount} attendees`);
    }
    if (metadata.attendeeResponses) {
      const responses = Object.entries(metadata.attendeeResponses)
        .map(([_, status]) => status)
        .reduce(
          (acc, status) => {
            acc[status] = (acc[status] || 0) + 1;
            return acc;
          },
          {} as Record<string, number>
        );
      additions.push(`\nAttendee responses: ${JSON.stringify(responses)}`);
    }
    if (metadata.isRecurring) {
      additions.push("\nThis is a recurring meeting");
    }
  }

  if (metadata.sourceType === "notion" || metadata.sourceType === "docs") {
    if (metadata.hasCheckboxes) {
      additions.push("\nDocument contains checkboxes (task items)");
    }
    if (metadata.hasProperties) {
      additions.push("\nDocument has structured properties");
    }
  }

  return additions.join("\n");
}

/**
 * Get all available source types.
 */
export function getAvailableSourceTypes(): SourceType[] {
  return Object.keys(SOURCE_CONTEXTS) as SourceType[];
}
