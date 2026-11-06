import { defineConfig } from "vitest/config";

// Worker tests only; the web app has its own Vite config (vite.config.ts).
export default defineConfig({ test: { root: ".", include: ["tests/**/*.test.ts"] } });
