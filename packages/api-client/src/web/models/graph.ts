export interface GraphQueryResponse {
  success: boolean;
  results: Array<Record<string, unknown>>;
  count: number;
}
