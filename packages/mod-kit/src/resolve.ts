import type {
  DroviModule,
  ModuleCommand,
  ModuleManifestGate,
  ModuleNavItem,
  ModuleOverride,
  ModuleResolutionInput,
  ModuleRouteDefinition,
  ResolvedDroviModule,
} from "./types";

function byId<T extends { id: string }>(items: T[]): Map<string, T> {
  return new Map(items.map((item) => [item.id, item]));
}

function mergeRoute(
  route: ModuleRouteDefinition,
  override: Partial<ModuleRouteDefinition> | undefined
): ModuleRouteDefinition {
  if (!override) {
    return route;
  }
  return {
    ...route,
    ...override,
    id: route.id,
  };
}

function mergeNavItem(
  item: ModuleNavItem,
  override: Partial<ModuleNavItem> | undefined
): ModuleNavItem {
  if (!override) {
    return item;
  }
  return {
    ...item,
    ...override,
    id: item.id,
  };
}

function mergeCommand(
  command: ModuleCommand,
  override: Partial<ModuleCommand> | undefined
): ModuleCommand {
  if (!override) {
    return command;
  }
  return {
    ...command,
    ...override,
    id: command.id,
  };
}

function isCapabilityEnabled(
  capability: string,
  gate: ModuleManifestGate | undefined,
  globals: Partial<Record<string, boolean>> | undefined
): boolean {
  const globalState = globals?.[capability];
  if (globalState === false) {
    return false;
  }
  const gatedState = gate?.capabilities?.[capability];
  if (gatedState === false) {
    return false;
  }
  return true;
}

function resolveSingleModule(
  module: DroviModule,
  appOverride: ModuleOverride | undefined,
  gate: ModuleManifestGate | undefined,
  globalCapabilities: Partial<Record<string, boolean>> | undefined
): ResolvedDroviModule | null {
  if (gate?.enabled === false) {
    return null;
  }

  // Precedence is explicit and stable:
  // base module -> module static override -> app override -> manifest gate.
  const staticOverride = module.staticOverride;
  const routeMap = byId(module.routes ?? []);
  const navMap = byId(module.navItems ?? []);
  const commandMap = byId(module.commands ?? []);

  const mergedRoutes = [...routeMap.values()]
    .map((route) =>
      mergeRoute(
        mergeRoute(route, staticOverride?.routes?.[route.id]),
        appOverride?.routes?.[route.id]
      )
    )
    .filter((route) => !(gate?.disabledRoutes ?? []).includes(route.id));

  const mergedNavItems = [...navMap.values()]
    .map((item) =>
      mergeNavItem(
        mergeNavItem(item, staticOverride?.nav?.[item.id]),
        appOverride?.nav?.[item.id]
      )
    )
    .filter((item) => !(gate?.disabledNavItems ?? []).includes(item.id))
    .filter((item) => {
      if (!item.requiresCapability) {
        return true;
      }
      return isCapabilityEnabled(
        item.requiresCapability,
        gate,
        globalCapabilities
      );
    });

  const mergedCommands = [...commandMap.values()]
    .map((command) =>
      mergeCommand(
        mergeCommand(command, staticOverride?.commands?.[command.id]),
        appOverride?.commands?.[command.id]
      )
    )
    .filter((command) => !(gate?.disabledCommands ?? []).includes(command.id))
    .filter((command) => {
      if (!command.requiresCapability) {
        return true;
      }
      return isCapabilityEnabled(
        command.requiresCapability,
        gate,
        globalCapabilities
      );
    });

  const capabilities = (module.capabilities ?? []).filter((capability) =>
    isCapabilityEnabled(capability, gate, globalCapabilities)
  );

  const typeOverrides = {
    ...(staticOverride?.typeOverrides ?? {}),
    ...(appOverride?.typeOverrides ?? {}),
  };

  const uiHints = {
    ...(module.uiHints ?? {}),
    ...(staticOverride?.uiHints ?? {}),
    ...(appOverride?.uiHints ?? {}),
    typeOverrides,
  };

  return {
    id: module.id,
    title: module.title,
    capabilities,
    routes: mergedRoutes,
    navItems: mergedNavItems,
    commands: mergedCommands,
    i18n: module.i18n ?? { namespaces: [] },
    uiHints,
  };
}

export function resolveModules({
  modules,
  appOverrides,
  manifestGates,
  enabledCapabilities,
}: ModuleResolutionInput): ResolvedDroviModule[] {
  const resolved: ResolvedDroviModule[] = [];

  for (const module of modules) {
    const next = resolveSingleModule(
      module,
      appOverrides?.[module.id],
      manifestGates?.[module.id],
      enabledCapabilities
    );
    if (next) {
      resolved.push(next);
    }
  }

  return resolved;
}
