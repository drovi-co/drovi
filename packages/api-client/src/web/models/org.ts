export interface User {
  user_id: string;
  org_id: string;
  org_name: string;
  role: string;
  email: string;
  exp: string;
  locale?: string;
  user_locale?: string | null;
  org_default_locale?: string;
}

export interface OrgInfo {
  id: string;
  name: string;
  status: string;
  region: string | null;
  allowed_domains: string[];
  notification_emails: string[] | null;
  allowed_connectors: string[] | null;
  default_connection_visibility: "org_shared" | "private";
  default_locale?: string;
  expires_at: string | null;
  created_at: string | null;
  member_count: number;
  connection_count: number;
}

export interface OrgMember {
  id: string;
  role: string;
  name: string | null;
  email: string;
  created_at: string | null;
}

export interface OrgInvite {
  token: string;
  org_id: string;
  role: string;
  expires_at: string;
  used_at: string | null;
  created_at: string | null;
  email?: string | null;
}

export interface OrgExportResponse {
  export_job_id: string;
  status: "processing" | "completed" | "failed";
  progress: number;
  download_url: string | null;
  expires_at: string;
}

// Pilot-friendly connection model (org surfaces).
export interface OrgConnection {
  id: string;
  provider: string;
  email: string | null;
  workspace: string | null;
  status: string;
  visibility?: "org_shared" | "private";
  created_by_user_id?: string | null;
  created_by_email?: string | null;
  created_by_name?: string | null;
  live_status?: string | null;
  backfill_status?: string | null;
  last_error?: string | null;
  scopes: string[];
  last_sync: string | null;
  messages_synced: number;
  restricted_labels: string[];
  restricted_channels: string[];
  progress: number | null;
}

export interface ConnectResponse {
  auth_url: string;
  state: string;
  code_verifier: string;
}

export interface SyncTriggerResponse {
  connection_id: string;
  status: string;
  message: string;
}

export interface BackfillResponse {
  connection_id: string;
  backfill_jobs: string[];
  status: string;
}

export interface SyncEvent {
  event_type: "started" | "progress" | "completed" | "failed";
  connection_id: string;
  connector_type?: string;
  job_id?: string | null;
  records_synced?: number;
  total_records?: number;
  progress?: number | null;
  status?: string;
  error?: string;
  sync_params?: Record<string, unknown> | null;
  timestamp?: string;
}
