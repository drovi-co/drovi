// =============================================================================
// KNOWLEDGE AGENT (Part of Agent 5)
// =============================================================================
//
// Pattern detection, cross-thread connections, and insight generation.
// Builds institutional memory from email conversations.
//

import { generateText } from "ai";
import { z } from "zod";
import {
  aggregateEmbeddings,
  cosineSimilarity,
} from "../../embeddings/generator.js";
import { observability } from "../../observability.js";
import {
  type AIProvider,
  getDefaultModel,
  getModel,
  isReasoningModel,
} from "../../providers/index.js";

// =============================================================================
// TYPES
// =============================================================================

export interface PatternInput {
  id: string;
  content: string;
  embedding: number[];
  metadata: {
    date: Date;
    threadId: string;
    threadSubject: string;
    participants: string[];
    type?: string;
  };
}

export interface DetectedPattern {
  id: string;
  name: string;
  description: string;
  frequency: number;
  examples: Array<{
    id: string;
    content: string;
    date: Date;
  }>;
  participants: string[];
  timeSpan: {
    first: Date;
    last: Date;
  };
  confidence: number;
}

export interface CrossThreadConnection {
  sourceThreadId: string;
  targetThreadId: string;
  similarity: number;
  connectionType: "topic" | "participant" | "reference" | "follow_up";
  sharedElements: string[];
}

export interface TopicSummary {
  topic: string;
  summary: string;
  keyPoints: string[];
  timeline: Array<{
    date: Date;
    event: string;
    threadId: string;
  }>;
  participants: string[];
  status: "active" | "resolved" | "stale";
  relatedTopics: string[];
}

export interface Insight {
  id: string;
  type: "pattern" | "trend" | "anomaly" | "recommendation";
  title: string;
  description: string;
  evidence: string[];
  confidence: number;
  actionable: boolean;
  suggestedAction?: string;
}

export interface KnowledgeAgentConfig {
  provider?: AIProvider;
  model?: string;
  temperature?: number;
  maxTokens?: number;
  clusteringThreshold?: number;
}

// =============================================================================
// SCHEMAS
// =============================================================================

export const PatternResponseSchema = z.object({
  name: z.string(),
  description: z.string(),
  frequency: z.number(),
  participants: z.array(z.string()),
  confidence: z.number(),
});

export const TopicSummaryResponseSchema = z.object({
  summary: z.string(),
  keyPoints: z.array(z.string()),
  timeline: z.array(
    z.object({
      date: z.string(),
      event: z.string(),
      threadId: z.string(),
    })
  ),
  participants: z.array(z.string()),
  status: z.enum(["active", "resolved", "stale"]),
  relatedTopics: z.array(z.string()),
});

export const InsightResponseSchema = z.object({
  type: z.enum(["pattern", "trend", "anomaly", "recommendation"]),
  title: z.string(),
  description: z.string(),
  confidence: z.number(),
  actionable: z.boolean(),
  suggestedAction: z.string().optional(),
});

// =============================================================================
// KNOWLEDGE AGENT CLASS
// =============================================================================

/**
 * Knowledge Agent for pattern detection and insight generation.
 */
export class KnowledgeAgent {
  private readonly config: KnowledgeAgentConfig;

  constructor(config: KnowledgeAgentConfig = {}) {
    this.config = {
      temperature: 0.4,
      maxTokens: 2048,
      clusteringThreshold: 0.75,
      ...config,
    };
  }

  /**
   * Get the model name being used (for checking if it's a reasoning model).
   */
  private getModelName(): string {
    return this.config.model ?? "gpt-5.2";
  }

  // ===========================================================================
  // PATTERN DETECTION
  // ===========================================================================

