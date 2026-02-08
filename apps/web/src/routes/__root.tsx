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
import { ThemeProvider } from "@/components/theme-provider";
import { Toaster } from "@/components/ui/sonner";
import type { QueryClient } from "@tanstack/react-query";
import { initializeAuth } from "@/lib/auth";

import "../index.css";

export interface RouterAppContext {
  queryClient: QueryClient;
}

export const Route = createRootRouteWithContext<RouterAppContext>()({
  component: RootComponent,
  head: () => ({
    meta: [
      {
        title: "Drovi - AI Email Intelligence Platform",
      },
      {
        name: "description",
        content:
          "Drovi transforms your inbox into an intelligent memory system. Never forget commitments, track decisions, and get AI-powered insights from your email history.",
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
    void initializeAuth();
  }, []);

  return (
    <>
      <HeadContent />
      <ThemeProvider
        attribute="class"
        defaultTheme="dark"
        disableTransitionOnChange
        storageKey="vite-ui-theme"
      >
        <Outlet />
        <IntentBar />
        <SupportModal />
        <Toaster richColors />
        <AutoUpdaterDialog />
      </ThemeProvider>
      {import.meta.env.DEV && <TanStackRouterDevtools position="bottom-left" />}
      {import.meta.env.DEV && (
        <ReactQueryDevtools buttonPosition="bottom-right" position="bottom" />
      )}
    </>
  );
}
