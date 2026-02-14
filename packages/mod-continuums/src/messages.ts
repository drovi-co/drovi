import type { ModuleI18nNamespace } from "@memorystack/mod-kit";

export const MOD_CONTINUUMS_NAMESPACE = "mod_continuums";

export const modContinuumsMessages: Record<string, string> = {
  "continuums.title": "Continuums",
  "continuums.builder": "Builder",
  "continuums.exchange": "Exchange",
};

export const modContinuumsI18n: ModuleI18nNamespace = {
  namespace: MOD_CONTINUUMS_NAMESPACE,
  defaultLocale: "en",
  messages: modContinuumsMessages,
};
