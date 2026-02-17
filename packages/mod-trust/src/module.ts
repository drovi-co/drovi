import type { DroviModule } from "@memorystack/mod-kit";
import { MOD_TRUST_NAMESPACE, modTrustI18n } from "./messages";

export function createTrustModule(): DroviModule {
  return {
    id: "mod-trust",
    title: "Trust & Audit",
    capabilities: ["trust.read", "trust.verify_ledger"],
    routes: [{ id: "trust.index", path: "/dashboard/trust", slot: "dashboard" }],
    navItems: [
      {
        id: "core.trust",
        label: "Trust & Audit",
        to: "/dashboard/trust",
        icon: "shield",
        group: "execution",
        order: 80,
        requiresCapability: "trust.read",
      },
    ],
    commands: [
      {
        id: "trust.verify_ledger",
        title: "Verify ledger",
        action: "trust.verify_ledger",
        requiresCapability: "trust.verify_ledger",
      },
    ],
    i18n: {
      namespaces: [modTrustI18n],
    },
    uiHints: {
      namespace: MOD_TRUST_NAMESPACE,
    },
  };
}
