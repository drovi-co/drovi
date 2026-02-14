export interface TeamRoleLabels {
  owner: string;
  admin: string;
  member: string;
}

export const defaultTeamRoleLabels: TeamRoleLabels = {
  owner: "Owner",
  admin: "Admin",
  member: "Member",
};

export function resolveRoleLabel(
  role: string,
  labels: TeamRoleLabels = defaultTeamRoleLabels
): string {
  const normalized = role.trim().toLowerCase();
  if (normalized in labels) {
    return labels[normalized as keyof TeamRoleLabels];
  }
  return role;
}
