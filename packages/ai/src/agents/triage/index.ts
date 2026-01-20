// =============================================================================
// TRIAGE AGENT (Agent 6)
// =============================================================================
//
// Inbox automation, action suggestions, and priority ranking.
// Combines rule-based scoring with LLM-powered reasoning.
//

import { generateText } from "ai";
import { observability } from "../../observability.js";
import {
  buildDelegationPrompt,
  buildGroupingPrompt,
  buildInboxSummaryPrompt,
  buildReasoningExplanationPrompt,
  buildRuleSuggestionPrompt,
  buildTriageSystemPrompt,
  buildTriageUserPrompt,
  DelegationResultSchema,
  GroupingResultSchema,
  InboxSummarySchema,
  ReasoningExplanationSchema,
  RuleSuggestionSchema,
  type TriageResult,
  TriageResultSchema,
} from "../../prompts/triage/index.js";
import {
  type AIProvider,
  getDefaultModel,
  getModel,
} from "../../providers/index.js";
import {
  batchCalculatePriority,
  batchClassifyActions,
  calculatePriority,
  classifyAction,
  type PriorityResult,
  suggestResponseTime,
  type TeamMember,
  type ThreadForPriority,
  type UserActionPatterns,
} from "../../scoring/index.js";

// =============================================================================
// TYPES
// =============================================================================

export interface TriageAgentConfig {
  provider?: AIProvider;
  model?: string;
  temperature?: number;
  maxTokens?: number;
  useLLMForComplex?: boolean;
}

export interface ThreadInput {
  id: string;
  subject: string;
  snippet?: string;
  bodyText?: string;
  sender: string;
  senderName?: string;
  senderIsVIP?: boolean;
  senderIsInternal?: boolean;
  participants: Array<{
    address: string;
    name?: string;
    isVIP?: boolean;
    isInternal?: boolean;
  }>;
  lastMessageAt: Date;
  messageCount: number;
  classification?: string;
  claims?: Array<{
    type: string;
    content: string;
    dueDate?: Date;
  }>;
}

export interface TriageSuggestion {
  threadId: string;
  action: string;
  confidence: number;
  reasoning: string;
  priority: PriorityResult;
  responseTime?: {
    suggested: Date;
    deadline?: Date;
  };
  details?: {
    delegateTo?: string;
    delegateReason?: string;
    scheduleFor?: Date;
    waitUntil?: Date;
    waitReason?: string;
    escalateReason?: string;
  };
  usedLLM: boolean;
}

export interface ThreadGroup {
  id: string;
  name: string;
  reason: string;
  threadIds: string[];
  suggestedBatchAction?: string;
}

export interface InboxSummaryResult {
  summary: string;
  focusRecommendation: string;
  quickWins?: string[];
  stats: {
    total: number;
    urgent: number;
    high: number;
    medium: number;
    low: number;
    needsResponse: number;
    canArchive: number;
  };
}

export interface TriageRule {
  id: string;
  name: string;
  description: string;
  trigger: {
    type: "sender" | "subject" | "content" | "label";
    condition: "contains" | "equals" | "matches";
    value: string;
  };
  action: "archive" | "label" | "forward" | "priority";
  actionValue?: string;
  enabled: boolean;
  createdAt: Date;
  hitCount: number;
}

// =============================================================================
// TRIAGE AGENT CLASS
// =============================================================================

/**
 * Triage Agent for inbox automation and action suggestions.
 */
export class TriageAgent {
  private readonly config: TriageAgentConfig;

  constructor(config: TriageAgentConfig = {}) {
    this.config = {
      temperature: 0.3,
      maxTokens: 1024,
      useLLMForComplex: true,
      ...config,
    };
  }

  // ===========================================================================
  // SINGLE THREAD TRIAGE
  // ===========================================================================

