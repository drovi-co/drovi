import type { ModuleI18nNamespace } from "@memorystack/mod-kit";

export const MOD_EVIDENCE_NAMESPACE = "mod_evidence";

export const modEvidenceMessages: Record<string, string> = {
  "evidence.title": "Evidence",
  "evidence.open": "Open evidence",
  "evidence.redacted": "Redacted by policy",
};

export const modEvidenceI18n: ModuleI18nNamespace = {
  namespace: MOD_EVIDENCE_NAMESPACE,
  defaultLocale: "en",
  messages: modEvidenceMessages,
};
