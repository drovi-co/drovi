import { existsSync } from "node:fs";
import { syncEnvVars } from "@trigger.dev/build/extensions/core";
import { defineConfig } from "@trigger.dev/sdk";

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
    // Mark pino-pretty as external - it uses dynamic imports that don't bundle well
    external: ["pino-pretty"],
    extensions: [
      // Sync env vars from .env file if it exists (local dev only)
      // For production/staging, manage env vars in Trigger.dev dashboard
      syncEnvVars(async () => {
        const envVars: Record<string, string> = {};

        // Only load from .env if it exists (local dev)
        const envPath = ".env";
        if (existsSync(envPath)) {
          const dotenv = await import("dotenv");
          const result = dotenv.config({ path: envPath });

          if (result.parsed) {
            for (const [key, value] of Object.entries(result.parsed)) {
              if (value) {
                envVars[key] = value;
              }
            }
          }
        }

        return envVars;
      }),
    ],
  },
});
