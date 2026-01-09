// =============================================================================
// RELATIONSHIP SCORING
// =============================================================================
//
// Calculate importance scores, health scores, VIP detection, and risk flagging.
//

import type {
  HealthScore,
  ImportanceScore,
  RiskFlagging,
  VIPDetection,
} from "../types";
import type { CommunicationMetrics } from "./communication";

// =============================================================================
// IMPORTANCE SCORING
// =============================================================================

/**
 * Scoring weights for importance calculation.
 */
const IMPORTANCE_WEIGHTS = {
  frequency: 0.3,
  responsiveness: 0.2,
  threadVolume: 0.2,
  senioritySignal: 0.15,
  dealInvolvement: 0.15,
};

/**
 * Calculate importance score for a contact.
 */
export function calculateImportanceScore(
  metrics: CommunicationMetrics,
  senioritySignals: {
    hasExecutiveTitle: boolean;
    hasHighValueDomain: boolean;
    hasDecisionMakerIndicators: boolean;
  },
  dealInvolvement: {
    isInActiveDeals: boolean;
    dealValue?: number;
    dealCount: number;
  }
): ImportanceScore {
  // Frequency score (0-1)
  const frequencyScore = Math.min(1, metrics.frequency.threadsPerMonth / 10);

  // Responsiveness score (0-1) - higher response rate = higher importance
  const responsivenessScore = metrics.responsiveness.responseRate;

  // Thread volume score (0-1)
  const threadVolumeScore = Math.min(1, metrics.summary.totalThreads / 50);

  // Seniority signal score (0-1)
  let seniorityScore = 0;
  if (senioritySignals.hasExecutiveTitle) {
    seniorityScore += 0.5;
  }
  if (senioritySignals.hasHighValueDomain) {
    seniorityScore += 0.25;
  }
  if (senioritySignals.hasDecisionMakerIndicators) {
    seniorityScore += 0.25;
  }

  // Deal involvement score (0-1)
  let dealScore = 0;
  if (dealInvolvement.isInActiveDeals) {
    dealScore = Math.min(1, 0.5 + dealInvolvement.dealCount * 0.25);
  }

  // Calculate overall score
  const overall =
    frequencyScore * IMPORTANCE_WEIGHTS.frequency +
    responsivenessScore * IMPORTANCE_WEIGHTS.responsiveness +
    threadVolumeScore * IMPORTANCE_WEIGHTS.threadVolume +
    seniorityScore * IMPORTANCE_WEIGHTS.senioritySignal +
    dealScore * IMPORTANCE_WEIGHTS.dealInvolvement;

  // Identify factors
  const factors: string[] = [];
  if (frequencyScore > 0.5) {
    factors.push("High communication frequency");
  }
  if (responsivenessScore > 0.7) {
    factors.push("Very responsive");
  }
  if (threadVolumeScore > 0.5) {
    factors.push("Large interaction history");
  }
  if (senioritySignals.hasExecutiveTitle) {
    factors.push("Executive-level contact");
  }
  if (dealInvolvement.isInActiveDeals) {
    factors.push("Involved in active deals");
  }

  return {
    overall: Math.round(overall * 100) / 100,
    components: {
      frequency: Math.round(frequencyScore * 100) / 100,
      responsiveness: Math.round(responsivenessScore * 100) / 100,
      threadVolume: Math.round(threadVolumeScore * 100) / 100,
      senioritySignal: Math.round(seniorityScore * 100) / 100,
      dealInvolvement: Math.round(dealScore * 100) / 100,
    },
    factors,
  };
}

// =============================================================================
// HEALTH SCORING
// =============================================================================

/**
 * Calculate relationship health score.
 */
