import { type CoreMessage, generateText, streamText } from "ai";
import { observability } from "../observability.js";
import {
  type AIProvider,
  getDefaultModel,
  getModel,
} from "../providers/index.js";

// Base agent configuration
export interface AgentConfig {
  name: string;
  description?: string;
  systemPrompt: string;
  provider?: AIProvider;
  model?: string;
  maxTokens?: number;
  temperature?: number;
}

// Agent execution context
export interface AgentContext {
  userId?: string;
  sessionId?: string;
  organizationId?: string;
  metadata?: Record<string, unknown>;
}

// Base agent class
export class BaseAgent {
  protected config: AgentConfig;
  protected messages: CoreMessage[] = [];

  constructor(config: AgentConfig) {
    this.config = config;
  }

  // Add system message
  protected getSystemMessage(): CoreMessage {
    return {
      role: "system",
      content: this.config.systemPrompt,
    };
  }

  // Generate a response
  async generate(userMessage: string, context?: AgentContext): Promise<string> {
    const model = this.config.provider
      ? getModel(this.config.provider, this.config.model)
      : getDefaultModel();

    const messages: CoreMessage[] = [
      this.getSystemMessage(),
      ...this.messages,
      { role: "user", content: userMessage },
    ];

    // Create trace for observability
    const trace = observability.trace({
      name: `agent:${this.config.name}`,
      userId: context?.userId,
      sessionId: context?.sessionId,
      metadata: {
        ...context?.metadata,
        organizationId: context?.organizationId,
        agentName: this.config.name,
      },
    });

    try {
      const { text, usage } = await generateText({
        model,
        messages,
        maxTokens: this.config.maxTokens ?? 2048,
        temperature: this.config.temperature ?? 0.7,
      });

      // Record generation
      trace.generation({
        name: "generate",
        model: this.config.model ?? "default",
        input: messages,
        output: text,
        usage: usage
          ? {
              promptTokens: usage.promptTokens,
              completionTokens: usage.completionTokens,
              totalTokens: usage.totalTokens,
            }
          : undefined,
      });

      // Add to conversation history
      this.messages.push(
        { role: "user", content: userMessage },
        { role: "assistant", content: text }
      );

      return text;
    } catch (error) {
      trace.generation({
        name: "generate-error",
        model: this.config.model ?? "default",
        input: messages,
        output: error instanceof Error ? error.message : "Unknown error",
        level: "ERROR",
      });
      throw error;
    }
  }

  // Stream a response
  async *stream(
    userMessage: string,
    context?: AgentContext
  ): AsyncGenerator<string, void, unknown> {
    const model = this.config.provider
      ? getModel(this.config.provider, this.config.model)
      : getDefaultModel();

    const messages: CoreMessage[] = [
      this.getSystemMessage(),
      ...this.messages,
      { role: "user", content: userMessage },
    ];

    const trace = observability.trace({
      name: `agent:${this.config.name}:stream`,
      userId: context?.userId,
      sessionId: context?.sessionId,
      metadata: {
        ...context?.metadata,
        organizationId: context?.organizationId,
        agentName: this.config.name,
      },
    });

    try {
      const { textStream, text: fullText } = streamText({
        model,
        messages,
        maxTokens: this.config.maxTokens ?? 2048,
        temperature: this.config.temperature ?? 0.7,
      });

      let accumulatedText = "";
      for await (const textPart of textStream) {
        accumulatedText += textPart;
        yield textPart;
      }

      // Record generation after streaming completes
      trace.generation({
        name: "stream",
        model: this.config.model ?? "default",
        input: messages,
        output: await fullText,
      });

      // Add to conversation history
      this.messages.push(
        { role: "user", content: userMessage },
        { role: "assistant", content: accumulatedText }
      );
    } catch (error) {
      trace.generation({
        name: "stream-error",
        model: this.config.model ?? "default",
        input: messages,
        output: error instanceof Error ? error.message : "Unknown error",
        level: "ERROR",
      });
      throw error;
    }
  }

  // Clear conversation history
  clearHistory() {
    this.messages = [];
  }

  // Get conversation history
  getHistory(): CoreMessage[] {
    return [...this.messages];
  }
}

// Pre-configured chat agent
export function createChatAgent(config?: Partial<AgentConfig>): BaseAgent {
  return new BaseAgent({
    name: "chat",
    description: "General purpose conversational AI assistant",
    systemPrompt: `You are a helpful AI assistant. Be concise, accurate, and helpful.
When you don't know something, say so. Don't make up information.`,
    ...config,
  });
}

// Pre-configured code assistant agent
export function createCodeAgent(config?: Partial<AgentConfig>): BaseAgent {
  return new BaseAgent({
    name: "code",
    description: "Code generation and explanation assistant",
    systemPrompt: `You are an expert software developer assistant. Help users with:
- Writing clean, efficient code
- Debugging and fixing issues
- Explaining code concepts
- Best practices and patterns

Always provide code examples when relevant. Use markdown code blocks with language specification.`,
    temperature: 0.3,
    ...config,
  });
}

// Pre-configured data analysis agent
export function createAnalystAgent(config?: Partial<AgentConfig>): BaseAgent {
  return new BaseAgent({
    name: "analyst",
    description: "Data analysis and insights assistant",
    systemPrompt: `You are a data analyst assistant. Help users:
- Understand and interpret data
- Generate insights from information
- Create summaries and reports
- Suggest data visualizations

Be precise with numbers and always cite your sources when referencing data.`,
    temperature: 0.5,
    ...config,
  });
}

export { BaseAgent as Agent };

// =============================================================================
// THREAD UNDERSTANDING AGENT (Agent 1)
// =============================================================================

export type {
  AnalysisOptions,
  BaseClaim,
  Claim,
  ClaimEvidence,
  ClaimType,
  DbClaimFormat,
  DecisionClaim,
  ExtractedClaims,
  FactClaim,
  IntentCategory,
  IntentClassification,
  OpenLoop,
  PromiseClaim,
  QuestionClaim,
  RequestClaim,
  SentimentAnalysis,
  ThreadAnalysis,
  ThreadBrief,
  ThreadInput,
  ThreadMessage,
  ThreadType,
  ThreadTypeResult,
  TimelineEvent,
  UrgencyScore,
  WaitingOn,
} from "./thread-understanding/index.js";
export {
  analyzeThread,
  claimsToDbFormat,
  createThreadUnderstandingAgent,
  ThreadUnderstandingAgent,
} from "./thread-understanding/index.js";

// =============================================================================
// COMMITMENT AGENT (Agent 2)
// =============================================================================

export type {
  CommitmentDirection,
  CommitmentPriority,
  CommitmentStatus,
  CommitmentThreadContext,
  DailyDigest,
  DueDateExtraction,
  DueDateSource,
  ExtractedCommitment,
  FollowUpDraft,
  OverdueCommitment,
  PartiesResult,
  PartyIdentification,
  PromiseClaimInput,
  RequestClaimInput,
  StatusChange,
} from "./commitment/index.js";
export {
  CommitmentAgent,
  createCommitmentAgent,
  extractCommitments,
  extractDueDate,
  identifyParties,
  mergeDateExtractions,
  mergePartyIdentifications,
} from "./commitment/index.js";

// =============================================================================
// DECISION AGENT (Agent 3)
// =============================================================================

export type {
  Alternative,
  DecisionClaimInput,
  DecisionParticipant,
  DecisionSearchResult,
  DecisionThreadContext,
  ExtractedDecision,
  Supersession,
} from "./decision/index.js";
export {
  createDecisionAgent,
  DecisionAgent,
  extractDecisions,
} from "./decision/index.js";
