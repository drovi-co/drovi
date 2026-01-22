import { existsSync } from "node:fs";
import dotenv from "dotenv";
import { defineConfig } from "drizzle-kit";

// Only load .env file if it exists and don't override existing env vars (for CI)
const envPath = "../../apps/server/.env";
if (existsSync(envPath)) {
  dotenv.config({
    path: envPath,
    override: false, // Don't override env vars from CI
  });
}

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("DATABASE_URL environment variable is required");
}

export default defineConfig({
  schema: "./src/schema",
  out: "./src/migrations",
  dialect: "postgresql",
  dbCredentials: {
    url: databaseUrl,
  },
});
