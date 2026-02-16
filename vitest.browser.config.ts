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
    environment: "jsdom",
    include: ["**/*.{test,spec}.{jsx,tsx}"],
    exclude: sharedTestExclude,
    coverage: sharedCoverageConfig,
    setupFiles: ["./vitest.setup.ts", "./vitest.browser.setup.ts"],
  },
  resolve: {
    alias: {
      ...sharedResolveAlias,
      // Force a single React runtime pair for browser tests.
      react: path.resolve(__dirname, "./apps/web/node_modules/react"),
      "react-dom": path.resolve(__dirname, "./apps/web/node_modules/react-dom"),
      "react/jsx-runtime": path.resolve(
        __dirname,
        "./apps/web/node_modules/react/jsx-runtime.js"
      ),
      "react/jsx-dev-runtime": path.resolve(
        __dirname,
        "./apps/web/node_modules/react/jsx-dev-runtime.js"
      ),
      "@testing-library/react": path.resolve(
        __dirname,
        "./apps/web/node_modules/@testing-library/react"
      ),
    },
    // Bun can install multiple react-dom variants with different peer resolutions.
    // Dedupe ensures browser tests use a single React runtime pair.
    dedupe: ["react", "react-dom"],
  },
});
