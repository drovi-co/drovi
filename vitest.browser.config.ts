import { defineConfig } from "vitest/config";

import {
  sharedCoverageConfig,
  sharedResolveAlias,
  sharedTestExclude,
} from "./vitest.shared";

export default defineConfig({
  test: {
    globals: true,
    environment: "jsdom",
    include: ["**/*.{test,spec}.{jsx,tsx}"],
    exclude: sharedTestExclude,
    coverage: sharedCoverageConfig,
    setupFiles: ["./vitest.setup.ts", "./vitest.browser.setup.ts"],
  },
  resolve: {
    alias: sharedResolveAlias,
  },
});
