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
