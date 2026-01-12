// =============================================================================
// DETECTORS MODULE (PRD-09)
// =============================================================================
//
// Exports all risk detection functionality.
//

// Contradiction detection
export {
  ContradictionDetector,
  createContradictionDetector,
  type ContradictionInput,
  type ContradictionResult,
  type ConflictDetail,
  type HistoricalStatement,
  type ResolutionSuggestion,
} from "./contradiction.js";

// Sensitive data detection
export {
  SensitiveDataDetector,
  createSensitiveDataDetector,
  type SensitiveDataInput,
  type SensitiveDataResult,
  type PIIFinding,
  type PIIType,
  type ConfidentialFinding,
  type ConfidentialType,
  type RecipientWarning,
  type RecipientInfo as SensitiveRecipientInfo,
} from "./sensitive.js";

// Fraud detection
export {
  FraudDetector,
  createFraudDetector,
  type FraudDetectionInput,
  type FraudDetectionResult,
  type ImpersonationSignal,
  type InvoiceFraudSignal,
  type PhishingSignal,
  type FraudRecommendation,
} from "./fraud.js";

// Policy enforcement
export {
  PolicyDetector,
  createPolicyDetector,
  createPolicyRule,
  DEFAULT_POLICY_RULES,
  type PolicyRule,
  type PolicyCategory,
  type PolicySeverity,
  type PolicyCondition,
  type ConditionType,
  type ConditionOperator,
  type PolicyAction,
  type ActionType,
  type PolicyInput,
  type RecipientInfo as PolicyRecipientInfo,
  type SenderInfo,
  type AttachmentInfo,
  type ExtractedAmount,
  type PolicyResult,
  type PolicyViolation,
  type PolicyWarning,
  type ApprovalRequest,
  type AuditEntry,
} from "./policy.js";

// =============================================================================
// COMBINED RISK ANALYSIS
// =============================================================================

import { ContradictionDetector, type ContradictionInput, type ContradictionResult, type HistoricalStatement } from "./contradiction.js";
import { FraudDetector, type FraudDetectionInput, type FraudDetectionResult } from "./fraud.js";
import { PolicyDetector, type PolicyInput, type PolicyResult, type PolicyRule } from "./policy.js";
import { SensitiveDataDetector, type SensitiveDataInput, type SensitiveDataResult } from "./sensitive.js";

export interface CombinedRiskInput {
  content: string;
  subject?: string;
  sender: {
    email: string;
    name?: string;
    domain: string;
    role?: string;
    department?: string;
  };
  recipients: Array<{
    email: string;
    name?: string;
    domain: string;
    isExternal: boolean;
    isVerified?: boolean;
  }>;
  attachments?: Array<{
    filename: string;
    mimeType: string;
    size: number;
    hasPassword?: boolean;
  }>;
  historicalStatements?: HistoricalStatement[];
  knownContacts?: string[];
  knownDomains?: string[];
  threadClassification?: string;
  extractedAmounts?: Array<{
    value: number;
    currency: string;
    context: string;
  }>;
  organizationId: string;
  accountId: string;
}

export interface CombinedRiskResult {
  contradiction: ContradictionResult;
  sensitiveData: SensitiveDataResult;
  fraud: FraudDetectionResult;
  policy: PolicyResult;
  overallRiskScore: number;
  overallRiskLevel: "low" | "medium" | "high" | "critical";
  summary: RiskSummary;
  recommendations: string[];
}

export interface RiskSummary {
  totalIssues: number;
  criticalIssues: number;
  highIssues: number;
  mediumIssues: number;
  lowIssues: number;
  categories: string[];
}

/**
 * Combined risk analyzer that runs all detectors.
 */
export class CombinedRiskAnalyzer {
  private contradictionDetector: ContradictionDetector;
  private sensitiveDataDetector: SensitiveDataDetector;
  private fraudDetector: FraudDetector;
  private policyDetector: PolicyDetector;

  constructor(options?: { customPolicyRules?: PolicyRule[] }) {
    this.contradictionDetector = new ContradictionDetector();
    this.sensitiveDataDetector = new SensitiveDataDetector();
    this.fraudDetector = new FraudDetector();
    this.policyDetector = new PolicyDetector(options?.customPolicyRules);
  }

