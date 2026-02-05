import { z } from "zod";

// Actuation tier (controls approval requirements)
export const ActuationTierSchema = z.enum(["tier_0", "tier_1", "tier_2", "tier_3"]);

// Actuation status
export const ActuationStatusSchema = z.enum([
  "draft",
  "pending_approval",
  "approved",
  "executing",
  "completed",
  "failed",
  "rolled_back",
  "cancelled",
]);

// Action type
export const ActionTypeSchema = z.enum([
  "send_email",
  "send_slack",
  "create_task",
  "update_crm",
  "send_reminder",
  "calendar_invite",
  "webhook",
]);

// Actuation schema
export const ActuationSchema = z.object({
  id: z.string(),
  organization_id: z.string(),
  action_type: ActionTypeSchema,
  tier: ActuationTierSchema,
  status: ActuationStatusSchema,
  title: z.string(),
  description: z.string().optional(),
  payload: z.record(z.string(), z.unknown()),
  preview: z.object({
    summary: z.string(),
    details: z.string().optional(),
    recipients: z.array(z.string()).optional(),
    attachments: z.array(z.string()).optional(),
  }).optional(),
  requires_approval: z.boolean(),
  approved_by: z.string().optional(),
  approved_at: z.string().optional(),
  executed_at: z.string().optional(),
  completed_at: z.string().optional(),
  error_message: z.string().optional(),
  rollback_available: z.boolean().optional(),
  created_at: z.string(),
  created_by: z.string().optional(),
  uio_id: z.string().optional(),
  evidence_ids: z.array(z.string()).optional(),
});

// Actuation list response
export const ActuationListResponseSchema = z.object({
  actuations: z.array(ActuationSchema),
  total: z.number(),
});

// Create actuation request
export const CreateActuationRequestSchema = z.object({
  organization_id: z.string(),
  action_type: ActionTypeSchema,
  title: z.string(),
  payload: z.record(z.string(), z.unknown()),
  uio_id: z.string().optional(),
  execute_immediately: z.boolean().optional(),
});

// Approve actuation request
export const ApproveActuationRequestSchema = z.object({
  notes: z.string().optional(),
});

// Execute actuation request
export const ExecuteActuationRequestSchema = z.object({
  dry_run: z.boolean().optional(),
});

// Rollback actuation request
export const RollbackActuationRequestSchema = z.object({
  reason: z.string().optional(),
});

export type ActuationTier = z.infer<typeof ActuationTierSchema>;
export type ActuationStatus = z.infer<typeof ActuationStatusSchema>;
export type ActionType = z.infer<typeof ActionTypeSchema>;
export type Actuation = z.infer<typeof ActuationSchema>;
export type ActuationListResponse = z.infer<typeof ActuationListResponseSchema>;
export type CreateActuationRequest = z.infer<typeof CreateActuationRequestSchema>;
