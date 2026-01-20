// =============================================================================
// MODEL ROUTER
// =============================================================================
//
// Intelligent model selection based on task type, complexity, and requirements.
// Routes AI tasks to the most cost-effective model that meets quality requirements.
//

// =============================================================================
// TYPES
// =============================================================================

/**
 * Task types for AI operations.
 */
export type AITaskType =
  | "classification" // Intent, urgency, sentiment classification
  | "extraction" // Claim, commitment, decision extraction
  | "summarization" // Thread briefs, summaries
  | "generation" // Draft generation, responses
  | "reasoning" // Risk analysis, complex decisions
  | "embedding"; // Vector embeddings

/**
 * Complexity levels for tasks.
 */
export type TaskComplexity = "simple" | "medium" | "complex";

/**
 * Latency requirements.
 */
export type LatencyRequirement = "realtime" | "interactive" | "batch";

/**
 * Quality requirements.
 */
export type QualityRequirement = "standard" | "high" | "critical";

/**
 * Model selection requirements.
 */
export interface ModelRequirements {
  task: AITaskType;
  complexity?: TaskComplexity;
  latency?: LatencyRequirement;
  quality?: QualityRequirement;
  /** Estimated input token count (for context window considerations) */
  estimatedInputTokens?: number;
  /** Whether structured output (JSON) is required */
  structuredOutput?: boolean;
  /** Source type for source-specific optimizations */
  sourceType?: "email" | "slack" | "whatsapp" | "calendar" | "notion" | "docs";
}

/**
 * Available model IDs.
 */
export type ModelId =
  // Anthropic
  | "claude-3-5-sonnet-20241022"
  | "claude-3-5-haiku-20241022"
  | "claude-3-opus-20240229"
  // OpenAI
  | "gpt-4o"
  | "gpt-4o-mini"
  | "gpt-4-turbo"
  // Google
  | "gemini-2.5-flash"
  | "gemini-1.5-pro";

/**
 * Model capabilities and characteristics.
 */
export interface ModelProfile {
  id: ModelId;
  provider: "anthropic" | "openai" | "google";
  /** Context window size in tokens */
  contextWindow: number;
  /** Cost per 1M input tokens in cents */
  inputCostPer1M: number;
  /** Cost per 1M output tokens in cents */
  outputCostPer1M: number;
  /** Relative quality score (1-10) */
  qualityScore: number;
  /** Relative speed score (1-10) */
  speedScore: number;
  /** Supports structured JSON output */
  supportsStructuredOutput: boolean;
  /** Best for specific task types */
  bestFor: AITaskType[];
}

// =============================================================================
// MODEL PROFILES
// =============================================================================

