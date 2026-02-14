import type { ModuleI18nNamespace } from "@memorystack/mod-kit";

export const MOD_TEAMS_NAMESPACE = "mod_teams";

export const modTeamsMessages: Record<string, string> = {
  "teams.title": "Team",
  "teams.members": "Members",
  "teams.invitations": "Invitations",
  "teams.settings": "Team settings",
};

export const modTeamsI18n: ModuleI18nNamespace = {
  namespace: MOD_TEAMS_NAMESPACE,
  defaultLocale: "en",
  messages: modTeamsMessages,
};
