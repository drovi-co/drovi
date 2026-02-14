import path from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [tailwindcss(), react()],
  resolve: {
    alias: {
      "@memorystack/mod-ask": path.resolve(
        __dirname,
        "../../packages/mod-ask/src"
      ),
      "@memorystack/mod-auth": path.resolve(
        __dirname,
        "../../packages/mod-auth/src"
      ),
      "@memorystack/mod-console": path.resolve(
        __dirname,
        "../../packages/mod-console/src"
      ),
      "@memorystack/mod-continuums": path.resolve(
        __dirname,
        "../../packages/mod-continuums/src"
      ),
      "@memorystack/mod-drive": path.resolve(
        __dirname,
        "../../packages/mod-drive/src"
      ),
      "@memorystack/mod-evidence": path.resolve(
        __dirname,
        "../../packages/mod-evidence/src"
      ),
      "@memorystack/mod-kit": path.resolve(
        __dirname,
        "../../packages/mod-kit/src"
      ),
      "@memorystack/mod-onboarding": path.resolve(
        __dirname,
        "../../packages/mod-onboarding/src"
      ),
      "@memorystack/mod-sources": path.resolve(
        __dirname,
        "../../packages/mod-sources/src"
      ),
      "@memorystack/mod-teams": path.resolve(
        __dirname,
        "../../packages/mod-teams/src"
      ),
      "@memorystack/vertical-runtime": path.resolve(
        __dirname,
        "../../packages/vertical-runtime/src"
      ),
      "@memorystack/ui-theme": path.resolve(
        __dirname,
        "../../packages/ui-theme/src"
      ),
    },
  },
  server: {
    proxy: {
      "/api": {
        target: "http://localhost:8000",
        changeOrigin: true,
      },
    },
  },
});
