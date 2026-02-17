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

export interface OnboardingChecklist {
  security_review_complete: boolean;
  data_custody_mapped: boolean;
  pilot_mandate_set: boolean;
  go_live_ready: boolean;
}

export interface OnboardingRunbookItem {
  organization_id: string;
  organization_name: string;
  checklist: OnboardingChecklist;
  owner_email: string | null;
  target_go_live_at: string | null;
  notes: string | null;
  updated_by: string | null;
  updated_at: string | null;
  open_ticket_count: number;
}

export interface OnboardingRunbookListResponse {
  runbooks: OnboardingRunbookItem[];
}

export interface OnboardingRunbookUpdateRequest {
  security_review_complete?: boolean;
  data_custody_mapped?: boolean;
  pilot_mandate_set?: boolean;
  go_live_ready?: boolean;
  owner_email?: string | null;
  target_go_live_at?: string | null;
  notes?: string | null;
}

export interface OnboardingAutomationItem {
  key: "weekly_operations_brief" | "monthly_integrity_report" | string;
  label: string;
  job_type: string;
  enabled: boolean;
  cron: string;
  pilot_only: boolean;
  cadence: "weekly" | "monthly" | string;
  last_job_id: string | null;
  last_status: string | null;
  last_run_at: string | null;
}

export interface OnboardingAutomationListResponse {
  automations: OnboardingAutomationItem[];
}

export interface TriggerOnboardingAutomationResponse {
  key: string;
  job_id: string;
  status: string;
  job_type: string;
  queued_at: string;
}