export function calculateHealthScore(
  currentMetrics: CommunicationMetrics,
  baselineMetrics: CommunicationMetrics,
  sentimentData: {
    recentSentiment: number; // -1 to 1
    baselineSentiment: number; // -1 to 1
  }
): HealthScore {
  // Calculate frequency ratio (recent vs baseline)
  const frequencyRatio =
    baselineMetrics.frequency.threadsPerMonth > 0
      ? currentMetrics.frequency.threadsPerMonth /
        baselineMetrics.frequency.threadsPerMonth
      : currentMetrics.frequency.threadsPerMonth > 0
        ? 2
        : 1;

  // Calculate sentiment trend (-1 to 1)
  const sentimentTrend =
    sentimentData.recentSentiment - sentimentData.baselineSentiment;

  // Calculate response rate trend (-1 to 1)
  const responseRateTrend =
    currentMetrics.responsiveness.responseRate -
    baselineMetrics.responsiveness.responseRate;

  // Calculate overall health score
  // Normalize frequency ratio to 0-1 scale (0.5 = baseline, 1 = 2x, 0 = 0x)
  const normalizedFrequency = Math.min(1, Math.max(0, frequencyRatio / 2));

  // Normalize sentiment trend to 0-1 scale
  const normalizedSentiment = (sentimentTrend + 1) / 2;

  // Normalize response rate trend to 0-1 scale
  const normalizedResponseRate = (responseRateTrend + 1) / 2;

  const overall =
    normalizedFrequency * 0.4 +
    normalizedSentiment * 0.3 +
    normalizedResponseRate * 0.3;

  // Determine trend
  let trend: HealthScore["trend"] = "stable";
  if (frequencyRatio > 1.2 && sentimentTrend >= 0) {
    trend = "improving";
  } else if (frequencyRatio < 0.5 || sentimentTrend < -0.3) {
    trend = "declining";
  }

  // Generate warnings
  const warnings: string[] = [];
  if (frequencyRatio < 0.3) {
    warnings.push("Communication frequency has dropped significantly");
  }
  if (sentimentTrend < -0.3) {
    warnings.push("Sentiment has become more negative");
  }
  if (responseRateTrend < -0.2) {
    warnings.push("Response rate has decreased");
  }
  if (currentMetrics.direction.trend === "user_initiating_more") {
    warnings.push("You are always initiating conversations");
  }

  return {
    overall: Math.round(overall * 100) / 100,
    trend,
    components: {
      frequencyRatio: Math.round(frequencyRatio * 100) / 100,
      sentimentTrend: Math.round(sentimentTrend * 100) / 100,
      responseRateTrend: Math.round(responseRateTrend * 100) / 100,
    },
    warnings,
  };
}

// =============================================================================
// VIP DETECTION
// =============================================================================

/**
 * Executive title patterns.
 */
const EXECUTIVE_TITLES = [
  /\b(ceo|cfo|cto|coo|cmo|ciso|cpo|cro)\b/i,
  /\bchief\s+\w+\s+officer\b/i,
  /\b(president|vice\s+president|vp)\b/i,
  /\b(founder|co-founder|owner)\b/i,
  /\b(director|managing\s+director)\b/i,
  /\b(partner|senior\s+partner)\b/i,
  /\b(head\s+of)\b/i,
  /\b(svp|evp)\b/i,
];

/**
 * Check if a title indicates executive level.
 */
export function isExecutiveTitle(title: string): boolean {
  return EXECUTIVE_TITLES.some((pattern) => pattern.test(title));
}

/**
 * High-value domains (enterprise companies).
 */
const HIGH_VALUE_DOMAINS = new Set([
  "google.com",
  "microsoft.com",
  "amazon.com",
  "apple.com",
  "meta.com",
  "facebook.com",
  "salesforce.com",
  "oracle.com",
  "ibm.com",
  "cisco.com",
  "intel.com",
  "adobe.com",
  "sap.com",
  "vmware.com",
  "nvidia.com",
  // Add more as needed
]);

/**
 * Check if an email domain is high-value.
 */
export function isHighValueDomain(email: string): boolean {
  const domain = email.split("@")[1]?.toLowerCase();
  return domain ? HIGH_VALUE_DOMAINS.has(domain) : false;
}

/**
 * Detect if a contact should be marked as VIP.
 */
export function detectVIP(
  importanceScore: ImportanceScore,
  contact: {
    title?: string;
    email: string;
    company?: string;
    userOverrideVip?: boolean;
  },
  _activityThresholds: {
    minThreads: number;
    minResponseRate: number;
  } = { minThreads: 5, minResponseRate: 0.5 }
): VIPDetection {
  const signals: VIPDetection["signals"] = [];

  // Check user override
  if (contact.userOverrideVip === true) {
    return {
      isVip: true,
      confidence: 1.0,
      reasons: ["Manually marked as VIP"],
      signals: [
        {
          type: "user_override",
          strength: 1.0,
          description: "User marked this contact as VIP",
        },
      ],
    };
  }

  if (contact.userOverrideVip === false) {
    return {
      isVip: false,
      confidence: 1.0,
      reasons: ["Manually unmarked as VIP"],
      signals: [],
    };
  }

  // Check executive title
  if (contact.title && isExecutiveTitle(contact.title)) {
    signals.push({
      type: "seniority",
      strength: 0.9,
      description: `Executive title: ${contact.title}`,
    });
  }

  // Check high-value domain
  if (isHighValueDomain(contact.email)) {
    signals.push({
      type: "seniority",
      strength: 0.7,
      description: "Works at a major enterprise company",
    });
  }

  // Check frequency signal
  if (importanceScore.components.frequency > 0.7) {
    signals.push({
      type: "frequency",
      strength: importanceScore.components.frequency,
      description: "Very high communication frequency",
    });
  }

  // Check responsiveness signal
  if (importanceScore.components.responsiveness > 0.8) {
    signals.push({
      type: "frequency",
      strength: importanceScore.components.responsiveness * 0.8,
      description: "Highly responsive contact",
    });
  }

  // Check deal involvement
  if (importanceScore.components.dealInvolvement > 0.5) {
    signals.push({
      type: "deal",
      strength: importanceScore.components.dealInvolvement,
      description: "Involved in active deals",
    });
  }

  // Calculate overall VIP probability
  const totalStrength = signals.reduce((sum, s) => sum + s.strength, 0);
  const avgStrength = signals.length > 0 ? totalStrength / signals.length : 0;
  const maxStrength =
    signals.length > 0 ? Math.max(...signals.map((s) => s.strength)) : 0;

  // VIP if any strong signal or combination of signals
  const isVip =
    maxStrength >= 0.9 ||
    (signals.length >= 2 && avgStrength >= 0.6) ||
    importanceScore.overall >= 0.8;

  const confidence = isVip
    ? Math.min(1, maxStrength + signals.length * 0.1)
    : 1 - avgStrength;

  const reasons = signals
    .filter((s) => s.strength >= 0.5)
    .map((s) => s.description);

  return {
    isVip,
    confidence: Math.round(confidence * 100) / 100,
    reasons,
    signals,
  };
}

