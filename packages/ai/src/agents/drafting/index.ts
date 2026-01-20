// =============================================================================
// DRAFTING AGENT (Agent 7)
// =============================================================================
//
// Evidence-grounded reply drafting with citations, tone matching, and
// consistency checking.
//

import { generateText } from "ai";
import {
  buildDraftContext,
  buildHistoricalStatements,
  type CitationSource,
  checkConsistencyRules,
  extractCitationSources,
  getToneProfile,
  getVariationParams,
  postProcessDraft,
  type ToneProfile,
  type VariationType,
} from "../../generation/index.js";
import { observability } from "../../observability.js";
import {
  buildConsistencyCheckPrompt,
  buildDraftingSystemPrompt,
  buildFollowUpPrompt,
  buildFollowUpSystemPrompt,
  buildImprovementPrompt,
  buildLengthAdjustmentPrompt,
  buildRefinementPrompt,
  buildReminderSchedulePrompt,
  buildReplyDraftPrompt,
  buildToneAdjustmentPrompt,
  buildToneAnalysisPrompt,
  buildVariationsPrompt,
  type CommitmentContext,
  type ConsistencyCheck,
  ConsistencyCheckSchema,
  type DraftContext,
  type DraftReply,
  DraftReplySchema,
  DraftVariationSchema,
  type FollowUpContext,
  type FollowUpDraft,
  FollowUpDraftSchema,
  type HistoricalContext,
  type Improvement,
  ImprovementSchema,
  type ImprovementType,
  type LengthAdjustment,
  LengthAdjustmentSchema,
  type Refinement,
  RefinementSchema,
  type RelationshipContext,
  type ReminderSchedule,
  ReminderScheduleSchema,
  type ThreadContext,
  type ToneAnalysis,
  ToneAnalysisSchema,
} from "../../prompts/drafting/index.js";
import {
  type AIProvider,
  getDefaultModel,
  getModel,
} from "../../providers/index.js";

// =============================================================================
// TYPES
// =============================================================================

export interface DraftingAgentConfig {
  provider?: AIProvider;
  model?: string;
  temperature?: number;
  maxTokens?: number;
  enableToneMatching?: boolean;
  enableConsistencyCheck?: boolean;
}

export interface DraftRequest {
  threadId: string;
  thread: ThreadContext;
  userIntent: string;
  relationship?: RelationshipContext;
  history?: HistoricalContext;
  commitments?: CommitmentContext;
  userToneSamples?: string[];
  options?: DraftOptions;
}

export interface DraftOptions {
  tone?: "formal" | "professional" | "casual" | "friendly";
  length?: "brief" | "standard" | "detailed";
  includeGreeting?: boolean;
  includeSignoff?: boolean;
  citationLevel?: "minimal" | "standard" | "thorough";
  forceToneMatch?: boolean;
}

export interface GeneratedDraft {
  draft: DraftReply;
  context: DraftContext;
  toneProfile?: ToneProfile;
  consistencyCheck?: ConsistencyCheck;
  citationSources: CitationSource[];
}

export interface DraftVariationResult {
  variations: Array<{
    id: string;
    label: string;
    body: string;
    characteristics: string[];
    bestFor: string;
  }>;
  baseDraft: string;
}

// =============================================================================
// DRAFTING AGENT CLASS
// =============================================================================

/**
 * Drafting Agent for evidence-grounded email generation.
 */
export class DraftingAgent {
  private readonly config: DraftingAgentConfig;

  constructor(config: DraftingAgentConfig = {}) {
    this.config = {
      temperature: 0.5,
      maxTokens: 2048,
      enableToneMatching: true,
      enableConsistencyCheck: true,
      ...config,
    };
  }

  // ===========================================================================
  // DRAFT GENERATION
  // ===========================================================================

