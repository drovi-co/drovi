// =============================================================================
// THREAD UNDERSTANDING AGENT
// =============================================================================
//
// Agent 1: Orchestrates thread analysis including classification, extraction,
// and generation phases.
//

import { observability } from "../../observability";
import {
  analyzeSentiment,
  classifyIntent,
  detectThreadType,
  scoreUrgency,
} from "./classifiers/index";
import { extractAllClaims } from "./extractors/index";
import {
  analyzeWaitingOn,
  detectOpenLoops,
  generateBrief,
  generateTimeline,
} from "./generators/index";
import type {
  AnalysisOptions,
  ExtractedClaims,
  IntentClassification,
  OpenLoop,
  SentimentAnalysis,
  ThreadAnalysis,
  ThreadBrief,
  ThreadInput,
  ThreadTypeResult,
  TimelineEvent,
  UrgencyScore,
  WaitingOn,
} from "./types";

// Model version for tracking
const MODEL_VERSION = "1.0.0";

/**
 * Thread Understanding Agent
 *
 * Analyzes email threads to extract structured intelligence:
 * - Classification: intent, urgency, sentiment, thread type
 * - Extraction: facts, promises, requests, questions, decisions
 * - Generation: brief, timeline, open loops, waiting-on
 */
export class ThreadUnderstandingAgent {
  private readonly defaultOptions: AnalysisOptions = {
    skipClassification: false,
    skipExtraction: false,
    skipGeneration: false,
    force: false,
    minConfidence: 0.5,
  };

  /**
   * Analyze a thread completely.
   *
   * @param thread - Thread with messages to analyze
   * @param options - Analysis options
   * @returns Complete thread analysis
   */
  async analyze(
    thread: ThreadInput,
    options?: AnalysisOptions
  ): Promise<ThreadAnalysis> {
    const startTime = Date.now();
    const opts = { ...this.defaultOptions, ...options };

    const trace = observability.trace({
      name: "thread-understanding-agent",
      metadata: {
        threadId: thread.id,
        accountId: thread.accountId,
        messageCount: thread.messages.length,
      },
    });

    try {
      // Phase 1: Classification (parallel)
      const classification = opts.skipClassification
        ? getDefaultClassification(thread)
        : await this.runClassification(thread);

      // Phase 2: Extraction
      const claims = opts.skipExtraction
        ? getDefaultClaims()
        : await this.runExtraction(thread, opts.minConfidence);

      // Phase 3: Generation (depends on extraction)
      const generation = opts.skipGeneration
        ? getDefaultGeneration(thread)
        : await this.runGeneration(thread, claims);

      const duration = Date.now() - startTime;

      trace.generation({
        name: "complete-analysis",
        model: MODEL_VERSION,
        output: {
          classification: {
            intent: classification.intent.intent,
            urgency: classification.urgency.level,
            sentiment: classification.sentiment.overall,
          },
          claims: {
            facts: claims.facts.length,
            promises: claims.promises.length,
            requests: claims.requests.length,
            questions: claims.questions.length,
            decisions: claims.decisions.length,
          },
          openLoops: generation.openLoops.length,
          duration,
        },
      });

      return {
        threadId: thread.id,
        accountId: thread.accountId,
        organizationId: thread.organizationId,
        classification,
        claims,
        brief: generation.brief,
        timeline: generation.timeline,
        openLoops: generation.openLoops,
        waitingOn: generation.waitingOn,
        processedAt: new Date(),
        modelVersion: MODEL_VERSION,
        processingDuration: duration,
      };
    } catch (error) {
      trace.generation({
        name: "analysis-error",
        model: MODEL_VERSION,
        output: error instanceof Error ? error.message : "Unknown error",
        level: "ERROR",
      });
      throw error;
    }
  }

  /**
   * Run classification phase (parallel).
   */
  private async runClassification(thread: ThreadInput): Promise<{
    intent: IntentClassification;
    urgency: UrgencyScore;
    sentiment: SentimentAnalysis;
    threadType: ThreadTypeResult;
  }> {
    const [intent, urgency, sentiment, threadType] = await Promise.all([
      classifyIntent(thread.messages, thread.userEmail),
      scoreUrgency(thread.messages, thread.userEmail),
      analyzeSentiment(thread.messages, thread.userEmail),
      detectThreadType(thread.messages, thread.userEmail),
    ]);

    return { intent, urgency, sentiment, threadType };
  }

