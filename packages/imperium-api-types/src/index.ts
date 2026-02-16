/**
 * Imperium API type stubs.
 * Replace with generated types from openapi/imperium-openapi.json.
 */

export type HealthStatus = "ok";

export interface ApiHealthResponse {
  status: HealthStatus;
  service: string;
}

export interface ApiMetaResponse {
  name: "imperium-api";
  version: string;
  environment: string;
  data_mode: string;
  providers: ProviderConfigView[];
}

export interface ProviderConfigView {
  domain: string;
  primary: string;
  fallbacks: string[];
  configured: boolean;
  required_credentials: string[];
}

export interface ApiProvidersResponse {
  mode: string;
  providers: ProviderConfigView[];
}

export interface ProviderHealthView {
  domain: string;
  provider: string;
  healthy: boolean;
  details: string;
}

export interface ApiProvidersHealthResponse {
  mode: string;
  checked_at: string;
  checks: ProviderHealthView[];
}

export interface DeadLetterEventView {
  event_id: string;
  worker_role: string;
  subject: string;
  payload: string;
  error_message: string;
  retry_count: number;
  status: "pending" | "replayed" | string;
  first_failed_at: string;
  last_failed_at: string;
  replayed_at: string | null;
  replayed_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface ApiDeadLetterResponse {
  events: DeadLetterEventView[];
}

export interface ReplayDeadLetterResponse {
  replayed: boolean;
  event_id: string;
  subject: string;
  status: string;
  retry_count: number;
}

export interface AuditEventView {
  event_id: string;
  stream_key: string;
  actor_user_id: string | null;
  action: string;
  target: string;
  metadata: string;
  payload_hash: string;
  created_at: string;
}

export interface ApiAuditEventsResponse {
  events: AuditEventView[];
}
