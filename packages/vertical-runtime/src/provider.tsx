import type { ResolvedDroviModule } from "@memorystack/mod-kit";
import { resolveModules } from "@memorystack/mod-kit";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  fetchManifest,
  moduleGatesFromManifest,
  readManifestCache,
} from "./manifest-client";
import type {
  ModuleResolutionInputForVertical,
  VerticalRuntimeContextValue,
  VerticalRuntimeProviderProps,
} from "./types";

const VerticalRuntimeContext =
  createContext<VerticalRuntimeContextValue | null>(null);

function stableCapabilities(
  input: Record<string, boolean> | undefined
): Record<string, boolean> {
  return input ? { ...input } : {};
}

export function VerticalRuntimeProvider({
  orgId,
  baseUrl,
  getHeaders,
  refreshIntervalMs = 60_000,
  initialManifest,
  children,
}: VerticalRuntimeProviderProps) {
  const cachedRef = useRef(readManifestCache(orgId));
  const [manifest, setManifest] = useState(
    initialManifest ?? cachedRef.current?.manifest ?? null
  );
  const [etag, setEtag] = useState<string | undefined>(cachedRef.current?.etag);
  const [isLoading, setIsLoading] = useState(!manifest);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<number | null>(
    cachedRef.current?.fetchedAt ?? null
  );

  const refresh = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);
      const headers = getHeaders ? await getHeaders() : undefined;
      const result = await fetchManifest({
        orgId,
        baseUrl,
        etag,
        headers,
      });
      setManifest(result.manifest);
      setEtag(result.etag);
      setLastUpdatedAt(Date.now());
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Failed to refresh vertical manifest"
      );
    } finally {
      setIsLoading(false);
    }
  }, [orgId, baseUrl, etag, getHeaders]);

  useEffect(() => {
    refresh().catch(() => {
      // Error state is handled inside refresh.
    });
  }, [refresh]);

  useEffect(() => {
    if (refreshIntervalMs <= 0) {
      return;
    }
    const timer = window.setInterval(() => {
      refresh().catch(() => {
        // Error state is handled inside refresh.
      });
    }, refreshIntervalMs);
    return () => window.clearInterval(timer);
  }, [refresh, refreshIntervalMs]);

  const value = useMemo<VerticalRuntimeContextValue>(() => {
    const moduleGates = manifest ? moduleGatesFromManifest(manifest) : {};
    const capabilities = stableCapabilities(manifest?.capabilities);
    return {
      manifest,
      moduleGates,
      capabilities,
      isLoading,
      error,
      lastUpdatedAt,
      refresh,
    };
  }, [manifest, isLoading, error, lastUpdatedAt]);

  return (
    <VerticalRuntimeContext.Provider value={value}>
      {children}
    </VerticalRuntimeContext.Provider>
  );
}

export function useVertical(): VerticalRuntimeContextValue {
  const value = useContext(VerticalRuntimeContext);
  if (!value) {
    throw new Error(
      "useVertical must be used within a VerticalRuntimeProvider"
    );
  }
  return value;
}

export function resolveModulesForVertical(
  input: ModuleResolutionInputForVertical,
  runtime: Pick<VerticalRuntimeContextValue, "moduleGates" | "capabilities">
): ResolvedDroviModule[] {
  return resolveModules({
    ...input,
    manifestGates: runtime.moduleGates,
    enabledCapabilities: runtime.capabilities,
  });
}
