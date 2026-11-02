import { defineConfig } from "vite";

export default defineConfig({
  server: {
    host: "0.0.0.0",
    port: 5173,
    strictPort: true,
    proxy: {
      "/api": { target: "http://localhost:3000", changeOrigin: true, secure: false }
    }
  },
  preview: { host: "0.0.0.0", port: 4173, strictPort: true },
  build: {
    target: "es2022",
    sourcemap: false,
    rollupOptions: {
      input: { app: "index.html", sw: "src/sw.ts" },
      output: { entryFileNames: (chunk) => chunk.name === "sw" ? "sw.js" : "assets/[name]-[hash].js" }
    }
  }
});
