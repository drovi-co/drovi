export interface ActuationRecordSummary {
  id: string;
  driver: string;
  actionType: string;
  tier: string;
  status: string;
  createdAt: string | null;
  updatedAt: string | null;
}

export function transformActuationSummary(
  raw: Record<string, unknown>
): ActuationRecordSummary {
  return {
    id: raw.id as string,
    driver: raw.driver as string,
    actionType: raw.action_type as string,
    tier: raw.tier as string,
    status: raw.status as string,
    createdAt: (raw.created_at as string | null) ?? null,
    updatedAt: (raw.updated_at as string | null) ?? null,
  };
}