  /**
   * Detect patterns by clustering similar items.
   */
  detectPatterns(
    items: PatternInput[],
    options: { minClusterSize?: number; maxClusters?: number } = {}
  ): Map<string, PatternInput[]> {
    const { minClusterSize = 3, maxClusters = 20 } = options;
    const threshold = this.config.clusteringThreshold ?? 0.75;

    // Simple agglomerative clustering
    const clusters = new Map<string, PatternInput[]>();
    const assigned = new Set<string>();

    // Sort by date to process chronologically
    const sorted = [...items].sort(
      (a, b) => a.metadata.date.getTime() - b.metadata.date.getTime()
    );

    for (const item of sorted) {
      if (assigned.has(item.id)) continue;

      // Find best matching cluster
      let bestCluster: string | null = null;
      let bestSimilarity = 0;

      for (const [clusterId, clusterItems] of clusters) {
        // Calculate similarity to cluster centroid
        const centroid = this.calculateCentroid(
          clusterItems.map((i) => i.embedding)
        );
        const similarity = cosineSimilarity(item.embedding, centroid);

        if (similarity > threshold && similarity > bestSimilarity) {
          bestSimilarity = similarity;
          bestCluster = clusterId;
        }
      }

      if (bestCluster) {
        clusters.get(bestCluster)?.push(item);
        assigned.add(item.id);
      } else if (clusters.size < maxClusters) {
        // Create new cluster
        const clusterId = `cluster-${clusters.size + 1}`;
        clusters.set(clusterId, [item]);
        assigned.add(item.id);
      }
    }

    // Filter clusters by minimum size
    const validClusters = new Map<string, PatternInput[]>();
    for (const [id, clusterItems] of clusters) {
      if (clusterItems.length >= minClusterSize) {
        validClusters.set(id, clusterItems);
      }
    }

    return validClusters;
  }

  /**
   * Analyze a cluster and generate pattern description.
   */
  async analyzePattern(
    clusterId: string,
    items: PatternInput[]
  ): Promise<DetectedPattern> {
    const model = this.config.provider
      ? getModel(this.config.provider, this.config.model)
      : getDefaultModel();

    const trace = observability.trace({
      name: "knowledge:analyze-pattern",
      metadata: { clusterId, itemCount: items.length },
    });

    try {
      // Build context from cluster items
      const examples = items.slice(0, 5).map((item) => ({
        subject: item.metadata.threadSubject,
        content: item.content.slice(0, 300),
        date: item.metadata.date.toISOString().split("T")[0],
      }));

      const prompt = `Analyze these related email excerpts and identify the common pattern:

${examples
  .map(
    (e, i) => `[${i + 1}] ${e.date} - ${e.subject}
${e.content}...`
  )
  .join("\n\n")}

Identify:
1. The pattern name (short, descriptive)
2. What makes these emails similar
3. How frequently this pattern occurs
4. Who is typically involved

Respond with JSON:
{
  "name": "Pattern name",
  "description": "What this pattern represents",
  "frequency": 0.0-1.0 (how common this pattern is),
  "participants": ["typical participants"],
  "confidence": 0.0-1.0
}`;

      const { text } = await generateText({
        model,
        messages: [{ role: "user", content: prompt }],
        // Reasoning models don't support temperature
        ...(isReasoningModel(this.getModelName())
          ? {}
          : { temperature: this.config.temperature ?? 0.4 }),
        maxOutputTokens: 512,
      });

      const parsed = PatternResponseSchema.parse(JSON.parse(text));

      // Collect all participants
      const allParticipants = new Set<string>();
      for (const item of items) {
        for (const p of item.metadata.participants) {
          allParticipants.add(p);
        }
      }

      const pattern: DetectedPattern = {
        id: clusterId,
        name: parsed.name,
        description: parsed.description,
        frequency: items.length,
        examples: items.slice(0, 5).map((item) => ({
          id: item.id,
          content: item.content.slice(0, 200),
          date: item.metadata.date,
        })),
        participants: [...allParticipants].slice(0, 10),
        timeSpan: {
          first: items[0]?.metadata.date ?? new Date(),
          last: items[items.length - 1]?.metadata.date ?? new Date(),
        },
        confidence: parsed.confidence,
      };

      trace.generation({
        name: "analyze-pattern",
        input: { clusterId, itemCount: items.length },
        output: pattern,
      });

      return pattern;
    } catch (error) {
      trace.generation({
        name: "analyze-pattern-error",
        input: { clusterId, itemCount: items.length },
        output: error instanceof Error ? error.message : "Unknown error",
        level: "ERROR",
      });

      // Return basic pattern on error
      return {
        id: clusterId,
        name: "Unnamed Pattern",
        description: "A recurring pattern in email communications",
        frequency: items.length,
        examples: items.slice(0, 3).map((item) => ({
          id: item.id,
          content: item.content.slice(0, 200),
          date: item.metadata.date,
        })),
        participants: [],
        timeSpan: {
          first: items[0]?.metadata.date ?? new Date(),
          last: items[items.length - 1]?.metadata.date ?? new Date(),
        },
        confidence: 0.5,
      };
    }
  }

