import { z } from "zod";
import {
  ConfidenceSchema,
  EvidenceRefSchema,
  SourceTypeSchema,
  UIOStatusSchema,
  UIOTypeSchema,
} from "./common";

// Base UIO schema
export const UIOBaseSchema = z.object({
  id: z.string(),
  organization_id: z.string(),
  type: UIOTypeSchema,
  status: UIOStatusSchema,
  title: z.string(),
  description: z.string().optional(),
  confidence: z.number().min(0).max(1),
  reasoning: z.string().optional(),
  owner_id: z.string().optional(),
  stakeholder_ids: z.array(z.string()).optional(),
  valid_from: z.string().optional(),
  valid_to: z.string().optional(),
  created_at: z.string(),
  updated_at: z.string().optional(),
});

// Commitment specific fields
export const CommitmentSchema = UIOBaseSchema.extend({
  type: z.literal("commitment"),
  direction: z.enum(["owed_by_me", "owed_to_me"]).optional(),
  due_date: z.string().optional(),
  debtor_id: z.string().optional(),
  creditor_id: z.string().optional(),
  is_overdue: z.boolean().optional(),
});

// Decision specific fields
export const DecisionSchema = UIOBaseSchema.extend({
  type: z.literal("decision"),
  decision_maker_id: z.string().optional(),
  decided_at: z.string().optional(),
  alternatives: z.array(z.string()).optional(),
  supersedes_id: z.string().optional(),
});

// Task specific fields
export const TaskSchema = UIOBaseSchema.extend({
  type: z.literal("task"),
  assignee_id: z.string().optional(),
  priority: z.enum(["urgent", "high", "medium", "low"]).optional(),
  due_date: z.string().optional(),
});

// Risk specific fields
export const RiskSchema = UIOBaseSchema.extend({
  type: z.literal("risk"),
  severity: z.enum(["critical", "high", "medium", "low"]).optional(),
  suggested_action: z.string().optional(),
  mitigation_status: z.enum(["open", "mitigating", "mitigated", "accepted"]).optional(),
});

// UIO with full details
export const UIODetailSchema = UIOBaseSchema.extend({
  evidence: z.array(EvidenceRefSchema).optional(),
  related_uios: z.array(z.string()).optional(),
  supersedes_id: z.string().optional(),
  superseded_by_id: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

// UIO list response
export const UIOListResponseSchema = z.object({
  items: z.array(UIOBaseSchema),
  total: z.number(),
  limit: z.number(),
  offset: z.number(),
});

// UIO status change request
export const StatusChangeRequestSchema = z.object({
  status: UIOStatusSchema,
  user_id: z.string().optional(),
});

// UIO correction request
export const CorrectionRequestSchema = z.object({
  field: z.string(),
  value: z.unknown(),
  reason: z.string().optional(),
});

// Trust indicator response
export const TrustIndicatorSchema = z.object({
  uio_id: z.string(),
  trust_score: z.number().min(0).max(1),
  reasoning: z.array(z.string()),
  evidence: z.array(EvidenceRefSchema).optional(),
  is_contradicted: z.boolean(),
  belief_state: z.string().optional(),
  truth_state: z.string().optional(),
});

export const TrustScoresResponseSchema = z.object({
  indicators: z.array(TrustIndicatorSchema),
});

export type UIOBase = z.infer<typeof UIOBaseSchema>;
export type Commitment = z.infer<typeof CommitmentSchema>;
export type Decision = z.infer<typeof DecisionSchema>;
export type Task = z.infer<typeof TaskSchema>;
export type Risk = z.infer<typeof RiskSchema>;
export type UIODetail = z.infer<typeof UIODetailSchema>;
export type UIOListResponse = z.infer<typeof UIOListResponseSchema>;
export type TrustIndicator = z.infer<typeof TrustIndicatorSchema>;
