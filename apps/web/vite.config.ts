import path from "node:path";
import tailwindcss from "@tailwindcss/vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [tailwindcss(), tanstackRouter({}), react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "@memorystack/api-types": path.resolve(
        __dirname,
        "../../packages/api-types/src"
      ),
      "@memorystack/api-client": path.resolve(
        __dirname,
        "../../packages/api-client/src"
      ),
      "@memorystack/api-react": path.resolve(
        __dirname,
        "../../packages/api-react/src"
      ),
      "@memorystack/core-hooks": path.resolve(
        __dirname,
        "../../packages/core-hooks/src"
      ),
      "@memorystack/core-shell": path.resolve(
        __dirname,
        "../../packages/core-shell/src"
      ),
      "@memorystack/ui-theme": path.resolve(
        __dirname,
        "../../packages/ui-theme/src"
      ),
      "@memorystack/ui-core": path.resolve(
        __dirname,
        "../../packages/ui-core/src"
      ),
      "@memorystack/i18n": path.resolve(
        __dirname,
        "../../packages/i18n/src/index.tsx"
      ),
    },
  },
  server: {
    port: 3001,
  },
  optimizeDeps: {
    include: ["react-resizable-panels"],
  },
  build: {
    commonjsOptions: {
      include: [/react-resizable-panels/, /node_modules/],
    },
  },
});
