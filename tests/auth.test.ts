import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { Env } from "../worker/env";
import worker from "../worker/index";

const TOKEN = "test-token-1234";
const env = { MCP_TOKEN_SHA256: createHash("sha256").update(TOKEN).digest("hex") } as Env;
const list = (auth?: string) =>
  worker.fetch(
    new Request("https://x/mcp", {
      method: "POST",
      headers: auth ? { Authorization: auth } : {},
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    }),
    env,
  );

describe("/mcp bearer gate", () => {
  it("refuses a missing token", async () => expect((await list()).status).toBe(401));
  it("refuses a wrong token", async () => expect((await list("Bearer nope")).status).toBe(401));
  it("accepts the right token", async () => expect((await list(`Bearer ${TOKEN}`)).status).toBe(200));
  it("refuses everything when the hash is not set", async () => {
    const r = await worker.fetch(new Request("https://x/mcp", { method: "POST", headers: { Authorization: `Bearer ${TOKEN}` } }), {} as Env);
    expect(r.status).toBe(401);
  });
});

describe("/m/ media route", () => {
  const key = "renders/00000000-0000-4000-8000-000000000000/1.jpg";
  const obj = { size: 3, httpMetadata: { contentType: "image/jpeg" }, body: new Blob([new Uint8Array([1, 2, 3])]).stream() };
  const media = {
    MEDIA: { get: async (k: string) => (k === key ? obj : null), head: async (k: string) => (k === key ? { size: 3, httpMetadata: obj.httpMetadata } : null) },
  } as unknown as Env;
  it("answers HEAD with 200 and no body (fal checks references with HEAD)", async () => {
    const r = await worker.fetch(new Request(`https://x/m/${key}`, { method: "HEAD" }), media);
    expect(r.status).toBe(200);
    expect(r.headers.get("content-length")).toBe("3");
  });
  it("answers GET with the image", async () => {
    const r = await worker.fetch(new Request(`https://x/m/${key}`), media);
    expect(r.status).toBe(200);
    expect((await r.arrayBuffer()).byteLength).toBe(3);
  });
  it("refuses a key outside renders/", async () => {
    const r = await worker.fetch(new Request("https://x/m/../secret"), media);
    expect(r.status).toBe(404);
  });
});
