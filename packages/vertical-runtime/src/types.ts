import type {
  ModuleManifestGate,
  ModuleResolutionInput,
} from "@memorystack/mod-kit";
import type { ReactNode } from "react";

export interface PluginManifestTypeSpec {
  type: string;
  title?: string | null;
  description?: string | null;
  high_stakes?: boolean;
}

export interface PluginManifestExtensionTypeSpec {
  type: string;
  schema_version?: string;
  typed_table?: string | null;
  description?: string | null;
}

export interface PluginManifestStorageRules {
  canonical_spine_table: string;
  extension_payload_table: string;
  typed_tables: Record<string, string>;
  notes?: string | null;
}

export interface PluginManifest {
  plugins: string[];
  uio_types: PluginManifestTypeSpec[];
  extension_types: PluginManifestExtensionTypeSpec[];
  capabilities: Record<string, boolean>;
  ui_hints: Record<string, unknown>;
  storage_rules: PluginManifestStorageRules;
  i18n_overrides?: Record<string, Record<string, string>>;
}

export interface VerticalManifestCache {
  etag?: string;
  manifest: PluginManifest;
  fetchedAt: number;
}

export interface VerticalRuntimeState {
  manifest: PluginManifest | null;
  moduleGates: Partial<Record<string, ModuleManifestGate>>;
  capabilities: Record<string, boolean>;
  isLoading: boolean;
  error: string | null;
  lastUpdatedAt: number | null;
}

export interface VerticalRuntimeContextValue extends VerticalRuntimeState {
  refresh: () => Promise<void>;
}

export interface VerticalRuntimeProviderProps {
  orgId: string;
  baseUrl?: string;
  getHeaders?: () => HeadersInit | Promise<HeadersInit>;
  refreshIntervalMs?: number;
  initialManifest?: PluginManifest;
  children: ReactNode;
}

export type ModuleResolutionInputForVertical = Omit<
  ModuleResolutionInput,
  "manifestGates" | "enabledCapabilities"
>;
