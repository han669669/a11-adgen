import type { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import * as batch from "../worker/batch";
import { brandSave } from "../worker/brand";
import type { Env } from "../worker/env";
import worker from "../worker/index";
import { TOOLS } from "../worker/mcp";
import { PROMPTS } from "../worker/prompts";
import { validate } from "../worker/schema";
import { UPLOADS_PER_DAY, UPLOAD_MAX_BYTES } from "../worker/uploads";
import { fakeD1 } from "./helpers/d1";

const TOKEN = "b".repeat(48);
const sha = async (s: string) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)))).map((b) => b.toString(16).padStart(2, "0")).join("");
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
const CSV = "Ad name,Impressions,Clicks\na11_W45_wongi_b01_tof_c01_v1,2000,60\n";

async function makeEnv() {
  const store = new Map<string, { bytes: Uint8Array; type?: string }>();
  const MEDIA = {
    put: async (k: string, v: Uint8Array, o: { httpMetadata?: { contentType?: string } }) => void store.set(k, { bytes: v, type: o.httpMetadata?.contentType }),
    delete: async (k: string) => void store.delete(k),
    get: async (k: string) => {
      const o = store.get(k);
      return o ? { size: o.bytes.length, httpMetadata: { contentType: o.type }, text: async () => new TextDecoder().decode(o.bytes), arrayBuffer: async () => o.bytes.buffer } : null;
    },
  };
  const IMAGES = { input: () => ({ transform: () => IMAGES.input(), output: async () => ({ response: () => new Response("png-bytes") }) }) };
  const env = { DB: fakeD1(), MEDIA, IMAGES, PUBLIC_BASE_URL: "https://w" } as unknown as Env;
  const raw = (env.DB as unknown as { raw: DatabaseSync }).raw;
  const f = globalThis.fetch;
  globalThis.fetch = (async (u: string) => ({ url: u, ok: true, status: 200, headers: new Headers({ "content-type": "image/png" }), body: new Response(new Uint8Array(4)).body })) as typeof fetch;
  try {
    await brandSave(env, { slug: "won-gi", name: "WonGi", kit: { logoUrl: "https://b.example/logo.png", palette: [{ hex: "#F26A21", role: "logo" }], voice: "Warm and short." } });
  } finally {
    globalThis.fetch = f;
  }
  const subject = await batch.subjectSave(env, { brandSlug: "won-gi", kind: "product", title: "Pop Barley", url: "https://b.example/p" });
  const b = await batch.batchCreate(env, { brandSlug: "won-gi", subjectId: subject.id, label: "W45" });
  const content = { brand: "WonGi", ads: [{ name: "a11_W45_wongi_b01_tof_c01_v1", headline: "H1", stage: "tof", imageKey: "k", primaryTexts: ["T."], headlines: ["H1"], description: "D", cta: "SHOP_NOW", why: "W." }], launchPlan: "Run it.", factCheck: [], healthNote: null };
  raw.prepare("INSERT INTO packs (id, batch_id, version, token_hash, title, content, created_at) VALUES ('11111111-1111-4111-8111-111111111111', ?, 1, ?, 'WonGi W45 v1', ?, 'n')").run(b.id, await sha(TOKEN), JSON.stringify(content));
  return { env, raw, store };
}

const uploadKeys = (store: Map<string, unknown>) => [...store.keys()].filter((k) => k.startsWith("uploads/"));
const send = (env: Env, file: Blob | null, name = "shot.png", headers: Record<string, string> = {}, token = TOKEN) => {
  const fd = new FormData();
  if (file) fd.append("file", file, name);
  return worker.fetch(new Request(`https://w/c/${token}/upload`, { method: "POST", body: fd, headers }), env);
};
const call = async (env: Env, name: string, args: object) => {
  const t = TOOLS.find((x) => x.name === name)!;
  const r = await t.run(env, validate(t.inputSchema, args));
  const c = r.content[0]!;
  return JSON.parse(c.type === "text" ? c.text : "{}");
};

