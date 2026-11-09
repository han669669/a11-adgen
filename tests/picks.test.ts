import type { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import type { Env } from "../worker/env";
import { TOOLS } from "../worker/mcp";
import { picksGet } from "../worker/picks";
import { validate } from "../worker/schema";
import { createUploadLink, handleUploadLink } from "../worker/uploadlink";
import { fakeD1 } from "./helpers/d1";

const B = "bbbbbbbb-0000-4000-8000-000000000001";
const OLD = "11111111-0000-4000-8000-000000000001";
const NEW = "22222222-0000-4000-8000-000000000002";
const DRAFT = "renders/dddddddd-0000-4000-8000-000000000003/1.jpg";

/** A JPEG with a frame header of the given size and an end marker (enough for jpegSize and hasJpegEnd). */
function jpeg(w: number, h: number): Uint8Array {
  return new Uint8Array([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, h >> 8, h & 255, w >> 8, w & 255, 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1, 0xff, 0xd9]);
}

function setup() {
  const DB = fakeD1();
  const raw = (DB as unknown as { raw: DatabaseSync }).raw;
  raw.exec(`
    INSERT INTO brands (id, slug, name, created_at, updated_at) VALUES ('br', 'cat', 'Cat', 't', 't');
    INSERT INTO subjects (id, brand_id, kind, title, created_at) VALUES ('su', 'br', 'product', 'Cake', 't');
    INSERT INTO batches (id, brand_id, subject_id, kit_version, label, status, created_at, updated_at) VALUES ('${B}', 'br', 'su', 1, 'W47', 'finals', 't', 't');
    INSERT INTO ideas (id, batch_id, n, format, insight, visual, headline, created_at) VALUES ('i7', '${B}', 7, 'tof', 'in', 'v', 'Wait, there''s ten?', 't');
    INSERT INTO ideas (id, batch_id, n, format, insight, visual, headline, created_at) VALUES ('i9', '${B}', 9, 'mof', 'in', 'v', 'No pick here', 't');
    INSERT INTO draft_ranks (render_key, batch_id, idea_id, rank, created_at) VALUES ('${DRAFT}', '${B}', 'i7', 3, 't');
    INSERT INTO picks (render_key, batch_id, idea_id, note, final_render_id, created_at, by_owner) VALUES ('${DRAFT}', '${B}', 'i7', 'ill choose ad 1', '${OLD}', 't', 1);
  `);
  const final = (id: string, at: string, composed: string | null) =>
    raw
      .prepare(
        `INSERT INTO renders (id, batch, idea, kind, status, prompt, refs, width, height, quality, num_images, usd_est, created_at, updated_at, composed_key)
         VALUES (?, ?, 'i7', 'final', 'done', 'p', '[]', 1536, 1920, 'high', 1, 0.07, ?, ?, ?)`,
      )
      .run(id, B, at, at, composed);
  final(OLD, "2026-11-07T16:37:00Z", `renders/${OLD}/1-c1.jpg`);
  final(NEW, "2026-11-07T17:51:00Z", `renders/${NEW}/1-c2.jpg`);
  raw
    .prepare("INSERT INTO packs (id, batch_id, version, token_hash, title, content, created_at) VALUES ('p1', ?, 1, 'h', 't', ?, 'n')")
    .run(B, JSON.stringify({ ads: [{ imageKey: `renders/${NEW}/1-c2.jpg` }] }));

  const files = new Map<string, { bytes: Uint8Array; meta?: Record<string, string> }>();
  const MEDIA = {
    head: async (k: string) => (files.has(k) ? { customMetadata: files.get(k)!.meta ?? {} } : null),
    get: async (k: string) => {
      const f = files.get(k);
      return f ? { arrayBuffer: async () => f.bytes.buffer.slice(f.bytes.byteOffset, f.bytes.byteOffset + f.bytes.byteLength) } : null;
    },
    put: async (k: string, v: Uint8Array | ArrayBuffer, o?: { customMetadata?: Record<string, string> }) => void files.set(k, { bytes: new Uint8Array(v as ArrayBuffer), meta: o?.customMetadata }),
  };
  const kv = new Map<string, { value: string; ttl?: number }>();
  const OAUTH_KV = {
    get: async (k: string) => kv.get(k)?.value ?? null,
    put: async (k: string, value: string, o?: { expirationTtl?: number }) => void kv.set(k, { value, ttl: o?.expirationTtl }),
    delete: async (k: string) => void kv.delete(k),
  };
  const env = { DB, MEDIA, OAUTH_KV, PUBLIC_BASE_URL: "https://w.example/" } as unknown as Env;
  return { env, raw, files, kv };
}

const put = (url: string, body: Uint8Array, headers: Record<string, string> = {}) =>
  new Request(url, { method: "PUT", body, headers: { "content-length": String(body.byteLength), ...headers } });
const tokenOf = (url: string) => url.split("/up/")[1]!;

describe("picks_get", () => {
  it("lists each pick with its finals newest first, the pack versions, the latest final and the next step", async () => {
    const { env } = setup();
    const out = await picksGet(env, B);
    expect(out.batch).toEqual({ id: B, label: "W47", status: "finals" });
    expect(out.picks).toHaveLength(1);
    const p = out.picks[0]!;
    expect(p).toMatchObject({ idea: 7, stage: "tof", headline: "Wait, there's ten?", draftKey: DRAFT, criticRank: 3, byOwner: true, ownerNote: "ill choose ad 1", firstFinalId: OLD });
    expect(p.finals.map((f) => f.renderId)).toEqual([NEW, OLD]);
    expect(p.finals[0]).toMatchObject({ inPacks: [1], composedUrl: `https://w.example/m/renders/${NEW}/1-c2.jpg` });
    expect(p.finals[1]!.inPacks).toEqual([]);
    expect(p.latest).toMatchObject({ renderId: NEW, repaired: false });
    expect(p.next).toContain("pack_publish");
    expect(out.packs).toEqual([{ version: 1, revoked: false }]);
  });
  it("says what comes next when the final is missing or not composed", async () => {
    const { env, raw } = setup();
    raw.prepare("UPDATE renders SET composed_key = NULL").run();
    expect((await picksGet(env, B)).picks[0]!.next).toBe("compose_final");
    raw.prepare("DELETE FROM renders").run();
    expect((await picksGet(env, B)).picks[0]!.next).toBe("final_render");
  });
  it("refuses an unknown batch, and the tool takes only a batch id", async () => {
    const { env } = setup();
    await expect(picksGet(env, "00000000-0000-4000-8000-000000000000")).rejects.toThrow("No batch");
    const tool = TOOLS.find((t) => t.name === "picks_get")!;
    expect(() => validate(tool.inputSchema as never, { batchId: B, extra: 1 })).toThrow();
    const res = (await tool.run(env, validate(tool.inputSchema as never, { batchId: B }))) as { content: { text: string }[] };
    expect(JSON.parse(res.content[0]!.text).picks[0].latest.renderId).toBe(NEW);
  });
});

describe("upload_link", () => {
  it("a repair link saves the fixed picture, attaches it, marks it repaired and works once", async () => {
    const { env, raw, kv } = setup();
    const link = await createUploadLink(env, { kind: "repair", key: `renders/${NEW}/1.jpg` });
    expect(link.uploadUrl).toMatch(/^https:\/\/w\.example\/up\/[0-9a-f]{48}$/);
    expect(link.expiresInSeconds).toBe(900);
    // Only the hash of the token is stored, with a 15 minute life.
    const [k, v] = [...kv.entries()][0]!;
    expect(k).toMatch(/^upload:[0-9a-f]{64}$/);
    expect(k).not.toContain(tokenOf(link.uploadUrl));
    expect(v!.ttl).toBe(900);

    const r = await handleUploadLink(put(link.uploadUrl, jpeg(1536, 1920)), env, tokenOf(link.uploadUrl));
    expect(r.status).toBe(200);
    const body = (await r.json()) as { key: string; attached: boolean };
    expect(body.attached).toBe(true);
    expect(raw.prepare("SELECT composed_key FROM renders WHERE id = ?").get(NEW)).toEqual({ composed_key: body.key });
    const p = (await picksGet(env, B)).picks[0]!;
    expect(p.latest).toMatchObject({ renderId: NEW, composedKey: body.key, repaired: true });

    const again = await handleUploadLink(put(link.uploadUrl, jpeg(1536, 1920)), env, tokenOf(link.uploadUrl));
    expect(again.status).toBe(404);
  });
  it("a ref link saves a PNG under refs/ and answers with its url", async () => {
    const { env, files } = setup();
    const link = await createUploadLink(env, { kind: "ref" });
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
    const r = await handleUploadLink(put(link.uploadUrl, png), env, tokenOf(link.uploadUrl));
    expect(r.status).toBe(200);
    const { key, url } = (await r.json()) as { key: string; url: string };
    expect(key).toMatch(/^refs\/[0-9a-f-]{36}\.png$/);
    expect(url).toBe(`https://w.example/m/${key}`);
    expect(files.has(key)).toBe(true);
  });
  it("refuses a link for a draft, a final that is not composed, a missing key, and a ref with a key", async () => {
    const { env, raw } = setup();
    await expect(createUploadLink(env, { kind: "repair" })).rejects.toThrow("needs key");
    await expect(createUploadLink(env, { kind: "repair", key: "renders/99999999-0000-4000-8000-000000000009/1.jpg" })).rejects.toThrow("No render");
    raw.prepare("UPDATE renders SET composed_key = NULL WHERE id = ?").run(NEW);
    await expect(createUploadLink(env, { kind: "repair", key: `renders/${NEW}/1.jpg` })).rejects.toThrow("not composed yet");
    raw.prepare("UPDATE renders SET kind = 'draft' WHERE id = ?").run(OLD);
    await expect(createUploadLink(env, { kind: "repair", key: `renders/${OLD}/1.jpg` })).rejects.toThrow("not a completed final");
    await expect(createUploadLink(env, { kind: "ref", key: `renders/${NEW}/1.jpg` })).rejects.toThrow("takes no key");
  });
  it("refuses an unknown token, a GET, a missing length, a too large body, the wrong file type and the wrong size", async () => {
    const { env, raw } = setup();
    expect((await handleUploadLink(put("https://w.example/up/x", jpeg(1536, 1920)), env, "a".repeat(48))).status).toBe(404);
    const mk = async () => tokenOf((await createUploadLink(env, { kind: "repair", key: `renders/${NEW}/1.jpg` })).uploadUrl);
    expect((await handleUploadLink(new Request("https://w.example/up/t"), env, await mk())).status).toBe(405);
    const noLen = new Request("https://w.example/up/t", { method: "PUT", body: jpeg(1536, 1920) });
    noLen.headers.delete("content-length");
    expect((await handleUploadLink(noLen, env, await mk())).status).toBe(411);
    expect((await handleUploadLink(put("https://w.example/up/t", jpeg(1536, 1920), { "content-length": "10000001" }), env, await mk())).status).toBe(413);
    expect((await handleUploadLink(put("https://w.example/up/t", new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0, 0, 0])), env, await mk())).status).toBe(415);
    const wrongSize = await handleUploadLink(put("https://w.example/up/t", jpeg(1024, 1280)), env, await mk());
    expect(wrongSize.status).toBe(422);
    expect(((await wrongSize.json()) as { error: string; attached: boolean })).toMatchObject({ attached: false });
    // A failed attach leaves the render as it was.
    expect(raw.prepare("SELECT composed_key FROM renders WHERE id = ?").get(NEW)).toEqual({ composed_key: `renders/${NEW}/1-c2.jpg` });
  });
  it("the tool schema needs a kind and refuses a bad key and extra fields", () => {
    const tool = TOOLS.find((t) => t.name === "upload_link")!;
    for (const a of [{}, { kind: "other" }, { kind: "repair", key: "refs/x.jpg" }, { kind: "ref", ext: "gif" }, { kind: "ref", extra: 1 }])
      expect(() => validate(tool.inputSchema as never, a), JSON.stringify(a)).toThrow();
    expect(validate(tool.inputSchema as never, { kind: "repair", key: `renders/${NEW}/1.jpg` })).toBeTruthy();
  });
});