  /**
   * Generate an evidence-grounded reply draft.
   */
  async generateDraft(request: DraftRequest): Promise<GeneratedDraft> {
    const trace = observability.trace({
      name: "drafting:generate",
      metadata: { threadId: request.threadId },
    });

    try {
      // Build context
      const context = buildDraftContext(
        request.thread,
        request.relationship,
        request.history,
        request.commitments,
        request.userIntent,
        request.userToneSamples
      );

      // Extract citation sources
      const citationSources = extractCitationSources(context);

      // Get or analyze tone profile
      let toneProfile: ToneProfile | undefined;
      if (this.config.enableToneMatching && request.userToneSamples?.length) {
        if (request.options?.forceToneMatch) {
          // Use LLM for more accurate tone analysis
          toneProfile = await this.analyzeTone(request.userToneSamples);
        } else {
          // Use rule-based tone profile
          toneProfile = getToneProfile(
            request.userToneSamples,
            request.options?.tone
          );
        }
      } else if (request.options?.tone) {
        toneProfile = getToneProfile(undefined, request.options.tone);
      }

      // Generate draft using LLM
      const model = this.config.provider
        ? getModel(this.config.provider, this.config.model)
        : getDefaultModel();

      const { text } = await generateText({
        model,
        messages: [
          { role: "system", content: buildDraftingSystemPrompt() },
          { role: "user", content: buildReplyDraftPrompt(context) },
        ],
        temperature: this.config.temperature ?? 0.5,
        maxOutputTokens: this.config.maxTokens ?? 2048,
      });

      const parsed = JSON.parse(text);
      let draft = DraftReplySchema.parse(parsed);

      // Post-process draft
      draft = postProcessDraft(
        draft,
        citationSources,
        toneProfile,
        request.options
      );

      // Check consistency if enabled
      let consistencyCheck: ConsistencyCheck | undefined;
      if (this.config.enableConsistencyCheck) {
        const statements = buildHistoricalStatements(context);
        if (statements.length > 0) {
          consistencyCheck = await this.checkConsistency(
            draft.body,
            statements
          );
        }
      }

      trace.generation({
        name: "generate-draft",
        input: {
          threadId: request.threadId,
          intent: request.userIntent,
        },
        output: {
          confidence: draft.confidence,
          citationCount: draft.citations.length,
          hasWarnings: (draft.warnings?.length ?? 0) > 0,
        },
      });

      return {
        draft,
        context,
        toneProfile,
        consistencyCheck,
        citationSources,
      };
    } catch (error) {
      trace.generation({
        name: "generate-draft-error",
        input: { threadId: request.threadId },
        output: error instanceof Error ? error.message : "Unknown error",
        level: "ERROR",
      });

      throw error;
    }
  }

  // ===========================================================================
  // FOLLOW-UP GENERATION
  // ===========================================================================

  /**
   * Generate a follow-up email for a commitment.
   */
  async generateFollowUp(context: FollowUpContext): Promise<FollowUpDraft> {
    const trace = observability.trace({
      name: "drafting:follow-up",
      metadata: { commitmentId: context.commitment.id },
    });

    try {
      const model = this.config.provider
        ? getModel(this.config.provider, this.config.model)
        : getDefaultModel();

      const { text } = await generateText({
        model,
        messages: [
          { role: "system", content: buildFollowUpSystemPrompt() },
          { role: "user", content: buildFollowUpPrompt(context) },
        ],
        temperature: this.config.temperature ?? 0.5,
        maxOutputTokens: this.config.maxTokens ?? 1024,
      });

      const parsed = JSON.parse(text);
      const draft = FollowUpDraftSchema.parse(parsed);

      trace.generation({
        name: "generate-follow-up",
        input: { commitmentId: context.commitment.id },
        output: { tone: draft.tone, urgencyLevel: draft.urgencyLevel },
      });

      return draft;
    } catch (error) {
      trace.generation({
        name: "generate-follow-up-error",
        input: { commitmentId: context.commitment.id },
        output: error instanceof Error ? error.message : "Unknown error",
        level: "ERROR",
      });

      throw error;
    }
  }

  /**
   * Generate a reminder schedule for a commitment.
   */
  async generateReminderSchedule(
    commitment: {
      title: string;
      dueDate?: Date;
      importance: "low" | "medium" | "high" | "critical";
    },
    contactResponsePattern?: {
      avgResponseDays: number;
      preferredDays: string[];
    }
  ): Promise<ReminderSchedule> {
    const model = this.config.provider
      ? getModel(this.config.provider, this.config.model)
      : getDefaultModel();

    const { text } = await generateText({
      model,
      messages: [
        {
          role: "user",
          content: buildReminderSchedulePrompt(
            commitment,
            contactResponsePattern
          ),
        },
      ],
      temperature: 0.4,
      maxOutputTokens: 512,
    });

    const parsed = JSON.parse(text);
    return ReminderScheduleSchema.parse(parsed);
  }

  // ===========================================================================
  // DRAFT REFINEMENT
  // ===========================================================================

  /**
   * Refine a draft based on user feedback.
   */
  async refineDraft(
    originalDraft: string,
    feedback: string,
    context?: {
      threadSubject?: string;
      recipientName?: string;
      constraints?: string[];
    }
  ): Promise<Refinement> {
    const trace = observability.trace({
      name: "drafting:refine",
      metadata: {},
    });

    try {
      const model = this.config.provider
        ? getModel(this.config.provider, this.config.model)
        : getDefaultModel();

      const { text } = await generateText({
        model,
        messages: [
          {
            role: "user",
            content: buildRefinementPrompt(originalDraft, feedback, context),
          },
        ],
        temperature: this.config.temperature ?? 0.5,
        maxOutputTokens: this.config.maxTokens ?? 1024,
      });

      const parsed = JSON.parse(text);
      const refinement = RefinementSchema.parse(parsed);

      trace.generation({
        name: "refine-draft",
        input: { feedback },
        output: { changesCount: refinement.changesApplied.length },
      });

      return refinement;
    } catch (error) {
      trace.generation({
        name: "refine-draft-error",
        input: { feedback },
        output: error instanceof Error ? error.message : "Unknown error",
        level: "ERROR",
      });

      throw error;
    }
  }