  /**
   * Triage a single thread.
   */
  async triageThread(
    thread: ThreadInput,
    options: {
      userPatterns?: UserActionPatterns;
      teamMembers?: TeamMember[];
      rules?: TriageRule[];
      forceLLM?: boolean;
    } = {}
  ): Promise<TriageSuggestion> {
    const trace = observability.trace({
      name: "triage:thread",
      metadata: { threadId: thread.id },
    });

    try {
      // Convert to priority format
      const threadForPriority = this.convertToThreadForPriority(thread);

      // Calculate priority using rule-based scoring
      const priority = calculatePriority(threadForPriority);

      // Check if any explicit rules match
      const matchedRule = options.rules?.find(
        (r) => r.enabled && this.matchesRule(thread, r)
      );

      if (matchedRule) {
        trace.generation({
          name: "triage-rule-match",
          input: thread.id,
          output: { ruleId: matchedRule.id, ruleName: matchedRule.name },
        });

        return {
          threadId: thread.id,
          action: this.ruleActionToTriageAction(matchedRule.action),
          confidence: 0.95,
          reasoning: `Matched rule: ${matchedRule.name}. ${matchedRule.description}`,
          priority,
          usedLLM: false,
        };
      }

      // Classify action using rule-based system
      const actionContext = {
        thread: threadForPriority,
        priority,
        userPatterns: options.userPatterns,
        teamMembers: options.teamMembers,
      };

      const actionSuggestion = classifyAction(actionContext);

      // Get response time suggestion
      const responseTime =
        actionSuggestion.action === "respond"
          ? suggestResponseTime(actionContext)
          : undefined;

      // For complex or low-confidence cases, use LLM
      const shouldUseLLM =
        options.forceLLM ||
        (this.config.useLLMForComplex &&
          (actionSuggestion.confidence < 0.7 ||
            actionSuggestion.action === "review"));

      if (shouldUseLLM) {
        const llmResult = await this.triageWithLLM(thread);

        trace.generation({
          name: "triage-llm",
          input: thread.id,
          output: llmResult,
        });

        return {
          threadId: thread.id,
          action: llmResult.action,
          confidence: llmResult.confidence,
          reasoning: llmResult.reasoning,
          priority: {
            ...priority,
            urgencyScore: llmResult.urgencyScore,
            importanceScore: llmResult.importanceScore,
            tier: llmResult.priorityTier,
          },
          responseTime: llmResult.details?.responseTimeframe
            ? {
                suggested: this.parseTimeframe(
                  llmResult.details.responseTimeframe
                ),
              }
            : responseTime,
          details: llmResult.details,
          usedLLM: true,
        };
      }

      trace.generation({
        name: "triage-rules",
        input: thread.id,
        output: {
          action: actionSuggestion.action,
          confidence: actionSuggestion.confidence,
        },
      });

      return {
        threadId: thread.id,
        action: actionSuggestion.action,
        confidence: actionSuggestion.confidence,
        reasoning: actionSuggestion.reasoning,
        priority,
        responseTime,
        details: actionSuggestion.details,
        usedLLM: false,
      };
    } catch (error) {
      trace.generation({
        name: "triage-error",
        input: thread.id,
        output: error instanceof Error ? error.message : "Unknown error",
        level: "ERROR",
      });

      throw error;
    }
  }

  /**
   * Triage using LLM for complex cases.
   */
  private async triageWithLLM(thread: ThreadInput): Promise<TriageResult> {
    const model = this.config.provider
      ? getModel(this.config.provider, this.config.model)
      : getDefaultModel();

    const { text } = await generateText({
      model,
      messages: [
        { role: "system", content: buildTriageSystemPrompt() },
        {
          role: "user",
          content: buildTriageUserPrompt({
            subject: thread.subject,
            snippet: thread.snippet,
            bodyText: thread.bodyText,
            sender: thread.sender,
            senderName: thread.senderName,
            isVIP: thread.senderIsVIP,
            isInternal: thread.senderIsInternal,
            participants: thread.participants.map((p) => p.address),
            lastMessageAt: thread.lastMessageAt,
            messageCount: thread.messageCount,
            classification: thread.classification,
            claims: thread.claims?.map((c) => ({
              type: c.type,
              content: c.content,
              dueDate: c.dueDate?.toISOString().split("T")[0],
            })),
          }),
        },
      ],
      temperature: this.config.temperature ?? 0.3,
      maxOutputTokens: this.config.maxTokens ?? 1024,
    });

    const parsed = JSON.parse(text);
    return TriageResultSchema.parse(parsed);
  }

