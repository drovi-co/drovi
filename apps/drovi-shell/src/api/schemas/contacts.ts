import { z } from "zod";

// Contact summary (list view)
export const ContactSummarySchema = z.object({
  id: z.string(),
  organization_id: z.string(),
  primary_email: z.string().email(),
  display_name: z.string(),
  first_name: z.string().optional(),
  last_name: z.string().optional(),
  company: z.string().optional(),
  title: z.string().optional(),
  avatar_url: z.string().url().optional(),
  health_score: z.number().min(0).max(1).optional(),
  importance_score: z.number().min(0).max(1).optional(),
  engagement_score: z.number().min(0).max(1).optional(),
  sentiment_score: z.number().min(-1).max(1).optional(),
  is_vip: z.boolean(),
  is_at_risk: z.boolean(),
  is_internal: z.boolean().optional(),
  lifecycle_stage: z.string().optional(),
  total_threads: z.number().optional(),
  total_messages: z.number().optional(),
  last_interaction_at: z.string().optional(),
});

// Contact detail (full view)
export const ContactDetailSchema = ContactSummarySchema.extend({
  emails: z.array(z.string().email()).optional(),
  phone: z.string().optional(),
  linkedin_url: z.string().url().optional(),
  role_type: z.string().optional(),
  interaction_history: z.array(z.object({
    date: z.string(),
    type: z.string(),
    summary: z.string().optional(),
  })).optional(),
  relationship_strength: z.number().min(0).max(1).optional(),
  risk_indicators: z.array(z.string()).optional(),
  created_at: z.string(),
  updated_at: z.string().optional(),
});

// Contact list response
export const ContactListResponseSchema = z.object({
  contacts: z.array(ContactSummarySchema),
  total: z.number(),
  limit: z.number(),
  offset: z.number(),
});

// VIP status update request
export const VIPStatusRequestSchema = z.object({
  is_vip: z.boolean(),
  reason: z.string().optional(),
});

// Risk assessment request
export const RiskAssessmentRequestSchema = z.object({
  reassess: z.boolean().optional(),
});

// Risk assessment response
export const RiskAssessmentResponseSchema = z.object({
  is_at_risk: z.boolean(),
  risk_score: z.number().min(0).max(1),
  risk_factors: z.array(z.string()),
  recommended_actions: z.array(z.string()).optional(),
});

export type ContactSummary = z.infer<typeof ContactSummarySchema>;
export type ContactDetail = z.infer<typeof ContactDetailSchema>;
export type ContactListResponse = z.infer<typeof ContactListResponseSchema>;
export type VIPStatusRequest = z.infer<typeof VIPStatusRequestSchema>;
export type RiskAssessmentResponse = z.infer<typeof RiskAssessmentResponseSchema>;
