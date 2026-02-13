import type { DroviModule } from "@memorystack/mod-kit";
import { MOD_CONTINUUMS_NAMESPACE, modContinuumsI18n } from "./messages";

export function createContinuumsModule(): DroviModule {
  return {
    id: "mod-continuums",
    title: "Continuums",
    capabilities: [
      "continuums.read",
      "continuums.build",
      "continuums.exchange",
    ],
    routes: [
      {
        id: "continuums.index",
        path: "/dashboard/continuums",
        slot: "dashboard",
      },
      {
        id: "continuums.builder",
        path: "/dashboard/builder",
        slot: "dashboard",
      },
      {
        id: "continuums.exchange",
        path: "/dashboard/exchange",
        slot: "dashboard",
      },
    ],
    navItems: [
      {
        id: "continuums.nav",
        label: "Continuums",
        to: "/dashboard/continuums",
        requiresCapability: "continuums.read",
      },
      {
        id: "continuums.exchange_nav",
        label: "Exchange",
        to: "/dashboard/exchange",
        requiresCapability: "continuums.exchange",
      },
    ],
    i18n: {
      namespaces: [modContinuumsI18n],
    },
    uiHints: {
      namespace: MOD_CONTINUUMS_NAMESPACE,
      patternLibrary: true,
    },
  };
}
