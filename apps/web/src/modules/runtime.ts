import { createAskModule } from "@memorystack/mod-ask";
import { createAgentsModule } from "@memorystack/mod-agents";
import { createAuthModule } from "@memorystack/mod-auth";
import { createConsoleModule } from "@memorystack/mod-console";
import { createDriveModule } from "@memorystack/mod-drive";
import { createEvidenceModule } from "@memorystack/mod-evidence";
import {
  type DroviModule,
  resolveModules,
  type ModuleManifestGate,
  type ModuleOverride,
  type ResolvedDroviModule,
} from "@memorystack/mod-kit";
import {
  createOnboardingModule,
  type OnboardingStep,
} from "@memorystack/mod-onboarding";
import { createSourcesModule } from "@memorystack/mod-sources";
import { createTeamsModule } from "@memorystack/mod-teams";
import { createTrustModule } from "@memorystack/mod-trust";

export interface RuntimeOnboardingStep extends OnboardingStep {
  route: string;
}

export interface ResolveWebModulesOptions {
  appOverrides?: Partial<Record<string, ModuleOverride>>;
  manifestGates?: Partial<Record<string, ModuleManifestGate>>;
  enabledCapabilities?: Partial<Record<string, boolean>>;
}

const ONBOARDING_ROUTES_BY_STEP_ID: Record<string, string> = {
  create_org: "/onboarding/create-org",
  invite_team: "/onboarding/invite-team",
  connect_sources: "/onboarding/connect-sources",
  complete: "/onboarding/complete",
};

function createCoreShellModule(): DroviModule {
  return {
    id: "mod-core-shell",
    title: "Core Workspace",
    capabilities: ["core.workspace.read"],
    routes: [
      {
        id: "core.reality_stream",
        path: "/dashboard/reality-stream",
        slot: "dashboard",
      },
      { id: "core.graph", path: "/dashboard/graph", slot: "dashboard" },
      {
        id: "core.commitments",
        path: "/dashboard/commitments",
        slot: "dashboard",
      },
      {
        id: "core.decisions",
        path: "/dashboard/decisions",
        slot: "dashboard",
      },
      { id: "core.tasks", path: "/dashboard/tasks", slot: "dashboard" },
      {
        id: "core.schedule",
        path: "/dashboard/schedule",
        slot: "dashboard",
      },
      { id: "core.people", path: "/dashboard/contacts", slot: "dashboard" },
      {
        id: "core.patterns",
        path: "/dashboard/patterns",
        slot: "dashboard",
      },
      {
        id: "core.simulations",
        path: "/dashboard/simulations",
        slot: "dashboard",
      },
      {
        id: "core.actuations",
        path: "/dashboard/actuations",
        slot: "dashboard",
      },
      {
        id: "core.settings",
        path: "/dashboard/settings",
        slot: "dashboard",
      },
    ],
    navItems: [
      {
        id: "core.reality_stream",
        label: "Reality Stream",
        to: "/dashboard/reality-stream",
        icon: "activity",
        group: "console",
        order: 20,
        requiresCapability: "core.workspace.read",
      },
      {
        id: "core.graph",
        label: "Graph",
        to: "/dashboard/graph",
        icon: "network",
        group: "console",
        order: 30,
        requiresCapability: "core.workspace.read",
      },
      {
        id: "core.commitments",
        label: "Commitments",
        to: "/dashboard/commitments",
        icon: "check-circle-2",
        group: "memory",
        order: 10,
        requiresCapability: "core.workspace.read",
      },
      {
        id: "core.decisions",
        label: "Decisions",
        to: "/dashboard/decisions",
        icon: "book-open",
        group: "memory",
        order: 20,
        requiresCapability: "core.workspace.read",
      },
      {
        id: "core.tasks",
        label: "Tasks",
        to: "/dashboard/tasks",
        icon: "list-todo",
        group: "memory",
        order: 30,
        requiresCapability: "core.workspace.read",
      },
      {
        id: "core.schedule",
        label: "Schedule",
        to: "/dashboard/schedule",
        icon: "calendar",
        group: "memory",
        order: 40,
        requiresCapability: "core.workspace.read",
      },
      {
        id: "core.people",
        label: "People",
        to: "/dashboard/contacts",
        icon: "users",
        group: "discovery",
        order: 10,
        requiresCapability: "core.workspace.read",
      },
      {
        id: "core.patterns",
        label: "Patterns",
        to: "/dashboard/patterns",
        icon: "sparkles",
        group: "discovery",
        order: 20,
        requiresCapability: "core.workspace.read",
      },
      {
        id: "core.simulations",
        label: "Simulations",
        to: "/dashboard/simulations",
        icon: "activity",
        group: "execution",
        order: 10,
        requiresCapability: "core.workspace.read",
      },
      {
        id: "core.actuations",
        label: "Actuations",
        to: "/dashboard/actuations",
        icon: "zap",
        group: "execution",
        order: 20,
        requiresCapability: "core.workspace.read",
      },
      {
        id: "core.settings",
        label: "Settings",
        to: "/dashboard/settings",
        icon: "settings",
        group: "management",
        order: 90,
        requiresCapability: "core.workspace.read",
      },
    ],
    uiHints: {
      namespace: "mod_core_shell",
    },
  };
}

