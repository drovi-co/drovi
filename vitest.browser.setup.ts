import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// Ensure React Testing Library state is reset between tests.
afterEach(() => {
  cleanup();
});

// Some UI libraries rely on browser-only globals; provide safe defaults for jsdom.
if (typeof globalThis.ResizeObserver === "undefined") {
  globalThis.ResizeObserver = class ResizeObserver {
    observe() {
      // No-op. jsdom does not implement layout, but some components require the global.
    }
    unobserve() {
      // No-op.
    }
    disconnect() {
      // No-op.
    }
  };
}
