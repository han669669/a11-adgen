import type { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as batch from "../worker/batch";
import { brandSave } from "../worker/brand";
import type { Env } from "../worker/env";
import worker from "../worker/index";
import { TOOLS } from "../worker/mcp";
import { validate } from "../worker/schema";
import { fakeD1 } from "./helpers/d1";

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
const JPG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);
const SVG = new TextEncoder().encode("<svg xmlns='http://www.w3.org/2000/svg'></svg>");

type Route = { body?: Uint8Array; type?: string; status?: number; location?: string };
const asked: string[] = [];
function stub(routes: Record<string, Route>) {
  asked.length = 0;
  vi.stubGlobal("fetch", async (input: any) => {
    const url = String(input?.url ?? input);
    asked.push(url);
    const r = routes[url];
    if (!r) return new Response("nope", { status: 404, headers: { "content-type": "text/plain" } });
    return new Response(r.body ?? null, { status: r.status ?? 200, headers: { "content-type": r.type ?? "image/png", ...(r.location ? { location: r.location } : {}) } });
  });
}
afterEach(() => vi.unstubAllGlobals());

async function makeEnv() {
  const store = new Map<string, { bytes: Uint8Array; type?: string }>();
  const MEDIA = {
    put: async (k: string, v: Uint8Array, o?: { httpMetadata?: { contentType?: string } }) => void store.set(k, { bytes: v, type: o?.httpMetadata?.contentType }),
    delete: async (k: string) => void store.delete(k),
    get: async (k: string) => {
      const o = store.get(k);
      return o ? { size: o.bytes.length, arrayBuffer: async () => o.bytes.buffer, httpMetadata: { contentType: o.type }, body: new Response(o.bytes).body } : null;
    },
    head: async () => null,
  };
  const env = { DB: fakeD1(), MEDIA, PUBLIC_BASE_URL: "https://w" } as unknown as Env;
  stub({ "https://b.example/logo.png": { body: PNG } });
  await brandSave(env, { slug: "won-gi", name: "WonGi", kit: { logoUrl: "https://b.example/logo.png", palette: [{ hex: "#F26A21", role: "logo" }], voice: "Warm and short." } });
  return { env, store, raw: (env.DB as unknown as { raw: DatabaseSync }).raw };
}

const save = (env: Env, imageUrls: string[], kind: "redesign" | "product" = "redesign") =>
  batch.subjectSave(env, { brandSlug: "won-gi", kind, title: "Live ad", url: "https://ads.example/x", imageUrls });

