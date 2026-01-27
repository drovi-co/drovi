// =============================================================================
// PRIORITY SCORING (PRD-07)
// =============================================================================
//
// Urgency and importance assessment for email triage.
// Implements the priority matrix for inbox ranking.
//

// =============================================================================
// TYPES
// =============================================================================

export type PriorityTier = "urgent" | "high" | "medium" | "low";

export interface UrgencyFactors {
  hasExplicitDeadline: boolean;
  deadlineDate?: Date;
  hasUrgentLanguage: boolean;
  urgentKeywords: string[];
  senderIsVIP: boolean;
  isReplyExpected: boolean;
  threadAge: number; // hours since last message
  mentionsToday: boolean;
  mentionsASAP: boolean;
}

export interface ImportanceFactors {
  senderImportance: number; // 0-1
  senderIsVIP: boolean;
  senderIsInternal: boolean;
  hasClaim: boolean;
  claimType?: "decision" | "commitment" | "question";
  hasFinancialMention: boolean;
  financialAmount?: number;
  hasLegalMention: boolean;
  recipientCount: number;
  isDirectMessage: boolean;
  topicImportance: number; // 0-1 based on historical patterns
}

export interface PriorityResult {
  tier: PriorityTier;
  urgencyScore: number;
  importanceScore: number;
  combinedScore: number;
  factors: {
    urgency: Partial<UrgencyFactors>;
    importance: Partial<ImportanceFactors>;
  };
  reasoning: string;
}

export interface ThreadForPriority {
  id: string;
  subject: string;
  snippet?: string;
  lastMessageAt: Date;
  messageCount: number;
  participants: Array<{
    address: string;
    name?: string;
    isVIP?: boolean;
    isInternal?: boolean;
  }>;
  claims?: Array<{
    type: string;
    content: string;
    dueDate?: Date;
  }>;
  bodyText?: string;
  classification?: string;
}

// =============================================================================
// CONSTANTS
// =============================================================================

const URGENT_KEYWORDS = [
  "urgent",
  "asap",
  "immediately",
  "critical",
  "emergency",
  "deadline",
  "by today",
  "by eod",
  "end of day",
  "time-sensitive",
  "time sensitive",
  "high priority",
  "action required",
  "response needed",
  "needs immediate",
  "as soon as possible",
];

const FINANCIAL_KEYWORDS = [
  "invoice",
  "payment",
  "budget",
  "contract",
  "proposal",
  "quote",
  "pricing",
  "cost",
  "expense",
  "revenue",
  "deal",
  "negotiation",
];

const LEGAL_KEYWORDS = [
  "legal",
  "contract",
  "agreement",
  "terms",
  "compliance",
  "liability",
  "lawsuit",
  "attorney",
  "lawyer",
  "nda",
  "confidential",
];

// =============================================================================
// URGENCY ASSESSMENT
// =============================================================================

/**
 * Assess the urgency of a thread.
 * Urgency = how time-sensitive is this email?
 */
