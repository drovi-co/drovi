// =============================================================================
// ACTION CLASSIFICATION (PRD-07)
// =============================================================================
//
// Classify appropriate actions for email threads.
// Determines respond, archive, delegate, schedule, wait, escalate.
//

import type { PriorityResult, ThreadForPriority } from "./priority.js";

// =============================================================================
// TYPES
// =============================================================================

export type ActionType =
  | "respond"
  | "archive"
  | "delegate"
  | "schedule"
  | "wait"
  | "escalate"
  | "review";

export interface ActionSuggestion {
  action: ActionType;
  confidence: number;
  reasoning: string;
  details?: {
    delegateTo?: string;
    delegateReason?: string;
    scheduleFor?: Date;
    scheduleDuration?: number; // minutes
    waitUntil?: Date;
    waitReason?: string;
    escalateTo?: string;
    escalateReason?: string;
    responseTimeWindow?: {
      suggested: Date;
      deadline?: Date;
    };
  };
}

export interface ActionContext {
  thread: ThreadForPriority;
  priority: PriorityResult;
  userPatterns?: UserActionPatterns;
  teamMembers?: TeamMember[];
  userCalendar?: CalendarAvailability;
}

export interface UserActionPatterns {
  archivePatterns: string[];
  delegatePatterns: Array<{ pattern: string; delegateTo: string }>;
  responseTimeByPriority: Record<string, number>; // hours
  focusHours?: { start: number; end: number };
}

export interface TeamMember {
  id: string;
  name: string;
  email: string;
  expertise: string[];
  availability?: "available" | "busy" | "away";
}

export interface CalendarAvailability {
  busySlots: Array<{ start: Date; end: Date }>;
  nextFreeSlot?: Date;
  focusTime?: Array<{ start: Date; end: Date }>;
}

// =============================================================================
// ACTION CLASSIFICATION RULES
// =============================================================================

interface ClassificationRule {
  name: string;
  action: ActionType;
  weight: number;
  condition: (ctx: ActionContext) => boolean;
  details?: (ctx: ActionContext) => ActionSuggestion["details"];
}

