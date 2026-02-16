import type { ModuleI18nNamespace } from "@memorystack/mod-kit";

export const MOD_SOURCES_NAMESPACE = "mod_sources";

export const modSourcesMessages: Record<string, string> = {
  "sources.title": "Connected sources",
  "sources.connect": "Connect source",
  "sources.backfill": "Backfill",
  "sources.live": "Live sync",
};

export const modSourcesI18n: ModuleI18nNamespace = {
  namespace: MOD_SOURCES_NAMESPACE,
  defaultLocale: "en",
  messages: modSourcesMessages,
};
