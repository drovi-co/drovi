import path from "node:path";

export const sharedResolveAlias = {
  "@": path.resolve(__dirname, "./apps/web/src"),
  "@memorystack/db": path.resolve(__dirname, "./packages/db/src"),
  "@memorystack/api": path.resolve(__dirname, "./packages/api/src"),
  "@memorystack/auth": path.resolve(__dirname, "./packages/auth/src"),
  "@memorystack/env": path.resolve(__dirname, "./packages/env/src"),
  "@memorystack/i18n": path.resolve(__dirname, "./packages/i18n/src"),
};

export const sharedTestExclude = [
  "**/node_modules/**",
  "**/dist/**",
  "**/.turbo/**",
  "**/.bun/**",
  "**/.bun-cache/**",
  "**/.bun-tmp/**",
  "**/e2e/**",
  "**/perf/**",
];

export const sharedCoverageConfig = {
  provider: "v8",
  reporter: ["text", "json", "html"],
  exclude: [
    "node_modules/",
    "dist/",
    "**/*.d.ts",
    "**/*.config.{js,ts}",
    "**/index.ts",
  ],
} as const;
