export interface AskSource {
  name?: string | null;
  title?: string | null;
  source_type?: string | null;
  source_id?: string | null;
  source_timestamp?: string | null;
  quoted_text?: string | null;
  segment_hash?: string | null;
  conversation_id?: string | null;
  message_id?: string | null;
  url?: string | null;
  [key: string]: unknown;
}

export interface AskResponse {
  answer: string;
  intent: string;
  sources: AskSource[];
  cypher_query: string | null;
  results_count: number;
  duration_seconds: number;
  timestamp: string;
  session_id: string | null;
  context_used: boolean;
  closest_matches_used: boolean;
  user_context: Record<string, unknown> | null;
}
