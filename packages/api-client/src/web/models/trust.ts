export interface TrustIndicator {
  uio_id: string;
  trust_score: number;
  confidence: number;
  belief_state: string | null;
  truth_state: string | null;
  last_update_reason: string | null;
  last_updated_at: string | null;
  evidence_count: number;
  evidence: Array<Record<string, unknown>>;
  confidence_reasoning: string[];
}

export interface ContinuityFactor {
  id: string;
  label: string;
  weight: number;
  value: number;
  contribution: number;
  details: Record<string, unknown>;
}

export interface ContinuityScore {
  organization_id: string;
  as_of: string;
  lookback_days: number;
  score: number;
  score_normalized: number;
  factors: ContinuityFactor[];
  metrics: Record<string, number>;
}

export interface RecordCertificate {
  certificate_id: string;
  organization_id: string;
  uio_id: string;
  issued_at: string;
  payload_hash: string;
  signature: string;
  signature_alg: string;
  signature_key_id: string | null;
  certificate: Record<string, unknown>;
  export_json: string;
}

export interface MonthlyIntegrityReport {
  report_id: string;
  organization_id: string;
  month: string;
  generated_at: string;
  payload_hash: string;
  signature: string;
  signature_alg: string;
  signature_key_id: string | null;
  report: Record<string, unknown>;
  export_json: string;
}

export interface EvidenceBundleExport {
  bundle_id: string;
  organization_id: string;
  generated_at: string;
  payload_hash: string;
  signature: string;
  signature_alg: string;
  signature_key_id: string | null;
  bundle: Record<string, unknown>;
  export_json: string;
}

export interface TrustRetentionProfile {
  organization_id: string;
  data_retention_days: number;
  evidence_retention_days: number;
  default_legal_hold: boolean;
  require_legal_hold_reason: boolean;
  updated_at: string | null;
  updated_by_user_id: string | null;
}
