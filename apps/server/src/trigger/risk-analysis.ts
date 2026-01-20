// =============================================================================
// RISK ANALYSIS TRIGGER.DEV TASKS (PRD-09)
// =============================================================================
//
// Background tasks for risk analysis, fraud detection, and policy enforcement.
//

import type {
  CombinedRiskResult,
  HistoricalStatement,
} from "@memorystack/ai/agents";
import {
  type CombinedRiskInput,
  createCombinedRiskAnalyzer,
} from "@memorystack/ai/detectors";
import { db } from "@memorystack/db";
import {
  commitment,
  decision,
  emailAccount,
  emailMessage,
  emailThread,
  type RiskAnalysisDetails,
  riskAnalysis,
} from "@memorystack/db/schema";
import { task } from "@trigger.dev/sdk";
import { and, desc, eq, inArray } from "drizzle-orm";
import { log } from "../lib/logger";

// =============================================================================
// TYPES
// =============================================================================

interface AnalyzeMessagePayload {
  messageId: string;
  accountId: string;
  threadId?: string;
  force?: boolean;
}

interface AnalyzeDraftPayload {
  analysisId: string;
  accountId: string;
  organizationId: string;
  content: string;
  subject?: string;
  recipients: Array<{
    email: string;
    name?: string;
    domain: string;
    isExternal: boolean;
  }>;
  threadId?: string;
}

interface RiskAnalysisResult {
  success: boolean;
  analysisId: string;
  riskLevel: "low" | "medium" | "high" | "critical";
  riskScore: number;
  blocked: boolean;
  requiresApproval: boolean;
  error?: string;
}

interface BatchAnalysisPayload {
  accountId: string;
  limit?: number;
  onlyPending?: boolean;
}

interface BatchAnalysisResult {
  success: boolean;
  processed: number;
  failed: number;
  blocked: number;
  requiresApproval: number;
}

// =============================================================================
// ANALYZE INCOMING MESSAGE TASK
// =============================================================================

/**
 * Analyze an incoming email message for risks.
 */