  // ===========================================================================
  // DRAFT VARIATIONS
  // ===========================================================================

  /**
   * Generate multiple variations of a draft.
   */
  async generateVariations(
    baseDraft: string,
    intent: string,
    variationTypes: VariationType[]
  ): Promise<DraftVariationResult> {
    const trace = observability.trace({
      name: "drafting:variations",
      metadata: {},
    });

    try {
      const model = this.config.provider
        ? getModel(this.config.provider, this.config.model)
        : getDefaultModel();

      const { text } = await generateText({
        model,
        messages: [
          {
            role: "user",
            content: buildVariationsPrompt(baseDraft, intent, variationTypes),
          },
        ],
        temperature: 0.6, // Slightly higher for variation
        maxOutputTokens: this.config.maxTokens ?? 2048,
      });

      const parsed = JSON.parse(text);
      const result = DraftVariationSchema.parse(parsed);

      // Map to ensure required fields are present
      const variations = result.variations.map((v, i) => ({
        id: v.id ?? `variation-${i}`,
        label: v.label ?? `Variation ${i + 1}`,
        body: v.body ?? baseDraft,
        characteristics: v.characteristics ?? [],
        bestFor: v.bestFor ?? "General use",
      }));

      trace.generation({
        name: "generate-variations",
        input: { variationTypes },
        output: { variationCount: variations.length },
      });

      return {
        variations,
        baseDraft,
      };
    } catch (error) {
      trace.generation({
        name: "generate-variations-error",
        input: { variationTypes },
        output: error instanceof Error ? error.message : "Unknown error",
        level: "ERROR",
      });

      throw error;
    }
  }

  /**
   * Get variation parameters for a given type.
   */
  getVariationParams(type: VariationType): DraftOptions {
    return getVariationParams(type);
  }

  // ===========================================================================
  // LENGTH ADJUSTMENT
  // ===========================================================================

  /**
   * Adjust the length of a draft.
   */
  async adjustLength(
    draft: string,
    target: "shorter" | "longer" | { minWords?: number; maxWords?: number },
    preserveElements?: string[]
  ): Promise<LengthAdjustment> {
    const model = this.config.provider
      ? getModel(this.config.provider, this.config.model)
      : getDefaultModel();

    const { text } = await generateText({
      model,
      messages: [
        {
          role: "user",
          content: buildLengthAdjustmentPrompt(draft, target, preserveElements),
        },
      ],
      temperature: 0.4,
      maxOutputTokens: this.config.maxTokens ?? 1024,
    });

    const parsed = JSON.parse(text);
    return LengthAdjustmentSchema.parse(parsed);
  }

  // ===========================================================================
  // SPECIFIC IMPROVEMENTS
  // ===========================================================================

  /**
   * Apply a specific improvement type to a draft.
   */
  async improveDraft(
    draft: string,
    improvementType: ImprovementType
  ): Promise<Improvement> {
    const model = this.config.provider
      ? getModel(this.config.provider, this.config.model)
      : getDefaultModel();

    const { text } = await generateText({
      model,
      messages: [
        {
          role: "user",
          content: buildImprovementPrompt(draft, improvementType),
        },
      ],
      temperature: 0.5,
      maxOutputTokens: this.config.maxTokens ?? 1024,
    });

    const parsed = JSON.parse(text);
    return ImprovementSchema.parse(parsed);
  }

  // ===========================================================================
  // TONE ANALYSIS
  // ===========================================================================

  /**
   * Analyze tone from writing samples using LLM.
   */
  async analyzeTone(samples: string[]): Promise<ToneProfile> {
    const model = this.config.provider
      ? getModel(this.config.provider, this.config.model)
      : getDefaultModel();

    try {
      const { text } = await generateText({
        model,
        messages: [{ role: "user", content: buildToneAnalysisPrompt(samples) }],
        temperature: 0.3,
        maxOutputTokens: 512,
      });

      const parsed = JSON.parse(text);
      const analysis = ToneAnalysisSchema.parse(parsed);

      // Convert ToneAnalysis to ToneProfile
      return {
        primaryTone: analysis.detectedTone,
        formalityScore: analysis.formalityScore,
        characteristics: analysis.characteristics.map((c) => ({
          trait: c,
          examples: [],
          frequency: 0.7,
        })),
        greetings: [],
        signoffs: [],
        averageSentenceLength: analysis.averageSentenceLength,
        averageWordLength: 5,
        vocabularyComplexity: analysis.formalityScore * 0.7,
      };
    } catch {
      // Fallback to rule-based analysis
      return getToneProfile(samples);
    }
  }

