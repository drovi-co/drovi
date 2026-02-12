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
import { initializeAdminAuth } from "@/lib/auth";

import "../index.css";

export interface RouterAppContext {
  queryClient: QueryClient;
}

export const Route = createRootRouteWithContext<RouterAppContext>()({
  component: RootComponent,
  head: () => ({
    meta: [
      { title: "Drovi Admin" },
      {
        name: "description",
        content:
          "Drovi Admin dashboard for operators. Live KPIs, connector health, jobs, and moderation.",
      },
    ],
  }),
});

function RootComponent() {
  useEffect(() => {
    initializeAdminAuth().catch(() => {
      // Best-effort. Admin routes will show auth errors via the store.
    });
  }, []);

  return (
    <>
      <HeadContent />
      <ThemeProvider
        attribute="class"
        defaultTheme="dark"
        disableTransitionOnChange
        storageKey="vite-ui-theme-admin"
      >
        <Outlet />
        <Toaster richColors />
      </ThemeProvider>
      {import.meta.env.DEV && <TanStackRouterDevtools position="bottom-left" />}
      {import.meta.env.DEV && (
        <ReactQueryDevtools buttonPosition="bottom-right" position="bottom" />
      )}
    </>
  );
}
