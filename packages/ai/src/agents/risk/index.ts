// =============================================================================
// RISK AGENT (PRD-09)
// =============================================================================
//
// Policy & Risk Agent - Contradiction detection, fraud signals, policy enforcement.
//

import type { generateText } from "ai";
import {
  CombinedRiskAnalyzer,
  type CombinedRiskInput,
  type CombinedRiskResult,
  type ContradictionResult,
  type FraudDetectionResult,
  type HistoricalStatement,
  type PolicyResult,
  type PolicyRule,
  type SensitiveDataResult,
} from "../../detectors/index.js";
import {
  buildContradictionPrompt,
  buildFraudAnalysisPrompt,
  type ContradictionAnalysisResult,
  type FraudAnalysisResult,
  type FraudAnalysisInput,
  parseJsonResponse,
  RISK_ANALYSIS_SYSTEM_PROMPT,
  type SemanticContradictionInput,
} from "../../prompts/risk/index.js";

// =============================================================================
// TYPES
// =============================================================================

export interface RiskAgentConfig {
  generateText: typeof generateText;
  model: Parameters<typeof generateText>[0]["model"];
  organizationId: string;
  customPolicyRules?: PolicyRule[];
  enableSemanticAnalysis?: boolean;
}

export interface RiskAnalysisRequest {
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
  accountId: string;
  threadId?: string;
  messageId?: string;
}

export interface RiskAnalysisContext {
  historicalStatements?: HistoricalStatement[];
  knownContacts?: string[];
  knownDomains?: string[];
  threadClassification?: string;
  extractedAmounts?: Array<{
    value: number;
    currency: string;
    context: string;
  }>;
}

export interface RiskAnalysisResponse {
  request: RiskAnalysisRequest;
  result: CombinedRiskResult;
  semanticAnalysis?: SemanticAnalysisResult;
  timestamp: Date;
  processingTime: number;
}

export interface SemanticAnalysisResult {
  contradictionAnalysis?: ContradictionAnalysisResult;
  fraudAnalysis?: FraudAnalysisResult;
  enhancedRecommendations: string[];
}

export interface DraftRiskCheckRequest {
  draftContent: string;
  recipients: Array<{
    email: string;
    name?: string;
    domain: string;
    isExternal: boolean;
  }>;
  accountId: string;
  organizationId: string;
}

export interface DraftRiskCheckResponse {
  canSend: boolean;
  blockReasons: string[];
  warnings: string[];
  requiredApprovals: Array<{
    reason: string;
    approverRoles: string[];
  }>;
  riskScore: number;
  riskLevel: "low" | "medium" | "high" | "critical";
  suggestions: string[];
}

// =============================================================================
// RISK AGENT
// =============================================================================

export class RiskAgent {
  private config: RiskAgentConfig;
  private analyzer: CombinedRiskAnalyzer;

  constructor(config: RiskAgentConfig) {
    this.config = config;
    this.analyzer = new CombinedRiskAnalyzer({
      customPolicyRules: config.customPolicyRules,
    });
  }

  /**
   * Analyze risks in an incoming email.
   */
  async analyzeIncomingEmail(
    request: RiskAnalysisRequest,
    context?: RiskAnalysisContext
  ): Promise<RiskAnalysisResponse> {
    const startTime = Date.now();

    // Build combined input
    const combinedInput: CombinedRiskInput = {
      content: request.content,
      subject: request.subject,
      sender: request.sender,
      recipients: request.recipients,
      attachments: request.attachments,
      historicalStatements: context?.historicalStatements,
      knownContacts: context?.knownContacts,
      knownDomains: context?.knownDomains,
      threadClassification: context?.threadClassification,
      extractedAmounts: context?.extractedAmounts,
      organizationId: this.config.organizationId,
      accountId: request.accountId,
    };

    // Run rule-based analysis
    const result = this.analyzer.analyze(combinedInput);

    // Run semantic analysis if enabled and there are potential issues
    let semanticAnalysis: SemanticAnalysisResult | undefined;
    if (
      this.config.enableSemanticAnalysis &&
      (result.fraud.score > 0.3 ||
        result.contradiction.conflicts.length > 0)
    ) {
      semanticAnalysis = await this.runSemanticAnalysis(
        request,
        context,
        result
      );
    }

    return {
      request,
      result,
      semanticAnalysis,
      timestamp: new Date(),
      processingTime: Date.now() - startTime,
    };
  }

