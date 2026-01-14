import { defineConfig } from "@trigger.dev/sdk";
import { syncEnvVars } from "@trigger.dev/build/extensions/core";

export default defineConfig({
  project: "proj_zmpryelvppbqvzeghxbk",
  runtime: "node",
  logLevel: "log",
  maxDuration: 300, // 5 minutes default
  retries: {
    enabledInDev: true,
    default: {
      maxAttempts: 3,
      minTimeoutInMs: 1000,
      maxTimeoutInMs: 10_000,
      factor: 2,
      randomize: true,
    },
  },
  dirs: ["./src/trigger"],
  build: {
    external: [
      "@memorystack/db",
      "@memorystack/auth",
      "@memorystack/email",
      "@memorystack/env",
    ],
    extensions: [
      // Sync env vars from local .env file during build
      syncEnvVars(async () => {
        // Load from .env file for local dev
        const dotenv = await import("dotenv");
        const result = dotenv.config({ path: ".env" });
        const envVars: Record<string, string> = {};

        if (result.parsed) {
          for (const [key, value] of Object.entries(result.parsed)) {
            if (value) {
              envVars[key] = value;
            }
          }
        }

        return envVars;
      }),
    ],
  },
});
