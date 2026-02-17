import type { ModuleI18nNamespace } from "@memorystack/mod-kit";

export const MOD_TRUST_NAMESPACE = "mod_trust";

export const modTrustMessages: Record<string, string> = {
  "trust.title": "Trust & Audit",
  "trust.verifyLedger": "Verify ledger",
  "trust.provenance": "Provenance and integrity",
};

export const modTrustI18n: ModuleI18nNamespace = {
  namespace: MOD_TRUST_NAMESPACE,
  defaultLocale: "en",
  messages: modTrustMessages,
};
