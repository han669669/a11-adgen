import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * The finish scripts that the Worker serves to an MCP client with no checkout (issue 147; worker/finishkit.ts). The web app
 * build writes them to dist/finish-kit.json (vite.config.ts), and the Worker bundle includes that file, as it does
 * dist/app-manifest.json. The tests read the same files (vitest.config.ts). The Worker runs none of them.
 */
export const FINISH_FILES = [
  "headline.py",
  "photo_finish.py",
  "product_lock.py",
  "pack_check.py",
  "cap_check.py",
  "box_print.py",
  "food_grade.py",
  "requirements.txt",
] as const;

export const finishFiles = (root: string): Record<string, string> =>
  Object.fromEntries(FINISH_FILES.map((name) => [name, readFileSync(path.join(root, "scripts", name), "utf8")]));
