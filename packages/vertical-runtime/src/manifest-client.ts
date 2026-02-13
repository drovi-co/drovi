import type { ModuleManifestGate } from "@memorystack/mod-kit";
import type { PluginManifest, VerticalManifestCache } from "./types";

const CACHE_VERSION = 1;
const DEFAULT_PATH = "/api/v1/org/manifest";

function cacheKey(orgId: string): string {
  return `drovi.vertical.manifest.v${CACHE_VERSION}:${orgId}`;
}

export function readManifestCache(orgId: string): VerticalManifestCache | null {
  if (typeof window === "undefined") {
    return null;
  }
  const raw = window.localStorage.getItem(cacheKey(orgId));
  if (!raw) {
    return null;
  }
  try {
    return JSON.parse(raw) as VerticalManifestCache;
  } catch {
    return null;
  }
}

export function writeManifestCache(
  orgId: string,
  cache: VerticalManifestCache
): void {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.setItem(cacheKey(orgId), JSON.stringify(cache));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function parseModuleGates(
  raw: unknown
): Partial<Record<string, ModuleManifestGate>> {
  if (!isRecord(raw)) {
    return {};
  }

  const result: Partial<Record<string, ModuleManifestGate>> = {};
  for (const [moduleId, gateValue] of Object.entries(raw)) {
    if (!isRecord(gateValue)) {
      continue;
    }

    const capabilities = isRecord(gateValue.capabilities)
      ? Object.fromEntries(
          Object.entries(gateValue.capabilities).filter(
            (entry): entry is [string, boolean] => typeof entry[1] === "boolean"
          )
        )
      : undefined;

    result[moduleId] = {
      enabled:
        typeof gateValue.enabled === "boolean" ? gateValue.enabled : undefined,
      capabilities,
      disabledRoutes: Array.isArray(gateValue.disabledRoutes)
        ? gateValue.disabledRoutes.filter(
            (value): value is string => typeof value === "string"
          )
        : undefined,
      disabledNavItems: Array.isArray(gateValue.disabledNavItems)
        ? gateValue.disabledNavItems.filter(
            (value): value is string => typeof value === "string"
          )
        : undefined,
      disabledCommands: Array.isArray(gateValue.disabledCommands)
        ? gateValue.disabledCommands.filter(
            (value): value is string => typeof value === "string"
          )
        : undefined,
    };
  }

  return result;
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

function parseI18nOverrides(
  raw: unknown
): Record<string, Record<string, string>> {
  if (!isRecord(raw)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(raw).map(([namespace, messages]) => [
      namespace,
      parseStringMap(messages),
    ])
  );
}

function parseStorageRules(raw: unknown): {
  canonical_spine_table: string;
  extension_payload_table: string;
  typed_tables: Record<string, string>;
  notes?: string | null;
} {
  if (!isRecord(raw)) {
    return {
      canonical_spine_table: "unified_intelligence_object",
      extension_payload_table: "uio_extension_payload",
      typed_tables: {},
    };
  }

  const typedTables = isRecord(raw.typed_tables)
    ? Object.fromEntries(
        Object.entries(raw.typed_tables).filter(
          (entry): entry is [string, string] => typeof entry[1] === "string"
        )
      )
    : {};

  return {
    canonical_spine_table:
      typeof raw.canonical_spine_table === "string"
        ? raw.canonical_spine_table
        : "unified_intelligence_object",
    extension_payload_table:
      typeof raw.extension_payload_table === "string"
        ? raw.extension_payload_table
        : "uio_extension_payload",
    typed_tables: typedTables,
    notes: typeof raw.notes === "string" ? raw.notes : undefined,
  };
}

function parseManifest(payload: unknown): PluginManifest {
  if (!isRecord(payload)) {
    throw new Error("Invalid plugin manifest payload");
  }

  const plugins = Array.isArray(payload.plugins)
    ? payload.plugins.filter(
        (plugin): plugin is string => typeof plugin === "string"
      )
    : [];

  const uioTypes = Array.isArray(payload.uio_types)
    ? payload.uio_types
        .filter(isRecord)
        .map((item) => ({
          type: typeof item.type === "string" ? item.type : "",
          title: typeof item.title === "string" ? item.title : null,
          description:
            typeof item.description === "string" ? item.description : null,
          high_stakes:
            typeof item.high_stakes === "boolean" ? item.high_stakes : false,
        }))
        .filter((item) => item.type.length > 0)
    : [];

  const capabilities = isRecord(payload.capabilities)
    ? Object.fromEntries(
        Object.entries(payload.capabilities).filter(
          (entry): entry is [string, boolean] => typeof entry[1] === "boolean"
        )
      )
    : {};

  const uiHints = isRecord(payload.ui_hints) ? payload.ui_hints : {};
  const extensionTypes = Array.isArray(payload.extension_types)
    ? payload.extension_types
        .filter(isRecord)
        .map((item) => ({
          type: typeof item.type === "string" ? item.type : "",
          schema_version:
            typeof item.schema_version === "string"
              ? item.schema_version
              : "1.0",
          typed_table:
            typeof item.typed_table === "string" ? item.typed_table : null,
          description:
            typeof item.description === "string" ? item.description : null,
        }))
        .filter((item) => item.type.length > 0)
    : [];
  const storageRules = parseStorageRules(payload.storage_rules);
  const i18nOverrides = parseI18nOverrides(
    payload.i18n_overrides ?? uiHints.i18n_overrides
  );

  return {
    plugins,
    uio_types: uioTypes,
    extension_types: extensionTypes,
    capabilities,
    ui_hints: uiHints,
    storage_rules: storageRules,
    i18n_overrides: i18nOverrides,
  };
}

export interface FetchManifestOptions {
  orgId: string;
  baseUrl?: string;
  etag?: string;
  headers?: HeadersInit;
}

export interface FetchManifestResult {
  manifest: PluginManifest;
  etag?: string;
  notModified: boolean;
}

export async function fetchManifest({
  orgId,
  baseUrl,
  etag,
  headers,
}: FetchManifestOptions): Promise<FetchManifestResult> {
  const target = `${baseUrl ?? ""}${DEFAULT_PATH}`;
  const requestHeaders = new Headers(headers);
  if (etag) {
    requestHeaders.set("If-None-Match", etag);
  }

  const response = await fetch(target, {
    method: "GET",
    credentials: "include",
    headers: requestHeaders,
  });

  if (response.status === 304) {
    const cached = readManifestCache(orgId);
    if (cached) {
      return {
        manifest: cached.manifest,
        etag: cached.etag,
        notModified: true,
      };
    }
    throw new Error("Manifest returned 304 but no cache entry exists");
  }

  if (!response.ok) {
    throw new Error(`Failed to fetch plugin manifest (${response.status})`);
  }

  const payload = await response.json();
  const manifest = parseManifest(payload);
  const nextEtag = response.headers.get("ETag") ?? undefined;

  writeManifestCache(orgId, {
    etag: nextEtag,
    manifest,
    fetchedAt: Date.now(),
  });

  return {
    manifest,
    etag: nextEtag,
    notModified: false,
  };
}

export function moduleGatesFromManifest(
  manifest: PluginManifest
): Partial<Record<string, ModuleManifestGate>> {
  const maybeModules = manifest.ui_hints.modules;
  return parseModuleGates(maybeModules);
}