  // ===========================================================================
  // BATCH TRIAGE
  // ===========================================================================

  /**
   * Triage multiple threads at once.
   */
  async batchTriage(
    threads: ThreadInput[],
    options: {
      userPatterns?: UserActionPatterns;
      teamMembers?: TeamMember[];
      rules?: TriageRule[];
    } = {}
  ): Promise<TriageSuggestion[]> {
    const trace = observability.trace({
      name: "triage:batch",
      metadata: { threadCount: threads.length },
    });

    try {
      // Convert all threads
      const threadsForPriority = threads.map((t) =>
        this.convertToThreadForPriority(t)
      );

      // Batch calculate priorities
      const priorityResults = batchCalculatePriority(threadsForPriority);

      // Batch classify actions
      const actionContexts = priorityResults.map(({ thread, priority }) => ({
        thread,
        priority,
        userPatterns: options.userPatterns,
        teamMembers: options.teamMembers,
      }));

      const actionResults = batchClassifyActions(actionContexts);

      // Build results
      const results: TriageSuggestion[] = [];

      for (let i = 0; i < threads.length; i++) {
        const thread = threads[i];
        const priorityResult = priorityResults[i];
        const actionResult = actionResults[i];

        if (!(thread && priorityResult && actionResult)) continue;

        // Check rules
        const matchedRule = options.rules?.find(
          (r) => r.enabled && this.matchesRule(thread, r)
        );

        if (matchedRule) {
          results.push({
            threadId: thread.id,
            action: this.ruleActionToTriageAction(matchedRule.action),
            confidence: 0.95,
            reasoning: `Matched rule: ${matchedRule.name}`,
            priority: priorityResult.priority,
            usedLLM: false,
          });
        } else {
          results.push({
            threadId: thread.id,
            action: actionResult.suggestion.action,
            confidence: actionResult.suggestion.confidence,
            reasoning: actionResult.suggestion.reasoning,
            priority: priorityResult.priority,
            details: actionResult.suggestion.details,
            usedLLM: false,
          });
        }
      }

      // Sort by priority
      results.sort(
        (a, b) => b.priority.combinedScore - a.priority.combinedScore
      );

      trace.generation({
        name: "batch-triage",
        input: { threadCount: threads.length },
        output: { resultCount: results.length },
      });

      return results;
    } catch (error) {
      trace.generation({
        name: "batch-triage-error",
        input: { threadCount: threads.length },
        output: error instanceof Error ? error.message : "Unknown error",
        level: "ERROR",
      });

      throw error;
    }
  }

  // ===========================================================================
  // SMART GROUPING
  // ===========================================================================

  /**
   * Group threads for batch processing.
   */
  async groupThreads(
    threads: ThreadInput[],
    suggestions: TriageSuggestion[]
  ): Promise<{ groups: ThreadGroup[]; ungrouped: string[] }> {
    const model = this.config.provider
      ? getModel(this.config.provider, this.config.model)
      : getDefaultModel();

    const trace = observability.trace({
      name: "triage:group",
      metadata: { threadCount: threads.length },
    });

    try {
      const threadData = threads.map((t) => {
        const suggestion = suggestions.find((s) => s.threadId === t.id);
        return {
          id: t.id,
          subject: t.subject,
          sender: t.sender,
          action: suggestion?.action ?? "review",
        };
      });

      const { text } = await generateText({
        model,
        messages: [{ role: "user", content: buildGroupingPrompt(threadData) }],
        temperature: 0.3,
        maxOutputTokens: 1024,
      });

      const parsed = GroupingResultSchema.parse(JSON.parse(text));

      const groups: ThreadGroup[] = parsed.groups.map((g, i) => ({
        id: `group-${Date.now()}-${i}`,
        name: g.name,
        reason: g.reason,
        threadIds: g.threadIds,
        suggestedBatchAction: g.suggestedBatchAction,
      }));

      trace.generation({
        name: "group-threads",
        input: { threadCount: threads.length },
        output: { groupCount: groups.length },
      });

      return { groups, ungrouped: parsed.ungrouped };
    } catch (error) {
      trace.generation({
        name: "group-threads-error",
        input: { threadCount: threads.length },
        output: error instanceof Error ? error.message : "Unknown error",
        level: "ERROR",
      });

      return { groups: [], ungrouped: threads.map((t) => t.id) };
    }
  }