describe("subject_save keeps a live ad's images", () => {
  it("fetches each image, stores it under subjects/<id>/<n>.<ext> with the type from its bytes, and saves the keys", async () => {
    const { env, store, raw } = await makeEnv();
    // The header says PNG for the JPEG: the bytes decide.
    stub({ "https://ads.example/a.png": { body: PNG }, "https://ads.example/b.jpg": { body: JPG, type: "image/png" } });
    const s = await save(env, ["https://ads.example/a.png", "https://ads.example/b.jpg"]);
    expect(s.imageKeys).toEqual([`subjects/${s.id}/1.png`, `subjects/${s.id}/2.jpg`]);
    expect(s.imageErrors).toEqual([]);
    expect(store.get(s.imageKeys[1]!)!.type).toBe("image/jpeg");
    const data = JSON.parse((raw.prepare("SELECT data FROM subjects WHERE id = ?").get(s.id) as { data: string }).data);
    expect(data.imageKeys).toEqual(s.imageKeys);
    expect(data.imageUrls).toEqual(["https://ads.example/a.png", "https://ads.example/b.jpg"]);
  });

  it("one bad image does not stop the others: it gives a reason (not an image, error status, http, private host)", async () => {
    const { env } = await makeEnv();
    stub({ "https://ads.example/ok.png": { body: PNG }, "https://ads.example/vector.svg": { body: SVG, type: "image/svg+xml" }, "https://ads.example/gone.png": { status: 404 }, "https://ads.example/page": { body: PNG, type: "text/html" } });
    const s = await save(env, ["https://ads.example/vector.svg", "https://ads.example/gone.png", "https://ads.example/page", "http://ads.example/plain.png", "https://127.0.0.1/a.png", "https://ads.example/ok.png"]);
    expect(s.imageKeys).toEqual([`subjects/${s.id}/6.png`]);
    expect(s.imageErrors).toHaveLength(5);
    expect(s.imageErrors.join("\n")).toMatch(/Image 1 is not a PNG, JPEG or WebP/);
    expect(s.imageErrors.join("\n")).toMatch(/Image 2 URL did not return an image \(HTTP 404/);
    expect(s.imageErrors.join("\n")).toMatch(/Image 3 URL did not return an image/);
    expect(s.imageErrors.join("\n")).toMatch(/Image 4 URL must use HTTPS/);
    expect(s.imageErrors.join("\n")).toMatch(/Image 5 URL must point at a public host/);
    expect(asked).not.toContain("http://ads.example/plain.png");
    expect(asked).not.toContain("https://127.0.0.1/a.png");
  });

  it("follows a redirect by hand and never requests a plain-http or internal hop", async () => {
    const { env } = await makeEnv();
    stub({
      "https://ads.example/r1": { status: 302, location: "https://cdn.ads.example/a.png" },
      "https://cdn.ads.example/a.png": { body: PNG },
      "https://ads.example/r2": { status: 302, location: "http://ads.example/plain.png" },
      "https://ads.example/r3": { status: 302, location: "https://169.254.169.254/latest" },
    });
    const s = await save(env, ["https://ads.example/r1", "https://ads.example/r2", "https://ads.example/r3"]);
    expect(s.imageKeys).toEqual([`subjects/${s.id}/1.png`]);
    expect(s.imageErrors).toHaveLength(2);
    expect(asked).not.toContain("http://ads.example/plain.png");
    expect(asked).not.toContain("https://169.254.169.254/latest");
  });

  it("refuses an image over 8 MB, even with no Content-Length", async () => {
    const { env } = await makeEnv();
    const big = new Uint8Array(8_000_001);
    big.set(PNG);
    stub({ "https://ads.example/big.png": { body: big } });
    const s = await save(env, ["https://ads.example/big.png"]);
    expect(s.imageKeys).toEqual([]);
    expect(s.imageErrors[0]).toMatch(/larger than 8000000 bytes/);
  });

  it("a subject with no image URLs saves no keys; the old data fields stay", async () => {
    const { env, raw } = await makeEnv();
    const s = await batch.subjectSave(env, { brandSlug: "won-gi", kind: "brand", title: "Brand only" });
    expect(s.imageKeys).toEqual([]);
    const data = JSON.parse((raw.prepare("SELECT data FROM subjects WHERE id = ?").get(s.id) as { data: string }).data);
    expect(data).toMatchObject({ imageUrls: [], notes: "" });
  });

  it("removes the stored images when the subject row cannot be written", async () => {
    const { env, store } = await makeEnv();
    stub({ "https://ads.example/a.png": { body: PNG } });
    const real = env.DB.prepare.bind(env.DB);
    env.DB.prepare = ((sql: string) => {
      if (sql.startsWith("INSERT INTO subjects")) throw new Error("d1 down");
      return real(sql);
    }) as typeof env.DB.prepare;
    await expect(save(env, ["https://ads.example/a.png"])).rejects.toThrow("d1 down");
    expect([...store.keys()].filter((k) => k.startsWith("subjects/"))).toEqual([]);
  });
});

describe("the stored image is private and the agent can look at it", () => {
  it("image_get accepts a subjects/ key, shows it, and gives no public URL", async () => {
    const { env } = await makeEnv();
    stub({ "https://ads.example/a.png": { body: PNG } });
    const s = await save(env, ["https://ads.example/a.png"]);
    const t = TOOLS.find((x) => x.name === "image_get")!;
    expect(() => validate(t.inputSchema, { key: s.imageKeys[0] })).not.toThrow();
    const out = await t.run(env, { key: s.imageKeys[0] });
    expect(out.content[0]).toMatchObject({ type: "image", mimeType: "image/png" });
    expect(out.content[1]).toEqual({ type: "text", text: s.imageKeys[0] });
  });

  it("the public /m/ route does not serve a subjects/ key", async () => {
    const { env } = await makeEnv();
    stub({ "https://ads.example/a.png": { body: PNG } });
    const s = await save(env, ["https://ads.example/a.png"]);
    const res = await worker.fetch(new Request(`https://w/m/${s.imageKeys[0]}`), env);
    expect(res.status).toBe(404);
  });

  it("the key pattern rejects a path outside subjects/<uuid>/<1-6>.<ext>", () => {
    const t = TOOLS.find((x) => x.name === "image_get")!;
    const id = "3f2b8c1e-aaaa-4bbb-8ccc-1234567890ab";
    for (const key of [`subjects/${id}/0.png`, `subjects/${id}/7.png`, `subjects/${id}/1.gif`, `subjects/${id}/../x.png`, `subjects/x/1.png`]) expect(() => validate(t.inputSchema, { key }), key).toThrow();
    expect(() => validate(t.inputSchema, { key: `subjects/${id}/6.webp` })).not.toThrow();
  });
});
