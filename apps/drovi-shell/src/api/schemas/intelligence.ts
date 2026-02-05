import { z } from "zod";
import { EvidenceRefSchema, SourceTypeSchema } from "./common";

// Analyze request
export const AnalyzeRequestSchema = z.object({
  content: z.string(),
  source_type: SourceTypeSchema.optional(),
  organization_id: z.string(),
  conversation_id: z.string().optional(),
  message_ids: z.array(z.string()).optional(),
  user_email: z.string().email().optional(),
  user_name: z.string().optional(),
  extract_commitments: z.boolean().optional(),
  extract_decisions: z.boolean().optional(),
  analyze_risk: z.boolean().optional(),
  deduplicate: z.boolean().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

// Analyze response
export const AnalyzeResponseSchema = z.object({
  claims: z.array(z.object({
    id: z.string(),
    statement: z.string(),
    confidence: z.number(),
  })).optional(),
  commitments: z.array(z.object({
    id: z.string(),
    title: z.string(),
    description: z.string().optional(),
    direction: z.enum(["owed_by_me", "owed_to_me"]).optional(),
    due_date: z.string().optional(),
    confidence: z.number(),
  })).optional(),
  decisions: z.array(z.object({
    id: z.string(),
    statement: z.string(),
    confidence: z.number(),
  })).optional(),
  tasks: z.array(z.object({
    id: z.string(),
    title: z.string(),
    priority: z.enum(["urgent", "high", "medium", "low"]).optional(),
    confidence: z.number(),
  })).optional(),
  risks: z.array(z.object({
    id: z.string(),
    title: z.string(),
    severity: z.enum(["critical", "high", "medium", "low"]).optional(),
    confidence: z.number(),
  })).optional(),
  confidence: z.number(),
  needs_review: z.boolean().optional(),
});

// Ask request
export const AskRequestSchema = z.object({
  query: z.string(),
  organization_id: z.string(),
  session_id: z.string().optional(),
  mode: z.enum(["truth", "reasoning", "truth+reasoning"]).optional(),
  include_citations: z.boolean().optional(),
  max_sources: z.number().optional(),
});

// Ask response (non-streaming)
export const AskResponseSchema = z.object({
  truth: z.object({
    results: z.array(z.object({
      id: z.string(),
      type: z.string(),
      title: z.string(),
      confidence: z.number(),
      evidence_id: z.string().optional(),
    })),
    citations: z.array(z.object({
      id: z.string(),
      source: z.string(),
      snippet: z.string(),
    })).optional(),
  }).optional(),
  reasoning: z.string().optional(),
  session_id: z.string().optional(),
});

// Brief response
export const BriefResponseSchema = z.object({
  summary: z.object({
    total_commitments: z.number(),
    total_decisions: z.number(),
    total_risks: z.number(),
    overdue_count: z.number().optional(),
  }),
  attention_items: z.array(z.object({
    type: z.enum([
      "overdue_commitment",
      "upcoming_commitment",
      "contradiction",
      "high_risk",
      "pending_decision",
    ]),
    id: z.string(),
    title: z.string(),
    confidence: z.number().optional(),
    owner: z.string().optional(),
    counterparty: z.string().optional(),
    severity: z.string().optional(),
    evidence_ids: z.array(z.string()).optional(),
    days_overdue: z.number().optional(),
    days_until_due: z.number().optional(),
  })),
  period: z.enum(["today", "last_7_days"]),
  generated_at: z.string(),
});

// Search request
export const SearchRequestSchema = z.object({
  query: z.string(),
  organization_id: z.string(),
  types: z.array(z.string()).optional(),
  source_types: z.array(SourceTypeSchema).optional(),
  time_range: z.object({
    from: z.string().optional(),
    to: z.string().optional(),
  }).optional(),
  include_graph_context: z.boolean().optional(),
  limit: z.number().min(1).max(100).optional(),
});

// Search response
export const SearchResponseSchema = z.object({
  results: z.array(z.object({
    id: z.string(),
    type: z.string(),
    title: z.string(),
    properties: z.record(z.string(), z.unknown()).optional(),
    score: z.number(),
    scores: z.object({
      vector: z.number().optional(),
      fulltext: z.number().optional(),
      contains: z.number().optional(),
    }).optional(),
    match_source: z.enum(["vector", "fulltext", "contains"]).optional(),
    connections: z.array(z.object({
      id: z.string(),
      type: z.string(),
      relationship: z.string(),
    })).optional(),
  })),
  total: z.number(),
  latency_ms: z.number().optional(),
});

// Contradiction response
export const ContradictionSchema = z.object({
  id: z.string(),
  uio_id: z.string(),
  contradicting_uio_id: z.string(),
  type: z.enum(["direct", "temporal", "conditional"]),
  severity: z.enum(["low", "medium", "high", "critical"]),
  evidence: z.record(z.string(), z.unknown()).optional(),
});

export const ContradictionsResponseSchema = z.object({
  contradictions: z.array(ContradictionSchema),
});

export type AnalyzeRequest = z.infer<typeof AnalyzeRequestSchema>;
export type AnalyzeResponse = z.infer<typeof AnalyzeResponseSchema>;
export type AskRequest = z.infer<typeof AskRequestSchema>;
export type AskResponse = z.infer<typeof AskResponseSchema>;
export type BriefResponse = z.infer<typeof BriefResponseSchema>;
export type SearchRequest = z.infer<typeof SearchRequestSchema>;
export type SearchResponse = z.infer<typeof SearchResponseSchema>;
export type Contradiction = z.infer<typeof ContradictionSchema>;