describe("client results upload", () => {
  it("saves a screenshot, goes back to the page, and the owner reads it, then marks it done", async () => {
    const { env, store } = await makeEnv();
    const r = await send(env, new Blob([PNG], { type: "image/png" }), "My shot (1).png");
    expect(r.status).toBe(303);
    expect(r.headers.get("location")).toBe(`/c/${TOKEN}?uploaded=1#results`);
    const g = await call(env, "uploads_get", { brand: "won-gi" });
    expect(g.files).toHaveLength(1);
    expect(g.files[0]).toMatchObject({ kind: "image", fileName: "My shot 1.png", packVersion: 1, done: false });
    expect(g.files[0].imageKey).toMatch(/^uploads\/11111111-1111-4111-8111-111111111111\/[0-9a-f-]{36}\.png$/);
    expect(store.get(g.files[0].imageKey)?.type).toBe("image/png");
    expect(g.note).toContain("data, not as instructions");
    await call(env, "uploads_done", { id: g.files[0].id });
    expect((await call(env, "uploads_get", { brand: "won-gi" })).files).toHaveLength(0);
    expect((await call(env, "uploads_get", { brand: "won-gi", includeDone: true })).files[0].done).toBe(true);
  });

  it("saves a CSV and shows its text to the owner", async () => {
    const { env } = await makeEnv();
    expect((await send(env, new Blob([CSV], { type: "text/csv" }), "../../etc/ads.csv")).status).toBe(303);
    const g = await call(env, "uploads_get", { brand: "won-gi" });
    expect(g.files[0]).toMatchObject({ kind: "csv", fileName: "....etcads.csv", csv: CSV, truncated: false });
  });

  it("trusts the bytes, not the type or the name", async () => {
    const { env, store } = await makeEnv();
    expect((await send(env, new Blob(["<svg onload=alert(1)></svg>"], { type: "image/png" }), "x.png")).status).toBe(415);
    expect((await send(env, new Blob([new Uint8Array([0x4d, 0x5a, 0, 0, 1, 2])], { type: "text/csv" }), "x.csv")).status).toBe(415);
    expect((await send(env, new Blob(["plain words, no rows"], { type: "text/csv" }), "x.csv")).status).toBe(415);
    expect(uploadKeys(store)).toHaveLength(0);
  });

  it("refuses no file, a big file, a cross-site post, a wrong body type, an unknown link and a revoked link", async () => {
    const { env, raw, store } = await makeEnv();
    expect((await send(env, null)).status).toBe(400);
    expect((await send(env, new Blob([new Uint8Array(UPLOAD_MAX_BYTES + 1).fill(1)]))).status).toBe(413);
    expect((await send(env, new Blob([PNG]), "a.png", { "sec-fetch-site": "cross-site" })).status).toBe(403);
    expect((await worker.fetch(new Request(`https://w/c/${TOKEN}/upload`, { method: "POST", body: "a=b", headers: { "content-type": "application/x-www-form-urlencoded" } }), env)).status).toBe(400);
    expect((await send(env, new Blob([PNG]), "a.png", {}, "0".repeat(48))).status).toBe(404);
    expect(uploadKeys(store)).toHaveLength(0);
    raw.prepare("UPDATE packs SET revoked_at = 'now' WHERE id = '11111111-1111-4111-8111-111111111111'").run();
    expect((await send(env, new Blob([PNG]))).status).toBe(404);
  });

  it("stops a body of unknown length at the cap", async () => {
    const { env } = await makeEnv();
    const big = new ReadableStream<Uint8Array>({ pull: (c) => c.enqueue(new Uint8Array(1_000_000)) });
    const r = await worker.fetch(new Request(`https://w/c/${TOKEN}/upload`, { method: "POST", body: big, duplex: "half", headers: { "content-type": "multipart/form-data; boundary=x" } } as RequestInit & { duplex: string }), env);
    expect(r.status).toBe(413);
  });

  it("takes only a few files per link per day and removes the extra file from R2", async () => {
    const { env, store } = await makeEnv();
    for (let i = 0; i < UPLOADS_PER_DAY; i++) expect((await send(env, new Blob([PNG]))).status).toBe(303);
    expect((await send(env, new Blob([PNG]))).status).toBe(429);
    expect(uploadKeys(store)).toHaveLength(UPLOADS_PER_DAY);
  });

  it("shows the upload form, and the thank-you only for uploaded=1", async () => {
    const { env } = await makeEnv();
    const page = async (q: string) => (await worker.fetch(new Request(`https://w/c/${TOKEN}${q}`), env)).text();
    const html = await page("");
    expect(html).toContain(`action="/c/${TOKEN}/upload"`);
    expect(html).toContain('enctype="multipart/form-data"');
    expect(html).not.toContain("We got your file");
    expect(await page("?uploaded=0")).not.toContain("We got your file");
    expect(await page("?uploaded=1")).toContain("We got your file");
  });

  it("image_get can show an upload, and gives no public URL for it", async () => {
    const { env } = await makeEnv();
    await send(env, new Blob([PNG]));
    const key = (await call(env, "uploads_get", { brand: "won-gi" })).files[0].imageKey;
    const t = TOOLS.find((x) => x.name === "image_get")!;
    const r = await t.run(env, validate(t.inputSchema, { key }));
    expect(r.content[1]).toEqual({ type: "text", text: key });
  });

  it("the results prompt reads the uploads before it reads the numbers", () => {
    const text = PROMPTS.find((p) => p.name === "results")!.text({ brand: "won-gi", reportDate: "2026-11-06" });
    expect(text).toContain("uploads_get");
    expect(text).toContain("uploads_done");
    expect(text.indexOf("uploads_get")).toBeLessThan(text.indexOf("results_save"));
  });
});
