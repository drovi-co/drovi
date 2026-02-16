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
    include: ["**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts}"],
    exclude: sharedTestExclude,
    coverage: sharedCoverageConfig,
    setupFiles: ["./vitest.setup.ts"],
  },
  resolve: {
    alias: sharedResolveAlias,
  },
});