  /**
   * Check risks before sending a draft.
   */
  async checkDraftRisks(
    request: DraftRiskCheckRequest,
    context?: RiskAnalysisContext
  ): Promise<DraftRiskCheckResponse> {
    // Build analysis input
    const analysisInput: CombinedRiskInput = {
      content: request.draftContent,
      sender: {
        email: "self",
        domain: "internal",
      },
      recipients: request.recipients,
      historicalStatements: context?.historicalStatements,
      knownContacts: context?.knownContacts,
      knownDomains: context?.knownDomains,
      threadClassification: context?.threadClassification,
      extractedAmounts: context?.extractedAmounts,
      organizationId: request.organizationId,
      accountId: request.accountId,
    };

    // Run analysis
    const result = this.analyzer.analyze(analysisInput);

    // Check for contradictions with semantic analysis if enabled
    let enhancedContradictions: ContradictionAnalysisResult | undefined;
    if (
      this.config.enableSemanticAnalysis &&
      context?.historicalStatements?.length
    ) {
      enhancedContradictions = await this.analyzeContradictionsSemantically({
        draftContent: request.draftContent,
        historicalStatements: context.historicalStatements
          .filter((s) => s.type !== "claim")
          .map((s) => ({
            id: s.id,
            text: s.text,
            source: s.source,
            date: s.date.toISOString(),
            type: s.type as "decision" | "commitment" | "statement",
          })),
      });
    }

    // Compile response
    const blockReasons: string[] = [];
    const warnings: string[] = [];
    const suggestions: string[] = [];

    // Check policy blocks
    if (result.policy.overallStatus === "blocked") {
      blockReasons.push(result.policy.blockedReason ?? "Policy violation");
    }

    // Add contradiction issues
    for (const conflict of result.contradiction.conflicts) {
      if (conflict.severity === "critical" || conflict.severity === "high") {
        warnings.push(`Contradiction: ${conflict.draftStatement}`);
      }
    }

    // Add enhanced contradiction findings
    if (enhancedContradictions) {
      for (const c of enhancedContradictions.contradictions) {
        if (c.severity === "critical" || c.severity === "high") {
          suggestions.push(c.suggestion);
        }
      }
    }

    // Add sensitive data warnings
    if (result.sensitiveData.severity !== "none") {
      for (const warning of result.sensitiveData.recipientWarnings) {
        warnings.push(warning.warning);
      }
    }

    // Add policy warnings
    for (const warning of result.policy.warnings) {
      warnings.push(warning.message);
    }

    // Compile suggestions
    suggestions.push(...result.recommendations);

    // Required approvals
    const requiredApprovals = result.policy.requiredApprovals.map((a) => ({
      reason: a.reason,
      approverRoles: a.approverRoles,
    }));

    return {
      canSend:
        result.policy.overallStatus !== "blocked" && blockReasons.length === 0,
      blockReasons,
      warnings: Array.from(new Set(warnings)),
      requiredApprovals,
      riskScore: result.overallRiskScore,
      riskLevel: result.overallRiskLevel,
      suggestions: Array.from(new Set(suggestions)),
    };
  }

  /**
   * Analyze contradictions using LLM for semantic understanding.
   */
  async analyzeContradictionsSemantically(
    input: SemanticContradictionInput
  ): Promise<ContradictionAnalysisResult> {
    const prompt = buildContradictionPrompt(input);

    const response = await this.config.generateText({
      model: this.config.model,
      system: RISK_ANALYSIS_SYSTEM_PROMPT,
      prompt,
      maxTokens: 2000,
    });

    const parsed = parseJsonResponse<ContradictionAnalysisResult>(
      response.text
    );

    return (
      parsed ?? {
        contradictions: [],
        overallAssessment: "Unable to analyze contradictions",
        confidence: 0,
      }
    );
  }

  /**
   * Analyze fraud signals using LLM.
   */
  async analyzeFraudSemantically(
    input: FraudAnalysisInput
  ): Promise<FraudAnalysisResult> {
    const prompt = buildFraudAnalysisPrompt(input);

    const response = await this.config.generateText({
      model: this.config.model,
      system: RISK_ANALYSIS_SYSTEM_PROMPT,
      prompt,
      maxTokens: 2000,
    });

    const parsed = parseJsonResponse<FraudAnalysisResult>(response.text);

    return (
      parsed ?? {
        isLikelyFraud: false,
        fraudType: "none",
        confidence: 0,
        redFlags: [],
        recommendation: {
          action: "allow",
          reason: "Unable to analyze fraud signals",
          verificationSteps: [],
        },
      }
    );
  }

