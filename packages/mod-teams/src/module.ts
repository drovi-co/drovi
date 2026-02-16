import type { DroviModule } from "@memorystack/mod-kit";
import { MOD_TEAMS_NAMESPACE, modTeamsI18n } from "./messages";
import { defaultTeamRoleLabels, type TeamRoleLabels } from "./roles";

export interface CreateTeamsModuleOptions {
  roleLabels?: Partial<TeamRoleLabels>;
}

export function createTeamsModule(
  options?: CreateTeamsModuleOptions
): DroviModule {
  const roleLabels: TeamRoleLabels = {
    ...defaultTeamRoleLabels,
    ...(options?.roleLabels ?? {}),
  };

  return {
    id: "mod-teams",
    title: "Teams",
    capabilities: ["team.read", "team.invite", "team.manage"],
    routes: [
      { id: "teams.index", path: "/dashboard/team", slot: "dashboard" },
      {
        id: "teams.members",
        path: "/dashboard/team/members",
        slot: "dashboard",
      },
      {
        id: "teams.invitations",
        path: "/dashboard/team/invitations",
        slot: "dashboard",
      },
      {
        id: "teams.settings",
        path: "/dashboard/team/settings",
        slot: "dashboard",
      },
    ],
    navItems: [
      {
        id: "teams.nav",
        label: "Team",
        to: "/dashboard/team",
        requiresCapability: "team.read",
      },
    ],
    i18n: {
      namespaces: [modTeamsI18n],
    },
    uiHints: {
      namespace: MOD_TEAMS_NAMESPACE,
      roleLabels,
    },
  };
}
