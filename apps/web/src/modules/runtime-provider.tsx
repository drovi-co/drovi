import {
  fetchManifest,
  getVerticalPreset,
  listVerticalPresets,
  type PluginManifest,
  type VerticalId,
} from "@memorystack/vertical-runtime";
import { applyThemePack, UI_THEME_PACK, themePacks } from "@memorystack/ui-theme";
import type { ModuleOverride, ResolvedDroviModule } from "@memorystack/mod-kit";
import {
  createContext,
  type PropsWithChildren,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { useAuthStore } from "@/lib/auth";
import {
  getWebAllowedConnectorIds,
  getWebCapabilities,
  getWebOnboardingSteps,
  getWebPostLoginRedirect,
  resolveWebModules,
  type ResolveWebModulesOptions,
  type RuntimeOnboardingStep,
} from "./runtime";

interface WebRuntimeContextValue {
  modules: ResolvedDroviModule[];
  capabilities: Record<string, boolean>;
  onboardingSteps: RuntimeOnboardingStep[];
  allowedConnectorIds: string[] | null;
  postLoginRedirect: string;
  vocabulary: Record<string, string>;
  typeLabels: Record<string, string>;
  navLabels: Record<string, string>;
  hiddenNavItemIds: string[];
  themePackId: string;
  manifest: PluginManifest | null;
  isLoading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

const DEFAULT_RUNTIME_MODULES = resolveWebModules({
  enabledCapabilities: { "world.brain.read": true },
});

const DEFAULT_CONTEXT_VALUE: WebRuntimeContextValue = {
  modules: DEFAULT_RUNTIME_MODULES,
  capabilities: getWebCapabilities(DEFAULT_RUNTIME_MODULES),
  onboardingSteps: getWebOnboardingSteps(DEFAULT_RUNTIME_MODULES),
  allowedConnectorIds: getWebAllowedConnectorIds(DEFAULT_RUNTIME_MODULES),
  postLoginRedirect: getWebPostLoginRedirect(DEFAULT_RUNTIME_MODULES),
  vocabulary: {},
  typeLabels: {},
  navLabels: {},
  hiddenNavItemIds: [],
  themePackId: UI_THEME_PACK,
  manifest: null,
  isLoading: false,
  error: null,
  refresh: async () => undefined,
};

const WebRuntimeContext =
  createContext<WebRuntimeContextValue>(DEFAULT_CONTEXT_VALUE);

const KNOWN_VERTICAL_IDS = new Set(
  listVerticalPresets().map((preset) => preset.id)
);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function parseStringMap(value: unknown): Record<string, string> {
  if (!isRecord(value)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(value).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string"
    )
  );
}

function parseStringList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((entry): entry is string => typeof entry === "string");
}

interface WorldBrainRolloutPolicy {
  enabled?: boolean;
  allowedOrgIds: string[];
  allowedRoles: string[];
  rolloutPercent?: number;
}

function normalizeRole(role: string | null): string {
  return typeof role === "string" ? role.trim().toLowerCase() : "";
}

function parseWorldBrainRolloutPolicy(
  manifest: PluginManifest | null
): WorldBrainRolloutPolicy | null {
  if (!manifest || !isRecord(manifest.ui_hints)) {
    return null;
  }

  const uiHints = manifest.ui_hints;
  const directPolicy = isRecord(uiHints.world_brain) ? uiHints.world_brain : null;
  const nestedFeatures = isRecord(uiHints.features) ? uiHints.features : null;
  const nestedPolicy = nestedFeatures && isRecord(nestedFeatures.world_brain)
    ? nestedFeatures.world_brain
    : null;
  const policy = directPolicy ?? nestedPolicy;
  if (!policy) {
    return null;
  }

  const enabled = typeof policy.enabled === "boolean" ? policy.enabled : undefined;
  const allowedOrgIds = parseStringList(
    policy.allowed_org_ids ?? policy.org_ids
  );
  const allowedRoles = parseStringList(
    policy.allowed_roles ?? policy.roles
  ).map((role) => role.trim().toLowerCase());
  const rawPercent = policy.rollout_percent ?? policy.rollout_percentage;
  const rolloutPercent =
    typeof rawPercent === "number" &&
    Number.isFinite(rawPercent) &&
    rawPercent >= 0 &&
    rawPercent <= 100
      ? rawPercent
      : undefined;

  return {
    enabled,
    allowedOrgIds,
    allowedRoles,
    rolloutPercent,
  };
}

function stableRolloutBucket(input: string): number {
  let hash = 0;
  for (let i = 0; i < input.length; i += 1) {
    hash = (hash * 33 + input.charCodeAt(i)) % 10007;
  }
  return hash % 100;
}

