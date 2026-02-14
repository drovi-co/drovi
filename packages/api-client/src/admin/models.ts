export interface AdminMe {
  email: string;
  subject: string;
  scopes: string[];
  expires_at: string | null;
}

export interface AdminLoginResponse {
  admin: { email: string };
  session_token: string;
  expires_at: string;
}

export interface KPIBlock {
  key: string;
  label: string;
  value: number;
  unit?: string | null;
  delta_5m?: number | null;
}

export interface KPIsResponse {
  generated_at: string;
  blocks: KPIBlock[];
  breakdowns: Record<string, unknown>;
}

export interface GovernanceSignal {
  label: string;
  value: string;
  severity: string;
  metadata: Record<string, unknown>;
}

export interface GovernanceOverviewResponse {
  generated_at: string;
  blocks: KPIBlock[];
  approvals_by_status: Array<Record<string, unknown>>;
  recent_signals: GovernanceSignal[];
}