  // ===========================================================================
  // INBOX SUMMARY
  // ===========================================================================

  /**
   * Generate an inbox summary from triage results.
   */
  async generateInboxSummary(
    suggestions: TriageSuggestion[]
  ): Promise<InboxSummaryResult> {
    const model = this.config.provider
      ? getModel(this.config.provider, this.config.model)
      : getDefaultModel();

    // Calculate stats
    const stats = {
      total: suggestions.length,
      urgent: suggestions.filter((s) => s.priority.tier === "urgent").length,
      high: suggestions.filter((s) => s.priority.tier === "high").length,
      medium: suggestions.filter((s) => s.priority.tier === "medium").length,
      low: suggestions.filter((s) => s.priority.tier === "low").length,
      needsResponse: suggestions.filter((s) => s.action === "respond").length,
      canArchive: suggestions.filter((s) => s.action === "archive").length,
    };

    // Get top items
    const topItems = suggestions
      .sort((a, b) => b.priority.combinedScore - a.priority.combinedScore)
      .slice(0, 5)
      .map((s) => ({
        subject: `Thread ${s.threadId}`,
        action: s.action,
        reason: s.reasoning.split(".")[0] ?? s.reasoning,
      }));

    try {
      const { text } = await generateText({
        model,
        messages: [
          { role: "user", content: buildInboxSummaryPrompt(stats, topItems) },
        ],
        temperature: 0.5,
        maxOutputTokens: 512,
      });

      const parsed = InboxSummarySchema.parse(JSON.parse(text));

      return {
        ...parsed,
        stats,
      };
    } catch {
      // Fallback to basic summary
      return {
        summary: `You have ${stats.total} emails to process. ${stats.urgent} are urgent and ${stats.needsResponse} need a response.`,
        focusRecommendation:
          stats.urgent > 0
            ? "Start with the urgent items first."
            : "Work through high priority items.",
        stats,
      };
    }
  }

  // ===========================================================================
  // DELEGATION
  // ===========================================================================

  /**
   * Get delegation suggestion for a thread.
   */
  async suggestDelegation(
    thread: ThreadInput,
    teamMembers: TeamMember[]
  ): Promise<{
    delegateTo: string;
    reason: string;
    confidence: number;
  } | null> {
    const model = this.config.provider
      ? getModel(this.config.provider, this.config.model)
      : getDefaultModel();

    try {
      const { text } = await generateText({
        model,
        messages: [
          {
            role: "user",
            content: buildDelegationPrompt(
              {
                subject: thread.subject,
                snippet: thread.snippet,
                bodyText: thread.bodyText,
              },
              teamMembers.map((m) => ({
                name: m.name,
                email: m.email,
                role: m.expertise.join(", "),
                expertise: m.expertise,
              }))
            ),
          },
        ],
        temperature: 0.3,
        maxOutputTokens: 256,
      });

      const parsed = DelegationResultSchema.parse(JSON.parse(text));
      return parsed;
    } catch {
      return null;
    }
  }

  // ===========================================================================
  // RULE SUGGESTIONS
  // ===========================================================================

  /**
   * Suggest automation rules based on user patterns.
   */
  async suggestRules(
    patterns: Array<{
      condition: string;
      actionTaken: string;
      frequency: number;
    }>
  ): Promise<
    Array<Omit<TriageRule, "id" | "enabled" | "createdAt" | "hitCount">>
  > {
    const model = this.config.provider
      ? getModel(this.config.provider, this.config.model)
      : getDefaultModel();

    try {
      const { text } = await generateText({
        model,
        messages: [
          { role: "user", content: buildRuleSuggestionPrompt(patterns) },
        ],
        temperature: 0.4,
        maxOutputTokens: 1024,
      });

      const parsed = RuleSuggestionSchema.parse(JSON.parse(text));
      return parsed.suggestedRules;
    } catch {
      return [];
    }
  }

  // ===========================================================================
  // REASONING EXPLANATION
  // ===========================================================================

