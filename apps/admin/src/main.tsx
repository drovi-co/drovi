import { ErrorBoundary, Loader } from "@memorystack/core-shell";
import { QueryClientProvider } from "@tanstack/react-query";
import { createRouter, RouterProvider } from "@tanstack/react-router";
import ReactDOM from "react-dom/client";
import { I18nProvider, normalizeLocale } from "./i18n";
import { queryClient } from "./lib/query-client";
import { initSentry } from "./lib/sentry";
import { routeTree } from "./route-tree";

// Initialize Sentry for error tracking
initSentry();

const INITIAL_LOCALE = normalizeLocale(
  typeof window === "undefined"
    ? "en"
    : window.localStorage.getItem("drovi.admin.locale") ||
        window.navigator.language
);

const router = createRouter({
  routeTree,
  defaultPreload: "intent",
  defaultPendingComponent: () => <Loader />,
  context: { queryClient },
  Wrap({ children }) {
    return (
      <ErrorBoundary>
        <I18nProvider
          initialLocale={INITIAL_LOCALE}
          onLocaleChange={(locale: string) => {
            try {
              window.localStorage.setItem("drovi.admin.locale", locale);
              document.documentElement.lang = locale;
            } catch {
              // Ignore storage failures.
            }
          }}
        >
          <QueryClientProvider client={queryClient}>
            {children}
          </QueryClientProvider>
        </I18nProvider>
      </ErrorBoundary>
    );
  },
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

const rootElement = document.getElementById("app");

if (!rootElement) {
  throw new Error("Root element not found");
}

if (!rootElement.innerHTML) {
  const root = ReactDOM.createRoot(rootElement);
  root.render(<RouterProvider router={router} />);
}
