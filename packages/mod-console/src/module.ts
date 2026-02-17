import type { DroviModule } from "@memorystack/mod-kit";
import { MOD_CONSOLE_NAMESPACE, modConsoleI18n } from "./messages";

export function createConsoleModule(): DroviModule {
  return {
    id: "mod-console",
    title: "Ledger",
    capabilities: ["ops.internal", "console.read"],
    routes: [
      { id: "console.index", path: "/dashboard/console", slot: "dashboard" },
    ],
    navItems: [
      {
        id: "console.nav",
        label: "Ledger",
        to: "/dashboard/console",
        icon: "terminal",
        group: "console",
        order: 10,
        requiresCapability: "console.read",
      },
    ],
    i18n: {
      namespaces: [modConsoleI18n],
    },
    uiHints: {
      namespace: MOD_CONSOLE_NAMESPACE,
      internalOnly: true,
    },
  };
}
