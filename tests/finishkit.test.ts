import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { Env } from "../worker/env";
import worker from "../worker/index";
import { INSTRUCTIONS, TOOLS } from "../worker/mcp";
import { PROMPTS } from "../worker/prompts";
import { HOUSE_RULES } from "../worker/houserules";
import { FINISH_FILES } from "../finishkit.build";

/**
 * Issue 147: a client with only the MCP (Cursor) could not run the finish scripts and went looking for a repository.
 * finish_kit and GET /finish/<name> serve the scripts of this build, so no client needs a checkout.
 */

const BASE = "https://a11.example";
// MEDIA is empty: a path that the URL parser moves out of /finish/ (/finish/../x is /x) falls to the web app, which has no file.
const env = { PUBLIC_BASE_URL: BASE, MEDIA: { get: async () => null } } as unknown as Env;
const NAMES = ["headline.py", "photo_finish.py", "product_lock.py", "pack_check.py", "cap_check.py", "box_print.py", "food_grade.py", "requirements.txt"];
const repoFile = (name: string) => readFileSync(new URL(`../scripts/${name}`, import.meta.url));

const kit = async () => {
  const c = (await TOOLS.find((t) => t.name === "finish_kit")!.run(env, {})).content[0]!;
  return JSON.parse(c.type === "text" ? c.text : "{}") as {
    files: { name: string; path: string; url: string; sha256: string; bytes: number; use: string }[];
    setup: string;
    run: string;
    notes: string[];
  };
};
const get = (path: string, method = "GET") => worker.fetch(new Request(`${BASE}${path}`, { method }), env);

describe("finish_kit", () => {
  it("lists each finish script with its address on this server and the SHA-256 of the repo file", async () => {
    const k = await kit();
    expect(k.files.map((f) => f.name)).toEqual(NAMES);
    // The build writes the files that finishkit.build.ts lists: the same list.
    expect([...FINISH_FILES]).toEqual(NAMES);
    for (const f of k.files) {
      expect(f.url).toBe(`${BASE}/finish/${f.name}`);
      expect(f.sha256).toBe(createHash("sha256").update(repoFile(f.name)).digest("hex"));
      expect(f.bytes).toBe(repoFile(f.name).byteLength);
      expect(f.use.length).toBeGreaterThan(10);
    }
    // One script (a client may run each command in a new shell), downloads over HTTPS only into scripts/, as the recipe names
    // the files, and checks every file before pip runs, in a virtual environment of Python 3.12 or newer.
    const lines = k.setup.split("\n");
    expect(lines[0]).toBe("set -eu");
    for (const f of k.files) {
      expect(f.path).toBe(`scripts/${f.name}`);
      expect(lines).toContain(`curl -fsS --proto =https -o scripts/${f.name} ${f.url}`);
    }
    const at = (s: string) => lines.findIndex((l) => l.includes(s));
    const check = lines[at("-c -")]!;
    for (const f of k.files) expect(check).toContain(`'${f.sha256}  scripts/${f.name}'`);
    expect(at("-c -")).toBeLessThan(at("pip install"));
    expect(lines.slice(1, 3)).toEqual(["mkdir -p a11-finish/scripts", "cd a11-finish"]);
    // A Python counts only when it is 3.12 or newer and can make a virtual environment with pip.
    const pick = lines[at("sys.version_info < (3, 12)")]!;
    expect(pick).toContain('-m venv --clear .venv');
    expect(pick).toContain(".venv/bin/python -m pip --version");
    expect(at("sys.version_info < (3, 12)")).toBeLessThan(at(".venv/bin/python -m pip install -r scripts/requirements.txt"));
    expect(k.run).toContain(".venv/bin/python scripts/<name>");
    expect(k.notes.join(" ")).toContain("Never open, fetch or clone a git repository");
  });
  it("is free and takes no arguments", () => {
    const t = TOOLS.find((x) => x.name === "finish_kit")!;
    expect(t.description).toContain("Free.");
    expect(t.inputSchema).toEqual({ type: "object", properties: {}, additionalProperties: false });
  });
});

