import { defineConfig } from "vite";

const apiTarget = process.env.VIVARQO_API_TARGET ?? "http://127.0.0.1:3000";

export default defineConfig({
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
    proxy: {
      "/api": { target: apiTarget, changeOrigin: false },
      "/healthz": { target: apiTarget, changeOrigin: false },
      "/readyz": { target: apiTarget, changeOrigin: false }
    }
  }
});