function evaluateWorldBrainAccessPolicy(
  manifest: PluginManifest | null,
  orgId: string | null,
  role: string | null
): boolean {
  const policy = parseWorldBrainRolloutPolicy(manifest);
  if (!policy) {
    return true;
  }
  if (policy.enabled === false) {
    return false;
  }
  if (policy.allowedOrgIds.length > 0) {
    if (!orgId || !policy.allowedOrgIds.includes(orgId)) {
      return false;
    }
  }
  if (policy.allowedRoles.length > 0) {
    const normalizedRole = normalizeRole(role);
    if (!normalizedRole || !policy.allowedRoles.includes(normalizedRole)) {
      return false;
    }
  }
  if (
    typeof policy.rolloutPercent === "number" &&
    policy.rolloutPercent >= 0 &&
    policy.rolloutPercent < 100
  ) {
    const bucket = stableRolloutBucket(
      `${orgId ?? "unknown"}:${normalizeRole(role)}`
    );
    if (bucket >= policy.rolloutPercent) {
      return false;
    }
  }
  return true;
}

function parseModuleOverrides(
  value: unknown
): Partial<Record<string, ModuleOverride>> {
  if (!isRecord(value)) {
    return {};
  }

  const entries: Array<[string, ModuleOverride]> = [];
  for (const [moduleId, override] of Object.entries(value)) {
    if (!isRecord(override)) {
      continue;
    }
    entries.push([moduleId, override as ModuleOverride]);
  }
  return Object.fromEntries(entries);
}

function mergeModuleOverride(
  base: ModuleOverride | undefined,
  next: ModuleOverride | undefined
): ModuleOverride | undefined {
  if (!base) {
    return next;
  }
  if (!next) {
    return base;
  }

  return {
    routes: { ...(base.routes ?? {}), ...(next.routes ?? {}) },
    nav: { ...(base.nav ?? {}), ...(next.nav ?? {}) },
    commands: { ...(base.commands ?? {}), ...(next.commands ?? {}) },
    typeOverrides: { ...(base.typeOverrides ?? {}), ...(next.typeOverrides ?? {}) },
    uiHints: { ...(base.uiHints ?? {}), ...(next.uiHints ?? {}) },
  };
}

function mergeModuleOverrides(
  base: Partial<Record<string, ModuleOverride>>,
  extra: Partial<Record<string, ModuleOverride>>
): Partial<Record<string, ModuleOverride>> {
  const merged: Partial<Record<string, ModuleOverride>> = {};
  const moduleIds = new Set([...Object.keys(base), ...Object.keys(extra)]);
  for (const moduleId of moduleIds) {
    merged[moduleId] = mergeModuleOverride(base[moduleId], extra[moduleId]);
  }
  return merged;
}

function parseVerticalId(raw: unknown): VerticalId | null {
  if (typeof raw !== "string") {
    return null;
  }
  return KNOWN_VERTICAL_IDS.has(raw as VerticalId) ? (raw as VerticalId) : null;
}

function parseCapabilityStates(
  value: unknown
): Partial<Record<string, boolean>> {
  if (!isRecord(value)) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(value).filter(
      (entry): entry is [string, boolean] => typeof entry[1] === "boolean"
    )
  );
}

function parseResolveOptions(
  manifest: PluginManifest | null,
  context: { orgId: string | null; role: string | null }
): ResolveWebModulesOptions {
  const uiHints =
    manifest && isRecord(manifest.ui_hints) ? manifest.ui_hints : {};
  const verticalId = parseVerticalId(uiHints.vertical);
  const preset = verticalId ? getVerticalPreset(verticalId) : null;
  const manifestOverrides = parseModuleOverrides(
    uiHints.module_overrides ?? uiHints.app_overrides
  );
  const appOverrides = mergeModuleOverrides(
    preset?.appOverrides ?? {},
    manifestOverrides
  );

  const manifestGates: NonNullable<ResolveWebModulesOptions["manifestGates"]> =
    isRecord(uiHints.modules)
      ? ({
          ...(
            uiHints.modules as NonNullable<ResolveWebModulesOptions["manifestGates"]>
          ),
        } as NonNullable<ResolveWebModulesOptions["manifestGates"]>)
      : {};

  const worldBrainEnabled = evaluateWorldBrainAccessPolicy(
    manifest,
    context.orgId,
    context.role
  );

  if (!worldBrainEnabled) {
    const existingCoreGate = manifestGates?.["mod-core-shell"] ?? {};
    const existingDisabledRoutes = existingCoreGate.disabledRoutes ?? [];
    const existingDisabledNavItems = existingCoreGate.disabledNavItems ?? [];
    manifestGates["mod-core-shell"] = {
      ...existingCoreGate,
      disabledRoutes: Array.from(
        new Set([...existingDisabledRoutes, "core.world_brain"])
      ),
      disabledNavItems: Array.from(
        new Set([...existingDisabledNavItems, "core.world_brain"])
      ),
      capabilities: {
        ...(existingCoreGate.capabilities ?? {}),
        "world.brain.read": false,
      },
    };
  }

  return {
    appOverrides,
    manifestGates,
    enabledCapabilities: {
      ...parseCapabilityStates(manifest?.capabilities),
      "world.brain.read": worldBrainEnabled,
    },
  };
}

