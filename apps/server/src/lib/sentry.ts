import { env } from "@memorystack/env/server";
import {
  httpIntegration,
  init,
  nativeNodeFetchIntegration,
  addBreadcrumb as sentryAddBreadcrumb,
  captureException as sentryCaptureException,
  captureMessage as sentryCaptureMessage,
  setUser as sentrySetUser,
  startInactiveSpan,
} from "@sentry/node";
import { log } from "./logger";

let sentryInitialized = false;

/**
 * Initialize Sentry for error tracking
 */
export function initSentry() {
  if (sentryInitialized || !env.SENTRY_DSN) {
    return;
  }

  init({
    dsn: env.SENTRY_DSN,
    environment: env.SENTRY_ENVIRONMENT,

    // Performance monitoring
    tracesSampleRate: env.NODE_ENV === "production" ? 0.1 : 1.0,

    // Set sampling rate for profiling
    profilesSampleRate: env.NODE_ENV === "production" ? 0.1 : 1.0,

    // Filter out sensitive data
    beforeSend(event) {
      // Remove sensitive headers using object destructuring (more performant than delete)
      if (event.request?.headers) {
        const { authorization, cookie, ...safeHeaders } = event.request.headers;
        event.request.headers = safeHeaders;
      }
      return event;
    },

    // Ignore certain errors
    ignoreErrors: [
      // Ignore common non-actionable errors
      "UNAUTHORIZED",
      "NOT_FOUND",
      "BAD_REQUEST",
    ],

    // Integrations
    integrations: [
      // Add Node.js specific integrations
      httpIntegration(),
      nativeNodeFetchIntegration(),
    ],
  });

  sentryInitialized = true;
  log.info("Sentry initialized for error tracking");
}

/**
 * Capture an exception with Sentry
 */
export function captureException(
  error: Error,
  context?: Record<string, unknown>
) {
  if (!env.SENTRY_DSN) {
    log.error("Error (Sentry not configured)", error);
    return;
  }

  sentryCaptureException(error, {
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
  if (!env.SENTRY_DSN) {
    log[level === "warning" ? "warn" : level](message, context);
    return;
  }

  sentryCaptureMessage(message, {
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
  if (!env.SENTRY_DSN) {
    return;
  }

  if (user) {
    sentrySetUser({
      id: user.id,
      email: user.email,
      username: user.name,
    });
  } else {
    sentrySetUser(null);
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
  if (!env.SENTRY_DSN) {
    return;
  }

  sentryAddBreadcrumb({
    ...breadcrumb,
    timestamp: Date.now() / 1000,
  });
}

/**
 * Start a transaction for performance monitoring
 */
export function startTransaction(name: string, op: string) {
  if (!env.SENTRY_DSN) {
    return null;
  }

  return startInactiveSpan({
    name,
    op,
  });
}