const classificationRules: ClassificationRule[] = [
  // RESPOND rules
  {
    name: "direct-question",
    action: "respond",
    weight: 0.9,
    condition: (ctx) => {
      const text =
        `${ctx.thread.subject} ${ctx.thread.snippet ?? ""}`.toLowerCase();
      return (
        /\?$/.test(text) ||
        /what do you think/i.test(text) ||
        /can you (please|kindly)/i.test(text) ||
        /let me know/i.test(text)
      );
    },
  },
  {
    name: "explicit-request",
    action: "respond",
    weight: 0.85,
    condition: (ctx) => {
      const text =
        `${ctx.thread.subject} ${ctx.thread.snippet ?? ""}`.toLowerCase();
      return (
        /please (respond|reply|confirm|review)/i.test(text) ||
        /need your (input|feedback|approval)/i.test(text)
      );
    },
  },
  {
    name: "commitment-request",
    action: "respond",
    weight: 0.8,
    condition: (ctx) => {
      return ctx.thread.claims?.some((c) => c.type === "commitment") ?? false;
    },
  },

  // ARCHIVE rules
  {
    name: "fyi-only",
    action: "archive",
    weight: 0.85,
    condition: (ctx) => {
      const text =
        `${ctx.thread.subject} ${ctx.thread.snippet ?? ""}`.toLowerCase();
      return (
        /^(fyi|for your information|no action needed)/i.test(text) ||
        /no (response|reply|action) (needed|required)/i.test(text)
      );
    },
  },
  {
    name: "newsletter-marketing",
    action: "archive",
    weight: 0.9,
    condition: (ctx) => {
      const text =
        `${ctx.thread.subject} ${ctx.thread.snippet ?? ""}`.toLowerCase();
      return (
        /unsubscribe/i.test(text) ||
        /newsletter/i.test(text) ||
        ctx.thread.classification?.toLowerCase().includes("marketing") ===
          true ||
        ctx.thread.classification?.toLowerCase().includes("newsletter") === true
      );
    },
  },
  {
    name: "auto-notification",
    action: "archive",
    weight: 0.88,
    condition: (ctx) => {
      const fromAddresses = ctx.thread.participants
        .map((p) => p.address.toLowerCase())
        .filter((a) => a.includes("noreply") || a.includes("no-reply"));
      return (
        fromAddresses.length > 0 ||
        ctx.thread.classification?.toLowerCase().includes("notification") ===
          true
      );
    },
  },
  {
    name: "low-priority-aged",
    action: "archive",
    weight: 0.7,
    condition: (ctx) => {
      const ageHours =
        (Date.now() - ctx.thread.lastMessageAt.getTime()) / (1000 * 60 * 60);
      return ctx.priority.tier === "low" && ageHours > 72;
    },
  },

  // DELEGATE rules
  {
    name: "wrong-recipient",
    action: "delegate",
    weight: 0.85,
    condition: (ctx) => {
      const text =
        `${ctx.thread.subject} ${ctx.thread.snippet ?? ""}`.toLowerCase();
      return /not (my|the right) (area|department|team)/i.test(text);
    },
    details: (ctx) => {
      // Find appropriate delegate based on content
      const expertise = findExpertiseNeeded(ctx.thread);
      const delegate = ctx.teamMembers?.find(
        (m) =>
          m.expertise.some((e) => expertise.includes(e)) &&
          m.availability !== "away"
      );
      return delegate
        ? {
            delegateTo: delegate.email,
            delegateReason: `Better suited for ${delegate.name}'s expertise in ${expertise.join(", ")}`,
          }
        : undefined;
    },
  },
  {
    name: "expertise-match",
    action: "delegate",
    weight: 0.75,
    condition: (ctx) => {
      if (!ctx.teamMembers || ctx.teamMembers.length === 0) {
        return false;
      }
      const expertise = findExpertiseNeeded(ctx.thread);
      return (
        expertise.length > 0 &&
        ctx.teamMembers.some(
          (m) =>
            m.expertise.some((e) => expertise.includes(e)) &&
            m.availability === "available"
        )
      );
    },
    details: (ctx) => {
      const expertise = findExpertiseNeeded(ctx.thread);
      const delegate = ctx.teamMembers?.find(
        (m) =>
          m.expertise.some((e) => expertise.includes(e)) &&
          m.availability === "available"
      );
      return delegate
        ? {
            delegateTo: delegate.email,
            delegateReason: `Matches ${delegate.name}'s expertise`,
          }
        : undefined;
    },
  },

  // SCHEDULE rules
  {
    name: "complex-task",
    action: "schedule",
    weight: 0.8,
    condition: (ctx) => {
      const text =
        `${ctx.thread.subject} ${ctx.thread.snippet ?? ""}`.toLowerCase();
      return (
        /analysis|review|proposal|report|document/i.test(text) &&
        ctx.priority.tier !== "urgent"
      );
    },
    details: (ctx) => {
      const suggestedTime =
        ctx.userCalendar?.nextFreeSlot ?? addHours(new Date(), 24);
      return {
        scheduleFor: suggestedTime,
        scheduleDuration: 30, // Default 30 min
      };
    },
  },
  {
    name: "high-priority-busy",
    action: "schedule",
    weight: 0.75,
    condition: (ctx) => {
      return (
        ctx.priority.tier === "high" &&
        ctx.userCalendar?.busySlots?.some(
          (slot) => slot.start <= new Date() && slot.end > new Date()
        ) === true
      );
    },
    details: (ctx) => ({
      scheduleFor: ctx.userCalendar?.nextFreeSlot ?? addHours(new Date(), 2),
      scheduleDuration: 15,
    }),
  },

  // WAIT rules
  {
    name: "waiting-on-others",
    action: "wait",
    weight: 0.85,
    condition: (ctx) => {
      const text =
        `${ctx.thread.subject} ${ctx.thread.snippet ?? ""}`.toLowerCase();
      return (
        /waiting (for|on)/i.test(text) ||
        /will (get back|follow up)/i.test(text) ||
        /pending (approval|review)/i.test(text)
      );
    },
    details: () => ({
      waitUntil: addHours(new Date(), 48),
      waitReason: "Waiting for external response",
    }),
  },
  {
    name: "thread-in-progress",
    action: "wait",
    weight: 0.7,
    condition: (ctx) => {
      // Multiple participants, recent activity
      const ageHours =
        (Date.now() - ctx.thread.lastMessageAt.getTime()) / (1000 * 60 * 60);
      return ctx.thread.participants.length > 3 && ageHours < 4;
    },
    details: () => ({
      waitUntil: addHours(new Date(), 24),
      waitReason: "Active thread - wait for discussion to settle",
    }),
  },

  // ESCALATE rules
  {
    name: "above-authority",
    action: "escalate",
    weight: 0.9,
    condition: (ctx) => {
      const text =
        `${ctx.thread.subject} ${ctx.thread.snippet ?? ""}`.toLowerCase();
      return (
        /approval (from|by) (manager|director|vp)/i.test(text) ||
        /executive decision/i.test(text) ||
        /budget approval/i.test(text)
      );
    },
    details: () => ({
      escalateReason: "Requires higher authority approval",
    }),
  },
  {
    name: "sensitive-legal",
    action: "escalate",
    weight: 0.85,
    condition: (ctx) => {
      const text =
        `${ctx.thread.subject} ${ctx.thread.snippet ?? ""}`.toLowerCase();
      return (
        /legal (issue|matter|concern)/i.test(text) ||
        /lawsuit|litigation/i.test(text) ||
        /hr (complaint|issue)/i.test(text)
      );
    },
    details: () => ({
      escalateReason: "Sensitive matter requiring management attention",
    }),
  },

  // REVIEW rules (default fallback with low weight)
  {
    name: "needs-review",
    action: "review",
    weight: 0.5,
    condition: () => true, // Always matches as fallback
  },
];

