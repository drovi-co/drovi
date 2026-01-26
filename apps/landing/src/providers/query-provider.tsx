"use client";

import { QueryClientProvider } from "@tanstack/react-query";

import { queryClient } from "@/lib/trpc";

// React 19 types conflict workaround
// biome-ignore lint/suspicious/noExplicitAny: React types version mismatch
export function QueryProvider({ children }: { children: any }) {
  return (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}
