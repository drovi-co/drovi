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
  },
  runtimeEnv: (import.meta as unknown as { env: Record<string, string> }).env,
  emptyStringAsUndefined: true,
});
