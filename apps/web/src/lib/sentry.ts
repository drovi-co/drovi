import { env } from "@memorystack/env/web";
import * as Sentry from "@sentry/react";

let sentryInitialized = false;

/**
 * Initialize Sentry for error tracking in the browser
 */
export function initSentry() {
  if (sentryInitialized || !env.VITE_SENTRY_DSN) {
    return;
  }

  Sentry.init({
    dsn: env.VITE_SENTRY_DSN,
    environment: env.VITE_SENTRY_ENVIRONMENT,

    // Performance monitoring
    tracesSampleRate: env.VITE_SENTRY_ENVIRONMENT === "production" ? 0.1 : 1.0,

    // Session replay for debugging
    replaysSessionSampleRate: 0.1,
    replaysOnErrorSampleRate: 1.0,

    // Filter out sensitive data
    beforeSend(event) {
      // Remove sensitive URL parameters
      if (event.request?.url) {
        const url = new URL(event.request.url);
        url.searchParams.delete("token");
        url.searchParams.delete("code");
        url.searchParams.delete("state");
        event.request.url = url.toString();
      }
      return event;
    },

    // Ignore common non-actionable errors
    ignoreErrors: [
      // Browser extensions
      "top.GLOBALS",
      // Network errors
      "Network request failed",
      "Failed to fetch",
      "Load failed",
      // User navigation
      "ResizeObserver loop",
      // Third-party scripts
      "Script error.",
    ],

    // Integrations
    integrations: [
      Sentry.browserTracingIntegration(),
      Sentry.replayIntegration({
        maskAllText: true,
        blockAllMedia: true,
      }),
    ],
  });

  sentryInitialized = true;
}

/**
 * Capture an exception with Sentry
 */
export function captureException(
  error: Error,
  context?: Record<string, unknown>
) {
  if (!env.VITE_SENTRY_DSN) {
    console.error("Error (Sentry not configured):", error);
    return;
  }

  Sentry.captureException(error, {
    extra: context,
  });
}

/**
 * Capture a message with Sentry
 */
export function captureMessage(
  message: string,
  level: "info" | "warning" | "error" = "info",
  context?: Record<string, unknown>
) {
  if (!env.VITE_SENTRY_DSN) {
    console.log(`[${level}] ${message}`, context);
    return;
  }

  Sentry.captureMessage(message, {
    level,
    extra: context,
  });
}

/**
 * Set user context for Sentry
 */
export function setUser(
  user: { id: string; email?: string; name?: string } | null
) {
  if (!env.VITE_SENTRY_DSN) {
    return;
  }

  if (user) {
    Sentry.setUser({
      id: user.id,
      email: user.email,
      username: user.name,
    });
  } else {
    Sentry.setUser(null);
  }
}

/**
 * Add breadcrumb for debugging
 */
export function addBreadcrumb(breadcrumb: {
  category: string;
  message: string;
  level?: "debug" | "info" | "warning" | "error";
  data?: Record<string, unknown>;
}) {
  if (!env.VITE_SENTRY_DSN) {
    return;
  }

  Sentry.addBreadcrumb({
    ...breadcrumb,
    timestamp: Date.now() / 1000,
  });
}

/**
 * Set a tag for filtering in Sentry
 */
export function setTag(key: string, value: string) {
  if (!env.VITE_SENTRY_DSN) {
    return;
  }
  Sentry.setTag(key, value);
}

export { Sentry };
