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
    // Encoded slashes keep the /m/ prefix, so this reaches the key check. The mock would serve any key it is asked for.
    const open = { MEDIA: { get: async () => obj, head: async () => obj } } as unknown as Env;
    const r = await worker.fetch(new Request("https://x/m/renders%2F..%2Fsecret"), open);
    expect(r.status).toBe(404);
  });
});

describe("/admin/stage", () => {
  const put = async (auth: string | null, name: string, body = "export default {}", length: string | null = String(body.length)) => {
    const saved = new Map<string, ArrayBuffer>();
    const e = { ...env, MEDIA: { put: async (k: string, v: ArrayBuffer) => void saved.set(k, v) } } as unknown as Env;
    const headers: Record<string, string> = {};
    if (auth) headers.Authorization = auth;
    if (length !== null) headers["Content-Length"] = length;
    const r = await worker.fetch(new Request(`https://x/admin/stage/${name}`, { method: "PUT", headers, body }), e);
    return { r, saved };
  };
  it("refuses without the token", async () => expect((await put(null, "w.js")).r.status).toBe(401));
  it("refuses a bad name", async () => expect((await put(`Bearer ${TOKEN}`, "..%2Fx")).r.status).toBe(400));
  it("saves the bundle under deploy/", async () => {
    const { r, saved } = await put(`Bearer ${TOKEN}`, "w.js");
    expect(r.status).toBe(200);
    expect([...saved.keys()]).toEqual(["deploy/w.js"]);
  });
  it("refuses an empty body with 400", async () => expect((await put(`Bearer ${TOKEN}`, "w.js", "")).r.status).toBe(400));
  it("refuses a declared size over 3 MB with 413, before reading the body", async () => {
    const { r, saved } = await put(`Bearer ${TOKEN}`, "w.js", "x", "3000001");
    expect(r.status).toBe(413);
    expect(saved.size).toBe(0);
  });
  it("refuses a body with no Content-Length with 411", async () =>
    expect((await put(`Bearer ${TOKEN}`, "w.js", "x", null)).r.status).toBe(411));
});
