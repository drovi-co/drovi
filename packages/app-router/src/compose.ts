import type { ResolvedDroviModule } from "@memorystack/mod-kit";
import type {
  ComposedModuleRuntime,
  ComposeModuleRuntimeOptions,
  ComposeRoutePlanOptions,
  ComposeTanStackOptions,
  ModuleRoutePlan,
  RoutePlanEntry,
} from "./types";

const DEFAULT_SLOTS = new Set([
  "root",
  "auth",
  "onboarding",
  "dashboard",
  "admin",
  "standalone",
]);

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

export function composeModuleRoutePlan({
  modules,
  includeSlots,
}: ComposeRoutePlanOptions): ModuleRoutePlan {
  const slots = includeSlots ? new Set(includeSlots) : DEFAULT_SLOTS;
  const entries: RoutePlanEntry[] = [];

  for (const module of modules) {
    for (const route of module.routes) {
      if (!slots.has(route.slot)) {
        continue;
      }
      entries.push({
        moduleId: module.id,
        routeId: route.id,
        path: route.path,
        slot: route.slot,
        enabledByDefault: route.enabledByDefault !== false,
      });
    }
  }

  return {
    boundaries: ["root", "auth", "onboarding", "dashboard"],
    entries,
  };
}

export function composeTanStackRouteTree<TRoute>({
  rootRoute,
  slotParents,
  plan,
  createRoute,
  addChildren,
}: ComposeTanStackOptions<TRoute>): TRoute {
  const childrenByParent = new Map<TRoute, TRoute[]>();

  for (const entry of plan.entries) {
    if (!entry.enabledByDefault) {
      continue;
    }
    const parent = slotParents[entry.slot] ?? rootRoute;
    const next = createRoute(entry, parent);
    const current = childrenByParent.get(parent) ?? [];
    current.push(next);
    childrenByParent.set(parent, current);
  }

  let composedRoot = rootRoute;
  for (const [parent, children] of childrenByParent) {
    const nextParent = addChildren(parent, children);
    if (parent === rootRoute) {
      composedRoot = nextParent;
    }
  }
  return composedRoot;
}

export function composeModuleRuntime({
  modules,
}: ComposeModuleRuntimeOptions): ComposedModuleRuntime {
  const paths: string[] = [];
  const navIds: string[] = [];
  const commandIds: string[] = [];

  for (const module of modules) {
    for (const route of module.routes) {
      if (route.enabledByDefault !== false) {
        paths.push(route.path);
      }
    }
    for (const nav of module.navItems) {
      navIds.push(nav.id);
    }
    for (const command of module.commands) {
      commandIds.push(command.id);
    }
  }

  return {
    paths: unique(paths),
    navIds: unique(navIds),
    commandIds: unique(commandIds),
  };
}

export function moduleById(
  modules: ResolvedDroviModule[],
  moduleId: string
): ResolvedDroviModule | null {
  return modules.find((module) => module.id === moduleId) ?? null;
}