  /**
   * Analyze all risk factors for input.
   */
  analyze(input: CombinedRiskInput): CombinedRiskResult {
    // Run contradiction detection
    const contradictionInput: ContradictionInput = {
      content: input.content,
      contentType: "message",
    };
    const contradiction = this.contradictionDetector.checkContradictions(
      contradictionInput,
      input.historicalStatements ?? []
    );

    // Run sensitive data detection
    const sensitiveInput: SensitiveDataInput = {
      content: input.content + (input.subject ? `\n${input.subject}` : ""),
      recipients: input.recipients?.map((r) => ({
        email: r.email,
        name: r.name,
        isExternal: r.isExternal,
      })),
      organizationDomains: input.knownDomains,
    };
    const sensitiveData = this.sensitiveDataDetector.checkSensitiveData(sensitiveInput);

    // Run fraud detection
    const fraudInput: FraudDetectionInput = {
      content: input.content,
      subject: input.subject,
      senderEmail: input.sender.email,
      senderName: input.sender.name,
      links: extractLinks(input.content),
      attachments: input.attachments?.map((a) => ({
        filename: a.filename,
        mimeType: a.mimeType,
        sizeBytes: a.size,
      })),
      knownContacts: input.knownContacts?.map((email) => ({
        email,
        name: email.split("@")[0] ?? email,
      })),
      organizationDomains: input.knownDomains,
    };
    const fraud = this.fraudDetector.detectFraud(fraudInput);

    // Run policy detection
    const policyInput: PolicyInput = {
      content: input.content,
      subject: input.subject,
      recipients: input.recipients,
      sender: input.sender,
      attachments: input.attachments,
      threadClassification: input.threadClassification,
      extractedAmounts: input.extractedAmounts,
      organizationId: input.organizationId,
      accountId: input.accountId,
    };
    const policy = this.policyDetector.evaluate(policyInput);

    // Calculate overall risk score
    const riskScores = {
      contradiction: 1 - contradiction.score,
      sensitiveData: sensitiveData.severity === "critical" ? 1.0 :
                     sensitiveData.severity === "high" ? 0.75 :
                     sensitiveData.severity === "medium" ? 0.5 :
                     sensitiveData.severity === "low" ? 0.25 : 0,
      fraud: fraud.score,
      policy: policy.overallStatus === "blocked" ? 1.0 :
              policy.overallStatus === "pending_approval" ? 0.6 :
              policy.overallStatus === "warning" ? 0.3 : 0,
    };

    const overallRiskScore = Math.max(
      riskScores.contradiction,
      riskScores.sensitiveData,
      riskScores.fraud,
      riskScores.policy
    );

    const overallRiskLevel =
      overallRiskScore >= 0.8 ? "critical" :
      overallRiskScore >= 0.6 ? "high" :
      overallRiskScore >= 0.3 ? "medium" : "low";

    // Build summary
    const summary = this.buildSummary(contradiction, sensitiveData, fraud, policy);

    // Compile recommendations
    const recommendations = this.compileRecommendations(
      contradiction,
      sensitiveData,
      fraud,
      policy
    );

    return {
      contradiction,
      sensitiveData,
      fraud,
      policy,
      overallRiskScore,
      overallRiskLevel,
      summary,
      recommendations,
    };
  }

  /**
   * Build risk summary.
   */
  private buildSummary(
    contradiction: ContradictionResult,
    sensitiveData: SensitiveDataResult,
    fraud: FraudDetectionResult,
    policy: PolicyResult
  ): RiskSummary {
    const categories: string[] = [];
    let critical = 0;
    let high = 0;
    let medium = 0;
    let low = 0;

    // Count contradiction issues
    for (const conflict of contradiction.conflicts) {
      if (conflict.severity === "critical") critical++;
      else if (conflict.severity === "high") high++;
      else if (conflict.severity === "medium") medium++;
      else low++;
      if (!categories.includes("contradiction")) {
        categories.push("contradiction");
      }
    }

    // Count sensitive data issues
    if (sensitiveData.piiFindings.length > 0 || sensitiveData.confidentialFindings.length > 0) {
      if (!categories.includes("sensitive_data")) {
        categories.push("sensitive_data");
      }
      if (sensitiveData.severity === "critical") critical++;
      else if (sensitiveData.severity === "high") high++;
      else if (sensitiveData.severity === "medium") medium++;
      else if (sensitiveData.severity === "low") low++;
    }

    // Count fraud issues
    const fraudSignals = [
      ...fraud.impersonationSignals,
      ...fraud.invoiceFraudSignals,
      ...fraud.phishingSignals,
    ];
    for (const signal of fraudSignals) {
      if (signal.severity === "critical") critical++;
      else if (signal.severity === "high") high++;
      else if (signal.severity === "medium") medium++;
      else low++;
    }
    if (fraudSignals.length > 0 && !categories.includes("fraud")) {
      categories.push("fraud");
    }

    // Count policy issues
    for (const violation of policy.violations) {
      if (violation.severity === "critical") critical++;
      else if (violation.severity === "violation") high++;
      else if (violation.severity === "warning") medium++;
      else low++;
      if (!categories.includes("policy")) {
        categories.push("policy");
      }
    }

    return {
      totalIssues: critical + high + medium + low,
      criticalIssues: critical,
      highIssues: high,
      mediumIssues: medium,
      lowIssues: low,
      categories,
    };
  }

  /**
   * Compile all recommendations.
   */
  private compileRecommendations(
    contradiction: ContradictionResult,
    sensitiveData: SensitiveDataResult,
    fraud: FraudDetectionResult,
    policy: PolicyResult
  ): string[] {
    const recommendations: string[] = [];

    // Contradiction recommendations
    for (const suggestion of contradiction.suggestions) {
      recommendations.push(suggestion.description);
    }

    // Sensitive data recommendations
    for (const warning of sensitiveData.recipientWarnings) {
      recommendations.push(warning.warning);
    }
    if (sensitiveData.piiFindings.length > 0) {
      recommendations.push("Review and redact any unnecessary PII before sending");
    }

    // Fraud recommendations
    for (const rec of fraud.recommendations) {
      if (rec.type !== "ignore") {
        recommendations.push(rec.action);
      }
    }

    // Policy recommendations
    for (const violation of policy.violations) {
      recommendations.push(violation.suggestedAction);
    }

    // Deduplicate
    return Array.from(new Set(recommendations));
  }
}

/**
 * Extract links from content.
 */
function extractLinks(content: string): string[] {
  const urlRegex = /https?:\/\/[^\s<>"']+/gi;
  const matches = content.match(urlRegex);
  return matches ?? [];
}

/**
 * Create a combined risk analyzer.
 */
export function createCombinedRiskAnalyzer(options?: {
  customPolicyRules?: PolicyRule[];
}): CombinedRiskAnalyzer {
  return new CombinedRiskAnalyzer(options);
}
