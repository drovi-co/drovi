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

export interface PluginManifest {
  plugins: string[];
  uio_types: PluginManifestTypeSpec[];
  capabilities: Record<string, boolean>;
  ui_hints: Record<string, unknown>;
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