// =============================================================================
// HELPERS
// =============================================================================

function addHours(date: Date, hours: number): Date {
  return new Date(date.getTime() + hours * 60 * 60 * 1000);
}

function findExpertiseNeeded(thread: ThreadForPriority): string[] {
  const text =
    `${thread.subject} ${thread.snippet ?? ""} ${thread.bodyText ?? ""}`.toLowerCase();
  const expertiseMap: Record<string, string[]> = {
    technical: ["code", "bug", "api", "deploy", "server", "database"],
    design: ["design", "ui", "ux", "mockup", "wireframe"],
    sales: ["deal", "prospect", "customer", "quote", "proposal"],
    finance: ["invoice", "budget", "expense", "payment"],
    legal: ["contract", "agreement", "terms", "compliance"],
    hr: ["hiring", "candidate", "interview", "onboarding"],
    marketing: ["campaign", "content", "social", "seo"],
  };

  const matched: string[] = [];
  for (const [expertise, keywords] of Object.entries(expertiseMap)) {
    if (keywords.some((kw) => text.includes(kw))) {
      matched.push(expertise);
    }
  }
  return matched;
}

// =============================================================================
// MAIN CLASSIFICATION FUNCTION
// =============================================================================

/**
 * Classify the suggested action for a thread.
 */
export function classifyAction(context: ActionContext): ActionSuggestion {
  const matchedRules: Array<{
    rule: ClassificationRule;
    details?: ActionSuggestion["details"];
  }> = [];

  // Evaluate all rules
  for (const rule of classificationRules) {
    if (rule.condition(context)) {
      matchedRules.push({
        rule,
        details: rule.details?.(context),
      });
    }
  }

  // Sort by weight (highest first) and filter out review as fallback
  const priorityRules = matchedRules
    .filter((m) => m.rule.action !== "review")
    .sort((a, b) => b.rule.weight - a.rule.weight);

  // Get best match or fallback to review
  const bestMatch =
    priorityRules[0] ?? matchedRules.find((m) => m.rule.action === "review");

  if (!bestMatch) {
    return {
      action: "review",
      confidence: 0.5,
      reasoning: "Could not determine a specific action. Review manually.",
    };
  }

  // Build reasoning
  const reasoning = buildActionReasoning(
    bestMatch.rule.action,
    bestMatch.rule.name,
    context
  );

  // Calculate confidence based on weight and priority match
  let confidence = bestMatch.rule.weight;
  if (
    context.priority.tier === "urgent" &&
    bestMatch.rule.action === "respond"
  ) {
    confidence = Math.min(confidence + 0.1, 1);
  }

  return {
    action: bestMatch.rule.action,
    confidence,
    reasoning,
    details: bestMatch.details,
  };
}

