/**
 * DEPRECATED: tRPC Compatibility Layer
 *
 * This module provides backward compatibility for components still using tRPC.
 * The app is migrating to use the direct Python API client in @/lib/api.ts
 *
 * New code should use:
 * - import { api, orgAPI } from "@/lib/api" for API calls
 * - import { useAuthStore } from "@/lib/auth" for auth state
 */

import { QueryCache, QueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

// Create a shared query client for React Query
export const queryClient = new QueryClient({
  queryCache: new QueryCache({
    onError: (error, query) => {
      toast.error(error.message, {
        action: {
          label: "retry",
          onClick: query.invalidate,
        },
      });
    },
  }),
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000, // 5 minutes
      retry: 1,
    },
  },
});

// Stub tRPC client that logs deprecation warnings
const createStubHandler = (path: string) => {
  return new Proxy({}, {
    get: (_target, prop) => {
      const newPath = path ? `${path}.${String(prop)}` : String(prop);

      // Handle queryOptions and mutationOptions
      if (prop === "queryOptions") {
        return (params?: unknown) => {
          console.warn(
            `[DEPRECATED] tRPC call: trpc.${path}.queryOptions() - Please migrate to @/lib/api`,
            params
          );
          return {
            queryKey: [path, params],
            queryFn: async () => {
              console.warn(`[DEPRECATED] tRPC query executed: ${path}`);
              return null;
            },
            enabled: false,
          };
        };
      }

      if (prop === "mutationOptions") {
        return (callbacks?: { onSuccess?: () => void; onError?: (err: Error) => void }) => {
          console.warn(
            `[DEPRECATED] tRPC call: trpc.${path}.mutationOptions() - Please migrate to @/lib/api`
          );
          return {
            mutationFn: async () => {
              console.warn(`[DEPRECATED] tRPC mutation executed: ${path}`);
              throw new Error(`tRPC deprecated: ${path}. Please migrate to @/lib/api`);
            },
            onError: callbacks?.onError,
          };
        };
      }

      return createStubHandler(newPath);
    },
  });
};

export const trpcClient = createStubHandler("");
export const trpc = createStubHandler("");

/**
 * @deprecated Use @/lib/api instead
 */
export function useTRPC() {
  return trpc;
}
