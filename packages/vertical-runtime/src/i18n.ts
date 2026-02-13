import type { ResolvedDroviModule } from "@memorystack/mod-kit";
import type { PluginManifest } from "./types";

export type NamespaceMessages = Record<string, string>;
export type ModuleI18nCatalog = Record<string, NamespaceMessages>;

function parseNamespaceMessages(value: unknown): NamespaceMessages {
  if (!value || typeof value !== "object") {
    return {};
  }

  return Object.fromEntries(
    Object.entries(value).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string"
    )
  );
}

function parseOverrideCatalog(value: unknown): ModuleI18nCatalog {
  if (!value || typeof value !== "object") {
    return {};
  }

  return Object.fromEntries(
    Object.entries(value).map(([namespace, messages]) => [
      namespace,
      parseNamespaceMessages(messages),
    ])
  );
}

export function i18nOverridesFromManifest(
  manifest: PluginManifest | null
): ModuleI18nCatalog {
  if (!manifest) {
    return {};
  }
  return parseOverrideCatalog(
    manifest.i18n_overrides ?? manifest.ui_hints.i18n_overrides
  );
}

export function buildModuleI18nCatalog(
  modules: ResolvedDroviModule[],
  overrides: ModuleI18nCatalog = {}
): ModuleI18nCatalog {
  const catalog: ModuleI18nCatalog = {};

  for (const module of modules) {
    for (const namespace of module.i18n.namespaces) {
      const baseMessages = namespace.messages;
      const overrideMessages = overrides[namespace.namespace] ?? {};
      catalog[namespace.namespace] = {
        ...baseMessages,
        ...overrideMessages,
      };
    }
  }

  return catalog;
}
