import type { DroviModule } from "@memorystack/mod-kit";
import { MOD_ASK_NAMESPACE, modAskI18n } from "./messages";
import { type AskPreset, defaultAskPresets } from "./presets";

export interface CreateAskModuleOptions {
  presets?: AskPreset[];
}

export function createAskModule(options?: CreateAskModuleOptions): DroviModule {
  const presets = options?.presets ?? defaultAskPresets;

  return {
    id: "mod-ask",
    title: "Ask",
    capabilities: ["ask.read", "ask.chat"],
    routes: [{ id: "ask.page", path: "/ai", slot: "root" }],
    commands: [
      {
        id: "ask.open",
        title: "Open Ask",
        action: "ask.open",
        requiresCapability: "ask.read",
      },
    ],
    i18n: {
      namespaces: [modAskI18n],
    },
    uiHints: {
      namespace: MOD_ASK_NAMESPACE,
      presets,
    },
  };
}