const MODEL_PROFILES: Record<ModelId, ModelProfile> = {
  // Anthropic Models
  "claude-3-5-sonnet-20241022": {
    id: "claude-3-5-sonnet-20241022",
    provider: "anthropic",
    contextWindow: 200000,
    inputCostPer1M: 300,
    outputCostPer1M: 1500,
    qualityScore: 9,
    speedScore: 7,
    supportsStructuredOutput: true,
    bestFor: ["generation", "reasoning"],
  },
  "claude-3-5-haiku-20241022": {
    id: "claude-3-5-haiku-20241022",
    provider: "anthropic",
    contextWindow: 200000,
    inputCostPer1M: 80,
    outputCostPer1M: 400,
    qualityScore: 7,
    speedScore: 9,
    supportsStructuredOutput: true,
    bestFor: ["classification", "extraction", "summarization"],
  },
  "claude-3-opus-20240229": {
    id: "claude-3-opus-20240229",
    provider: "anthropic",
    contextWindow: 200000,
    inputCostPer1M: 1500,
    outputCostPer1M: 7500,
    qualityScore: 10,
    speedScore: 4,
    supportsStructuredOutput: true,
    bestFor: ["reasoning"],
  },

  // OpenAI Models
  "gpt-4o": {
    id: "gpt-4o",
    provider: "openai",
    contextWindow: 128000,
    inputCostPer1M: 250,
    outputCostPer1M: 1000,
    qualityScore: 8,
    speedScore: 8,
    supportsStructuredOutput: true,
    bestFor: ["generation", "reasoning", "summarization"],
  },
  "gpt-4o-mini": {
    id: "gpt-4o-mini",
    provider: "openai",
    contextWindow: 128000,
    inputCostPer1M: 15,
    outputCostPer1M: 60,
    qualityScore: 6,
    speedScore: 10,
    supportsStructuredOutput: true,
    bestFor: ["classification", "extraction"],
  },
  "gpt-4-turbo": {
    id: "gpt-4-turbo",
    provider: "openai",
    contextWindow: 128000,
    inputCostPer1M: 1000,
    outputCostPer1M: 3000,
    qualityScore: 8,
    speedScore: 6,
    supportsStructuredOutput: true,
    bestFor: ["generation", "reasoning"],
  },

  // Google Models
  "gemini-2.5-flash": {
    id: "gemini-2.5-flash",
    provider: "google",
    contextWindow: 1000000,
    inputCostPer1M: 7.5,
    outputCostPer1M: 30,
    qualityScore: 7,
    speedScore: 10,
    supportsStructuredOutput: true,
    bestFor: ["classification", "extraction", "summarization"],
  },
  "gemini-1.5-pro": {
    id: "gemini-1.5-pro",
    provider: "google",
    contextWindow: 2000000,
    inputCostPer1M: 125,
    outputCostPer1M: 500,
    qualityScore: 8,
    speedScore: 7,
    supportsStructuredOutput: true,
    bestFor: ["generation", "reasoning", "summarization"],
  },
};

// =============================================================================
// MODEL ROUTER
// =============================================================================

/**
 * Default model mappings by task type and quality.
 */
const DEFAULT_MODEL_MAP: Record<
  AITaskType,
  Record<QualityRequirement, ModelId>
> = {
  classification: {
    standard: "gemini-2.5-flash",
    high: "claude-3-5-haiku-20241022",
    critical: "claude-3-5-sonnet-20241022",
  },
  extraction: {
    standard: "gemini-2.5-flash",
    high: "claude-3-5-haiku-20241022",
    critical: "claude-3-5-sonnet-20241022",
  },
  summarization: {
    standard: "gemini-2.5-flash",
    high: "claude-3-5-haiku-20241022",
    critical: "gpt-4o",
  },
  generation: {
    standard: "gpt-4o-mini",
    high: "gpt-4o",
    critical: "claude-3-5-sonnet-20241022",
  },
  reasoning: {
    standard: "claude-3-5-haiku-20241022",
    high: "claude-3-5-sonnet-20241022",
    critical: "claude-3-opus-20240229",
  },
  embedding: {
    standard: "gpt-4o-mini",
    high: "gpt-4o-mini",
    critical: "gpt-4o-mini",
  },
};

/**
 * Complexity-based quality adjustment.
 */
function adjustQualityForComplexity(
  baseQuality: QualityRequirement,
  complexity: TaskComplexity
): QualityRequirement {
  if (complexity === "complex" && baseQuality === "standard") {
    return "high";
  }
  if (complexity === "complex" && baseQuality === "high") {
    return "critical";
  }
  return baseQuality;
}

/**
 * Select the optimal model for given requirements.
 */
