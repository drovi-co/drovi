export interface SyncStatus {
  connection_id: string;
  status: "idle" | "syncing" | "completed" | "failed";
  progress: number;
  records_synced: number;
  total_records: number | null;
  error: string | null;
  started_at: string | null;
  completed_at: string | null;
}

export interface OAuthInitResponse {
  auth_url: string;
  state: string;
}

export interface EmailAuthResponse {
  user: {
    id: string;
    email: string;
    name?: string | null;
    role?: string | null;
    created_at?: string | null;
  };
  session_token: string;
  organization?: {
    id: string;
    name: string;
    status?: string;
    region?: string | null;
    created_at?: string | null;
  } | null;
  organizations?: Array<{
    id: string;
    name: string;
    status?: string;
    region?: string | null;
    created_at?: string | null;
  }> | null;
}
