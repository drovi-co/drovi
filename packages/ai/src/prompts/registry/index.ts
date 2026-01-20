// =============================================================================
// PROMPT REGISTRY
// =============================================================================
//
// Centralized registry for prompt version management.
// Enables A/B testing, rollback, and tracking of prompt performance.
//

// =============================================================================
// TYPES
// =============================================================================

/**
 * Prompt categories for organization.
 */
export type PromptCategory =
  | "classification"
  | "extraction"
  | "summarization"
  | "generation"
  | "analysis";

/**
 * Prompt metadata for tracking and versioning.
 */
export interface PromptMetadata {
  /** Unique identifier for the prompt */
  id: string;
  /** Human-readable name */
  name: string;
  /** Category for organization */
  category: PromptCategory;
  /** Semantic version (e.g., "1.0.0") */
  version: string;
  /** Description of what the prompt does */
  description: string;
  /** When the prompt was created */
  createdAt: Date;
  /** Who created/updated the prompt */
  author?: string;
  /** Tags for filtering */
  tags?: string[];
  /** Whether this is the active version */
  isActive: boolean;
  /** Parent version if this is an iteration */
  parentVersion?: string;
  /** Notes about changes from parent */
  changeNotes?: string;
}

/**
 * Performance metrics for a prompt version.
 */
export interface PromptMetrics {
  /** Number of times the prompt was used */
  usageCount: number;
  /** Average latency in ms */
  avgLatencyMs: number;
  /** Average input tokens */
  avgInputTokens: number;
  /** Average output tokens */
  avgOutputTokens: number;
  /** Success rate (0-1) */
  successRate: number;
  /** User feedback score (1-5) */
  feedbackScore?: number;
  /** Number of feedback submissions */
  feedbackCount?: number;
  /** Last used timestamp */
  lastUsedAt?: Date;
}

/**
 * A registered prompt with its template and metadata.
 */
export interface RegisteredPrompt {
  metadata: PromptMetadata;
  /** The prompt template (may include {placeholders}) */
  template: string;
  /** System prompt if separate */
  systemPrompt?: string;
  /** Expected input variables */
  inputVariables: string[];
  /** Output schema description */
  outputSchema?: string;
  /** Example inputs for testing */
  examples?: Array<{
    input: Record<string, unknown>;
    expectedOutput?: unknown;
  }>;
  /** Performance metrics */
  metrics?: PromptMetrics;
}

// =============================================================================
// REGISTRY STORAGE
// =============================================================================

const promptRegistry = new Map<string, RegisteredPrompt[]>();
const activeVersions = new Map<string, string>(); // promptId -> version

// =============================================================================
// REGISTRY FUNCTIONS
// =============================================================================

/**
 * Register a new prompt version.
 */
export function registerPrompt(prompt: RegisteredPrompt): void {
  const key = prompt.metadata.id;
  const versions = promptRegistry.get(key) ?? [];

  // Check for duplicate version
  if (versions.some((v) => v.metadata.version === prompt.metadata.version)) {
    throw new Error(
      `Prompt ${key} version ${prompt.metadata.version} already exists`
    );
  }

  versions.push(prompt);
  promptRegistry.set(key, versions);

  // Set as active if marked or if it's the first version
  if (prompt.metadata.isActive || versions.length === 1) {
    setActiveVersion(key, prompt.metadata.version);
  }
}

/**
 * Get the active version of a prompt.
 */
export function getPrompt(promptId: string): RegisteredPrompt | null {
  const activeVersion = activeVersions.get(promptId);
  if (!activeVersion) return null;

  return getPromptVersion(promptId, activeVersion);
}

/**
 * Get a specific version of a prompt.
 */
export function getPromptVersion(
  promptId: string,
  version: string
): RegisteredPrompt | null {
  const versions = promptRegistry.get(promptId);
  if (!versions) return null;

  return versions.find((v) => v.metadata.version === version) ?? null;
}

/**
 * Get all versions of a prompt.
 */
export function getPromptVersions(promptId: string): RegisteredPrompt[] {
  return promptRegistry.get(promptId) ?? [];
}

/**
 * Set the active version for a prompt.
 */
export function setActiveVersion(promptId: string, version: string): void {
  const versions = promptRegistry.get(promptId);
  if (!versions) {
    throw new Error(`Prompt ${promptId} not found`);
  }

  const targetVersion = versions.find((v) => v.metadata.version === version);
  if (!targetVersion) {
    throw new Error(`Version ${version} of prompt ${promptId} not found`);
  }

  // Update isActive flags
  for (const v of versions) {
    v.metadata.isActive = v.metadata.version === version;
  }

  activeVersions.set(promptId, version);
}

/**
 * Get all registered prompts.
 */
export function getAllPrompts(): RegisteredPrompt[] {
  const prompts: RegisteredPrompt[] = [];
  for (const [_, versions] of promptRegistry) {
    const active = versions.find((v) => v.metadata.isActive);
    if (active) prompts.push(active);
  }
  return prompts;
}

