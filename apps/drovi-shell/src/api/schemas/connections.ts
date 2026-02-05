import { z } from "zod";

// Connection provider types
export const ConnectorTypeSchema = z.enum([
  "gmail",
  "outlook",
  "slack",
  "notion",
  "google_calendar",
  "google_docs",
  "hubspot",
  "whatsapp",
  "teams",
]);

// Connection status
export const ConnectionStatusSchema = z.enum([
  "pending",
  "active",
  "error",
  "disconnected",
  "syncing",
]);

// Connection schema
export const ConnectionSchema = z.object({
  id: z.string(),
  organization_id: z.string(),
  connector_type: ConnectorTypeSchema,
  name: z.string(),
  status: ConnectionStatusSchema,
  config: z.record(z.string(), z.unknown()).optional(),
  last_sync_at: z.string().optional(),
  token_expires_at: z.string().optional(),
  enabled_streams: z.array(z.string()).optional(),
  created_at: z.string(),
  updated_at: z.string().optional(),
});

// Connection list response
export const ConnectionListResponseSchema = z.object({
  connections: z.array(ConnectionSchema),
});

// OAuth initiate request
export const OAuthInitiateRequestSchema = z.object({
  provider: ConnectorTypeSchema,
  redirect_uri: z.string().url().optional(),
  scopes: z.array(z.string()).optional(),
});

// OAuth initiate response
export const OAuthInitiateResponseSchema = z.object({
  auth_url: z.string().url(),
  state: z.string(),
  code_verifier: z.string().optional(),
});

// Sync job schema
export const SyncJobSchema = z.object({
  id: z.string(),
  connection_id: z.string(),
  status: z.enum(["pending", "running", "completed", "failed"]),
  records_processed: z.number().optional(),
  error_message: z.string().optional(),
  started_at: z.string().optional(),
  completed_at: z.string().optional(),
});

// Sync status response
export const SyncStatusResponseSchema = z.object({
  job: SyncJobSchema.optional(),
  last_sync_at: z.string().optional(),
  next_sync_at: z.string().optional(),
  is_syncing: z.boolean(),
});

// Create connection request
export const CreateConnectionRequestSchema = z.object({
  connector_type: ConnectorTypeSchema,
  name: z.string(),
  organization_id: z.string(),
  config: z.record(z.string(), z.unknown()).optional(),
});

export type ConnectorType = z.infer<typeof ConnectorTypeSchema>;
export type ConnectionStatus = z.infer<typeof ConnectionStatusSchema>;
export type Connection = z.infer<typeof ConnectionSchema>;
export type ConnectionListResponse = z.infer<typeof ConnectionListResponseSchema>;
export type OAuthInitiateRequest = z.infer<typeof OAuthInitiateRequestSchema>;
export type OAuthInitiateResponse = z.infer<typeof OAuthInitiateResponseSchema>;
export type SyncJob = z.infer<typeof SyncJobSchema>;
export type SyncStatusResponse = z.infer<typeof SyncStatusResponseSchema>;