export function selectModel(requirements: ModelRequirements): ModelId {
  const {
    task,
    complexity = "medium",
    latency = "interactive",
    quality = "standard",
    estimatedInputTokens,
    structuredOutput = false,
  } = requirements;

  // Adjust quality based on complexity
  const effectiveQuality = adjustQualityForComplexity(quality, complexity);

  // Start with default model for task/quality combo
  let selectedModel = DEFAULT_MODEL_MAP[task][effectiveQuality];
  let profile = MODEL_PROFILES[selectedModel];

  // Check context window requirements
  if (estimatedInputTokens && estimatedInputTokens > profile.contextWindow * 0.8) {
    // Need a larger context window model
    const largeContextModels: ModelId[] = [
      "gemini-1.5-pro",
      "gemini-2.5-flash",
      "claude-3-5-sonnet-20241022",
    ];

    for (const modelId of largeContextModels) {
      const modelProfile = MODEL_PROFILES[modelId];
      if (modelProfile.contextWindow >= estimatedInputTokens * 1.2) {
        selectedModel = modelId;
        profile = modelProfile;
        break;
      }
    }
  }

  // Check latency requirements
  if (latency === "realtime" && profile.speedScore < 8) {
    // Need a faster model
    const fastModels: ModelId[] = [
      "gemini-2.5-flash",
      "gpt-4o-mini",
      "claude-3-5-haiku-20241022",
    ];

    for (const modelId of fastModels) {
      const modelProfile = MODEL_PROFILES[modelId];
      if (
        modelProfile.speedScore >= 8 &&
        (!structuredOutput || modelProfile.supportsStructuredOutput)
      ) {
        selectedModel = modelId;
        break;
      }
    }
  }

  // Check structured output requirement
  if (structuredOutput && !profile.supportsStructuredOutput) {
    // This shouldn't happen with current models, but handle it
    selectedModel = "gpt-4o-mini";
  }

  return selectedModel;
}

/**
 * Get the model profile for a given model ID.
 */
export function getModelProfile(modelId: ModelId): ModelProfile {
  return MODEL_PROFILES[modelId];
}

/**
 * Estimate cost for a model and token counts.
 */
export function estimateCost(
  modelId: ModelId,
  inputTokens: number,
  outputTokens: number
): number {
  const profile = MODEL_PROFILES[modelId];
  const inputCost = (inputTokens / 1_000_000) * profile.inputCostPer1M;
  const outputCost = (outputTokens / 1_000_000) * profile.outputCostPer1M;
  return Math.round((inputCost + outputCost) * 100) / 100;
}

/**
 * Get all available models.
 */
export function getAvailableModels(): ModelProfile[] {
  return Object.values(MODEL_PROFILES);
}

/**
 * Get models for a specific provider.
 */
export function getModelsByProvider(
  provider: "anthropic" | "openai" | "google"
): ModelProfile[] {
  return Object.values(MODEL_PROFILES).filter((m) => m.provider === provider);
}

/**
 * Get the cheapest model that meets minimum quality requirements.
 */
export function getCheapestModel(
  minQuality: number = 6,
  structuredOutput: boolean = false
): ModelId {
  const candidates = Object.values(MODEL_PROFILES)
    .filter((m) => m.qualityScore >= minQuality)
    .filter((m) => !structuredOutput || m.supportsStructuredOutput)
    .sort((a, b) => a.inputCostPer1M - b.inputCostPer1M);

  return candidates[0]?.id ?? "gpt-4o-mini";
}

/**
 * Get the fastest model that meets minimum quality requirements.
 */
export function getFastestModel(
  minQuality: number = 6,
  structuredOutput: boolean = false
): ModelId {
  const candidates = Object.values(MODEL_PROFILES)
    .filter((m) => m.qualityScore >= minQuality)
    .filter((m) => !structuredOutput || m.supportsStructuredOutput)
    .sort((a, b) => b.speedScore - a.speedScore);

  return candidates[0]?.id ?? "gemini-2.5-flash";
}

/**
 * Get the highest quality model within a cost budget (cents per 1M tokens).
 */
export function getBestModelWithinBudget(
  maxCostPer1M: number,
  structuredOutput: boolean = false
): ModelId {
  const candidates = Object.values(MODEL_PROFILES)
    .filter((m) => m.inputCostPer1M <= maxCostPer1M)
    .filter((m) => !structuredOutput || m.supportsStructuredOutput)
    .sort((a, b) => b.qualityScore - a.qualityScore);

  return candidates[0]?.id ?? "gpt-4o-mini";
}

// =============================================================================
// EXPORTS
// =============================================================================

export { MODEL_PROFILES };