/**
 * Get prompts by category.
 */
export function getPromptsByCategory(
  category: PromptCategory
): RegisteredPrompt[] {
  return getAllPrompts().filter((p) => p.metadata.category === category);
}

/**
 * Get prompts by tag.
 */
export function getPromptsByTag(tag: string): RegisteredPrompt[] {
  return getAllPrompts().filter((p) => p.metadata.tags?.includes(tag));
}

/**
 * Update metrics for a prompt.
 */
export function updatePromptMetrics(
  promptId: string,
  version: string,
  metrics: Partial<PromptMetrics>
): void {
  const prompt = getPromptVersion(promptId, version);
  if (!prompt) return;

  prompt.metrics = {
    ...prompt.metrics,
    ...metrics,
    lastUsedAt: new Date(),
  } as PromptMetrics;
}

/**
 * Record a single prompt usage.
 */
export function recordPromptUsage(
  promptId: string,
  version: string,
  usage: {
    latencyMs: number;
    inputTokens: number;
    outputTokens: number;
    success: boolean;
  }
): void {
  const prompt = getPromptVersion(promptId, version);
  if (!prompt) return;

  const current = prompt.metrics ?? {
    usageCount: 0,
    avgLatencyMs: 0,
    avgInputTokens: 0,
    avgOutputTokens: 0,
    successRate: 1,
  };

  const newCount = current.usageCount + 1;

  // Update running averages
  prompt.metrics = {
    usageCount: newCount,
    avgLatencyMs:
      (current.avgLatencyMs * current.usageCount + usage.latencyMs) / newCount,
    avgInputTokens:
      (current.avgInputTokens * current.usageCount + usage.inputTokens) /
      newCount,
    avgOutputTokens:
      (current.avgOutputTokens * current.usageCount + usage.outputTokens) /
      newCount,
    successRate:
      (current.successRate * current.usageCount + (usage.success ? 1 : 0)) /
      newCount,
    feedbackScore: current.feedbackScore,
    feedbackCount: current.feedbackCount,
    lastUsedAt: new Date(),
  };
}

/**
 * Record user feedback for a prompt.
 */
export function recordPromptFeedback(
  promptId: string,
  version: string,
  score: number
): void {
  const prompt = getPromptVersion(promptId, version);
  if (!prompt) return;

  const current = prompt.metrics ?? {
    usageCount: 0,
    avgLatencyMs: 0,
    avgInputTokens: 0,
    avgOutputTokens: 0,
    successRate: 1,
  };

  const feedbackCount = (current.feedbackCount ?? 0) + 1;
  const currentScore = current.feedbackScore ?? 0;

  prompt.metrics = {
    ...current,
    feedbackScore: (currentScore * (feedbackCount - 1) + score) / feedbackCount,
    feedbackCount,
    lastUsedAt: new Date(),
  };
}

// =============================================================================
// TEMPLATE RENDERING
// =============================================================================

/**
 * Render a prompt template with variables.
 */
export function renderPrompt(
  promptId: string,
  variables: Record<string, unknown>,
  version?: string
): string | null {
  const prompt = version
    ? getPromptVersion(promptId, version)
    : getPrompt(promptId);

  if (!prompt) return null;

  let rendered = prompt.template;

  // Replace placeholders
  for (const [key, value] of Object.entries(variables)) {
    const placeholder = `{${key}}`;
    rendered = rendered.replace(
      new RegExp(placeholder, "g"),
      String(value ?? "")
    );
  }

  // Check for unreplaced placeholders
  const unreplaced = rendered.match(/\{[^}]+\}/g);
  if (unreplaced) {
    console.warn(
      `[PromptRegistry] Unreplaced placeholders in ${promptId}: ${unreplaced.join(", ")}`
    );
  }

  return rendered;
}

/**
 * Get the system prompt for a registered prompt.
 */
export function getSystemPrompt(
  promptId: string,
  version?: string
): string | null {
  const prompt = version
    ? getPromptVersion(promptId, version)
    : getPrompt(promptId);

  return prompt?.systemPrompt ?? null;
}

// =============================================================================
// EXPORT/IMPORT
// =============================================================================

/**
 * Export all prompts for backup/migration.
 */
export function exportPrompts(): RegisteredPrompt[] {
  const all: RegisteredPrompt[] = [];
  for (const [_, versions] of promptRegistry) {
    all.push(...versions);
  }
  return all;
}

/**
 * Import prompts from backup.
 */
