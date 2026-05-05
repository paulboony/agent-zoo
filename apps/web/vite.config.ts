import path from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { "@": path.resolve(__dirname, "src") },
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