export function assessUrgency(thread: ThreadForPriority): {
  score: number;
  factors: Partial<UrgencyFactors>;
} {
  const factors: Partial<UrgencyFactors> = {};
  let score = 0;
  const weights = {
    explicitDeadline: 0.35,
    urgentLanguage: 0.25,
    vipSender: 0.15,
    replyExpected: 0.1,
    threadAge: 0.1,
    todayMention: 0.05,
  };

  const text =
    `${thread.subject} ${thread.snippet ?? ""} ${thread.bodyText ?? ""}`.toLowerCase();

  // Check for explicit deadlines
  const deadlinePatterns = [
    /by\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)/i,
    /by\s+(\d{1,2}\/\d{1,2})/i,
    /due\s+(date|by)/i,
    /deadline[:\s]/i,
    /before\s+(end of|eod|cob)/i,
  ];

  for (const pattern of deadlinePatterns) {
    if (pattern.test(text)) {
      factors.hasExplicitDeadline = true;
      score += weights.explicitDeadline;
      break;
    }
  }

  // Check for claims with due dates
  if (thread.claims?.some((c) => c.dueDate)) {
    factors.hasExplicitDeadline = true;
    const nearestDue = thread.claims
      .filter((c) => c.dueDate)
      .map((c) => c.dueDate!)
      .sort((a, b) => a.getTime() - b.getTime())[0];

    if (nearestDue) {
      factors.deadlineDate = nearestDue;
      const hoursUntilDue =
        (nearestDue.getTime() - Date.now()) / (1000 * 60 * 60);
      if (hoursUntilDue < 24) {
        score += weights.explicitDeadline * 1.5; // Boost for imminent deadline
      } else {
        score += weights.explicitDeadline;
      }
    }
  }

  // Check for urgent language
  const foundKeywords = URGENT_KEYWORDS.filter((kw) => text.includes(kw));
  if (foundKeywords.length > 0) {
    factors.hasUrgentLanguage = true;
    factors.urgentKeywords = foundKeywords;
    score += weights.urgentLanguage * Math.min(foundKeywords.length / 2, 1);
  }

  // Check for ASAP or today mentions specifically
  factors.mentionsASAP = /asap|a\.s\.a\.p/i.test(text);
  factors.mentionsToday = /today|tonight|this morning|this afternoon/i.test(
    text
  );

  if (factors.mentionsASAP) {
    score += weights.todayMention;
  }
  if (factors.mentionsToday) {
    score += weights.todayMention;
  }

  // VIP sender boost
  const hasVIPSender = thread.participants.some((p) => p.isVIP);
  if (hasVIPSender) {
    factors.senderIsVIP = true;
    score += weights.vipSender;
  }

  // Reply expected
  const replyIndicators = [
    /please\s+(reply|respond|let me know)/i,
    /waiting\s+(for|on)\s+(your|a)\s+(response|reply)/i,
    /\?$/,
    /what\s+do\s+you\s+think/i,
    /can\s+you\s+(please|kindly)/i,
  ];

  for (const pattern of replyIndicators) {
    if (pattern.test(text)) {
      factors.isReplyExpected = true;
      score += weights.replyExpected;
      break;
    }
  }

  // Thread age - older unanswered threads become more urgent
  const hoursOld =
    (Date.now() - thread.lastMessageAt.getTime()) / (1000 * 60 * 60);
  factors.threadAge = hoursOld;

  if (hoursOld > 48) {
    score += weights.threadAge;
  } else if (hoursOld > 24) {
    score += weights.threadAge * 0.5;
  }

  return {
    score: Math.min(score, 1),
    factors,
  };
}

// =============================================================================
// IMPORTANCE ASSESSMENT
// =============================================================================

/**
 * Assess the importance of a thread.
 * Importance = how significant is this email for business/work?
 */