// =============================================================================
// RISK FLAGGING
// =============================================================================

/**
 * Flag relationships at risk.
 */
export function flagRisk(
  healthScore: HealthScore,
  metrics: CommunicationMetrics,
  lastContactDaysAgo: number
): RiskFlagging {
  const reasons: string[] = [];
  let riskLevel: RiskFlagging["riskLevel"] = "low";

  // Check days since last contact
  if (lastContactDaysAgo > 90) {
    reasons.push(`No contact in ${lastContactDaysAgo} days`);
    riskLevel = "high";
  } else if (lastContactDaysAgo > 60) {
    reasons.push(`No contact in ${lastContactDaysAgo} days`);
    riskLevel = riskLevel === "low" ? "medium" : riskLevel;
  } else if (lastContactDaysAgo > 30) {
    reasons.push(`No contact in ${lastContactDaysAgo} days`);
  }

  // Check frequency drop
  const frequencyDropPercent =
    (1 - healthScore.components.frequencyRatio) * 100;
  if (frequencyDropPercent > 70) {
    reasons.push("Communication frequency dropped significantly");
    riskLevel = "high";
  } else if (frequencyDropPercent > 50) {
    reasons.push("Communication frequency declining");
    riskLevel = riskLevel === "low" ? "medium" : riskLevel;
  }

  // Check sentiment change
  const sentimentChange = healthScore.components.sentimentTrend;
  if (sentimentChange < -0.5) {
    reasons.push("Relationship sentiment has become very negative");
    riskLevel = "high";
  } else if (sentimentChange < -0.3) {
    reasons.push("Relationship sentiment declining");
    riskLevel = riskLevel === "low" ? "medium" : riskLevel;
  }

  // Check response rate
  if (metrics.responsiveness.responseRate < 0.2) {
    reasons.push("Very low response rate");
    riskLevel = riskLevel === "low" ? "medium" : riskLevel;
  }

  // Check health warnings
  for (const warning of healthScore.warnings) {
    if (!reasons.includes(warning)) {
      reasons.push(warning);
    }
  }

  const isAtRisk = riskLevel !== "low";

  // Suggest action
  let suggestedAction: string | undefined;
  if (riskLevel === "high") {
    suggestedAction =
      "Schedule a call or send a personal check-in message immediately";
  } else if (riskLevel === "medium") {
    suggestedAction = "Consider reaching out to re-engage";
  }

  return {
    isAtRisk,
    riskLevel,
    reasons,
    metrics: {
      daysSinceLastContact: lastContactDaysAgo,
      frequencyDropPercent: Math.round(frequencyDropPercent),
      sentimentChange: Math.round(sentimentChange * 100) / 100,
    },
    suggestedAction,
  };
}

// =============================================================================
// ENGAGEMENT SCORE
// =============================================================================

/**
 * Calculate overall engagement score.
 */
export function calculateEngagementScore(
  metrics: CommunicationMetrics
): number {
  // Combine frequency, responsiveness, and direction into engagement
  const frequencyScore = Math.min(1, metrics.frequency.messagesPerMonth / 20);
  const responsivenessScore = metrics.responsiveness.responseRate;

  // Direction balance (0.5 = perfectly balanced, 0 or 1 = one-sided)
  const directionBalance =
    1 -
    Math.abs(
      metrics.direction.initiatedByUser /
        Math.max(
          1,
          metrics.direction.initiatedByUser +
            metrics.direction.initiatedByContact
        ) -
        0.5
    ) *
      2;

  const engagement =
    frequencyScore * 0.4 + responsivenessScore * 0.4 + directionBalance * 0.2;

  return Math.round(engagement * 100) / 100;
}