/**
 * Build human-readable reasoning for action suggestion.
 */
function buildActionReasoning(
  action: ActionType,
  ruleName: string,
  _context: ActionContext
): string {
  const actionDescriptions: Record<ActionType, string> = {
    respond: "This email needs a response",
    archive: "This email can be archived",
    delegate: "This email should be delegated",
    schedule: "Schedule time to address this",
    wait: "Wait before taking action",
    escalate: "This should be escalated",
    review: "Review this email manually",
  };

  const ruleReasons: Record<string, string> = {
    "direct-question": "Contains a direct question requiring your input",
    "explicit-request": "Explicitly requests your response or action",
    "commitment-request": "Contains a commitment that needs your attention",
    "fyi-only": "Marked as FYI only, no action needed",
    "newsletter-marketing": "Appears to be a newsletter or marketing email",
    "auto-notification": "Automated notification that doesn't need response",
    "low-priority-aged": "Low priority email that has been waiting over 3 days",
    "wrong-recipient": "May be better handled by someone else",
    "expertise-match": "Matches another team member's expertise area",
    "complex-task": "Requires focused time for a complex task",
    "high-priority-busy": "High priority but you're currently busy",
    "waiting-on-others": "Waiting on external response",
    "thread-in-progress": "Active discussion - wait for it to settle",
    "above-authority": "Requires higher authority approval",
    "sensitive-legal": "Sensitive matter requiring management attention",
    "needs-review": "Requires manual review to determine appropriate action",
  };

  const baseDescription = actionDescriptions[action];
  const ruleReason = ruleReasons[ruleName] ?? "";

  return ruleReason ? `${baseDescription}. ${ruleReason}.` : baseDescription;
}

// =============================================================================
// RESPONSE TIME SUGGESTION
// =============================================================================

/**
 * Suggest when to respond based on priority and context.
 */
export function suggestResponseTime(context: ActionContext): {
  suggested: Date;
  deadline?: Date;
} {
  const now = new Date();

  // Base response windows by priority tier
  const responseWindows: Record<string, number> = {
    urgent: 2, // hours
    high: 8,
    medium: 24,
    low: 72,
  };

  const hours = responseWindows[context.priority.tier] ?? 24;
  const suggested = addHours(now, hours);

  // Check for explicit deadlines
  let deadline: Date | undefined;
  if (context.priority.factors.urgency.deadlineDate) {
    deadline = context.priority.factors.urgency.deadlineDate;
    // Adjust suggestion if deadline is sooner
    if (deadline < suggested) {
      return {
        suggested: addHours(deadline, -2), // 2 hours before deadline
        deadline,
      };
    }
  }

  // Adjust for user patterns
  if (context.userPatterns?.responseTimeByPriority) {
    const patternHours =
      context.userPatterns.responseTimeByPriority[context.priority.tier];
    if (patternHours) {
      return {
        suggested: addHours(now, patternHours),
        deadline,
      };
    }
  }

  return { suggested, deadline };
}

// =============================================================================
// BATCH CLASSIFICATION
// =============================================================================

/**
 * Classify actions for multiple threads.
 */
export function batchClassifyActions(
  contexts: ActionContext[]
): Array<{ context: ActionContext; suggestion: ActionSuggestion }> {
  return contexts.map((context) => ({
    context,
    suggestion: classifyAction(context),
  }));
}
