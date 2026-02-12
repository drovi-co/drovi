export type ModuleCapability = string;

export type ModuleRouteSlot =
  | "root"
  | "auth"
  | "onboarding"
  | "dashboard"
  | "admin"
  | "standalone";

export interface ModuleRouteDefinition {
  id: string;
  path: string;
  slot: ModuleRouteSlot;
  enabledByDefault?: boolean;
  featureFlag?: string;
}

export interface ModuleNavItem {
  id: string;
  label: string;
  to: string;
  icon?: string;
  requiresCapability?: ModuleCapability;
}

export interface ModuleCommand {
  id: string;
  title: string;
  action: string;
  requiresCapability?: ModuleCapability;
}

export interface ModuleI18nNamespace {
  namespace: string;
  defaultLocale: string;
  messages: Record<string, string>;
}

export interface ModuleI18nDefinition {
  namespaces: ModuleI18nNamespace[];
}

export interface ModuleUiHints {
  [key: string]: unknown;
}

export interface ModuleTypeOverride {
  [typeName: string]: {
    label?: string;
    description?: string;
    hidden?: boolean;
  };
}

export interface ModuleOverride {
  routes?: Partial<Record<string, Partial<ModuleRouteDefinition>>>;
  nav?: Partial<Record<string, Partial<ModuleNavItem>>>;
  commands?: Partial<Record<string, Partial<ModuleCommand>>>;
  typeOverrides?: ModuleTypeOverride;
  uiHints?: ModuleUiHints;
}

export interface ModuleManifestGate {
  enabled?: boolean;
  capabilities?: Partial<Record<ModuleCapability, boolean>>;
  disabledRoutes?: string[];
  disabledNavItems?: string[];
  disabledCommands?: string[];
}

export interface DroviModule {
  id: string;
  title: string;
  capabilities?: ModuleCapability[];
  routes?: ModuleRouteDefinition[];
  navItems?: ModuleNavItem[];
  commands?: ModuleCommand[];
  i18n?: ModuleI18nDefinition;
  uiHints?: ModuleUiHints;
  staticOverride?: ModuleOverride;
}

export interface ResolvedDroviModule
  extends Omit<DroviModule, "staticOverride"> {
  capabilities: ModuleCapability[];
  routes: ModuleRouteDefinition[];
  navItems: ModuleNavItem[];
  commands: ModuleCommand[];
  i18n: ModuleI18nDefinition;
  uiHints: ModuleUiHints;
}

export interface ModuleResolutionInput {
  modules: DroviModule[];
  appOverrides?: Partial<Record<string, ModuleOverride>>;
  manifestGates?: Partial<Record<string, ModuleManifestGate>>;
  enabledCapabilities?: Partial<Record<ModuleCapability, boolean>>;
}
