import path from "node:path";
import { defineConfig } from "vitest/config";

import {
  sharedCoverageConfig,
  sharedResolveAlias,
  sharedTestExclude,
} from "./vitest.shared";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["apps/admin/src/**/*.smoke.test.{ts,tsx}"],
    exclude: sharedTestExclude,
    coverage: sharedCoverageConfig,
    setupFiles: ["./vitest.setup.ts"],
  },
  resolve: {
    alias: {
      ...sharedResolveAlias,
      "@": path.resolve(__dirname, "./apps/admin/src"),
    },
  },
});
