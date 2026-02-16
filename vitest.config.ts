import nodeConfig from "./vitest.node.config";

// Backwards-compatible default config.
// The monorepo runs Node tests by default; browser tests run via `vitest.browser.config.ts`.
export default nodeConfig;
