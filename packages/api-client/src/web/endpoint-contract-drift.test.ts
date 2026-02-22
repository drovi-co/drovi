import { readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join } from "node:path";

import { describe, expect, test } from "vitest";

const REPO_ROOT = process.cwd();
const FRONTEND_WEB_API_DIR = join(REPO_ROOT, "packages/api-client/src/web");
const FRONTEND_EXTRA_FILES = [
  join(REPO_ROOT, "apps/web/src/lib/api.ts"),
  join(REPO_ROOT, "apps/web/src/modules/drive/pages/drive-page.tsx"),
];
const BACKEND_ROUTES_DIR = join(REPO_ROOT, "drovi-intelligence/src/api/routes");
const BACKEND_WEBHOOK_ROUTER_FILE = join(
  REPO_ROOT,
  "drovi-intelligence/src/connectors/webhooks/router.py"
);
const BACKEND_MAIN_FILE = join(REPO_ROOT, "drovi-intelligence/src/api/main.py");

const REQUEST_PATH_REGEX =
  /request(?:Json|Text|NoContent|Blob)(?:<[\s\S]*?>)?\(\s*(`(?:\\.|[^`\\])*`|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')/g;
const STRING_LITERAL_REGEX = /`(?:\\.|[^`\\])*`|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/g;
const URL_PROPERTY_REGEX =
  /\burl\s*:\s*(`(?:\\.|[^`\\])*`|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')/g;
const HEALTH_RETURN_REGEX =
  /\breturn\s+(`(?:\\.|[^`\\])*`|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')/g;

const ROUTER_PREFIX_REGEX = /router\s*=\s*APIRouter\(\s*([\s\S]*?)\)/m;
const ROUTER_ROUTE_REGEX =
  /@router\.(?:get|post|put|patch|delete|options|head)\(\s*(?:\n\s*)*["']([^"']*)["']/g;
const ROUTER_INCLUDE_REGEX =
  /router\.include_router\(\s*([A-Za-z_][A-Za-z0-9_]*)\s*(?:,\s*prefix\s*=\s*["']([^"']*)["'])?/g;
const IMPORT_ALIAS_REGEX =
  /from\s+\.([A-Za-z_][A-Za-z0-9_]*)\s+import\s+router\s+as\s+([A-Za-z_][A-Za-z0-9_]*)/g;
const APP_INCLUDE_MODULE_ROUTER_REGEX =
  /app\.include_router\(\s*([A-Za-z_][A-Za-z0-9_]*)\.router\s*(?:,\s*prefix\s*=\s*["']([^"']*)["'])?/g;
const APP_INCLUDE_ROUTER_OBJECT_REGEX =
  /app\.include_router\(\s*([A-Za-z_][A-Za-z0-9_]*)\s*,\s*prefix\s*=\s*["']([^"']*)["']/g;

interface RouterInclude {
  alias: string;
  prefix: string;
}

interface RouterModule {
  prefix: string;
  routes: string[];
  includes: RouterInclude[];
  imports: Map<string, string>;
}

interface MainInclude {
  symbol: string;
  prefix: string;
}

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

function walkFiles(
  directory: string,
  predicate: (filePath: string) => boolean,
  files: string[] = []
): string[] {
  for (const entry of readdirSync(directory)) {
    const fullPath = join(directory, entry);
    if (isDirectory(fullPath)) {
      walkFiles(fullPath, predicate, files);
      continue;
    }
    if (predicate(fullPath)) {
      files.push(fullPath);
    }
  }
  return files;
}

function decodeLiteral(literal: string): string {
  if (literal.length < 2) {
    return literal;
  }
  return literal.slice(1, -1);
}

function normalizeRoutePath(raw: string): string | null {
  let path = raw.trim();
  if (!path) {
    return null;
  }

  path = path.replace(/\$\{[^}]+\}/g, "{param}");

  if (path.startsWith("http://") || path.startsWith("https://")) {
    try {
      path = new URL(path).pathname;
    } catch {
      return null;
    }
  }

  const apiIndex = path.indexOf("/api/v1/");
  if (apiIndex >= 0) {
    path = path.slice(apiIndex);
  } else if (!path.startsWith("/")) {
    const healthIndex = path.indexOf("/health");
    if (healthIndex >= 0) {
      path = path.slice(healthIndex);
    }
  }

  if (!path.startsWith("/")) {
    return null;
  }

  if (
    !path.startsWith("/api/v1") &&
    path !== "/health" &&
    path !== "/ready" &&
    path !== "/live"
  ) {
    path = `/api/v1${path}`;
  }

  path = path.split("?")[0] ?? path;
  path = path.split("#")[0] ?? path;
  path = path.replace(/\{[^}]+\}/g, "{param}");
  path = path.replace(/\/{2,}/g, "/");

  if (path.length > 1 && path.endsWith("/")) {
    path = path.slice(0, -1);
  }

  return path;
}

function joinRouteSegments(...segments: string[]): string {
  let path = "";
  for (const segment of segments) {
    if (!segment) {
      continue;
    }
    if (!path) {
      path = segment.startsWith("/") ? segment : `/${segment}`;
      continue;
    }
    path = `${path.replace(/\/+$/g, "")}/${segment.replace(/^\/+/g, "")}`;
  }
  return path.replace(/\/{2,}/g, "/");
}

function extractFrontendEndpoints(): Set<string> {
  const endpoints = new Set<string>();
  const webApiFiles = walkFiles(
    FRONTEND_WEB_API_DIR,
    (filePath) => filePath.endsWith("-api.ts")
  );

  for (const filePath of webApiFiles) {
    const source = readFileSync(filePath, "utf8");

    REQUEST_PATH_REGEX.lastIndex = 0;
    let callMatch = REQUEST_PATH_REGEX.exec(source);
    while (callMatch) {
      const normalized = normalizeRoutePath(decodeLiteral(callMatch[1] ?? ""));
      if (normalized) {
        endpoints.add(normalized);
      }
      callMatch = REQUEST_PATH_REGEX.exec(source);
    }

    // Capture explicit absolute API strings used outside request helpers
    // (for example OAuth redirect URI paths).
    STRING_LITERAL_REGEX.lastIndex = 0;
    let literalMatch = STRING_LITERAL_REGEX.exec(source);
    while (literalMatch) {
      const literal = decodeLiteral(literalMatch[0] ?? "");
      if (!literal.includes("/api/v1/")) {
        literalMatch = STRING_LITERAL_REGEX.exec(source);
        continue;
      }
      const normalized = normalizeRoutePath(literal);
      if (normalized) {
        endpoints.add(normalized);
      }
      literalMatch = STRING_LITERAL_REGEX.exec(source);
    }
  }

  for (const filePath of FRONTEND_EXTRA_FILES) {
    const source = readFileSync(filePath, "utf8");

    URL_PROPERTY_REGEX.lastIndex = 0;
    let urlMatch = URL_PROPERTY_REGEX.exec(source);
    while (urlMatch) {
      const normalized = normalizeRoutePath(decodeLiteral(urlMatch[1] ?? ""));
      if (normalized) {
        endpoints.add(normalized);
      }
      urlMatch = URL_PROPERTY_REGEX.exec(source);
    }

    HEALTH_RETURN_REGEX.lastIndex = 0;
    let healthMatch = HEALTH_RETURN_REGEX.exec(source);
    while (healthMatch) {
      const literal = decodeLiteral(healthMatch[1] ?? "");
      if (!literal.startsWith("/health")) {
        healthMatch = HEALTH_RETURN_REGEX.exec(source);
        continue;
      }
      const normalized = normalizeRoutePath(literal);
      if (normalized) {
        endpoints.add(normalized);
      }
      healthMatch = HEALTH_RETURN_REGEX.exec(source);
    }
  }

  return endpoints;
}

function parseRouterModule(filePath: string): RouterModule {
  const source = readFileSync(filePath, "utf8");
  const imports = new Map<string, string>();
  const includes: RouterInclude[] = [];
  const routes: string[] = [];

  let prefix = "";
  const prefixMatch = ROUTER_PREFIX_REGEX.exec(source);
  if (prefixMatch?.[1]) {
    const explicitPrefixMatch = /\bprefix\s*=\s*["']([^"']*)["']/.exec(
      prefixMatch[1]
    );
    prefix = explicitPrefixMatch?.[1] ?? "";
  }

  IMPORT_ALIAS_REGEX.lastIndex = 0;
  let importMatch = IMPORT_ALIAS_REGEX.exec(source);
  while (importMatch) {
    const childModule = importMatch[1] ?? "";
    const alias = importMatch[2] ?? "";
    if (childModule && alias) {
      imports.set(alias, childModule);
    }
    importMatch = IMPORT_ALIAS_REGEX.exec(source);
  }

  ROUTER_INCLUDE_REGEX.lastIndex = 0;
  let includeMatch = ROUTER_INCLUDE_REGEX.exec(source);
  while (includeMatch) {
    includes.push({
      alias: includeMatch[1] ?? "",
      prefix: includeMatch[2] ?? "",
    });
    includeMatch = ROUTER_INCLUDE_REGEX.exec(source);
  }

  ROUTER_ROUTE_REGEX.lastIndex = 0;
  let routeMatch = ROUTER_ROUTE_REGEX.exec(source);
  while (routeMatch) {
    routes.push(routeMatch[1] ?? "");
    routeMatch = ROUTER_ROUTE_REGEX.exec(source);
  }

  return { prefix, routes, includes, imports };
}

function collectBackendRouteModules(): Map<string, RouterModule> {
  const modules = new Map<string, RouterModule>();
  const routeFiles = walkFiles(BACKEND_ROUTES_DIR, (filePath) =>
    filePath.endsWith(".py")
  );

  for (const filePath of routeFiles) {
    const moduleName = basename(filePath).replace(/\.py$/, "");
    modules.set(moduleName, parseRouterModule(filePath));
  }

  modules.set("webhook_router", parseRouterModule(BACKEND_WEBHOOK_ROUTER_FILE));
  return modules;
}

function parseMainIncludes(): MainInclude[] {
  const source = readFileSync(BACKEND_MAIN_FILE, "utf8");
  const includes: MainInclude[] = [];

  APP_INCLUDE_MODULE_ROUTER_REGEX.lastIndex = 0;
  let moduleRouterMatch = APP_INCLUDE_MODULE_ROUTER_REGEX.exec(source);
  while (moduleRouterMatch) {
    includes.push({
      symbol: moduleRouterMatch[1] ?? "",
      prefix: moduleRouterMatch[2] ?? "",
    });
    moduleRouterMatch = APP_INCLUDE_MODULE_ROUTER_REGEX.exec(source);
  }

  APP_INCLUDE_ROUTER_OBJECT_REGEX.lastIndex = 0;
  let routerObjectMatch = APP_INCLUDE_ROUTER_OBJECT_REGEX.exec(source);
  while (routerObjectMatch) {
    includes.push({
      symbol: routerObjectMatch[1] ?? "",
      prefix: routerObjectMatch[2] ?? "",
    });
    routerObjectMatch = APP_INCLUDE_ROUTER_OBJECT_REGEX.exec(source);
  }

  return includes;
}

function resolveModuleRoutes(
  moduleName: string,
  modules: Map<string, RouterModule>,
  stack: Set<string> = new Set()
): Set<string> {
  if (stack.has(moduleName)) {
    return new Set();
  }

  const module = modules.get(moduleName);
  if (!module) {
    return new Set();
  }

  const nextStack = new Set(stack);
  nextStack.add(moduleName);
  const resolved = new Set<string>();

  for (const route of module.routes) {
    resolved.add(joinRouteSegments(module.prefix, route));
  }

  for (const include of module.includes) {
    const childModuleName = module.imports.get(include.alias);
    if (!childModuleName) {
      continue;
    }
    const childRoutes = resolveModuleRoutes(childModuleName, modules, nextStack);
    for (const childRoute of childRoutes) {
      resolved.add(joinRouteSegments(module.prefix, include.prefix, childRoute));
    }
  }

  return resolved;
}

function extractBackendEndpoints(): Set<string> {
  const endpoints = new Set<string>();
  const modules = collectBackendRouteModules();
  const mainIncludes = parseMainIncludes();

  for (const include of mainIncludes) {
    const moduleName =
      include.symbol === "webhook_router" ? "webhook_router" : include.symbol;
    const resolvedRoutes = resolveModuleRoutes(moduleName, modules);
    for (const route of resolvedRoutes) {
      const normalized = normalizeRoutePath(joinRouteSegments(include.prefix, route));
      if (normalized) {
        endpoints.add(normalized);
      }
    }
  }

  return endpoints;
}

describe("frontend/backend endpoint contract", () => {
  test("frontend endpoints have backend router coverage", () => {
    const frontendEndpoints = extractFrontendEndpoints();
    const backendEndpoints = extractBackendEndpoints();

    const missing = [...frontendEndpoints]
      .filter((endpoint) => !backendEndpoints.has(endpoint))
      .sort();

    expect(missing).toEqual([]);
  });

  test("extractors return non-trivial endpoint sets", () => {
    const frontendEndpoints = extractFrontendEndpoints();
    const backendEndpoints = extractBackendEndpoints();

    expect(frontendEndpoints.size).toBeGreaterThan(25);
    expect(backendEndpoints.size).toBeGreaterThan(100);
  });
});
