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
    include: ["apps/landing/src/**/*.smoke.test.{ts,tsx}"],
    exclude: sharedTestExclude,
    coverage: sharedCoverageConfig,
    setupFiles: ["./vitest.setup.ts", "./vitest.browser.setup.ts"],
  },
  resolve: {
    alias: {
      ...sharedResolveAlias,
      "@": path.resolve(__dirname, "./apps/landing/src"),
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
    dedupe: ["react", "react-dom"],
  },
});
