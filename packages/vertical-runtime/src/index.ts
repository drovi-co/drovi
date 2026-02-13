export type { ModuleI18nCatalog, NamespaceMessages } from "./i18n";
export {
  buildModuleI18nCatalog,
  i18nOverridesFromManifest,
} from "./i18n";
export {
  fetchManifest,
  moduleGatesFromManifest,
  readManifestCache,
  writeManifestCache,
} from "./manifest-client";
export type {
  VerticalId,
  VerticalPreset,
} from "./presets";
export { getVerticalPreset, listVerticalPresets } from "./presets";
export {
  resolveModulesForVertical,
  useVertical,
  VerticalRuntimeProvider,
} from "./provider";
export type {
  ModuleResolutionInputForVertical,
  PluginManifest,
  PluginManifestExtensionTypeSpec,
  PluginManifestStorageRules,
  PluginManifestTypeSpec,
  VerticalManifestCache,
  VerticalRuntimeContextValue,
  VerticalRuntimeProviderProps,
  VerticalRuntimeState,
} from "./types";