export function importPrompts(
  prompts: RegisteredPrompt[],
  overwrite = false
): void {
  for (const prompt of prompts) {
    const existing = getPromptVersion(
      prompt.metadata.id,
      prompt.metadata.version
    );

    if (existing && !overwrite) {
      console.warn(
        `[PromptRegistry] Skipping existing prompt: ${prompt.metadata.id} v${prompt.metadata.version}`
      );
      continue;
    }

    if (existing && overwrite) {
      // Remove existing version
      const versions = promptRegistry.get(prompt.metadata.id) ?? [];
      const filtered = versions.filter(
        (v) => v.metadata.version !== prompt.metadata.version
      );
      promptRegistry.set(prompt.metadata.id, filtered);
    }

    registerPrompt(prompt);
  }
}

/**
 * Clear the registry (for testing).
 */
export function clearRegistry(): void {
  promptRegistry.clear();
  activeVersions.clear();
}

// =============================================================================
// INITIALIZATION - Register core prompts
// =============================================================================

// This function can be called to register default prompts
export function initializeDefaultPrompts(): void {
  // Intent Classification
  registerPrompt({
    metadata: {
      id: "intent-classification",
      name: "Intent Classification",
      category: "classification",
      version: "1.0.0",
      description: "Classify the intent of a message or thread",
      createdAt: new Date("2024-01-01"),
      isActive: true,
      tags: ["core", "thread-understanding"],
    },
    template: `Classify the intent of the following message:

{content}

Classify into one of: inquiry, request, update, announcement, discussion, escalation, approval, rejection, follow_up, greeting, other

Respond with JSON: { "intent": "...", "confidence": 0.0-1.0 }`,
    inputVariables: ["content"],
    outputSchema: "{ intent: string, confidence: number }",
  });

  // Urgency Scoring
  registerPrompt({
    metadata: {
      id: "urgency-scoring",
      name: "Urgency Scoring",
      category: "classification",
      version: "1.0.0",
      description: "Score the urgency of a message (1-5)",
      createdAt: new Date("2024-01-01"),
      isActive: true,
      tags: ["core", "thread-understanding"],
    },
    template: `Score the urgency of this message from 1 (low) to 5 (critical):

{content}

Consider:
- Explicit urgency indicators (URGENT, ASAP, deadline)
- Implicit urgency (blocking issues, time-sensitive)
- Sender context if available

Respond with JSON: { "score": 1-5, "reasons": ["..."] }`,
    inputVariables: ["content"],
    outputSchema: "{ score: number, reasons: string[] }",
  });

  // Commitment Extraction
  registerPrompt({
    metadata: {
      id: "commitment-extraction",
      name: "Commitment Extraction",
      category: "extraction",
      version: "1.0.0",
      description: "Extract commitments from messages",
      createdAt: new Date("2024-01-01"),
      isActive: true,
      tags: ["core", "intelligence"],
    },
    template: `Extract all commitments from the following conversation:

{content}

{sourceContext}

A commitment is a promise or agreement to do something. Look for:
- Explicit promises ("I will", "I'll", "We commit to")
- Implicit agreements ("Sounds good, I'll handle it")
- Deadline mentions
- Assignment of responsibility

For each commitment, identify:
- The person who made it (committer)
- What they committed to (description)
- Who they committed to (beneficiary)
- Any deadline mentioned
- Confidence level (0-1)
- Source quote

Respond with JSON array of commitments.`,
    inputVariables: ["content", "sourceContext"],
    outputSchema: "Commitment[]",
  });

  // Decision Extraction
  registerPrompt({
    metadata: {
      id: "decision-extraction",
      name: "Decision Extraction",
      category: "extraction",
      version: "1.0.0",
      description: "Extract decisions from messages",
      createdAt: new Date("2024-01-01"),
      isActive: true,
      tags: ["core", "intelligence"],
    },
    template: `Extract all decisions from the following conversation:

{content}

{sourceContext}

A decision is a choice or conclusion that was reached. Look for:
- Explicit decisions ("We've decided", "The decision is")
- Implicit agreements that resolve a question
- Approval/rejection of proposals
- Selection between options

For each decision, identify:
- What was decided (description)
- Who made the decision (decider)
- What alternatives were considered
- Rationale if provided
- Confidence level (0-1)
- Source quote

Respond with JSON array of decisions.`,
    inputVariables: ["content", "sourceContext"],
    outputSchema: "Decision[]",
  });

  // Thread Brief
  registerPrompt({
    metadata: {
      id: "thread-brief",
      name: "Thread Brief Generation",
      category: "summarization",
      version: "1.0.0",
      description: "Generate a brief summary of a thread",
      createdAt: new Date("2024-01-01"),
      isActive: true,
      tags: ["core", "thread-understanding"],
    },
    template: `Generate a brief summary (2-3 sentences) of this email thread:

Subject: {subject}

{content}

The brief should:
- Capture the main topic and purpose
- Note any pending actions or decisions
- Be written for someone skimming their inbox

Respond with JSON: { "brief": "...", "keyPoints": ["..."] }`,
    inputVariables: ["subject", "content"],
    outputSchema: "{ brief: string, keyPoints: string[] }",
  });
}
