import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";

const API = process.env.SAYIT_API ?? "http://127.0.0.1:8787";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { "@": path.resolve(__dirname, "src") },
  },
  server: {
    port: 5173,
    proxy: {
      "/v1": { target: API, changeOrigin: false },
      "/health": { target: API, changeOrigin: false },
      "/ready": { target: API, changeOrigin: false },
    },
  },
});