  /**
   * Run extraction phase.
   */
  private async runExtraction(
    thread: ThreadInput,
    minConfidence = 0.5
  ): Promise<ExtractedClaims> {
    return await extractAllClaims(
      thread.messages,
      thread.userEmail,
      minConfidence
    );
  }

  /**
   * Run generation phase.
   */
  private async runGeneration(
    thread: ThreadInput,
    claims: ExtractedClaims
  ): Promise<{
    brief: ThreadBrief;
    timeline: TimelineEvent[];
    openLoops: OpenLoop[];
    waitingOn: WaitingOn;
  }> {
    // Brief and timeline can run in parallel
    // Open loops and waiting-on depend on claims
    const [brief, timeline, openLoops, waitingOn] = await Promise.all([
      generateBrief(thread.messages, thread.userEmail, thread.subject),
      generateTimeline(thread.messages, thread.userEmail),
      detectOpenLoops(thread.messages, thread.userEmail, claims),
      analyzeWaitingOn(thread.messages, thread.userEmail, claims),
    ]);

    return { brief, timeline, openLoops, waitingOn };
  }

  /**
   * Quick classification only (faster, less detailed).
   */
  async classifyOnly(
    thread: ThreadInput
  ): Promise<ThreadAnalysis["classification"]> {
    return await this.runClassification(thread);
  }

  /**
   * Extraction only (for downstream agents).
   */
  async extractOnly(
    thread: ThreadInput,
    minConfidence = 0.5
  ): Promise<ExtractedClaims> {
    return await this.runExtraction(thread, minConfidence);
  }

  /**
   * Brief only (for inbox list view).
   */
  async briefOnly(thread: ThreadInput): Promise<ThreadBrief> {
    return await generateBrief(
      thread.messages,
      thread.userEmail,
      thread.subject
    );
  }
}

// =============================================================================
// DEFAULT/FALLBACK VALUES
// =============================================================================

function getDefaultClassification(_thread: ThreadInput): {
  intent: IntentClassification;
  urgency: UrgencyScore;
  sentiment: SentimentAnalysis;
  threadType: ThreadTypeResult;
} {
  return {
    intent: {
      intent: "other",
      confidence: 0,
      reasoning: "Classification skipped",
      secondaryIntents: null,
    },
    urgency: {
      score: 0.3,
      level: "medium",
      reasoning: "Urgency scoring skipped",
      signals: [],
    },
    sentiment: {
      overall: 0,
      trend: "stable",
      messages: [],
      escalationDetected: false,
      escalationReason: null,
    },
    threadType: {
      type: "single_message",
      confidence: 0,
      messageCount: _thread.messages.length,
      participantCount: 1,
      backAndForthCount: null,
      hasForward: false,
    },
  };
}

function getDefaultClaims(): ExtractedClaims {
  return {
    facts: [],
    promises: [],
    requests: [],
    questions: [],
    decisions: [],
    other: [],
  };
}

function getDefaultGeneration(_thread: ThreadInput): {
  brief: ThreadBrief;
  timeline: TimelineEvent[];
  openLoops: OpenLoop[];
  waitingOn: WaitingOn;
} {
  return {
    brief: {
      summary: _thread.subject || "Email thread",
      keyPoints: [],
      actionRequired: false,
      actionDescription: null,
      participants: [],
    },
    timeline: [],
    openLoops: [],
    waitingOn: {
      isWaitingOnOthers: false,
      isOthersWaitingOnUser: false,
      waitingOn: [],
      waitingFor: [],
    },
  };
}

// =============================================================================
// EXPORTS
// =============================================================================

/**
 * Create a new Thread Understanding Agent instance.
 */
export function createThreadUnderstandingAgent(): ThreadUnderstandingAgent {
  return new ThreadUnderstandingAgent();
}

/**
 * Analyze a thread (convenience function).
 */
export async function analyzeThread(
  thread: ThreadInput,
  options?: AnalysisOptions
): Promise<ThreadAnalysis> {
  const agent = new ThreadUnderstandingAgent();
  return await agent.analyze(thread, options);
}