  /**
   * Adjust draft to match target tone.
   */
  async adjustTone(draft: string, targetTone: ToneAnalysis): Promise<string> {
    const model = this.config.provider
      ? getModel(this.config.provider, this.config.model)
      : getDefaultModel();

    const { text } = await generateText({
      model,
      messages: [
        {
          role: "user",
          content: buildToneAdjustmentPrompt(draft, targetTone),
        },
      ],
      temperature: 0.4,
      maxOutputTokens: this.config.maxTokens ?? 1024,
    });

    return text;
  }

  // ===========================================================================
  // CONSISTENCY CHECKING
  // ===========================================================================

  /**
   * Check draft consistency against historical statements.
   */
  async checkConsistency(
    draft: string,
    statements: Array<{ id: string; text: string; source: string; date: Date }>
  ): Promise<ConsistencyCheck> {
    // First try rule-based check
    const ruleCheck = checkConsistencyRules(draft, statements);

    // If rule-based check finds issues or we want thorough checking, use LLM
    if (!ruleCheck.isConsistent || statements.length > 5) {
      try {
        const model = this.config.provider
          ? getModel(this.config.provider, this.config.model)
          : getDefaultModel();

        const { text } = await generateText({
          model,
          messages: [
            {
              role: "user",
              content: buildConsistencyCheckPrompt(draft, statements),
            },
          ],
          temperature: 0.2,
          maxOutputTokens: 1024,
        });

        const parsed = JSON.parse(text);
        return ConsistencyCheckSchema.parse(parsed);
      } catch {
        // Fallback to rule-based result
        return ruleCheck;
      }
    }

    return ruleCheck;
  }

  // ===========================================================================
  // QUICK ACTIONS
  // ===========================================================================

  /**
   * Apply a quick action to a draft.
   */
  async applyQuickAction(
    draft: string,
    action:
      | "add-greeting"
      | "add-signoff"
      | "add-cta"
      | "soften-tone"
      | "strengthen-tone"
      | "add-appreciation"
  ): Promise<string> {
    const model = this.config.provider
      ? getModel(this.config.provider, this.config.model)
      : getDefaultModel();

    const { text } = await generateText({
      model,
      messages: [
        {
          role: "user",
          content: `Apply a quick improvement to this email.

## Draft
${draft}

## Action: ${action}
${this.getQuickActionInstruction(action)}

## Instructions
Make the minimal changes needed to achieve the action. Preserve the rest of the email exactly as is.

Respond with just the modified email text (no JSON, no explanation).`,
        },
      ],
      temperature: 0.3,
      maxOutputTokens: this.config.maxTokens ?? 1024,
    });

    return text;
  }

  private getQuickActionInstruction(action: string): string {
    const instructions: Record<string, string> = {
      "add-greeting":
        "Add an appropriate greeting if missing. Match the formality of the email.",
      "add-signoff":
        "Add a professional sign-off if missing. Include appropriate closing and name placeholder.",
      "add-cta":
        "Add a clear call-to-action. Be specific about what you need and when.",
      "soften-tone":
        "Soften the language throughout. Use more hedging words, add politeness markers.",
      "strengthen-tone":
        "Make the language more direct and assertive. Remove hedging, use active voice.",
      "add-appreciation":
        "Add expressions of appreciation or thanks where appropriate.",
    };
    return instructions[action] ?? "";
  }
}

// =============================================================================
// FACTORY FUNCTIONS
// =============================================================================

/**
 * Create a new DraftingAgent instance.
 */
export function createDraftingAgent(
  config?: DraftingAgentConfig
): DraftingAgent {
  return new DraftingAgent(config);
}

// =============================================================================
// RE-EXPORTS
// =============================================================================

// Types from generation
export type { ToneProfile, VariationType } from "../../generation/index.js";
// Types from prompts/drafting
export type {
  Citation,
  ConsistencyCheck,
  DraftContext,
  DraftReply,
  FollowUpContext,
  FollowUpDraft,
  Improvement,
  ImprovementType,
  LengthAdjustment,
  Refinement,
  ReminderSchedule,
  ToneAnalysis,
} from "../../prompts/drafting/index.js";

// Schemas from prompts/drafting
export {
  ConsistencyCheckSchema,
  DraftReplySchema,
  DraftVariationSchema,
  FollowUpDraftSchema,
  ImprovementSchema,
  LengthAdjustmentSchema,
  RefinementSchema,
  ReminderScheduleSchema,
  ToneAnalysisSchema,
} from "../../prompts/drafting/index.js";
