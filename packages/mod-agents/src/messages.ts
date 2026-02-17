import type { ModuleI18nNamespace } from "@memorystack/mod-kit";

export const MOD_AGENTS_NAMESPACE = "mod_agents";

export const modAgentsMessages: Record<string, string> = {
  "agents.title": "Agents",
  "agents.workforces": "Workforces",
  "agents.studio": "Studio",
  "agents.runs": "Runs",
  "agents.catalog": "Catalog",
  "agents.inbox": "Inbox",
};

export const modAgentsI18n: ModuleI18nNamespace = {
  namespace: MOD_AGENTS_NAMESPACE,
  defaultLocale: "en",
  messages: modAgentsMessages,
};
