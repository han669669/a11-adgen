import path from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// The web app. Built to dist/app; the Worker serves it from R2 (app/…), see docs/deploy.md.
export default defineConfig({
  root: "app",
  plugins: [react(), tailwindcss()],
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "app/src") } },
  build: { outDir: "../dist/app", emptyOutDir: true, assetsDir: "assets" },
  server: { proxy: { "/api": "http://localhost:8787", "/m": "http://localhost:8787" } },
});
