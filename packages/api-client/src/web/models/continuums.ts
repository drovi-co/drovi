export interface ContinuumSummary {
  id: string;
  name: string;
  description: string | null;
  status: string;
  currentVersion: number | null;
  activeVersion: number | null;
  createdAt: string | null;
  updatedAt: string | null;
  nextRunAt: string | null;
}

export interface ContinuumRun {
  id: string;
  status: string;
  version: number;
  startedAt: string | null;
  completedAt: string | null;
  errorMessage: string | null;
}

export interface ContinuumCreateResponse {
  id: string;
  version: number;
  status: string;
  next_run_at: string | null;
}

export interface ContinuumPreview {
  continuum_id: string;
  name: string;
  goal: string;
  schedule: Record<string, unknown>;
  expected_actions: string[];
  proof_requirements: Record<string, unknown>[];
  risk_snapshot: {
    open_commitments: number;
    overdue_commitments: number;
    at_risk_commitments: number;
    risk_score: number;
    risk_outlook: string;
  };
}

export interface ContinuumBundle {
  id: string;
  name: string;
  description: string | null;
  organizationId: string;
  visibility: string;
  governanceStatus: string;
  priceCents: number | null;
  currency: string | null;
  billingModel: string | null;
  version: string;
  manifest: Record<string, unknown>;
  signature: string;
}

export function transformContinuumSummary(
  raw: Record<string, unknown>
): ContinuumSummary {
  return {
    id: raw.id as string,
    name: raw.name as string,
    description: (raw.description as string | null) ?? null,
    status: raw.status as string,
    currentVersion: (raw.current_version as number | null) ?? null,
    activeVersion: (raw.active_version as number | null) ?? null,
    createdAt: (raw.created_at as string | null) ?? null,
    updatedAt: (raw.updated_at as string | null) ?? null,
    nextRunAt: (raw.next_run_at as string | null) ?? null,
  };
}

export function transformContinuumRun(
  raw: Record<string, unknown>
): ContinuumRun {
  return {
    id: raw.id as string,
    status: raw.status as string,
    version: (raw.version as number) ?? 0,
    startedAt: (raw.started_at as string | null) ?? null,
    completedAt: (raw.completed_at as string | null) ?? null,
    errorMessage: (raw.error_message as string | null) ?? null,
  };
}

export function transformBundle(raw: Record<string, unknown>): ContinuumBundle {
  return {
    id: raw.id as string,
    name: raw.name as string,
    description: (raw.description as string | null) ?? null,
    organizationId: raw.organization_id as string,
    visibility: raw.visibility as string,
    governanceStatus: raw.governance_status as string,
    priceCents: (raw.price_cents as number | null) ?? null,
    currency: (raw.currency as string | null) ?? null,
    billingModel: (raw.billing_model as string | null) ?? null,
    version: raw.version as string,
    manifest: (raw.manifest as Record<string, unknown>) ?? {},
    signature: raw.signature as string,
  };
}
