import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import { finishFiles } from "./finishkit.build";

// Worker tests are in tests/. Web app tests are next to their code in app/src, so `tsc -p app` checks them with the DOM types.
// The web app build has its own Vite config (vite.config.ts).
// "cloudflare:workers" exists only inside workerd: the OAuth library imports it, so tests use a small stand-in.
export default defineConfig({
  // The Worker imports the finish scripts that the web app build writes (dist/finish-kit.json): tests read the same scripts.
  plugins: [
    {
      name: "a11-finish-kit",
      enforce: "pre",
      resolveId(id) {
        if (id.endsWith("/dist/finish-kit.json")) return "\0a11-finish-kit";
      },
      load(id) {
        if (id === "\0a11-finish-kit") return `export default ${JSON.stringify(finishFiles(fileURLToPath(new URL(".", import.meta.url))))};`;
      },
    },
  ],
  test: {
    root: ".",
    include: ["tests/**/*.test.ts", "app/src/**/*.test.ts"],
    server: { deps: { inline: ["@cloudflare/workers-oauth-provider"] } },
  },
  resolve: {
    alias: {
      "cloudflare:workers": fileURLToPath(new URL("./tests/helpers/cloudflare-workers.ts", import.meta.url)),
      "@": fileURLToPath(new URL("./app/src", import.meta.url)),
      // The Worker imports the list of the web app build, which only a build writes. Tests use a fixed list.
      "../dist/app-manifest.json": fileURLToPath(new URL("./tests/fixtures/app-manifest.json", import.meta.url)),
    },
  },
});
