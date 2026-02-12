export interface ChangeRecord {
  entity_id: string;
  entity_type: string;
  change_type: string;
  version: number;
  timestamp: string;
  changed_by: string | null;
  change_reason: string | null;
  diff?: {
    change_summary: string;
    changes: Array<{
      field_name: string;
      change_type: string;
      old_value: unknown;
      new_value: unknown;
    }>;
  } | null;
}
