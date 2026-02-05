import { z } from "zod";

// Common pagination schema
export const PaginationSchema = z.object({
  limit: z.number(),
  offset: z.number(),
  total: z.number(),
});

// Common response wrapper
export const ApiResponseSchema = <T extends z.ZodTypeAny>(dataSchema: T) =>
  z.object({
    data: dataSchema,
    meta: z
      .object({
        request_id: z.string().optional(),
        latency_ms: z.number().optional(),
      })
      .optional(),
  });

// Error response
export const ApiErrorSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.record(z.string(), z.unknown()).optional(),
  }),
});

// Common timestamp fields
export const TimestampSchema = z.object({
  created_at: z.string(),
  updated_at: z.string().optional(),
});

// Confidence indicator
export const ConfidenceSchema = z.object({
  score: z.number().min(0).max(1),
  reasoning: z.string().optional(),
});

// Evidence reference
export const EvidenceRefSchema = z.object({
  id: z.string(),
  source_type: z.enum([
    "email",
    "slack",
    "notion",
    "google_docs",
    "whatsapp",
    "calendar",
    "meeting",
    "call",
    "recording",
    "transcript",
    "api",
    "manual",
  ]),
  snippet: z.string().optional(),
});

// Source types
export const SourceTypeSchema = z.enum([
  "email",
  "slack",
  "notion",
  "google_docs",
  "whatsapp",
  "calendar",
  "meeting",
  "call",
  "recording",
  "transcript",
  "api",
  "manual",
]);

// UIO types
export const UIOTypeSchema = z.enum([
  "commitment",
  "decision",
  "task",
  "risk",
  "claim",
  "contact",
]);

// UIO status
export const UIOStatusSchema = z.enum([
  "draft",
  "active",
  "in_progress",
  "completed",
  "cancelled",
  "archived",
]);

export type Pagination = z.infer<typeof PaginationSchema>;
export type ApiError = z.infer<typeof ApiErrorSchema>;
export type Confidence = z.infer<typeof ConfidenceSchema>;
export type EvidenceRef = z.infer<typeof EvidenceRefSchema>;
export type SourceType = z.infer<typeof SourceTypeSchema>;
export type UIOType = z.infer<typeof UIOTypeSchema>;
export type UIOStatus = z.infer<typeof UIOStatusSchema>;
