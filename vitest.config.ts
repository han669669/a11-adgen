import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Worker tests only; the web app has its own Vite config (vite.config.ts).
// "cloudflare:workers" exists only inside workerd: the OAuth library imports it, so tests use a small stand-in.
export default defineConfig({
  test: { root: ".", include: ["tests/**/*.test.ts"], server: { deps: { inline: ["@cloudflare/workers-oauth-provider"] } } },
  resolve: { alias: { "cloudflare:workers": fileURLToPath(new URL("./tests/helpers/cloudflare-workers.ts", import.meta.url)) } },
});
