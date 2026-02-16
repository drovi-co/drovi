import type {
  ModuleRouteSlot,
  ResolvedDroviModule,
} from "@memorystack/mod-kit";

export type AppRouteBoundary = "root" | "auth" | "onboarding" | "dashboard";

export interface RoutePlanEntry {
  moduleId: string;
  routeId: string;
  path: string;
  slot: ModuleRouteSlot;
  enabledByDefault: boolean;
}

export interface ModuleRoutePlan {
  boundaries: AppRouteBoundary[];
  entries: RoutePlanEntry[];
}

export interface ComposeRoutePlanOptions {
  modules: ResolvedDroviModule[];
  includeSlots?: ModuleRouteSlot[];
}

export interface ComposeTanStackOptions<TRoute> {
  rootRoute: TRoute;
  slotParents: Partial<Record<ModuleRouteSlot, TRoute>>;
  plan: ModuleRoutePlan;
  createRoute: (entry: RoutePlanEntry, parent: TRoute) => TRoute;
  addChildren: (parent: TRoute, children: TRoute[]) => TRoute;
}

export interface ComposedModuleRuntime {
  paths: string[];
  navIds: string[];
  commandIds: string[];
}

export interface ComposeModuleRuntimeOptions {
  modules: ResolvedDroviModule[];
}
