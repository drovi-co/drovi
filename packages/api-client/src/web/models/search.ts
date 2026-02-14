export interface SearchResult {
  id: string | null;
  type: string;
  title: string | null;
  properties: Record<string, unknown>;
  score: number;
  scores: Record<string, number>;
  match_source: string;
  connections: Array<Record<string, unknown>> | null;
}

export interface SearchResponse {
  success: boolean;
  results: SearchResult[];
  count: number;
  query_time_ms: number;
  total: number;
}

export interface ContentSearchResult {
  id: string;
  kind: string;
  source_type: string;
  source_id: string | null;
  source_account_id: string | null;
  conversation_id: string | null;
  message_id: string | null;
  title: string | null;
  snippet: string | null;
  captured_at: string | null;
  received_at: string;
}

export interface ContentSearchResponse {
  success: boolean;
  results: ContentSearchResult[];
  count: number;
}
