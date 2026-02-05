import { z } from "zod";

// Continuum status
export const ContinuumStatusSchema = z.enum([
  "DRAFT",
  "ACTIVE",
  "PAUSED",
  "FAILED",
  "COMPLETED",
]);

// Schedule type
export const ScheduleTypeSchema = z.enum(["interval", "cron", "on_demand"]);

// Escalation policy
export const EscalationPolicySchema = z.object({
  on_failure: z.boolean().optional(),
  max_retries: z.number().optional(),
  notify_on_failure: z.boolean().optional(),
  notify_on_escalation: z.boolean().optional(),
  require_manual_override: z.boolean().optional(),
  channels: z.array(z.string()).optional(),
});

// Continuum schema
export const ContinuumSchema = z.object({
  id: z.string(),
  organization_id: z.string(),
  name: z.string(),
  description: z.string().optional(),
  status: ContinuumStatusSchema,
  current_version: z.number(),
  active_version: z.number().optional(),
  schedule_type: ScheduleTypeSchema.optional(),
  schedule_interval_minutes: z.number().optional(),
  schedule_cron: z.string().optional(),
  escalation_policy: EscalationPolicySchema.optional(),
  last_run_at: z.string().optional(),
  next_run_at: z.string().optional(),
  created_at: z.string(),
  updated_at: z.string().optional(),
  created_by: z.string().optional(),
});

// Continuum list response
export const ContinuumListResponseSchema = z.object({
  continuums: z.array(ContinuumSchema),
});

// Continuum run schema
export const ContinuumRunSchema = z.object({
  id: z.string(),
  continuum_id: z.string(),
  version: z.number(),
  organization_id: z.string(),
  status: z.enum(["PENDING", "RUNNING", "SUCCESS", "FAILURE"]),
  input_payload: z.record(z.string(), z.unknown()).optional(),
  output_payload: z.record(z.string(), z.unknown()).optional(),
  error_message: z.string().optional(),
  started_at: z.string().optional(),
  completed_at: z.string().optional(),
});

// Run history response
export const RunHistoryResponseSchema = z.object({
  runs: z.array(ContinuumRunSchema),
});

// Alert schema
export const ContinuumAlertSchema = z.object({
  id: z.string(),
  continuum_id: z.string(),
  organization_id: z.string(),
  alert_type: z.enum(["FAILURE", "ESCALATION", "TIMEOUT"]),
  severity: z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]),
  message: z.string(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  status: z.enum(["OPEN", "ACKNOWLEDGED", "RESOLVED"]),
  created_at: z.string(),
  resolved_at: z.string().optional(),
  resolved_by: z.string().optional(),
});

// Preview request
export const ContinuumPreviewRequestSchema = z.object({
  horizon_days: z.number().min(1).max(365),
});

// Risk snapshot for preview
export const RiskSnapshotSchema = z.object({
  open_commitments: z.number(),
  overdue_commitments: z.number(),
  at_risk_commitments: z.number(),
  risk_score: z.number(),
  risk_outlook: z.enum(["low", "medium", "high"]),
});

// Preview response
export const ContinuumPreviewResponseSchema = z.object({
  risk_snapshots: z.array(RiskSnapshotSchema),
  sensitivity_analysis: z.record(z.string(), z.unknown()).optional(),
  recommendations: z.array(z.string()).optional(),
  override_points: z.array(z.object({
    day: z.number(),
    description: z.string(),
  })).optional(),
});

// Run request
export const ContinuumRunRequestSchema = z.object({
  organization_id: z.string(),
  triggered_by: z.string().optional(),
  as_of_date: z.string().optional(),
});

// Rollback request
export const ContinuumRollbackRequestSchema = z.object({
  target_version: z.number(),
});

export type ContinuumStatus = z.infer<typeof ContinuumStatusSchema>;
export type ScheduleType = z.infer<typeof ScheduleTypeSchema>;
export type EscalationPolicy = z.infer<typeof EscalationPolicySchema>;
export type Continuum = z.infer<typeof ContinuumSchema>;
export type ContinuumListResponse = z.infer<typeof ContinuumListResponseSchema>;
export type ContinuumRun = z.infer<typeof ContinuumRunSchema>;
export type ContinuumAlert = z.infer<typeof ContinuumAlertSchema>;
export type ContinuumPreviewRequest = z.infer<typeof ContinuumPreviewRequestSchema>;
export type ContinuumPreviewResponse = z.infer<typeof ContinuumPreviewResponseSchema>;
