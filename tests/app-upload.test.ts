import { execFile, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Env } from "../worker/env";
import worker from "../worker/index";

// scripts/upload_app.sh and scripts/rollback_app.sh, run for real against the Worker code on a local port.
const TOKEN = "app-upload-token-1234";
const OLD_PAGE = '<script src="/assets/index-OLD.js"></script><link href="/assets/index-OLD.css">';
const NEW_PAGE = '<script src="/assets/index-NEW.js"></script><link href="/assets/index-NEW.css">';

const hasTools = ["bash", "curl"].every((tool) => {
  try {
    execFileSync(tool, ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
});

describe.skipIf(!hasTools)("web app upload and rollback scripts", () => {
  const files = new Map<string, Uint8Array>();
  const puts: string[] = [];
  const env = {
    MEDIA: {
      get: async (key: string) => (files.has(key) ? { body: files.get(key) } : null),
      put: async (key: string, body: ArrayBuffer) => {
        puts.push(key);
        files.set(key, new Uint8Array(body));
      },
    },
    MCP_TOKEN_SHA256: createHash("sha256").update(TOKEN).digest("hex"),
  } as unknown as Env;
  const text = (key: string) => new TextDecoder().decode(files.get(key));

  let server: Server;
  let base = "";
  const dist = mkdtempSync(join(tmpdir(), "a11-dist-"));
  const rollback = mkdtempSync(join(tmpdir(), "a11-rollback-"));

  beforeAll(async () => {
    mkdirSync(join(dist, "assets"));
    writeFileSync(join(dist, "index.html"), NEW_PAGE);
    writeFileSync(join(dist, "assets/index-NEW.js"), "new js");
    writeFileSync(join(dist, "assets/index-NEW.css"), "new css");
    for (const [key, body] of [["app/index.html", OLD_PAGE], ["app/assets/index-OLD.js", "old js"], ["app/assets/index-OLD.css", "old css"]] as const) {
      files.set(key, new TextEncoder().encode(body));
    }
    server = createServer(async (req, res) => {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(chunk as Buffer);
      const response = await worker.fetch(
        new Request(`http://${req.headers.host}${req.url}`, {
          method: req.method,
          headers: req.headers as Record<string, string>,
          body: chunks.length ? Buffer.concat(chunks) : undefined,
        }),
        env,
      );
      res.writeHead(response.status, Object.fromEntries(response.headers));
      res.end(Buffer.from(await response.arrayBuffer()));
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => void server.close());

  // Async on purpose: the Worker answers from this process, so a blocking call would never get a reply.
  const run = (script: string, vars: Record<string, string>) =>
    new Promise<{ code: number; out: string }>((resolve) => {
      const env = { ...process.env, BASE: base, DIST: dist, ROLLBACK: rollback, A11_ADMIN_TOKEN: TOKEN, ...vars };
      execFile("bash", [`scripts/${script}`], { env }, (error, stdout, stderr) =>
        resolve({ code: error ? Number(error.code) : 0, out: stdout + stderr }),
      );
    });

  it("stops on a wrong token before any upload", async () => {
    const r = await run("upload_app.sh", { A11_ADMIN_TOKEN: "wrong-token" });
    expect(r.code).toBe(1);
    expect(r.out).toContain("Token check: HTTP 401");
    expect(r.out).not.toContain("wrong-token");
    expect(puts).toEqual([]);
  });

  it("does all checks but uploads nothing on a dry run", async () => {
    const r = await run("upload_app.sh", { DRY_RUN: "1" });
    expect(r.code, r.out).toBe(0);
    expect(r.out).toContain("Token check: 400");
    expect(readFileSync(join(rollback, "index.html"), "utf8")).toBe(OLD_PAGE);
    expect(puts).toEqual([]);
  });

  it("refuses a build whose page names a missing file, before any request", async () => {
    const broken = mkdtempSync(join(tmpdir(), "a11-broken-"));
    writeFileSync(join(broken, "index.html"), NEW_PAGE);
    const r = await run("upload_app.sh", { DIST: broken });
    expect(r.code).toBe(1);
    expect(r.out).toContain("not in the build: assets/index-NEW.css");
    expect(puts).toEqual([]);
  });

  it("uploads index.html last and proves the live page, then rolls back to the saved page", async () => {
    const up = await run("upload_app.sh", {});
    expect(up.code, up.out).toBe(0);
    expect(puts).toEqual(["app/assets/index-NEW.css", "app/assets/index-NEW.js", "app/index.html"]);
    expect(text("app/index.html")).toBe(NEW_PAGE);
    expect(up.out).toContain("Live page now names: assets/index-NEW.css assets/index-NEW.js");
    expect(up.out).toContain(`To roll back: BASE=${base} ROLLBACK=${rollback} scripts/rollback_app.sh`);
    expect(up.out).not.toContain(TOKEN);

    const back = await run("rollback_app.sh", {});
    expect(back.code, back.out).toBe(0);
    expect(puts.at(-1)).toBe("app/index.html");
    expect(text("app/index.html")).toBe(OLD_PAGE);
    expect(back.out).not.toContain(TOKEN);
  });
});