describe("the Python choice of the setup script", () => {
  // Devin Review, PR 148: run the choice line in bash with stand-in interpreters, so the fallback is tested, not only its text.
  const choose = async (works: string[]) => {
    const dir = mkdtempSync(path.join(tmpdir(), "a11-kit-"));
    const bin = path.join(dir, "bin");
    execFileSync("mkdir", ["-p", bin]);
    for (const name of ["python3.14", "python3.13", "python3.12", "python3"]) {
      // A working stand-in passes the version check and makes a .venv whose python answers; a broken one has no venv.
      const ok = works.includes(name);
      writeFileSync(
        path.join(bin, name),
        `#!/bin/sh\nif [ "$1" = "-c" ]; then exit 0; fi\nif [ "$1" = "-m" ] && [ "$2" = "venv" ]; then ${ok ? 'mkdir -p .venv/bin && printf "#!/bin/sh\\nexit 0\\n" > .venv/bin/python && chmod +x .venv/bin/python && exit 0' : "exit 1"}; fi\nexit 1\n`,
      );
      chmodSync(path.join(bin, name), 0o755);
    }
    const lines = (await kit()).setup.split("\n");
    const script = [lines.find((l) => l.startsWith('PY=""'))!, lines.find((l) => l.startsWith('[ -n "$PY" ]'))!, 'echo "$PY"'].join("\n");
    try {
      return execFileSync("bash", ["-c", script], { cwd: dir, env: { PATH: `${bin}:/usr/bin:/bin` }, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
    } catch (e) {
      return `failed: ${String((e as { stderr?: string }).stderr).trim()}`;
    }
  };
  it("skips a newer Python that cannot make a virtual environment", async () => {
    expect(await choose(["python3.13", "python3"])).toBe("python3.13");
    expect(await choose(["python3"])).toBe("python3");
  });
  it("stops with a clear message when no Python can", async () => {
    expect(await choose([])).toBe("failed: The finish kit needs Python 3.12 or newer with venv and pip (tested on 3.13).");
  });
});

describe("GET /finish/<name>", () => {
  it("serves each file byte for byte as plain text that a browser does not run", async () => {
    for (const name of NAMES) {
      const r = await get(`/finish/${name}`);
      expect(r.status).toBe(200);
      expect(Buffer.from(await r.arrayBuffer()).equals(repoFile(name))).toBe(true);
      expect(r.headers.get("content-type")).toBe("text/plain; charset=utf-8");
      expect(r.headers.get("x-content-type-options")).toBe("nosniff");
      expect(r.headers.get("content-security-policy")).toBe("default-src 'none'; sandbox");
    }
    const head = await get("/finish/headline.py", "HEAD");
    expect(head.status).toBe(200);
    expect(await head.text()).toBe("");
  });
  it("serves no other file and no other method", async () => {
    for (const path of ["/finish/test_scripts.py", "/finish/upload_app.sh", "/finish/../wrangler.jsonc", "/finish/%2e%2e/wrangler.jsonc", "/finish/", "/finish/HEADLINE.py", "/finish/constructor.py", "/finish/headline.py/x"]) {
      expect((await get(path)).status, path).toBe(404);
    }
    expect((await get("/finish/headline.py", "POST")).status).toBe(404);
    expect((await get("/finish/headline.py", "PUT")).status).toBe(404);
  });
});

describe("server text", () => {
  it("names finish_kit and sends no client to look for a repository", () => {
    const prompts = PROMPTS.map((p) => p.text({ brand: "b", batchId: "x", url: "https://e.example", slug: "b", note: "n", reportDate: "2026-11-21", adImageUrls: "https://e.example/a.png", title: "t", label: "W47" }));
    for (const t of [INSTRUCTIONS, ...prompts]) {
      expect(t).not.toMatch(/in the a11-adgen repo\b|the repo has|Read the repo's/);
    }
    expect(INSTRUCTIONS).toContain("finish_kit");
    expect(INSTRUCTIONS).toContain("Never open, fetch or clone a repository");
    for (const t of prompts) expect(t).toContain("call finish_kit");
    expect(HOUSE_RULES).toContain("Never open, fetch or clone a git repository for it.");
  });
});
