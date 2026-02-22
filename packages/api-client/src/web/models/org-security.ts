export interface OrgSecurityPolicy {
  organization_id: string;
  sso_enforced: boolean;
  password_fallback_enabled: boolean;
  password_fallback_environments: string[];
  ip_allowlist: string[];
  evidence_masking_enabled: boolean;
  break_glass_enabled: boolean;
  break_glass_required_actions: string[];
}

export interface OrgSecurityPolicyUpdate {
  sso_enforced?: boolean | null;
  password_fallback_enabled?: boolean | null;
  password_fallback_environments?: string[] | null;
  ip_allowlist?: string[] | null;
  evidence_masking_enabled?: boolean | null;
  break_glass_enabled?: boolean | null;
  break_glass_required_actions?: string[] | null;
}
