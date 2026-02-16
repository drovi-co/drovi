import path from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@memorystack/imperium-api-types": path.resolve(
        __dirname,
        "../../packages/imperium-api-types/src"
      ),
      "@memorystack/imperium-design-tokens": path.resolve(
        __dirname,
        "../../packages/imperium-design-tokens/src"
      ),
    },
  },
  server: {
    port: 3010,
    proxy: {
      "/api": {
        target: "http://localhost:8010",
        changeOrigin: true,
      },
      "/health": {
        target: "http://localhost:8010",
        changeOrigin: true,
      },
    },
  },
});
