import { ThemeProvider } from "@memorystack/core-shell";
import { Toaster } from "@memorystack/ui-core/sonner";
import type { QueryClient } from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import {
  createRootRouteWithContext,
  HeadContent,
  Outlet,
} from "@tanstack/react-router";
import { TanStackRouterDevtools } from "@tanstack/react-router-devtools";
import { useEffect } from "react";
import { AutoUpdaterDialog } from "@/components/desktop/auto-updater";
import { IntentBar } from "@/components/intent-bar/intent-bar";
import { SupportModal } from "@/components/support/support-modal";
import { initializeAuth } from "@/lib/auth";
import { useRoutePerformanceInstrumentation } from "@/lib/route-performance";
import { WebRuntimeProvider } from "@/modules/runtime-provider";

import "../index.css";

export interface RouterAppContext {
  queryClient: QueryClient;
}

export const Route = createRootRouteWithContext<RouterAppContext>()({
  component: RootComponent,
  head: () => ({
    meta: [
      {
        title: "Drovi - Institutional Memory Infrastructure",
      },
      {
        name: "description",
        content:
          "Drovi preserves institutional memory with evidence-backed records. Track commitments, decisions, and continuity with auditable precision.",
      },
    ],
    links: [
      {
        rel: "icon",
        href: "/favicon.ico",
      },
    ],
  }),
});

function RootComponent() {
  // Hydrate auth state from cookie / session token once for the whole app.
  // This prevents pages that rely on `useAuthStore()` from getting stuck in
  // "not authenticated" / "loading" states after a reload.
  useEffect(() => {
    initializeAuth().catch(() => undefined);
  }, []);
  useRoutePerformanceInstrumentation();

  return (
    <>
      <HeadContent />
      <ThemeProvider
        attribute="class"
        defaultTheme="dark"
        forcedTheme="dark"
        disableTransitionOnChange
        storageKey="vite-ui-theme"
      >
        <WebRuntimeProvider>
          <Outlet />
          <IntentBar />
          <SupportModal />
          <Toaster richColors />
          <AutoUpdaterDialog />
        </WebRuntimeProvider>
      </ThemeProvider>
      {import.meta.env.DEV && <TanStackRouterDevtools position="bottom-left" />}
      {import.meta.env.DEV && (
        <ReactQueryDevtools buttonPosition="bottom-right" position="bottom" />
      )}
    </>
  );
}
