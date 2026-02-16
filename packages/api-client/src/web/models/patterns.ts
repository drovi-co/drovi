export interface PatternCandidate {
  id: string;
  organization_id: string;
  candidate_type: string;
  member_count: number;
  member_ids: string[];
  sample_titles: string[];
  top_terms: string[];
  confidence_boost: number;
  updated_at: string;
}
