import path from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { "@": path.resolve(__dirname, "src") },
  },
  // Pre-bundle recharts at server start. It's a large, deep dependency
  // graph; without this, Vite optimizes it lazily on the first dashboard
  // load, which briefly 504s in-flight module requests and blanks the
  // page until a reload. Pre-bundling makes first paint deterministic.
  optimizeDeps: {
    include: ["recharts"],
  },
  server: {
    port: 5173,
    proxy: {
      "/api": "http://localhost:7777",
      "/hook": "http://localhost:7777",
      "/stream": {
        target: "http://localhost:7777",
        ws: false,
        changeOrigin: true,
      },
    },
  },
});
