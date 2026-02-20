import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

export const env = createEnv({
  clientPrefix: "VITE_",
  client: {
    VITE_SERVER_URL: z.url(),
    VITE_SENTRY_DSN: z.string().url().optional(),
    VITE_SENTRY_ENVIRONMENT: z.string().default("development"),

    // PostHog Analytics
    VITE_POSTHOG_KEY: z.string().optional(),
    VITE_POSTHOG_HOST: z.string().url().default("https://us.i.posthog.com"),
    VITE_ANALYTICS_ENABLED: z.coerce.boolean().default(true),

    // Datadog RUM
    VITE_DATADOG_SITE: z.string().default("datadoghq.eu"),
    VITE_DATADOG_RUM_APPLICATION_ID: z.string().optional(),
    VITE_DATADOG_RUM_CLIENT_TOKEN: z.string().optional(),
    VITE_DATADOG_RUM_SERVICE: z.string().default("drovi-web"),
    VITE_DATADOG_RUM_ENV: z.string().optional(),
    VITE_DATADOG_RUM_ENABLED: z.coerce.boolean().default(true),
    VITE_DATADOG_RUM_ENABLE_IN_DEV: z.coerce.boolean().default(false),
    VITE_APP_VERSION: z.string().optional(),
    VITE_GIT_SHA: z.string().optional(),
  },
  // `import.meta.env` is provided by Vite in the browser.
  // In Node-based test runners (Vitest), `import.meta.env` may not include all
  // stubbed variables, so we also merge `process.env` when available.
  runtimeEnv: {
    ...((import.meta as unknown as { env?: Record<string, string> }).env ?? {}),
    ...(typeof process !== "undefined"
      ? (process.env as Record<string, string>)
      : {}),
  },
  emptyStringAsUndefined: true,
});
