import type { DroviModule } from "@memorystack/mod-kit";
import { MOD_SOURCES_NAMESPACE, modSourcesI18n } from "./messages";

export interface CreateSourcesModuleOptions {
  allowedConnectors?: string[];
}

export function createSourcesModule(
  options?: CreateSourcesModuleOptions
): DroviModule {
  return {
    id: "mod-sources",
    title: "Sources",
    capabilities: ["sources.read", "sources.connect", "sources.sync"],
    routes: [
      { id: "sources.index", path: "/dashboard/sources", slot: "dashboard" },
    ],
    navItems: [
      {
        id: "sources.nav",
        label: "Connected Sources",
        to: "/dashboard/sources",
        requiresCapability: "sources.read",
      },
    ],
    commands: [
      {
        id: "sources.connect",
        title: "Connect source",
        action: "sources.connect",
        requiresCapability: "sources.connect",
      },
    ],
    i18n: {
      namespaces: [modSourcesI18n],
    },
    uiHints: {
      namespace: MOD_SOURCES_NAMESPACE,
      allowedConnectors: options?.allowedConnectors ?? null,
    },
  };
}
