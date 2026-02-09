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
      "@memorystack/i18n": path.resolve(__dirname, "../../packages/i18n/src/index.tsx"),
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