  /**
   * Run semantic analysis on detected issues.
   */
  private async runSemanticAnalysis(
    request: RiskAnalysisRequest,
    context: RiskAnalysisContext | undefined,
    result: CombinedRiskResult
  ): Promise<SemanticAnalysisResult> {
    const enhancedRecommendations: string[] = [];
    let contradictionAnalysis: ContradictionAnalysisResult | undefined;
    let fraudAnalysis: FraudAnalysisResult | undefined;

    // Run semantic contradiction analysis if there are potential conflicts
    if (
      result.contradiction.conflicts.length > 0 &&
      context?.historicalStatements?.length
    ) {
      contradictionAnalysis = await this.analyzeContradictionsSemantically({
        draftContent: request.content,
        historicalStatements: context.historicalStatements
          .filter((s) => s.type !== "claim")
          .map((s) => ({
            id: s.id,
            text: s.text,
            source: s.source,
            date: s.date.toISOString(),
            type: s.type as "decision" | "commitment" | "statement",
          })),
      });

      for (const c of contradictionAnalysis.contradictions) {
        enhancedRecommendations.push(c.suggestion);
      }
    }

    // Run semantic fraud analysis if there are signals
    if (result.fraud.score > 0.3) {
      fraudAnalysis = await this.analyzeFraudSemantically({
        content: request.content,
        sender: request.sender,
        signals: {
          impersonation: result.fraud.impersonationSignals.map((s) => ({
            type: s.type,
            details: s.explanation,
          })),
          invoiceFraud: result.fraud.invoiceFraudSignals.map((s) => ({
            type: s.type,
            details: s.explanation,
          })),
          phishing: result.fraud.phishingSignals.map((s) => ({
            type: s.type,
            details: s.explanation,
          })),
        },
      });

      if (fraudAnalysis.recommendation.verificationSteps.length > 0) {
        enhancedRecommendations.push(
          ...fraudAnalysis.recommendation.verificationSteps
        );
      }
    }

    return {
      contradictionAnalysis,
      fraudAnalysis,
      enhancedRecommendations,
    };
  }

  /**
   * Get rule-based contradiction analysis.
   */
  getContradictionResult(
    content: string,
    historicalStatements: HistoricalStatement[]
  ): ContradictionResult {
    const input: CombinedRiskInput = {
      content,
      sender: { email: "self", domain: "internal" },
      recipients: [],
      historicalStatements,
      organizationId: this.config.organizationId,
      accountId: "",
    };

    return this.analyzer.analyze(input).contradiction;
  }

  /**
   * Get rule-based sensitive data analysis.
   */
  getSensitiveDataResult(
    content: string,
    recipients: Array<{
      email: string;
      domain: string;
      isExternal: boolean;
    }>
  ): SensitiveDataResult {
    const input: CombinedRiskInput = {
      content,
      sender: { email: "self", domain: "internal" },
      recipients,
      organizationId: this.config.organizationId,
      accountId: "",
    };

    return this.analyzer.analyze(input).sensitiveData;
  }

  /**
   * Get rule-based fraud detection.
   */
  getFraudResult(
    content: string,
    sender: { email: string; name?: string; domain: string },
    knownDomains?: string[]
  ): FraudDetectionResult {
    const input: CombinedRiskInput = {
      content,
      sender,
      recipients: [],
      knownDomains,
      organizationId: this.config.organizationId,
      accountId: "",
    };

    return this.analyzer.analyze(input).fraud;
  }

  /**
   * Get policy evaluation.
   */
  getPolicyResult(
    content: string,
    sender: { email: string; role?: string },
    recipients: Array<{ email: string; domain: string; isExternal: boolean }>,
    attachments?: Array<{ filename: string; mimeType: string; size: number }>
  ): PolicyResult {
    const input: CombinedRiskInput = {
      content,
      sender: { ...sender, domain: "internal" },
      recipients,
      attachments,
      organizationId: this.config.organizationId,
      accountId: "",
    };

    return this.analyzer.analyze(input).policy;
  }
}

// =============================================================================
// FACTORY FUNCTION
// =============================================================================

/**
 * Create a risk agent instance.
 */
export function createRiskAgent(config: RiskAgentConfig): RiskAgent {
  return new RiskAgent(config);
}

// =============================================================================
// RE-EXPORTS
// =============================================================================

export type {
  CombinedRiskInput,
  CombinedRiskResult,
  ContradictionResult,
  FraudDetectionResult,
  HistoricalStatement,
  PolicyResult,
  PolicyRule,
  SensitiveDataResult,
} from "../../detectors/index.js";

export type {
  ContradictionAnalysisResult,
  FraudAnalysisResult,
} from "../../prompts/risk/index.js";