function parseThemePackId(manifest: PluginManifest | null): string {
  if (!manifest || !isRecord(manifest.ui_hints)) {
    return UI_THEME_PACK;
  }

  const explicit = manifest.ui_hints.theme_pack;
  if (typeof explicit === "string" && explicit in themePacks) {
    return explicit;
  }

  const verticalId = parseVerticalId(manifest.ui_hints.vertical);
  if (!verticalId) {
    return UI_THEME_PACK;
  }

  return getVerticalPreset(verticalId).themePack;
}

function parseVocabulary(manifest: PluginManifest | null): Record<string, string> {
  if (!manifest || !isRecord(manifest.ui_hints)) {
    return {};
  }
  const verticalId = parseVerticalId(manifest.ui_hints.vertical);
  const presetVocabulary = verticalId ? getVerticalPreset(verticalId).vocabulary : {};
  const manifestVocabulary = parseStringMap(manifest.ui_hints.vocabulary);
  return {
    ...presetVocabulary,
    ...manifestVocabulary,
  };
}

function parseTypeLabels(manifest: PluginManifest | null): Record<string, string> {
  if (!manifest || !isRecord(manifest.ui_hints)) {
    return {};
  }
  return parseStringMap(manifest.ui_hints.type_labels);
}

function parseNavLabels(manifest: PluginManifest | null): Record<string, string> {
  if (!manifest || !isRecord(manifest.ui_hints)) {
    return {};
  }

  const navigation =
    (isRecord(manifest.ui_hints.navigation) && manifest.ui_hints.navigation) || {};
  return parseStringMap(navigation.labels);
}

function parseHiddenNavItems(manifest: PluginManifest | null): string[] {
  if (!manifest || !isRecord(manifest.ui_hints)) {
    return [];
  }

  const navigation =
    (isRecord(manifest.ui_hints.navigation) && manifest.ui_hints.navigation) || {};
  return parseStringList(navigation.hidden_nav_items);
}

export function WebRuntimeProvider({ children }: PropsWithChildren) {
  const orgId = useAuthStore((state) => state.user?.org_id ?? null);
  const userRole = useAuthStore((state) => state.user?.role ?? null);
  const [manifest, setManifest] = useState<PluginManifest | null>(null);
  const [etag, setEtag] = useState<string | undefined>(undefined);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!orgId) {
      setManifest(null);
      setEtag(undefined);
      setError(null);
      setIsLoading(false);
      return;
    }

    try {
      setIsLoading(true);
      setError(null);
      const result = await fetchManifest({
        orgId,
        etag,
      });
      setManifest(result.manifest);
      setEtag(result.etag);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Failed to load runtime manifest"
      );
    } finally {
      setIsLoading(false);
    }
  }, [orgId, etag]);

  useEffect(() => {
    refresh().catch(() => undefined);
  }, [refresh]);

  useEffect(() => {
    if (!orgId) {
      return;
    }
    const timer = window.setInterval(() => {
      refresh().catch(() => undefined);
    }, 60_000);
    return () => window.clearInterval(timer);
  }, [orgId, refresh]);

  const resolved = useMemo(() => {
    return resolveWebModules(
      parseResolveOptions(manifest, {
        orgId,
        role: userRole,
      })
    );
  }, [manifest, orgId, userRole]);

  const themePackId = useMemo(() => parseThemePackId(manifest), [manifest]);

  useEffect(() => {
    const root = document.documentElement;
    const apply = () => {
      const mode = root.classList.contains("dark") ? "dark" : "light";
      applyThemePack({ themeId: themePackId, mode, root });
    };
    apply();
    const observer = new MutationObserver((records) => {
      for (const record of records) {
        if (record.type === "attributes" && record.attributeName === "class") {
          apply();
          break;
        }
      }
    });
    observer.observe(root, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, [themePackId]);

  const value = useMemo<WebRuntimeContextValue>(() => {
    const modules = resolved.length > 0 ? resolved : DEFAULT_RUNTIME_MODULES;
    return {
      modules,
      capabilities: getWebCapabilities(modules),
      onboardingSteps: getWebOnboardingSteps(modules),
      allowedConnectorIds: getWebAllowedConnectorIds(modules),
      postLoginRedirect: getWebPostLoginRedirect(modules),
      vocabulary: parseVocabulary(manifest),
      typeLabels: parseTypeLabels(manifest),
      navLabels: parseNavLabels(manifest),
      hiddenNavItemIds: parseHiddenNavItems(manifest),
      themePackId,
      manifest,
      isLoading,
      error,
      refresh,
    };
  }, [resolved, manifest, themePackId, isLoading, error, refresh]);

  return (
    <WebRuntimeContext.Provider value={value}>
      {children}
    </WebRuntimeContext.Provider>
  );
}

export function useWebRuntime(): WebRuntimeContextValue {
  return useContext(WebRuntimeContext);
}
