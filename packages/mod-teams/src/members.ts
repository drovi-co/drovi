import { useMemo } from "react";

export type TeamRole =
  | "pilot_owner"
  | "owner"
  | "pilot_admin"
  | "pilot_member"
  | "pilot_viewer"
  | string;

export interface TeamMemberLike {
  id: string;
  name?: string | null;
  email?: string | null;
  role: TeamRole;
}

export interface TeamMemberDisplay {
  displayName: string;
  initials: string;
  isOwner: boolean;
}

function initialsFromName(value: string): string {
  const initials = value
    .split(" ")
    .map((part) => part[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);

  return initials || "U";
}

export function isTeamAdminRole(role: TeamRole | null | undefined): boolean {
  return role === "pilot_owner" || role === "pilot_admin";
}

export function resolveTeamMemberDisplay(
  member: TeamMemberLike,
  fallbackUserLabel = "User"
): TeamMemberDisplay {
  const fallbackFromEmail = member.email?.split("@")[0] ?? null;
  const displayName = member.name ?? fallbackFromEmail ?? fallbackUserLabel;

  return {
    displayName,
    initials: initialsFromName(displayName),
    isOwner: member.role === "pilot_owner" || member.role === "owner",
  };
}

export function useTeamMemberDisplays(
  members: TeamMemberLike[] | undefined,
  fallbackUserLabel = "User"
): Array<{ member: TeamMemberLike; display: TeamMemberDisplay }> {
  return useMemo(() => {
    return (members ?? []).map((member) => ({
      member,
      display: resolveTeamMemberDisplay(member, fallbackUserLabel),
    }));
  }, [fallbackUserLabel, members]);
}