export const analyzeIncomingMessageTask = task({
  id: "risk-analyze-message",
  queue: {
    name: "risk-analysis",
    concurrencyLimit: 10,
  },
  retry: {
    maxAttempts: 3,
    minTimeoutInMs: 2000,
    maxTimeoutInMs: 15_000,
    factor: 2,
  },
  maxDuration: 60,
  run: async (payload: AnalyzeMessagePayload): Promise<RiskAnalysisResult> => {
    const { messageId, accountId, threadId, force = false } = payload;

    log.info("Analyzing message for risks", { messageId, accountId });

    try {
      // Check for existing analysis
      if (!force) {
        const existing = await db.query.riskAnalysis.findFirst({
          where: eq(riskAnalysis.messageId, messageId),
        });

        if (existing && existing.status === "completed") {
          log.info("Message already analyzed", { messageId });
          return {
            success: true,
            analysisId: existing.id,
            riskLevel: existing.overallRiskLevel as
              | "low"
              | "medium"
              | "high"
              | "critical",
            riskScore: existing.overallRiskScore ?? 0,
            blocked: false, // Status is "completed" so it wasn't blocked
            requiresApproval: existing.requiresApproval ?? false,
          };
        }
      }

      // Get message with thread
      const message = await db.query.emailMessage.findFirst({
        where: eq(emailMessage.id, messageId),
        with: {
          thread: {
            with: {
              account: true,
            },
          },
        },
      });

      if (!message) {
        return {
          success: false,
          analysisId: "",
          riskLevel: "low",
          riskScore: 0,
          blocked: false,
          requiresApproval: false,
          error: "Message not found",
        };
      }

      const account = message.thread.account;
      const organizationId = account.organizationId;

      // Get historical statements for contradiction checking
      const historicalStatements =
        await getHistoricalStatements(organizationId);

      // Get known contacts and domains
      const knownDomains = await getKnownDomains(organizationId);

      // Build analysis input
      const senderDomain =
        message.fromEmail?.split("@")[1]?.toLowerCase() ?? "";

      const analysisInput: CombinedRiskInput = {
        content: message.bodyText ?? message.bodyHtml ?? "",
        subject: message.subject ?? undefined,
        sender: {
          email: message.fromEmail ?? "",
          name: message.fromName ?? undefined,
          domain: senderDomain,
        },
        recipients: [], // Incoming message - no recipients to validate
        historicalStatements,
        knownDomains,
        organizationId,
        accountId,
      };

      // Run analysis
      const startTime = Date.now();
      const analyzer = createCombinedRiskAnalyzer();
      const result = analyzer.analyze(analysisInput);
      const processingTime = Date.now() - startTime;

      // Safely access properties that may vary across AI type versions
      const resultAny = result as unknown as Record<
        string,
        Record<string, unknown>
      >;
      const fraudRiskScore = (resultAny.fraud?.overallRiskScore ??
        resultAny.fraud?.riskScore ??
        0) as number;
      const sensitiveDataSeverity = (resultAny.sensitiveData?.overallSeverity ??
        resultAny.sensitiveData?.severity ??
        "none") as "none" | "low" | "medium" | "high" | "critical";

      // Build details for storage
      const details = buildRiskDetails(result);

      // Determine if requires approval
      const requiresApproval =
        (result.policy.requiredApprovals?.length ?? 0) > 0 ||
        fraudRiskScore > 0.7;

      // Determine status
      const status =
        result.policy.overallStatus === "blocked"
          ? "blocked"
          : requiresApproval
            ? "pending"
            : "completed";

      // Create or update analysis record
      const [analysis] = await db
        .insert(riskAnalysis)
        .values({
          accountId,
          threadId: threadId ?? message.threadId,
          messageId,
          analysisType: "incoming",
          status,
          overallRiskScore: result.overallRiskScore,
          overallRiskLevel: result.overallRiskLevel,
          hasContradictions: (result.contradiction.conflicts?.length ?? 0) > 0,
          hasSensitiveData: sensitiveDataSeverity !== "none",
          hasFraudSignals: fraudRiskScore > 0.3,
          hasPolicyViolations: (result.policy.violations?.length ?? 0) > 0,
          contradictionScore: 1 - (result.contradiction.score ?? 1),
          sensitiveDataScore: getSeverityScore(sensitiveDataSeverity),
          fraudScore: fraudRiskScore,
          policyScore: result.policy.overallStatus === "blocked" ? 1 : 0,
          requiresApproval,
          approvalStatus: requiresApproval ? "pending" : "not_required",
          details,
          processingTimeMs: processingTime,
          analyzedAt: new Date(),
        })
        .onConflictDoNothing()
        .returning();

      log.info("Message risk analysis completed", {
        messageId,
        riskLevel: result.overallRiskLevel,
        riskScore: result.overallRiskScore,
        blocked: status === "blocked",
      });

      return {
        success: true,
        analysisId: analysis?.id ?? "",
        riskLevel: result.overallRiskLevel,
        riskScore: result.overallRiskScore,
        blocked: status === "blocked",
        requiresApproval,
      };
    } catch (error) {
      log.error("Failed to analyze message for risks", {
        messageId,
        error: error instanceof Error ? error.message : "Unknown error",
      });

      return {
        success: false,
        analysisId: "",
        riskLevel: "low",
        riskScore: 0,
        blocked: false,
        requiresApproval: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  },
});

// =============================================================================
// ANALYZE DRAFT TASK
// =============================================================================

/**
 * Analyze a draft before sending.
 */
export const analyzeDraftTask = task({
  id: "risk-analyze-draft",
  queue: {
    name: "risk-analysis",
    concurrencyLimit: 10,
  },
  retry: {
    maxAttempts: 2,
    minTimeoutInMs: 1000,
    maxTimeoutInMs: 10_000,
    factor: 2,
  },
  maxDuration: 30, // Shorter timeout for draft analysis
  run: async (payload: AnalyzeDraftPayload): Promise<RiskAnalysisResult> => {
    const {
      analysisId,
      accountId,
      organizationId,
      content,
      subject,
      recipients,
      threadId: _threadId,
    } = payload;

    log.info("Analyzing draft for risks", { analysisId, accountId });

    try {
      // Get historical statements for contradiction checking
      const historicalStatements =
        await getHistoricalStatements(organizationId);

      // Get known domains
      const knownDomains = await getKnownDomains(organizationId);

      // Build analysis input
      const analysisInput: CombinedRiskInput = {
        content,
        subject,
        sender: {
          email: "self",
          domain: "internal",
        },
        recipients,
        historicalStatements,
        knownDomains,
        organizationId,
        accountId,
      };

      // Run analysis
      const startTime = Date.now();
      const analyzer = createCombinedRiskAnalyzer();
      const result = analyzer.analyze(analysisInput);
      const processingTime = Date.now() - startTime;

      // Safely access properties that may vary across AI type versions
      const resultAny = result as unknown as Record<
        string,
        Record<string, unknown>
      >;
      const sensitiveDataSeverity = (resultAny.sensitiveData?.overallSeverity ??
        resultAny.sensitiveData?.severity ??
        "none") as "none" | "low" | "medium" | "high" | "critical";

      // Build details for storage
      const details = buildRiskDetails(result);

      // Determine if requires approval
      const requiresApproval =
        (result.policy.requiredApprovals?.length ?? 0) > 0;

      // Determine status
      const status =
        result.policy.overallStatus === "blocked"
          ? "blocked"
          : requiresApproval
            ? "pending"
            : "completed";

      // Update analysis record
      await db
        .update(riskAnalysis)
        .set({
          status,
          overallRiskScore: result.overallRiskScore,
          overallRiskLevel: result.overallRiskLevel,
          hasContradictions: (result.contradiction.conflicts?.length ?? 0) > 0,
          hasSensitiveData: sensitiveDataSeverity !== "none",
          hasFraudSignals: false, // Drafts don't have fraud signals
          hasPolicyViolations: (result.policy.violations?.length ?? 0) > 0,
          contradictionScore: 1 - (result.contradiction.score ?? 1),
          sensitiveDataScore: getSeverityScore(sensitiveDataSeverity),
          fraudScore: 0,
          policyScore: result.policy.overallStatus === "blocked" ? 1 : 0,
          requiresApproval,
          approvalStatus: requiresApproval ? "pending" : "not_required",
          details,
          processingTimeMs: processingTime,
          analyzedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(riskAnalysis.id, analysisId));

      log.info("Draft risk analysis completed", {
        analysisId,
        riskLevel: result.overallRiskLevel,
        riskScore: result.overallRiskScore,
        blocked: status === "blocked",
      });

      return {
        success: true,
        analysisId,
        riskLevel: result.overallRiskLevel,
        riskScore: result.overallRiskScore,
        blocked: status === "blocked",
        requiresApproval,
      };
    } catch (error) {
      log.error("Failed to analyze draft for risks", {
        analysisId,
        error: error instanceof Error ? error.message : "Unknown error",
      });

      // Update analysis with error
      await db
        .update(riskAnalysis)
        .set({
          status: "error",
          updatedAt: new Date(),
        })
        .where(eq(riskAnalysis.id, analysisId));

      return {
        success: false,
        analysisId,
        riskLevel: "low",
        riskScore: 0,
        blocked: false,
        requiresApproval: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  },
});

// =============================================================================
// BATCH ANALYSIS TASK
// =============================================================================

/**
 * Analyze multiple messages for an account.
 */
export const batchRiskAnalysisTask = task({
  id: "risk-batch-analysis",
  queue: {
    name: "risk-batch",
    concurrencyLimit: 3,
  },
  retry: {
    maxAttempts: 2,
    minTimeoutInMs: 10_000,
    maxTimeoutInMs: 60_000,
    factor: 2,
  },
  maxDuration: 300, // 5 minutes
  run: async (payload: BatchAnalysisPayload): Promise<BatchAnalysisResult> => {
    const { accountId, limit = 50, onlyPending = true } = payload;

    log.info("Starting batch risk analysis", { accountId, limit, onlyPending });

    let processed = 0;
    let failed = 0;
    let blocked = 0;
    let requiresApproval = 0;

    try {
      // Get account to get organization ID
      const account = await db.query.emailAccount.findFirst({
        where: eq(emailAccount.id, accountId),
      });

      if (!account) {
        return {
          success: false,
          processed: 0,
          failed: 1,
          blocked: 0,
          requiresApproval: 0,
        };
      }

      // Get threads for this account first
      const accountThreads = await db.query.emailThread.findMany({
        where: eq(emailThread.accountId, accountId),
        columns: { id: true },
      });
      const threadIds = accountThreads.map((t) => t.id);

      if (threadIds.length === 0) {
        return {
          success: true,
          processed: 0,
          failed: 0,
          blocked: 0,
          requiresApproval: 0,
        };
      }

      // Get messages to analyze
      let messages;

      if (onlyPending) {
        // Get messages without risk analysis
        const analyzedMessageIds = await db
          .select({ messageId: riskAnalysis.messageId })
          .from(riskAnalysis)
          .where(eq(riskAnalysis.accountId, accountId));

        const alreadyAnalyzedIds = analyzedMessageIds
          .filter((r) => r.messageId !== null)
          .map((r) => r.messageId as string);

        // Get messages from account threads that haven't been analyzed
        messages = await db.query.emailMessage.findMany({
          where: and(
            inArray(emailMessage.threadId, threadIds),
            alreadyAnalyzedIds.length > 0
              ? inArray(emailMessage.id, alreadyAnalyzedIds) // This should be "not in" but drizzle doesn't have notInArray easily, so we'll filter
              : undefined
          ),
          orderBy: desc(emailMessage.sentAt),
          limit: limit * 2, // Fetch more since we'll filter
        });

        // Filter out already analyzed messages
        if (alreadyAnalyzedIds.length > 0) {
          const alreadyAnalyzedSet = new Set(alreadyAnalyzedIds);
          messages = messages
            .filter((m) => !alreadyAnalyzedSet.has(m.id))
            .slice(0, limit);
        }
      } else {
        messages = await db.query.emailMessage.findMany({
          where: inArray(emailMessage.threadId, threadIds),
          orderBy: desc(emailMessage.sentAt),
          limit,
        });
      }

      // Process each message
      for (const message of messages) {
        const result = await analyzeIncomingMessageTask.triggerAndWait({
          messageId: message.id,
          accountId,
          threadId: message.threadId,
          force: !onlyPending,
        });

        if (result.ok && result.output.success) {
          processed++;
          if (result.output.blocked) blocked++;
          if (result.output.requiresApproval) requiresApproval++;
        } else {
          failed++;
        }
      }

      log.info("Batch risk analysis completed", {
        accountId,
        processed,
        failed,
        blocked,
        requiresApproval,
      });

      return {
        success: failed === 0,
        processed,
        failed,
        blocked,
        requiresApproval,
      };
    } catch (error) {
      log.error("Batch risk analysis failed", {
        accountId,
        error: error instanceof Error ? error.message : "Unknown error",
      });

      return {
        success: false,
        processed,
        failed: failed + 1,
        blocked,
        requiresApproval,
      };
    }
  },
});

// =============================================================================
// HELPERS
// =============================================================================

/**
 * Get historical statements for contradiction checking.
 */
async function getHistoricalStatements(
  organizationId: string
): Promise<HistoricalStatement[]> {
  const statements: HistoricalStatement[] = [];

  // Get recent commitments
  const commitments = await db.query.commitment.findMany({
    where: eq(commitment.organizationId, organizationId),
    orderBy: desc(commitment.createdAt),
    limit: 100,
  });

  for (const c of commitments) {
    statements.push({
      id: c.id,
      text: c.title + (c.description ? `: ${c.description}` : ""),
      source: "commitment",
      type: "commitment",
      date: c.createdAt,
    });
  }

  // Get recent decisions
  const decisions = await db.query.decision.findMany({
    where: eq(decision.organizationId, organizationId),
    orderBy: desc(decision.createdAt),
    limit: 100,
  });

  for (const d of decisions) {
    statements.push({
      id: d.id,
      text: d.statement,
      source: d.title,
      type: "decision",
      date: d.createdAt,
    });
  }

  return statements;
}

/**
 * Get known domains for the organization.
 */
async function getKnownDomains(organizationId: string): Promise<string[]> {
  const accounts = await db.query.emailAccount.findMany({
    where: eq(emailAccount.organizationId, organizationId),
    columns: { email: true },
  });

  const domains = new Set<string>();
  for (const account of accounts) {
    const domain = account.email.split("@")[1]?.toLowerCase();
    if (domain) domains.add(domain);
  }

  return Array.from(domains);
}

/**
 * Build risk details for storage.
 * Uses type assertions for flexibility with varying AI result types.
 */
function buildRiskDetails(result: CombinedRiskResult): RiskAnalysisDetails {
  // Cast to any for flexible property access - the AI types may vary
  const r = result as unknown as Record<string, unknown>;
  const contradiction = r.contradiction as Record<string, unknown>;
  const sensitiveData = r.sensitiveData as Record<string, unknown>;
  const fraud = r.fraud as Record<string, unknown>;
  const policy = r.policy as Record<string, unknown>;

  return {
    contradictions: (
      (contradiction?.conflicts ?? []) as Array<Record<string, unknown>>
    ).map((c) => ({
      draftStatement: String(c.draftStatement ?? ""),
      conflictingSource: String(c.conflictingSource ?? c.source ?? ""),
      sourceId: String(c.sourceId ?? c.id ?? ""),
      severity: String(c.severity ?? "low"),
      suggestion: String(c.suggestion ?? c.recommendation ?? ""),
    })),
    sensitiveData: {
      piiFindings: (
        (sensitiveData?.piiFindings ?? []) as Array<Record<string, unknown>>
      ).map((f) => ({
        type: String(f.type ?? ""),
        location:
          typeof f.location === "object"
            ? JSON.stringify(f.location)
            : String(f.location ?? ""),
        severity: String(f.severity ?? "low"),
      })),
      confidentialFindings: (
        (sensitiveData?.confidentialFindings ?? []) as Array<
          Record<string, unknown>
        >
      ).map((f) => ({
        category: String(f.category ?? f.type ?? ""),
        location: String(f.matchedText ?? f.location ?? ""),
        severity: String(f.severity ?? "low"),
      })),
      recipientWarnings: (
        (sensitiveData?.recipientWarnings ?? []) as Array<
          Record<string, unknown>
        >
      ).map((w) => ({
        recipient: String(w.recipient ?? ""),
        reason: String(w.reason ?? w.warning ?? ""),
        recommendation: String(w.recommendation ?? w.suggestion ?? ""),
      })),
    },
    fraudSignals: {
      impersonation: (
        (fraud?.impersonationSignals ?? []) as Array<Record<string, unknown>>
      ).map((s) => ({
        type: String(s.type ?? ""),
        details: String(s.details ?? s.description ?? ""),
        severity: String(s.severity ?? "low"),
      })),
      invoiceFraud: (
        (fraud?.invoiceFraudSignals ?? []) as Array<Record<string, unknown>>
      ).map((s) => ({
        type: String(s.type ?? ""),
        details: String(s.details ?? s.description ?? ""),
        severity: String(s.severity ?? "low"),
      })),
      phishing: (
        (fraud?.phishingSignals ?? []) as Array<Record<string, unknown>>
      ).map((s) => ({
        type: String(s.type ?? ""),
        details: String(s.details ?? s.description ?? ""),
        severity: String(s.severity ?? "low"),
      })),
    },
    policyViolations: (
      (policy?.violations ?? []) as Array<Record<string, unknown>>
    ).map((v) => ({
      ruleId: String(v.ruleId ?? ""),
      ruleName: String(v.ruleName ?? ""),
      category: String(v.category ?? ""),
      severity: String(v.severity ?? "low"),
      description: String(v.description ?? ""),
      matchedContent: String(v.matchedContent ?? ""),
    })),
    recommendations: (r.recommendations ?? []) as string[],
  };
}

/**
 * Convert severity string to numeric score.
 */
function getSeverityScore(
  severity: "none" | "low" | "medium" | "high" | "critical"
): number {
  switch (severity) {
    case "critical":
      return 1.0;
    case "high":
      return 0.75;
    case "medium":
      return 0.5;
    case "low":
      return 0.25;
    case "none":
    default:
      return 0;
  }
}