  // ===========================================================================
  // CROSS-THREAD CONNECTIONS
  // ===========================================================================

  /**
   * Find connections between threads based on embeddings.
   */
  findCrossThreadConnections(
    threads: Array<{
      id: string;
      subject: string;
      embedding: number[];
      participants: string[];
    }>,
    options: { threshold?: number; maxConnections?: number } = {}
  ): CrossThreadConnection[] {
    const { threshold = 0.7, maxConnections = 50 } = options;
    const connections: CrossThreadConnection[] = [];

    // Compare all pairs
    for (let i = 0; i < threads.length; i++) {
      for (let j = i + 1; j < threads.length; j++) {
        const thread1 = threads[i];
        const thread2 = threads[j];

        if (!(thread1 && thread2)) continue;

        const similarity = cosineSimilarity(
          thread1.embedding,
          thread2.embedding
        );

        if (similarity >= threshold) {
          // Determine connection type
          const sharedParticipants = thread1.participants.filter((p) =>
            thread2.participants.includes(p)
          );

          let connectionType: CrossThreadConnection["connectionType"] = "topic";
          if (sharedParticipants.length > 0) {
            connectionType = "participant";
          }

          connections.push({
            sourceThreadId: thread1.id,
            targetThreadId: thread2.id,
            similarity,
            connectionType,
            sharedElements: sharedParticipants,
          });
        }
      }
    }

    // Sort by similarity and limit
    return connections
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, maxConnections);
  }

  // ===========================================================================
  // TOPIC SUMMARIZATION
  // ===========================================================================

  /**
   * Generate a comprehensive summary for a topic.
   */
  async summarizeTopic(
    topic: string,
    evidence: Array<{
      id: string;
      content: string;
      threadId: string;
      threadSubject: string;
      date: Date;
      participants: string[];
    }>
  ): Promise<TopicSummary> {
    const model = this.config.provider
      ? getModel(this.config.provider, this.config.model)
      : getDefaultModel();

    const trace = observability.trace({
      name: "knowledge:summarize-topic",
      metadata: { topic, evidenceCount: evidence.length },
    });

    try {
      // Sort by date
      const sorted = [...evidence].sort(
        (a, b) => a.date.getTime() - b.date.getTime()
      );

      const evidenceText = sorted
        .slice(0, 15)
        .map(
          (e, i) =>
            `[${i + 1}] ${e.date.toISOString().split("T")[0]} - ${e.threadSubject}
${e.content.slice(0, 400)}...`
        )
        .join("\n\n");

      const prompt = `Summarize everything about this topic based on email evidence:

Topic: "${topic}"

Evidence:
${evidenceText}

Provide:
1. A comprehensive summary (2-3 paragraphs)
2. Key points (bullet list)
3. Timeline of important events
4. Current status (active, resolved, or stale)
5. Related topics that might be of interest

Respond with JSON:
{
  "summary": "Comprehensive summary",
  "keyPoints": ["key point 1", "key point 2", ...],
  "timeline": [
    {"date": "YYYY-MM-DD", "event": "what happened", "threadId": "id"}
  ],
  "participants": ["person 1", "person 2"],
  "status": "active" | "resolved" | "stale",
  "relatedTopics": ["related topic 1", "..."]
}`;

      const { text } = await generateText({
        model,
        messages: [{ role: "user", content: prompt }],
        // Reasoning models don't support temperature
        ...(isReasoningModel(this.getModelName())
          ? {}
          : { temperature: this.config.temperature ?? 0.4 }),
        maxOutputTokens: this.config.maxTokens ?? 2048,
      });

      const parsed = TopicSummaryResponseSchema.parse(JSON.parse(text));

      const summary: TopicSummary = {
        topic,
        summary: parsed.summary,
        keyPoints: parsed.keyPoints,
        timeline: parsed.timeline.map((t) => ({
          date: new Date(t.date),
          event: t.event,
          threadId: t.threadId,
        })),
        participants: parsed.participants,
        status: parsed.status,
        relatedTopics: parsed.relatedTopics,
      };

      trace.generation({
        name: "summarize-topic",
        input: { topic, evidenceCount: evidence.length },
        output: {
          status: summary.status,
          keyPointCount: summary.keyPoints.length,
        },
      });

      return summary;
    } catch (error) {
      trace.generation({
        name: "summarize-topic-error",
        input: { topic, evidenceCount: evidence.length },
        output: error instanceof Error ? error.message : "Unknown error",
        level: "ERROR",
      });

      throw error;
    }
  }

  // ===========================================================================
  // INSIGHT GENERATION
  // ===========================================================================

  /**
   * Generate insights from patterns and data.
   */
  async generateInsights(
    patterns: DetectedPattern[],
    recentActivity: Array<{
      type: string;
      content: string;
      date: Date;
    }>
  ): Promise<Insight[]> {
    const model = this.config.provider
      ? getModel(this.config.provider, this.config.model)
      : getDefaultModel();

    const trace = observability.trace({
      name: "knowledge:generate-insights",
      metadata: {
        patternCount: patterns.length,
        activityCount: recentActivity.length,
      },
    });

    try {
      const patternSummary = patterns
        .slice(0, 10)
        .map(
          (p) =>
            `- ${p.name}: ${p.description} (${p.frequency} occurrences, ${(p.confidence * 100).toFixed(0)}% confidence)`
        )
        .join("\n");

      const recentSummary = recentActivity
        .slice(0, 10)
        .map(
          (a) =>
            `- ${a.date.toISOString().split("T")[0]}: [${a.type}] ${a.content.slice(0, 100)}`
        )
        .join("\n");

      const prompt = `Based on detected patterns and recent activity, generate actionable insights:

## Detected Patterns
${patternSummary}

## Recent Activity
${recentSummary}

Generate 3-5 insights that would be valuable. Consider:
- Trends (things changing over time)
- Anomalies (unusual patterns)
- Recommendations (actions to take)
- Pattern observations

For each insight, respond with JSON array:
[
  {
    "type": "pattern" | "trend" | "anomaly" | "recommendation",
    "title": "Brief title",
    "description": "What this insight means",
    "confidence": 0.0-1.0,
    "actionable": true/false,
    "suggestedAction": "What to do about it (optional)"
  }
]`;

      const { text } = await generateText({
        model,
        messages: [{ role: "user", content: prompt }],
        // Reasoning models don't support temperature
        ...(isReasoningModel(this.getModelName()) ? {} : { temperature: 0.5 }),
        maxOutputTokens: 1024,
      });

      const parsed = z.array(InsightResponseSchema).parse(JSON.parse(text));

      const insights: Insight[] = parsed.map((p, i) => ({
        id: `insight-${Date.now()}-${i}`,
        type: p.type,
        title: p.title,
        description: p.description,
        evidence: [],
        confidence: p.confidence,
        actionable: p.actionable,
        suggestedAction: p.suggestedAction,
      }));

      trace.generation({
        name: "generate-insights",
        input: {
          patternCount: patterns.length,
          activityCount: recentActivity.length,
        },
        output: { insightCount: insights.length },
      });

      return insights;
    } catch (error) {
      trace.generation({
        name: "generate-insights-error",
        input: {
          patternCount: patterns.length,
          activityCount: recentActivity.length,
        },
        output: error instanceof Error ? error.message : "Unknown error",
        level: "ERROR",
      });

      return [];
    }
  }

  // ===========================================================================
  // HELPERS
  // ===========================================================================

  /**
   * Calculate centroid of embedding vectors.
   */
  private calculateCentroid(embeddings: number[][]): number[] {
    return aggregateEmbeddings(embeddings, "mean");
  }
}

// =============================================================================
// FACTORY FUNCTIONS
// =============================================================================

/**
 * Create a new KnowledgeAgent instance.
 */
export function createKnowledgeAgent(
  config?: KnowledgeAgentConfig
): KnowledgeAgent {
  return new KnowledgeAgent(config);
}