  /**
   * Generate detailed explanation for a triage decision.
   */
  async explainDecision(
    thread: ThreadInput,
    suggestion: TriageSuggestion
  ): Promise<{
    summary: string;
    factors: Array<{ factor: string; impact: string; description: string }>;
    alternatives?: Array<{ action: string; reason: string }>;
    caveats?: string[];
  }> {
    const model = this.config.provider
      ? getModel(this.config.provider, this.config.model)
      : getDefaultModel();

    try {
      const { text } = await generateText({
        model,
        messages: [
          {
            role: "user",
            content: buildReasoningExplanationPrompt(
              {
                subject: thread.subject,
                snippet: thread.snippet,
                sender: thread.sender,
                lastMessageAt: thread.lastMessageAt,
              },
              {
                action: suggestion.action,
                urgencyScore: suggestion.priority.urgencyScore,
                importanceScore: suggestion.priority.importanceScore,
                priorityTier: suggestion.priority.tier,
              }
            ),
          },
        ],
        temperature: 0.4,
        maxOutputTokens: 512,
      });

      return ReasoningExplanationSchema.parse(JSON.parse(text));
    } catch {
      return {
        summary: suggestion.reasoning,
        factors: [],
      };
    }
  }

  // ===========================================================================
  // HELPERS
  // ===========================================================================

  private convertToThreadForPriority(thread: ThreadInput): ThreadForPriority {
    return {
      id: thread.id,
      subject: thread.subject,
      snippet: thread.snippet,
      lastMessageAt: thread.lastMessageAt,
      messageCount: thread.messageCount,
      participants: thread.participants.map((p) => ({
        address: p.address,
        name: p.name,
        isVIP: p.isVIP ?? thread.senderIsVIP,
        isInternal: p.isInternal ?? thread.senderIsInternal,
      })),
      claims: thread.claims?.map((c) => ({
        type: c.type,
        content: c.content,
        dueDate: c.dueDate,
      })),
      bodyText: thread.bodyText,
      classification: thread.classification,
    };
  }

  private matchesRule(thread: ThreadInput, rule: TriageRule): boolean {
    const { type, condition, value } = rule.trigger;

    let targetValue: string;
    switch (type) {
      case "sender":
        targetValue = thread.sender.toLowerCase();
        break;
      case "subject":
        targetValue = thread.subject.toLowerCase();
        break;
      case "content":
        targetValue =
          `${thread.subject} ${thread.snippet ?? ""} ${thread.bodyText ?? ""}`.toLowerCase();
        break;
      case "label":
        targetValue = thread.classification?.toLowerCase() ?? "";
        break;
      default:
        return false;
    }

    const ruleValue = value.toLowerCase();

    switch (condition) {
      case "equals":
        return targetValue === ruleValue;
      case "contains":
        return targetValue.includes(ruleValue);
      case "matches":
        try {
          return new RegExp(ruleValue).test(targetValue);
        } catch {
          return false;
        }
      default:
        return false;
    }
  }

  private ruleActionToTriageAction(action: TriageRule["action"]): string {
    const mapping: Record<string, string> = {
      archive: "archive",
      label: "review",
      forward: "delegate",
      priority: "respond",
    };
    return mapping[action] ?? "review";
  }

  private parseTimeframe(timeframe: string): Date {
    const now = new Date();
    const lower = timeframe.toLowerCase();

    if (lower.includes("hour")) {
      const hours = Number.parseInt(lower) || 1;
      return new Date(now.getTime() + hours * 60 * 60 * 1000);
    }
    if (lower.includes("day")) {
      const days = Number.parseInt(lower) || 1;
      return new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
    }
    if (lower.includes("immediate") || lower.includes("now")) {
      return new Date(now.getTime() + 2 * 60 * 60 * 1000); // 2 hours
    }

    // Default to 24 hours
    return new Date(now.getTime() + 24 * 60 * 60 * 1000);
  }
}

// =============================================================================
// FACTORY FUNCTIONS
// =============================================================================

/**
 * Create a new TriageAgent instance.
 */
export function createTriageAgent(config?: TriageAgentConfig): TriageAgent {
  return new TriageAgent(config);
}