export function assessImportance(thread: ThreadForPriority): {
  score: number;
  factors: Partial<ImportanceFactors>;
} {
  const factors: Partial<ImportanceFactors> = {};
  let score = 0;
  const weights = {
    senderImportance: 0.25,
    hasClaim: 0.2,
    financial: 0.15,
    legal: 0.15,
    directMessage: 0.1,
    topicImportance: 0.1,
    recipientCount: 0.05,
  };

  const text =
    `${thread.subject} ${thread.snippet ?? ""} ${thread.bodyText ?? ""}`.toLowerCase();

  // Sender importance
  const vipParticipants = thread.participants.filter((p) => p.isVIP);
  const internalParticipants = thread.participants.filter((p) => p.isInternal);

  if (vipParticipants.length > 0) {
    factors.senderIsVIP = true;
    factors.senderImportance = 1;
    score += weights.senderImportance;
  } else if (internalParticipants.length > 0) {
    factors.senderIsInternal = true;
    factors.senderImportance = 0.7;
    score += weights.senderImportance * 0.7;
  } else {
    factors.senderImportance = 0.3;
    score += weights.senderImportance * 0.3;
  }

  // Claims presence
  if (thread.claims && thread.claims.length > 0) {
    factors.hasClaim = true;
    const claimTypes = thread.claims.map((c) => c.type);

    if (claimTypes.includes("decision")) {
      factors.claimType = "decision";
      score += weights.hasClaim;
    } else if (claimTypes.includes("commitment")) {
      factors.claimType = "commitment";
      score += weights.hasClaim * 0.9;
    } else if (claimTypes.includes("question")) {
      factors.claimType = "question";
      score += weights.hasClaim * 0.7;
    }
  }

  // Financial mentions
  const hasFinancial = FINANCIAL_KEYWORDS.some((kw) => text.includes(kw));
  if (hasFinancial) {
    factors.hasFinancialMention = true;
    score += weights.financial;

    // Try to extract amounts
    const amountMatch = text.match(/\$[\d,]+(?:\.\d{2})?|\d+k|\d+\s*million/i);
    if (amountMatch) {
      const amountStr = amountMatch[0].toLowerCase();
      if (amountStr.includes("million")) {
        factors.financialAmount = 1_000_000;
        score += weights.financial * 0.5; // Extra boost for large amounts
      } else if (amountStr.includes("k")) {
        factors.financialAmount = Number.parseInt(amountStr, 10) * 1000;
      }
    }
  }

  // Legal mentions
  const hasLegal = LEGAL_KEYWORDS.some((kw) => text.includes(kw));
  if (hasLegal) {
    factors.hasLegalMention = true;
    score += weights.legal;
  }

  // Direct message vs broadcast
  factors.recipientCount = thread.participants.length;
  if (thread.participants.length <= 2) {
    factors.isDirectMessage = true;
    score += weights.directMessage;
  } else if (thread.participants.length > 10) {
    // Likely a broadcast, less important
    score -= weights.recipientCount;
  }

  // Topic importance based on classification
  if (thread.classification) {
    const importantClassifications = [
      "actionable",
      "decision-required",
      "needs-response",
    ];
    if (
      importantClassifications.some((c) =>
        thread.classification?.toLowerCase().includes(c)
      )
    ) {
      factors.topicImportance = 0.8;
      score += weights.topicImportance * 0.8;
    }
  }

  return {
    score: Math.min(Math.max(score, 0), 1),
    factors,
  };
}

// =============================================================================
// PRIORITY MATRIX
// =============================================================================

/**
 * Combine urgency and importance into a priority tier.
 *
 * Matrix:
 *                 High Importance    Low Importance
 * High Urgency  │    URGENT     │      HIGH       │
 *               │   (Do Now)    │  (Do Soon)      │
 *               ├───────────────┼─────────────────┤
 * Low Urgency   │     HIGH      │      LOW        │
 *               │  (Schedule)   │  (Archive?)     │
 */
export function calculatePriorityTier(
  urgencyScore: number,
  importanceScore: number
): PriorityTier {
  const urgencyThreshold = 0.5;
  const importanceThreshold = 0.5;

  const isUrgent = urgencyScore >= urgencyThreshold;
  const isImportant = importanceScore >= importanceThreshold;

  if (isUrgent && isImportant) {
    return "urgent";
  }
  if (isUrgent || isImportant) {
    return "high";
  }
  if (urgencyScore >= 0.3 || importanceScore >= 0.3) {
    return "medium";
  }
  return "low";
}

/**
 * Generate human-readable reasoning for the priority.
 */
