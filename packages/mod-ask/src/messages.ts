import type { ModuleI18nNamespace } from "@memorystack/mod-kit";

export const MOD_ASK_NAMESPACE = "mod_ask";

export const modAskMessages: Record<string, string> = {
  "ask.title": "Ask",
  "ask.placeholder": "Ask Drovi anything",
  "ask.citations": "Citations",
};

export const modAskI18n: ModuleI18nNamespace = {
  namespace: MOD_ASK_NAMESPACE,
  defaultLocale: "en",
  messages: modAskMessages,
};