export function buildWebModuleList() {
  return [
    createCoreShellModule(),
    createAuthModule({
      policy: {
        postLoginRedirect: "/dashboard",
      },
    }),
    createOnboardingModule(),
    createSourcesModule(),
    createTeamsModule(),
    createDriveModule(),
    createTrustModule(),
    createAgentsModule(),
    createEvidenceModule(),
    createAskModule(),
    createConsoleModule(),
  ];
}

export function resolveWebModules(
  options: ResolveWebModulesOptions = {}
): ResolvedDroviModule[] {
  return resolveModules({
    modules: buildWebModuleList(),
    enabledCapabilities: {
      "ops.internal": true,
      ...(options.enabledCapabilities ?? {}),
    },
    appOverrides: options.appOverrides,
    manifestGates: options.manifestGates,
  });
}

const defaultWebModules = resolveWebModules();

function findModule(
  modules: ResolvedDroviModule[],
  moduleId: string
): ResolvedDroviModule | null {
  return modules.find((module) => module.id === moduleId) ?? null;
}

export function getWebModules(
  modules: ResolvedDroviModule[] = defaultWebModules
): ResolvedDroviModule[] {
  return modules;
}

export function getWebModule(
  moduleId: string,
  modules: ResolvedDroviModule[] = defaultWebModules
): ResolvedDroviModule | null {
  return findModule(modules, moduleId);
}

export function getWebCapabilities(
  modules: ResolvedDroviModule[] = defaultWebModules
): Record<string, boolean> {
  const capabilities: Record<string, boolean> = {};
  for (const module of modules) {
    for (const capability of module.capabilities) {
      capabilities[capability] = true;
    }
  }
  return capabilities;
}

export function getWebPostLoginRedirect(
  modules: ResolvedDroviModule[] = defaultWebModules
): string {
  const authModule = findModule(modules, "mod-auth");
  const value = authModule?.uiHints.postLoginRedirect;
  return typeof value === "string" && value.length > 0 ? value : "/dashboard";
}

export function getWebAllowedConnectorIds(
  modules: ResolvedDroviModule[] = defaultWebModules
): string[] | null {
  const sourcesModule = findModule(modules, "mod-sources");
  const value = sourcesModule?.uiHints.allowedConnectors;
  if (!Array.isArray(value)) {
    return null;
  }
  return value.filter((item): item is string => typeof item === "string");
}

export function getWebOnboardingSteps(
  modules: ResolvedDroviModule[] = defaultWebModules
): RuntimeOnboardingStep[] {
  const onboardingModule = findModule(modules, "mod-onboarding");
  const value = onboardingModule?.uiHints.steps;
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter(
      (
        item
      ): item is { id: string; requiredCapabilities: string[] | undefined } =>
        typeof item === "object" && item !== null && "id" in item
    )
    .map((item) => ({
      id: item.id,
      requiredCapabilities: Array.isArray(item.requiredCapabilities)
        ? item.requiredCapabilities.filter(
            (capability): capability is string => typeof capability === "string"
          )
        : [],
      route: ONBOARDING_ROUTES_BY_STEP_ID[item.id] ?? "/onboarding/create-org",
    }));
}