export function generatePriorityReasoning(
  tier: PriorityTier,
  urgencyFactors: Partial<UrgencyFactors>,
  importanceFactors: Partial<ImportanceFactors>
): string {
  const reasons: string[] = [];

  // Urgency reasons
  if (urgencyFactors.hasExplicitDeadline) {
    if (urgencyFactors.deadlineDate) {
      const daysUntil = Math.ceil(
        (urgencyFactors.deadlineDate.getTime() - Date.now()) /
          (1000 * 60 * 60 * 24)
      );
      if (daysUntil <= 0) {
        reasons.push("Deadline is today or overdue");
      } else if (daysUntil === 1) {
        reasons.push("Deadline is tomorrow");
      } else {
        reasons.push(`Deadline in ${daysUntil} days`);
      }
    } else {
      reasons.push("Has explicit deadline mentioned");
    }
  }

  if (urgencyFactors.hasUrgentLanguage && urgencyFactors.urgentKeywords) {
    reasons.push(
      `Contains urgent language: "${urgencyFactors.urgentKeywords.slice(0, 2).join('", "')}"`
    );
  }

  if (urgencyFactors.senderIsVIP) {
    reasons.push("From VIP sender");
  }

  if (urgencyFactors.isReplyExpected) {
    reasons.push("Reply expected");
  }

  if (urgencyFactors.threadAge && urgencyFactors.threadAge > 48) {
    reasons.push(
      `Waiting ${Math.round(urgencyFactors.threadAge / 24)} days for response`
    );
  }

  // Importance reasons
  if (importanceFactors.senderIsVIP) {
    reasons.push("From important contact");
  }

  if (importanceFactors.hasClaim && importanceFactors.claimType) {
    const claimTypeLabels: Record<string, string> = {
      decision: "Contains a decision",
      commitment: "Contains a commitment",
      question: "Contains a question needing answer",
    };
    reasons.push(claimTypeLabels[importanceFactors.claimType] ?? "");
  }

  if (importanceFactors.hasFinancialMention) {
    if (
      importanceFactors.financialAmount &&
      importanceFactors.financialAmount >= 10_000
    ) {
      reasons.push(
        `Involves $${importanceFactors.financialAmount.toLocaleString()}`
      );
    } else {
      reasons.push("Involves financial matters");
    }
  }

  if (importanceFactors.hasLegalMention) {
    reasons.push("Involves legal matters");
  }

  if (importanceFactors.isDirectMessage) {
    reasons.push("Direct message (not broadcast)");
  }

  // Build final reasoning
  const tierLabels: Record<PriorityTier, string> = {
    urgent: "Urgent - requires immediate attention",
    high: "High priority - address soon",
    medium: "Medium priority - handle when possible",
    low: "Low priority - can wait or archive",
  };

  if (reasons.length === 0) {
    return tierLabels[tier];
  }

  return `${tierLabels[tier]}. ${reasons.join(". ")}.`;
}

// =============================================================================
// MAIN PRIORITY FUNCTION
// =============================================================================

/**
 * Calculate full priority for a thread.
 */
export function calculatePriority(thread: ThreadForPriority): PriorityResult {
  const urgency = assessUrgency(thread);
  const importance = assessImportance(thread);

  const tier = calculatePriorityTier(urgency.score, importance.score);

  // Combined score (weighted average)
  const combinedScore = urgency.score * 0.6 + importance.score * 0.4;

  const reasoning = generatePriorityReasoning(
    tier,
    urgency.factors,
    importance.factors
  );

  return {
    tier,
    urgencyScore: urgency.score,
    importanceScore: importance.score,
    combinedScore,
    factors: {
      urgency: urgency.factors,
      importance: importance.factors,
    },
    reasoning,
  };
}

// =============================================================================
// DYNAMIC RE-RANKING
// =============================================================================

/**
 * Re-calculate priority with time decay and new context.
 */
export function recalculatePriority(
  _currentPriority: PriorityResult,
  thread: ThreadForPriority,
  options: {
    hoursSinceLastCalculation?: number;
    newInformation?: boolean;
  } = {}
): PriorityResult {
  const { hoursSinceLastCalculation = 0 } = options;

  // Re-calculate from scratch
  const newPriority = calculatePriority(thread);

  // Apply time-based urgency boost for aging threads
  if (hoursSinceLastCalculation > 0) {
    const ageBoost = Math.min(hoursSinceLastCalculation / 72, 0.2); // Max 0.2 boost over 3 days
    newPriority.urgencyScore = Math.min(newPriority.urgencyScore + ageBoost, 1);

    // Recalculate tier with boosted urgency
    newPriority.tier = calculatePriorityTier(
      newPriority.urgencyScore,
      newPriority.importanceScore
    );
    newPriority.combinedScore =
      newPriority.urgencyScore * 0.6 + newPriority.importanceScore * 0.4;
  }

  return newPriority;
}

// =============================================================================
// BATCH PRIORITY
// =============================================================================

/**
 * Calculate priorities for multiple threads and return sorted.
 */
export function batchCalculatePriority(
  threads: ThreadForPriority[]
): Array<{ thread: ThreadForPriority; priority: PriorityResult }> {
  const results = threads.map((thread) => ({
    thread,
    priority: calculatePriority(thread),
  }));

  // Sort by combined score (highest first)
  return results.sort(
    (a, b) => b.priority.combinedScore - a.priority.combinedScore
  );
}
