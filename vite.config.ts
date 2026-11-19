import { createHash } from "node:crypto";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

/**
 * Writes dist/app-manifest.json: the SHA-256 of each file of the build, as "sha256-<base64>".
 * The Worker bundle includes it (wrangler.jsonc build.command), and the MCP tool app_publish takes only these files into R2 app/.
 */
function appManifest(): Plugin {
  let outDir = "";
  return {
    name: "a11-app-manifest",
    apply: "build",
    configResolved(config) {
      outDir = path.resolve(config.root, config.build.outDir);
    },
    writeBundle() {
      const files = readdirSync(outDir, { recursive: true, withFileTypes: true })
        .filter((f) => f.isFile())
        .map((f) => path.relative(outDir, path.join(f.parentPath, f.name)).split(path.sep).join("/"))
        .sort();
      const manifest = Object.fromEntries(files.map((f) => [f, `sha256-${createHash("sha256").update(readFileSync(path.join(outDir, f))).digest("base64")}`]));
      writeFileSync(path.join(outDir, "../app-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
    },
  };
}

// The web app. Built to dist/app; the Worker serves it from R2 (app/…), see docs/deploy.md.
export default defineConfig({
  root: "app",
  plugins: [react(), tailwindcss(), appManifest()],
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "app/src") } },
  build: { outDir: "../dist/app", emptyOutDir: true, assetsDir: "assets" },
  server: { proxy: { "/api": "http://localhost:8787", "/m": "http://localhost:8787" } },
});
