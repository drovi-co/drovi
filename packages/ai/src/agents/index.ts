import { generateText, type ModelMessage, streamText } from "ai";
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
  protected messages: ModelMessage[] = [];

  constructor(config: AgentConfig) {
    this.config = config;
  }

  // Add system message
  protected getSystemMessage(): ModelMessage {
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

    const messages: ModelMessage[] = [
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
        maxOutputTokens: this.config.maxTokens ?? 2048,
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
              promptTokens: usage.inputTokens ?? 0,
              completionTokens: usage.outputTokens ?? 0,
              totalTokens: (usage.inputTokens ?? 0) + (usage.outputTokens ?? 0),
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

    const messages: ModelMessage[] = [
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
        maxOutputTokens: this.config.maxTokens ?? 2048,
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
  getHistory(): ModelMessage[] {
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

// =============================================================================
// RELATIONSHIP INTELLIGENCE AGENT (Agent 4)
// =============================================================================

export type {
  // Agent context
  ContactContext,
  // Context generation
  ContactOpenLoop,
  DirectionMetrics,
  // Identity resolution
  EmailAlias,
  EnrichedProfile,
  FrequencyMetrics,
  HealthScore,
  IdentityResolutionResult,
  // Relationship scoring
  ImportanceScore,
  MeetingBrief,
  MergeCandidate,
  RecentInteraction,
  ResponseTimePrediction,
  ResponsivenessMetrics,
  RiskFlagging,
  // Profile enrichment
  SignatureExtraction,
  ThreadContext as RelationshipThreadContext,
  // Communication analytics
  TimePeriod,
  TopicAssociation,
  VIPDetection,
} from "./relationship/index.js";
export {
  analyzeRelationship,
  areEmailsRelated,
  calculateCommunicationMetrics,
  calculateDirection,
  calculateEngagementScore,
  // Analyzers - Communication
  calculateFrequency,
  calculateHealthScore,
  // Analyzers - Scoring
  calculateImportanceScore,
  calculateNameSimilarity,
  calculateResponsiveness,
  calculateTopicAssociation,
  createRelationshipAgent,
  detectVIP,
  extractDomain,
  findMergeCandidates,
  flagRisk,
  generateMeetingBrief,
  isExecutiveTitle,
  isFreeEmailProvider,
  isHighValueDomain,
  MeetingBriefResponseSchema,
  normalizeEmail,
  ProfileEnrichmentResponseSchema,
  // Analyzers - Identity
  parseEmail,
  parseName,
  RecentHistorySummaryResponseSchema,
  // Agent
  RelationshipAgent,
  resolveIdentity,
  // Schemas
  SignatureExtractionResponseSchema,
  VIPSignalResponseSchema,
} from "./relationship/index.js";

// =============================================================================
// SEARCH AGENT (Agent 5 - Search)
// =============================================================================

export type {
  AnswerResult,
  EvidenceItem,
  GeneratedAnswer,
  ParsedQuery,
  QueryIntent,
  SearchAgentConfig,
  SearchOptions,
  SearchResult,
} from "./search/index.js";
export {
  createSearchAgent,
  GeneratedAnswerSchema,
  ParsedQuerySchema,
  QueryIntentSchema,
  SearchAgent,
} from "./search/index.js";

// =============================================================================
// KNOWLEDGE AGENT (Agent 5 - Knowledge)
// =============================================================================

export type {
  CrossThreadConnection,
  DetectedPattern,
  Insight,
  KnowledgeAgentConfig,
  PatternInput,
  TopicSummary,
} from "./knowledge/index.js";
export {
  createKnowledgeAgent,
  InsightResponseSchema,
  KnowledgeAgent,
  PatternResponseSchema,
  TopicSummaryResponseSchema,
} from "./knowledge/index.js";

// =============================================================================
// TRIAGE AGENT (Agent 6)
// =============================================================================

export type {
  InboxSummaryResult,
  ThreadGroup,
  ThreadInput as TriageThreadInput,
  TriageAgentConfig,
  TriageRule,
  TriageSuggestion,
} from "./triage/index.js";
export { createTriageAgent, TriageAgent } from "./triage/index.js";

// =============================================================================
// DRAFTING AGENT (Agent 7)
// =============================================================================

export type {
  // Schema types
  Citation,
  ConsistencyCheck,
  DraftContext,
  // Agent types
  DraftingAgentConfig,
  DraftOptions,
  DraftReply,
  DraftRequest,
  DraftVariationResult,
  FollowUpContext,
  FollowUpDraft as DraftingFollowUpDraft,
  GeneratedDraft,
  Improvement,
  ImprovementType,
  LengthAdjustment,
  Refinement,
  ReminderSchedule,
  ToneAnalysis,
  ToneProfile,
  VariationType,
} from "./drafting/index.js";
export {
  ConsistencyCheckSchema,
  createDraftingAgent,
  DraftingAgent,
  // Schemas
  DraftReplySchema,
  DraftVariationSchema,
  FollowUpDraftSchema,
  ImprovementSchema,
  LengthAdjustmentSchema,
  RefinementSchema,
  ReminderScheduleSchema,
  ToneAnalysisSchema,
} from "./drafting/index.js";

// =============================================================================
// RISK AGENT (Agent 8)
// =============================================================================

export type {
  CombinedRiskInput,
  CombinedRiskResult,
  ContradictionAnalysisResult,
  ContradictionResult,
  DraftRiskCheckRequest,
  DraftRiskCheckResponse,
  FraudAnalysisResult,
  FraudDetectionResult,
  HistoricalStatement,
  PolicyResult,
  PolicyRule,
  RiskAgentConfig,
  RiskAnalysisContext,
  RiskAnalysisRequest,
  RiskAnalysisResponse,
  SemanticAnalysisResult,
  SensitiveDataResult,
} from "./risk/index.js";
export { createRiskAgent, RiskAgent } from "./risk/index.js";

// =============================================================================
// DEDUPLICATION AGENT (Cross-Source Unification)
// =============================================================================

export type {
  DeduplicationAction,
  DeduplicationContext,
  DeduplicationResult,
  DetectionMethod,
  ExtractedCommitmentForDedup,
  LLMMatchAnalysis,
  MatchCandidate,
  ResolvedParties,
  SimilarUIO,
} from "./deduplication/index.js";
export {
  createDeduplicationAgent,
  DeduplicationActionSchema,
  DeduplicationAgent,
  DeduplicationResultSchema,
  LLMMatchAnalysisSchema,
} from "./deduplication/index.js";

// =============================================================================
// UPDATE DETECTION AGENT (Cross-Source Update Detection)
// =============================================================================

export type {
  DetectedReference,
  ExtractedUpdateInfo,
  LLMUpdateDetectionResponse,
  MessageInput as UpdateMessageInput,
  TrackedUIO,
  UpdateDetectionContext,
  UpdateDetectionResult,
  UpdateType,
} from "./update-detection/index.js";
export {
  createUpdateDetectionAgent,
  DetectedReferenceSchema,
  ExtractedUpdateInfoSchema,
  LLMUpdateDetectionResponseSchema,
  UpdateDetectionAgent,
  UpdateTypeSchema,
} from "./update-detection/index.js";
