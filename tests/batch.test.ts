import type { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as batch from "../worker/batch";
import { brandGet, brandSave } from "../worker/brand";
import type { Env } from "../worker/env";
import { TOOLS } from "../worker/mcp";
import { picksGet } from "../worker/picks";
import { validate } from "../worker/schema";
import { reserve, totals } from "../worker/spend";
import { fakeD1 } from "./helpers/d1";

afterEach(() => vi.unstubAllGlobals());

const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const JPEG = [0xff, 0xd8, 0xff];
/** A fetched picture. Its first bytes are a real PNG or JPEG signature, taken from the type unless `sig` gives them. */
const img = (url: string, type = "image/png", size = 16, headers: Record<string, string> = {}, sig = type.includes("jpeg") ? JPEG : type.includes("png") ? PNG : []) => {
  const bytes = new Uint8Array(size);
  bytes.set(sig);
  return { url, ok: true, status: 200, headers: new Headers({ "content-type": type, ...headers }), body: new Response(bytes).body };
};

function makeEnv() {
  const saved = new Map<string, unknown>();
  const transforms: unknown[] = [];
  const IMAGES = {
    input: () => {
      const self = {
        transform: (t: unknown) => (transforms.push(t), self),
        output: async () => ({ response: () => new Response("png") }),
      };
      return self;
    },
  };
  const MEDIA = {
    put: async (k: string, v: unknown) => void saved.set(k, v),
    get: async () => null,
    delete: async (k: string) => void saved.delete(k),
  };
  const env = { DB: fakeD1(), MEDIA, IMAGES, SPEND_CAP_USD: "5.00", PUBLIC_BASE_URL: "https://w", FAL_KEY: "k" } as unknown as Env;
  return { env, saved, transforms, raw: (env.DB as unknown as { raw: DatabaseSync }).raw };
}

const kit = {
  logoUrl: "https://brand.example/logo.png",
  palette: [{ hex: "#F26A21", role: "logo orange" }],
  voice: "Warm, playful, short sentences.",
  refs: [{ url: "https://brand.example/closeup.jpg", label: "kernels close-up", role: "texture" as const }],
};

/** Completes a seeded batch to one pick per stage: a picked mof, and the seeded bof marked picked. */
async function pickAllStages(env: Env, batchId: string, bofId: string) {
  await batch.ideasSave(env, batchId, [{ format: "mof", insight: "m", visual: "m", headline: "M", picked: true }]);
  await batch.ideasUpdate(env, [{ id: bofId, picked: true }]);
}

async function seed(env: Env) {
  vi.stubGlobal("fetch", async (u: string) => img(u, u.endsWith(".jpg") ? "image/jpeg" : "image/png"));
  await brandSave(env, { slug: "wongi", name: "WonGi", kit });
  const subject = await batch.subjectSave(env, { brandSlug: "wongi", kind: "product", title: "Pop Barley", url: "https://brand.example/p" });
  const b = await batch.batchCreate(env, { brandSlug: "wongi", subjectId: subject.id, label: "W46" });
  const ideas = await batch.ideasSave(env, b.id, [
    { format: "tof", insight: "jar empties fast", visual: "empty jar", headline: "Somehow the jar is empty again.", picked: true },
    { format: "bof", insight: "bundle", visual: "three jars", headline: "Three jars. One price." },
  ]);
  return { subject, b, ideas };
}

function addDraft(raw: DatabaseSync, batchId: string, ideaId: string, renderId: string, n = 3) {
  const keys = Array.from({ length: n }, (_, i) => `renders/${renderId}/${i + 1}.jpg`);
  raw
    .prepare(
      `INSERT INTO renders (id, batch, idea, kind, status, prompt, refs, width, height, quality, num_images, image_keys, usd_est, created_at, updated_at)
       VALUES (?, ?, ?, 'draft', 'done', 'p', '[]', 1024, 1280, 'low', ?, ?, 0.02, 'now', 'now')`,
    )
    .run(renderId, batchId, ideaId, n, JSON.stringify(keys));
  return keys as [string, string, string];
}

describe("brand kit", () => {
  it("stores a trimmed logo and copies refs, with a new version per save", async () => {
    const { env, saved, transforms } = makeEnv();
    vi.stubGlobal("fetch", async (u: string) => img(u, u.endsWith(".jpg") ? "image/jpeg" : "image/png"));
    const v1 = await brandSave(env, { slug: "wongi", name: "WonGi", kit });
    const v2 = await brandSave(env, { slug: "wongi", name: "WonGi", kit, note: "new voice" });
    expect([v1.version, v2.version]).toEqual([1, 2]);
    expect(v1.kit.logo.key).toMatch(/^brands\/[0-9a-f-]{36}\/logo\.png$/);
    expect(v2.kit.logo.key).not.toBe(v1.kit.logo.key);
    expect(transforms).toEqual([{ trim: "border" }, { trim: "border" }]);
    expect(v1.kit.refs[0]!).toMatchObject({ role: "texture", sourceUrl: kit.refs[0]!.url });
    expect(v1.kit.refs[0]!.key).toMatch(/\/ref1\.jpg$/);
    expect(v1.kit.placement).toEqual({ logoWidthPct: 28, logoTopPct: 3 });
    expect(saved.size).toBe(4);
    expect(v1.brandId).toBe(v2.brandId);
    expect((await brandGet(env, "wongi")).kit?.version).toBe(2);
    expect((await brandGet(env, "wongi", 1)).kit?.version).toBe(1);
  });
  it("keeps the latest kit's food words when a new save has none, and trims them", async () => {
    const { env } = makeEnv();
    vi.stubGlobal("fetch", async (u: string) => img(u, u.endsWith(".jpg") ? "image/jpeg" : "image/png"));
    const v1 = await brandSave(env, { slug: "wongi", name: "WonGi", kit: { ...kit, food: "  Lumpy kernels.  " } });
    const v2 = await brandSave(env, { slug: "wongi", name: "WonGi", kit });
    const v3 = await brandSave(env, { slug: "wongi", name: "WonGi", kit: { ...kit, food: "   " } });
    expect([v1.kit.food, v2.kit.food, v3.kit.food]).toEqual(["Lumpy kernels.", "Lumpy kernels.", "Lumpy kernels."]);
  });
  it("refuses an SVG logo", async () => {
    const { env } = makeEnv();
    vi.stubGlobal("fetch", async (u: string) => img(u, "image/svg+xml"));
    await expect(brandSave(env, { slug: "wongi", name: "WonGi", kit })).rejects.toThrow("not SVG");
  });
  it("refuses an SVG reference and stores nothing", async () => {
    const { env, saved, raw } = makeEnv();
    vi.stubGlobal("fetch", async (u: string) => img(u, u.endsWith(".jpg") ? "image/SVG+xml" : "image/png"));
    await expect(brandSave(env, { slug: "wongi", name: "WonGi", kit })).rejects.toThrow("not SVG");
    expect(saved.size).toBe(0);
    expect(raw.prepare("SELECT COUNT(*) AS n FROM brands").get()).toEqual({ n: 0 });
  });
  it("refuses a reference whose bytes are not a picture, whatever type the server says", async () => {
    const { env, saved } = makeEnv();
    vi.stubGlobal("fetch", async (u: string) => (u.endsWith(".jpg") ? img(u, "image/png", 16, {}, []) : img(u)));
    await expect(brandSave(env, { slug: "wongi", name: "WonGi", kit })).rejects.toThrow("Reference 1 must be a PNG, JPEG or WebP file.");
    expect(saved.size).toBe(0);
  });
  it("stores a reference by its real type when the server says another image type", async () => {
    const { env, saved } = makeEnv();
    vi.stubGlobal("fetch", async (u: string) => (u.endsWith(".jpg") ? img(u, "image/png", 16, {}, JPEG) : img(u)));
    const out = await brandSave(env, { slug: "wongi", name: "WonGi", kit });
    expect(out.kit.refs[0]!.key).toMatch(/\/ref1\.jpg$/);
    expect([...saved.keys()].some((k) => k.endsWith("/ref1.jpg"))).toBe(true);
  });
  it("refuses an image over the size limit, also with no Content-Length", async () => {
    const { env } = makeEnv();
    vi.stubGlobal("fetch", async (u: string) => img(u, "image/png", 9_000_000));
    await expect(brandSave(env, { slug: "wongi", name: "WonGi", kit })).rejects.toThrow("larger than");
    vi.stubGlobal("fetch", async (u: string) => img(u, "image/png", 16, { "content-length": "9000000" }));
    await expect(brandSave(env, { slug: "wongi", name: "WonGi", kit })).rejects.toThrow("larger than");
  });
  it("deletes the stored files when the database write fails", async () => {
    const { env, saved, raw } = makeEnv();
    vi.stubGlobal("fetch", async (u: string) => img(u, u.endsWith(".jpg") ? "image/jpeg" : "image/png"));
    raw.exec("CREATE TRIGGER no_kits BEFORE INSERT ON brand_kits BEGIN SELECT RAISE(ABORT, 'db down'); END");
    await expect(brandSave(env, { slug: "wongi", name: "WonGi", kit })).rejects.toThrow("db down");
    expect(saved.size).toBe(0);
    expect(raw.prepare("SELECT COUNT(*) AS n FROM brands").get()).toEqual({ n: 0 });
  });
  it("refuses a batch for a brand with no kit", async () => {
    const { env, raw } = makeEnv();
    raw.prepare("INSERT INTO brands (id, slug, name, created_at, updated_at) VALUES ('b1', 'nokit', 'No Kit', 'now', 'now')").run();
    const s = await batch.subjectSave(env, { brandSlug: "nokit", kind: "brand", title: "Brand only" });
    await expect(batch.batchCreate(env, { brandSlug: "nokit", subjectId: s.id, label: "x" })).rejects.toThrow("no kit");
  });
});

describe("batch flow", () => {
  it("saves facts with their quotes and sources", async () => {
    const { env } = makeEnv();
    const { subject } = await seed(env);
    const facts = await batch.factsSave(env, subject.id, [{ label: "price", value: "S$6.90", quote: "S$6.90 per jar", sourceUrl: "https://brand.example/p" }]);
    expect(facts).toEqual([expect.objectContaining({ label: "price", quote: "S$6.90 per jar" })]);
  });

  it("ranks drafts, records picks and returns the drafts in submit order on batch_get", async () => {
    const { env, raw } = makeEnv();
    const { b, ideas } = await seed(env);
    const keys = addDraft(raw, b.id, ideas[0]!.id, "11111111-1111-1111-1111-111111111111");
    // A second render of the same idea, submitted later. Its id sorts first, and its image has the best rank.
    const [later] = addDraft(raw, b.id, ideas[0]!.id, "00000000-1111-1111-1111-111111111111", 1);
    await batch.draftsRank(env, b.id, [
      { key: keys[0], rank: 4 },
      { key: keys[1], rank: 2, reason: "clean jar" },
      { key: keys[2], rank: 3 },
      { key: later, rank: 1 },
    ]);
    await batch.picksSave(env, b.id, [{ key: keys[1], note: "yes" }]);
    const got = await batch.batchGet(env, b.id);
    const hook = got.ideas.find((i) => i.id === ideas[0]!.id)!;
    // Submit order of the renders, then image order. Never rank order, and never key order.
    expect(hook.drafts.map((d) => d.key)).toEqual([keys[0], keys[1], keys[2], later]);
    expect(hook.drafts.find((d) => d.rank === 2)!).toMatchObject({ key: keys[1], picked: true, reason: "clean jar" });
    expect(got.picks).toEqual([{ key: keys[1], ideaId: ideas[0]!.id, note: "yes", byOwner: true, finalRenderId: null }]);
    expect(got.kit?.logo.key).toMatch(/\/logo\.png$/);
  });

  it("compares the owner's pick with the blind rank and logs it for taste_log", async () => {
    const { env, raw } = makeEnv();
    const { b, ideas } = await seed(env);
    const k1 = addDraft(raw, b.id, ideas[0]!.id, "55555555-5555-5555-5555-555555555555");
    const k2 = addDraft(raw, b.id, ideas[1]!.id, "55555555-5555-5555-5555-666666666666");
    await batch.draftsRank(env, b.id, [
      { key: k1[0], rank: 1, reason: "clean jar" },
      { key: k1[1], rank: 2 },
      { key: k1[2], rank: 3 },
      { key: k2[0], rank: 1 },
      { key: k2[1], rank: 2, reason: "warm light" },
      { key: k2[2], rank: 3 },
    ]);
    const res = await batch.picksSave(env, b.id, [
      { key: k1[0], note: "this one" },
      { key: k2[1], note: "warmer" },
    ]);
    expect(res.review).toEqual([
      { key: k1[0], criticRank: 1, agreed: true },
      { key: k2[1], criticRank: 2, agreed: false },
    ]);
    expect(res.tally).toEqual({ reviewed: 2, agreed: 1 });
    expect(raw.prepare("SELECT COUNT(*) AS n FROM picks WHERE by_owner = 1").get()).toEqual({ n: 2 });
    const log = await batch.tasteLog(env);
    expect(log.tally).toEqual({ reviewed: 2, agreed: 1 });
    const second = log.picks.find((p) => p.chosen.key === k2[1])!;
    expect(second).toMatchObject({ ownerSaid: "warmer", chosen: { criticRank: 2, criticReason: "warm light" } });
    expect(second.passed.map((d) => d.criticRank)).toEqual([1, 3]);
  });

  it("keeps picks made before the owner review out of the taste log", async () => {
    const { env, raw } = makeEnv();
    const { b, ideas } = await seed(env);
    const keys = addDraft(raw, b.id, ideas[0]!.id, "77777777-7777-7777-7777-777777777777");
    raw.prepare("INSERT INTO picks (render_key, batch_id, idea_id, created_at) VALUES (?, ?, ?, 'now')").run(keys[0], b.id, ideas[0]!.id);
    expect((await batch.tasteLog(env)).picks).toEqual([]);
  });

  it("saves ownerSaid as the pick's words and clears unfinished picks on an empty list", async () => {
    const { env, raw } = makeEnv();
    const { b, ideas } = await seed(env);
    const keys = addDraft(raw, b.id, ideas[0]!.id, "88888888-8888-8888-8888-888888888888");
    const tool = TOOLS.find((t) => t.name === "picks_save")!;
    await tool.run(env, { batchId: b.id, picks: [{ key: keys[1], ownerSaid: "2" }] });
    expect((await batch.tasteLog(env)).picks[0]).toMatchObject({ ownerSaid: "2", chosen: { key: keys[1] } });
    expect((await batch.batchGet(env, b.id)).picks[0]).toMatchObject({ byOwner: true });
    await batch.picksSave(env, b.id, []);
    expect(raw.prepare("SELECT COUNT(*) AS n FROM picks").get()).toEqual({ n: 0 });
  });

  it("needs the owner's words for each pick on the MCP picks_save tool", () => {
    const tool = TOOLS.find((t) => t.name === "picks_save")!;
    const key = "renders/11111111-1111-1111-1111-111111111111/1.jpg";
    const args = { batchId: "11111111-1111-1111-1111-111111111111", picks: [{ key }] };
    expect(() => validate(tool.inputSchema as never, args)).toThrow();
    expect(() => validate(tool.inputSchema as never, { ...args, picks: [{ key, ownerSaid: "this one" }] })).not.toThrow();
    expect(() => validate(tool.inputSchema as never, { ...args, picks: [{ key, ownerSaid: "2" }] })).not.toThrow();
    expect(() => validate(tool.inputSchema as never, { ...args, picks: [{ key, ownerSaid: "   " }] })).toThrow();
  });

  it("refuses to rank or pick a key that is not a finished draft of the batch", async () => {
    const { env } = makeEnv();
    const { b } = await seed(env);
    const stranger = "renders/22222222-2222-2222-2222-222222222222/1.jpg";
    await expect(batch.draftsRank(env, b.id, [{ key: stranger, rank: 1 }])).rejects.toThrow("not a finished draft");
    await expect(batch.picksSave(env, b.id, [{ key: stranger }])).rejects.toThrow("not a finished draft");
  });

  it("keeps a pick that already has a final when the picks change", async () => {
    const { env, raw } = makeEnv();
    const { b, ideas } = await seed(env);
    const keys = addDraft(raw, b.id, ideas[0]!.id, "33333333-3333-3333-3333-333333333333");
    await expect(batch.picksSave(env, b.id, [{ key: keys[0] }, { key: keys[1] }])).rejects.toThrow("one draft per idea");
    await batch.picksSave(env, b.id, [{ key: keys[0] }]);
    raw.prepare("UPDATE picks SET final_render_id = 'f1' WHERE render_key = ?").run(keys[0]);
    await expect(batch.picksSave(env, b.id, [{ key: keys[2] }])).rejects.toThrow("already has a final");
    const bofKeys = addDraft(raw, b.id, ideas[1]!.id, "33333333-3333-3333-3333-444444444444");
    await batch.picksSave(env, b.id, [{ key: bofKeys[0] }]);
    const left = raw.prepare("SELECT render_key FROM picks ORDER BY render_key").all().map((r: any) => r.render_key);
    expect(left).toEqual([keys[0], bofKeys[0]].sort());
  });

  it("starts a final from a pick with the draft as the first reference", async () => {
    const { env, raw } = makeEnv();
    const { b, ideas } = await seed(env);
    const keys = addDraft(raw, b.id, ideas[0]!.id, "44444444-4444-4444-4444-444444444444");
    await batch.picksSave(env, b.id, [{ key: keys[0] }]);
    await expect(batch.finalRender(env, b.id, keys[0])).rejects.toThrow("no final prompt");
    await batch.ideasUpdate(env, [{ id: ideas[0]!.id, finalPrompt: "A".repeat(50), finalRefs: ["https://w/m/brands/x/v1-ref1.jpg"] }]);
    let body: any;
    vi.stubGlobal("fetch", async (_u: string, init: RequestInit) => {
      body = JSON.parse(String(init.body));
      return new Response(JSON.stringify({ request_id: "r", status_url: "https://q/s", response_url: "https://q/r" }));
    });
    const r = await batch.finalRender(env, b.id, keys[0]);
    expect(body.image_urls).toEqual([`https://w/m/${keys[0]}`, "https://w/m/brands/x/v1-ref1.jpg"]);
    expect(body.quality).toBe("high");
    expect(await batch.finalRender(env, b.id, keys[0])).toEqual({ id: r.id, status: "already started" });
    expect((await batch.batchGet(env, b.id)).picks[0]!.finalRenderId).toBe(r.id);
  });

  it("refuses status 'board' while a picked idea with drafts has no final prompt", async () => {
    const { env, raw } = makeEnv();
    const { b, ideas } = await seed(env);
    addDraft(raw, b.id, ideas[0]!.id, "66666666-6666-6666-6666-666666666666");
    await pickAllStages(env, b.id, ideas[1]!.id);
    await expect(batch.batchUpdate(env, { id: b.id, status: "board" })).rejects.toThrow("finalPrompt");
    await batch.ideasUpdate(env, [{ id: ideas[0]!.id, finalPrompt: "B".repeat(50) }]);
    await expect(batch.batchUpdate(env, { id: b.id, status: "board" })).resolves.toMatchObject({ updated: ["status"] });
  });

  it("ignores a draft whose idea belongs to another batch", async () => {
    const { env, raw } = makeEnv();
    const { b, subject } = await seed(env);
    const other = await batch.batchCreate(env, { brandSlug: "wongi", subjectId: subject.id, label: "W47" });
    const [foreign] = await batch.ideasSave(env, other.id, [{ format: "tof", insight: "x", visual: "x", headline: "x" }]);
    const keys = addDraft(raw, b.id, foreign!.id, "77777777-7777-7777-7777-777777777777");
    await expect(batch.picksSave(env, b.id, [{ key: keys[0] }])).rejects.toThrow("not a finished draft");
  });

  it("allows 1 pick per stage per batch, on save and on update", async () => {
    const { env } = makeEnv();
    const { b, ideas } = await seed(env); // seed: one tof picked, one bof not picked
    const pick = (format: "tof" | "mof" | "bof") => batch.ideasSave(env, b.id, [{ format, insight: "y", visual: "y", headline: "y", picked: true }]);
    await expect(pick("tof")).rejects.toThrow("Pick limit");
    await pick("mof");
    await expect(pick("mof")).rejects.toThrow("Pick limit");
    await pick("bof");
    await expect(batch.ideasUpdate(env, [{ id: ideas[1]!.id, picked: true }])).rejects.toThrow("Pick limit");
    await batch.ideasUpdate(env, [{ id: ideas[0]!.id, picked: true }]); // already picked: no change in count
  });

  it("lets the critic pick only ideas of the given batch, and never unpick", async () => {
    const { env } = makeEnv();
    const { subject, b, ideas } = await seed(env); // seed: one tof picked, one bof not picked
    const other = await batch.batchCreate(env, { brandSlug: "wongi", subjectId: subject.id, label: "other" });
    await expect(batch.ideasPick(env, other.id, [ideas[1]!.id])).rejects.toThrow("No idea of batch");
    // One wrong id: nothing is picked, not even the good one.
    await expect(batch.ideasPick(env, b.id, [ideas[1]!.id, "55555555-5555-5555-5555-555555555555"])).rejects.toThrow("No idea of batch");
    await expect(batch.ideasPick(env, b.id, [ideas[1]!.id, ideas[1]!.id])).rejects.toThrow("only once");
    expect((await batch.batchGet(env, b.id)).ideas.find((i: { id: string }) => i.id === ideas[1]!.id)!.picked).toBe(false);
    await expect(batch.ideasPick(env, b.id, [ideas[1]!.id])).resolves.toEqual({ batchId: b.id, picked: [ideas[1]!.id] });
    expect((await batch.batchGet(env, b.id)).ideas.filter((i: { picked: boolean }) => i.picked)).toHaveLength(2);
    const [tof2] = await batch.ideasSave(env, b.id, [{ format: "tof", insight: "x", visual: "x", headline: "x" }]);
    await expect(batch.ideasPick(env, b.id, [tof2!.id])).rejects.toThrow("Pick limit");
    expect(TOOLS.find((t) => t.name === "ideas_pick")!.inputSchema.properties).not.toHaveProperty("picked");
  });

  it("starts only one final when Render is tapped twice at once", async () => {
    const { env, raw } = makeEnv();
    const { b, ideas } = await seed(env);
    const keys = addDraft(raw, b.id, ideas[0]!.id, "88888888-8888-8888-8888-888888888888");
    await batch.picksSave(env, b.id, [{ key: keys[0] }]);
    await batch.ideasUpdate(env, [{ id: ideas[0]!.id, finalPrompt: "C".repeat(50) }]);
    let submits = 0;
    vi.stubGlobal("fetch", async () => {
      submits++;
      return new Response(JSON.stringify({ request_id: "r", status_url: "https://q/s", response_url: "https://q/r" }));
    });
    const out = await Promise.all([batch.finalRender(env, b.id, keys[0]), batch.finalRender(env, b.id, keys[0])]);
    expect(submits).toBe(1);
    expect(out.filter((o) => o.status === "already started")).toHaveLength(1);
  });

  it("frees the pick when fal refuses the final, so Render can be tapped again", async () => {
    const { env, raw } = makeEnv();
    const { b, ideas } = await seed(env);
    const keys = addDraft(raw, b.id, ideas[0]!.id, "99999999-9999-9999-9999-999999999999");
    await batch.picksSave(env, b.id, [{ key: keys[0] }]);
    await batch.ideasUpdate(env, [{ id: ideas[0]!.id, finalPrompt: "D".repeat(50) }]);
    vi.stubGlobal("fetch", async () => new Response("down", { status: 500 }));
    await expect(batch.finalRender(env, b.id, keys[0])).rejects.toThrow("fal submit failed");
    expect(raw.prepare("SELECT final_render_id FROM picks").get()).toEqual({ final_render_id: null });
  });

  /** One pick with a final prompt, and a fal stub that counts the submits. */
  async function claimSetup(renderId: string) {
    const { env, raw } = makeEnv();
    const { b, ideas } = await seed(env);
    const keys = addDraft(raw, b.id, ideas[0]!.id, renderId);
    await batch.picksSave(env, b.id, [{ key: keys[0] }]);
    await batch.ideasUpdate(env, [{ id: ideas[0]!.id, finalPrompt: "E".repeat(50) }]);
    const fal = { submits: 0 };
    vi.stubGlobal("fetch", async () => {
      fal.submits++;
      return new Response(JSON.stringify({ request_id: "r", status_url: "https://q/s", response_url: "https://q/r" }));
    });
    const setClaim = (v: string) => void raw.prepare("UPDATE picks SET final_render_id = ?").run(v);
    const claimNow = () => (raw.prepare("SELECT final_render_id FROM picks").get() as { final_render_id: string | null }).final_render_id;
    return { env, raw, b, ideas, key: keys[0], fal, setClaim, claimNow };
  }
  const ago = (ms: number) => new Date(Date.now() - ms).toISOString();

  it("takes over a final claim that is 3 minutes old when no final was made", async () => {
    const t = await claimSetup("a1a1a1a1-0000-4000-8000-000000000001");
    t.setClaim(`pending:${ago(180_000)}:00000000-0000-4000-8000-000000000000`);
    const r = await batch.finalRender(t.env, t.b.id, t.key);
    expect(t.fal.submits).toBe(1);
    expect(r.status).toBe("queued");
    expect(t.claimNow()).toBe(r.id);
  });

  it("adopts the final that was made after a stale claim, and pays for no second one", async () => {
    const t = await claimSetup("a1a1a1a1-0000-4000-8000-000000000002");
    t.setClaim(`pending:${ago(180_000)}:00000000-0000-4000-8000-000000000000`);
    t.raw
      .prepare(
        `INSERT INTO renders (id, batch, idea, kind, status, prompt, refs, width, height, quality, num_images, usd_est, created_at, updated_at)
         VALUES ('made-1', ?, ?, 'final', 'queued', 'p', '[]', 1536, 1920, 'high', 1, 0.06, ?, ?)`,
      )
      .run(t.b.id, t.ideas[0]!.id, ago(170_000), ago(170_000));
    t.raw.prepare("UPDATE batches SET status = 'board' WHERE id = ?").run(t.b.id);
    expect(await batch.finalRender(t.env, t.b.id, t.key)).toEqual({ id: "made-1", status: "already started" });
    expect(t.fal.submits).toBe(0);
    expect(t.claimNow()).toBe("made-1");
    expect(t.raw.prepare("SELECT status FROM batches WHERE id = ?").get(t.b.id)).toEqual({ status: "finals" });
  });

  it("keeps a final claim that is 10 seconds old", async () => {
    const t = await claimSetup("a1a1a1a1-0000-4000-8000-000000000003");
    const claim = `pending:${ago(10_000)}:00000000-0000-4000-8000-000000000000`;
    t.setClaim(claim);
    expect(await batch.finalRender(t.env, t.b.id, t.key)).toEqual({ id: null, status: "already started" });
    expect(t.fal.submits).toBe(0);
    expect(t.claimNow()).toBe(claim);
  });

  it.each(["0f3b2c1d-0000-4000-8000-000000000000", "f93b2c1d-0000-4000-8000-000000000000", "20261111-0000-4000-8000-000000000000"])(
    "never takes over an old claim that has no time (pending:%s)",
    async (uuid) => {
      const t = await claimSetup("a1a1a1a1-0000-4000-8000-000000000004");
      t.setClaim(`pending:${uuid}`);
      expect(await batch.finalRender(t.env, t.b.id, t.key)).toEqual({ id: null, status: "already started" });
      expect(t.fal.submits).toBe(0);
      expect(t.claimNow()).toBe(`pending:${uuid}`);
    },
  );

  it("closes the pick for ever when fal accepted the final but its row was not saved", async () => {
    const t = await claimSetup("a1a1a1a1-0000-4000-8000-000000000005");
    t.raw.exec("CREATE TRIGGER no_insert BEFORE INSERT ON renders BEGIN SELECT RAISE(ABORT, 'insert refused'); END;");
    await expect(batch.finalRender(t.env, t.b.id, t.key)).rejects.toThrow("Do not submit again");
    expect(t.fal.submits).toBe(1);
    expect(t.claimNow()).toMatch(/^accepted:[0-9a-f-]{36}$/);
    t.raw.exec("DROP TRIGGER no_insert");
    vi.useFakeTimers({ now: Date.now() + 600_000, toFake: ["Date"] });
    try {
      expect(await batch.finalRender(t.env, t.b.id, t.key)).toMatchObject({ id: null, status: "already started", note: expect.stringContaining("tell the owner") });
    } finally {
      vi.useRealTimers();
    }
    expect(t.fal.submits).toBe(1);
    expect((await picksGet(t.env, t.b.id)).picks[0]!.firstFinalId).toBeNull();
  });

  it("closes the pick when the first write of the accepted mark fails", async () => {
    const t = await claimSetup("a1a1a1a1-0000-4000-8000-000000000006");
    t.raw.exec("CREATE TRIGGER no_insert BEFORE INSERT ON renders BEGIN SELECT RAISE(ABORT, 'insert refused'); END;");
    const db = t.env.DB as unknown as { prepare: (sql: string) => { bind: (...v: unknown[]) => { run: () => Promise<unknown> } } };
    const prepare = db.prepare.bind(db);
    let failed = 0;
    db.prepare = (sql) => {
      const stmt = prepare(sql);
      if (!sql.endsWith("WHERE render_key = ? AND final_render_id = ?")) return stmt;
      const bind = stmt.bind.bind(stmt);
      stmt.bind = (...v) => {
        const bound = bind(...v);
        const run = bound.run.bind(bound);
        bound.run = async () => (failed++ === 0 ? Promise.reject(new Error("D1 is busy")) : run());
        return bound;
      };
      return stmt;
    };
    await expect(batch.finalRender(t.env, t.b.id, t.key)).rejects.toThrow("Do not submit again");
    expect(failed).toBe(2);
    expect(t.claimNow()).toMatch(/^accepted:[0-9a-f-]{36}$/);
  });

  it("keeps the final and the pick when fal accepted the job but the spend row cannot be settled", async () => {
    const t = await claimSetup("a1a1a1a1-0000-4000-8000-000000000007");
    t.raw.exec("CREATE TRIGGER no_settle BEFORE UPDATE ON spend BEGIN SELECT RAISE(ABORT, 'settle refused'); END;");
    const r = await batch.finalRender(t.env, t.b.id, t.key);
    expect(r).toMatchObject({ status: "queued" });
    // The spend row stays reserved, and a reservation counts in the cap.
    expect(t.raw.prepare("SELECT status FROM spend WHERE kind = 'final'").all()).toEqual([{ status: "reserved" }]);
    expect(t.fal.submits).toBe(1);
    expect(t.claimNow()).toBe(r.id);
    expect(t.raw.prepare("SELECT COUNT(*) AS n FROM renders WHERE kind = 'final'").get()).toEqual({ n: 1 });
  });

  it("does not block 'board' on a draft render that has no images", async () => {
    const { env, raw } = makeEnv();
    const { b, ideas } = await seed(env);
    raw
      .prepare(
        `INSERT INTO renders (id, batch, idea, kind, status, prompt, refs, width, height, quality, num_images, usd_est, created_at, updated_at)
         VALUES ('q1', ?, ?, 'draft', 'queued', 'p', '[]', 1024, 1280, 'low', 3, 0.02, 'now', 'now')`,
      )
      .run(b.id, ideas[0]!.id);
    await pickAllStages(env, b.id, ideas[1]!.id);
    await expect(batch.batchUpdate(env, { id: b.id, status: "board" })).resolves.toMatchObject({ updated: ["status"] });
  });

  it("needs exactly one picked idea per stage before 'board'", async () => {
    const { env } = makeEnv();
    const { b, ideas } = await seed(env); // tof picked; bof not picked; no mof
    await expect(batch.batchUpdate(env, { id: b.id, status: "board" })).rejects.toThrow("missing: mof, bof");
    await pickAllStages(env, b.id, ideas[1]!.id);
    await expect(batch.batchUpdate(env, { id: b.id, status: "board" })).resolves.toMatchObject({ updated: ["status"] });
  });

  it("checks the pick limit when a picked idea moves to another batch", async () => {
    const { env, raw } = makeEnv();
    const { b, ideas, subject } = await seed(env);
    const other = await batch.batchCreate(env, { brandSlug: "wongi", subjectId: subject.id, label: "W47" });
    await batch.ideasSave(env, other.id, [{ format: "tof", insight: "z", visual: "z", headline: "z", picked: true }]);
    expect(() => raw.prepare("UPDATE ideas SET batch_id = ? WHERE id = ?").run(other.id, ideas[0]!.id)).toThrow("Pick limit");
    expect(raw.prepare("SELECT batch_id FROM ideas WHERE id = ?").get(ideas[0]!.id)).toEqual({ batch_id: b.id });
  });

  it("reports an unknown idea id on update", async () => {
    const { env } = makeEnv();
    await expect(batch.ideasUpdate(env, [{ id: "55555555-5555-5555-5555-555555555555", picked: true }])).rejects.toThrow("No idea");
  });
});

describe("copy review", () => {
  const draft = (b: string, idea: string) => ({ batch: b, idea, kind: "draft", prompt: "P".repeat(50), referenceUrls: ["https://w/m/refs/a.jpg"] });
  const submit = (env: Env, a: Record<string, unknown>) => TOOLS.find((t) => t.name === "render_submit")!.run(env, a);

  it("refuses a draft until the owner approved the words, and again after they change", async () => {
    const { env } = makeEnv();
    const { b, ideas } = await seed(env);
    const id = ideas[0]!.id;
    await expect(submit(env, draft(b.id, id))).rejects.toThrow("has no subline");
    await batch.ideasUpdate(env, [{ id, subline: "Gone by noon." }]);
    await expect(submit(env, draft(b.id, id))).rejects.toThrow("has not approved the words");
    await expect(submit(env, draft(b.id, "77777777-7777-7777-7777-777777777777"))).rejects.toThrow("A draft belongs to an idea of its batch");

    // He changes the headline and approves in one update: the approval keeps the new words.
    await batch.ideasUpdate(env, [{ id, headline: "Wait, there's ten?", subline: "Ten flavours, one cake.", copyApproved: "yes this one" }]);
    await expect(batch.copyApprovedCheck(env, b.id, id)).resolves.toBeUndefined();
    const got = (await batch.batchGet(env, b.id)).ideas.find((i) => i.id === id)!;
    expect(got.headline).toBe("Wait, there's ten?");
    expect(got.copy).toMatchObject({ subline: "Ten flavours, one cake.", ownerApproved: { headline: "Wait, there's ten?", subline: "Ten flavours, one cake.", ownerSaid: "yes this one" } });

    await batch.ideasUpdate(env, [{ id, subline: "Ten flavours." }]);
    await expect(submit(env, draft(b.id, id))).rejects.toThrow("changed after the owner approved");
    await batch.ideasUpdate(env, [{ id, copyApproved: "ok" }]);
    await expect(batch.copyApprovedCheck(env, b.id, id)).resolves.toBeUndefined();
  });

  it("reports an unknown idea on approval, and the schema takes only his words", async () => {
    const { env } = makeEnv();
    await expect(batch.ideasUpdate(env, [{ id: "55555555-5555-5555-5555-555555555555", copyApproved: "yes" }])).rejects.toThrow("No idea");
    const s = TOOLS.find((t) => t.name === "ideas_update")!.inputSchema;
    expect(() => validate(s, { updates: [{ id: "55555555-5555-5555-5555-555555555555", copyApproved: " " }] })).toThrow();
  });
});

describe("monthly spend cap", () => {
  it("does not count last month's spend", async () => {
    const { env, raw } = makeEnv();
    raw.prepare("INSERT INTO spend (at, service, kind, ref, usd_est, status) VALUES ('2000-01-01T00:00:00.000Z', 'fal', 'final', 'old', 4.9, 'spent')").run();
    await expect(reserve(env, "fal", "draft", "new", 1)).resolves.toBeGreaterThan(0);
    expect((await totals(env)).totalUsd).toBe(1);
  });
});

describe("nested tool input", () => {
  const schema = TOOLS.find((t) => t.name === "ideas_save")!.inputSchema;
  const idea = { format: "tof", insight: "insight", visual: "visual", headline: "H" };
  it("fills nested defaults", () => {
    const nested = { type: "object", properties: { list: { type: "array", items: { type: "object", properties: { on: { type: "boolean", default: false } } } } } } as const;
    expect((validate(nested as any, { list: [{}] }) as any).list[0].on).toBe(false);
  });
  it("accepts a good list without a pick: the critic picks later with ideas_pick", () => {
    expect((validate(schema, { batchId: "11111111-1111-1111-1111-111111111111", ideas: [idea] }) as any).ideas[0]).toEqual(idea);
    expect(() => validate(schema, { batchId: "11111111-1111-1111-1111-111111111111", ideas: [{ ...idea, picked: true }] })).toThrow(
      "Unknown argument: ideas[0].picked.",
    );
  });
  it("refuses an unknown nested key with its path", () => {
    expect(() => validate(schema, { batchId: "11111111-1111-1111-1111-111111111111", ideas: [{ ...idea, colour: "red" }] })).toThrow(
      "Unknown argument: ideas[0].colour.",
    );
  });
  it("refuses null for a nested object", () => {
    expect(() => validate(schema, { batchId: "11111111-1111-1111-1111-111111111111", ideas: [{ ...idea, copy: null }] })).toThrow(
      "ideas[0].copy must be an object.",
    );
  });
  it("needs a source URL for every insight", () => {
    const s2 = TOOLS.find((t) => t.name === "batch_update")!.inputSchema;
    expect(() => validate(s2, { id: "11111111-1111-1111-1111-111111111111", insights: [{ truth: "a buyer truth" }] })).toThrow(
      "insights[0].sourceUrl is required.",
    );
  });
  it("refuses a wrong nested type", () => {
    const s3 = TOOLS.find((t) => t.name === "ideas_update")!.inputSchema;
    expect(() => validate(s3, { updates: [{ id: "11111111-1111-1111-1111-111111111111", picked: "yes" }] })).toThrow(
      "updates[0].picked must be true or false.",
    );
  });
});

describe("compose_final with brandSlug", () => {
  it("uses the kit version the batch was made with, not a later one", async () => {
    const { env, raw } = makeEnv();
    const { b, ideas } = await seed(env);
    const v1Logo = (await brandGet(env, "wongi")).kit!.kit.logo.key;
    await brandSave(env, { slug: "wongi", name: "WonGi", kit, note: "v2" });
    const renderId = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
    raw
      .prepare(
        `INSERT INTO renders (id, batch, idea, kind, status, prompt, refs, width, height, quality, num_images, image_keys, usd_est, created_at, updated_at)
         VALUES (?, ?, ?, 'final', 'done', 'p', '[]', 1536, 1920, 'high', 1, ?, 0.06, 'now', 'now')`,
      )
      .run(renderId, b.id, ideas[0]!.id, JSON.stringify([`renders/${renderId}/1.jpg`]));
    const asked: string[] = [];
    (env.MEDIA as unknown as { get: (k: string) => Promise<unknown> }).get = async (k: string) => (asked.push(k), { body: k });
    (env.IMAGES as unknown as { input: () => unknown }).input = () => {
      const self = { transform: () => self, draw: () => self, output: async () => ({ response: () => new Response("jpg") }) };
      return self;
    };
    const tool = TOOLS.find((t) => t.name === "compose_final")!;
    const res = await tool.run(env, validate(tool.inputSchema, { key: `renders/${renderId}/1.jpg`, brandSlug: "wongi" }));
    expect(res.isError).toBeUndefined();
    expect(asked).toContain(v1Logo);
    // The newest compose becomes the render's board image.
    const row = raw.prepare("SELECT composed_key FROM renders WHERE id = ?").get(renderId) as { composed_key: string };
    expect(row.composed_key).toMatch(new RegExp(`^renders/${renderId}/1-c\\d+\\.jpg$`));
  });

  it("refuses a render that is not in a batch of that brand", async () => {
    const { env, raw } = makeEnv();
    const { b, ideas } = await seed(env);
    await brandSave(env, { slug: "other", name: "Other", kit });
    const renderId = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
    raw
      .prepare(
        `INSERT INTO renders (id, batch, idea, kind, status, prompt, refs, width, height, quality, num_images, image_keys, usd_est, created_at, updated_at)
         VALUES (?, ?, ?, 'final', 'done', 'p', '[]', 1536, 1920, 'high', 1, ?, 0.06, 'now', 'now')`,
      )
      .run(renderId, b.id, ideas[0]!.id, JSON.stringify([`renders/${renderId}/1.jpg`]));
    const tool = TOOLS.find((t) => t.name === "compose_final")!;
    await expect(tool.run(env, validate(tool.inputSchema, { key: `renders/${renderId}/1.jpg`, brandSlug: "other" }))).rejects.toThrow(
      "is a render of a batch of another brand, not of other",
    );
    expect(raw.prepare("SELECT composed_key FROM renders WHERE id = ?").get(renderId)).toEqual({ composed_key: null });
  });

  it("uses the latest kit for a render that is in no batch (a free-form batch id)", async () => {
    const { env, raw } = makeEnv();
    await seed(env);
    await brandSave(env, { slug: "wongi", name: "WonGi", kit, note: "v2" });
    const latestLogo = (await brandGet(env, "wongi")).kit!.kit.logo.key;
    const renderId = "cccccccc-cccc-cccc-cccc-cccccccccccc";
    raw
      .prepare(
        `INSERT INTO renders (id, batch, idea, kind, status, prompt, refs, width, height, quality, num_images, image_keys, usd_est, created_at, updated_at)
         VALUES (?, 'phase0-test', 'x', 'final', 'done', 'p', '[]', 1536, 1920, 'high', 1, ?, 0.06, 'now', 'now')`,
      )
      .run(renderId, JSON.stringify([`renders/${renderId}/1.jpg`]));
    const asked: string[] = [];
    (env.MEDIA as unknown as { get: (k: string) => Promise<unknown> }).get = async (k: string) => (asked.push(k), { body: k });
    (env.IMAGES as unknown as { input: () => unknown }).input = () => {
      const self = { transform: () => self, draw: () => self, output: async () => ({ response: () => new Response("jpg") }) };
      return self;
    };
    const tool = TOOLS.find((t) => t.name === "compose_final")!;
    const res = await tool.run(env, validate(tool.inputSchema, { key: `renders/${renderId}/1.jpg`, brandSlug: "wongi" }));
    expect(res.isError).toBeUndefined();
    expect(asked).toContain(latestLogo);
  });
});

describe("owner verdicts", () => {
  const RID = "99999999-9999-4999-8999-999999999999";
  async function setup() {
    const { env, raw } = makeEnv();
    const { b, ideas, subject } = await seed(env);
    const keys = addDraft(raw, b.id, ideas[0]!.id, RID);
    // A final of the same idea: final verdicts are about a final picture, never a draft.
    const FID = "88888888-8888-4888-8888-888888888888";
    addDraft(raw, b.id, ideas[0]!.id, FID, 1);
    raw.prepare("UPDATE renders SET kind = 'final' WHERE id = ?").run(FID);
    const finalKey = `renders/${FID}/1.jpg`;
    return { env, raw, b, ideas, keys, subject, finalKey };
  }

  it("saves each kind of verdict with his words, and taste_log returns them newest first with the limit", async () => {
    const { env, raw, b, ideas, finalKey } = await setup();
    raw.prepare("INSERT INTO packs (id, batch_id, version, token_hash, title, content, created_at) VALUES ('p1', ?, 1, 'h', 't', '{}', 'now')").run(b.id);
    const res = await batch.batchUpdate(env, {
      id: b.id,
      ownerVerdicts: [
        { stage: "draft", mark: "pass", ideaId: ideas[1]!.id, ownerSaid: "none of these" },
        { stage: "final", mark: "fix", key: finalKey, ownerSaid: "logo a bit lower", notes: "v2" },
        { stage: "pack", mark: "approve", packVersion: 1, ownerSaid: "i approve of it" },
        // Copy that is not published yet has no pack version (creative-playbook §6 step 6).
        { stage: "pack", mark: "reject", ownerSaid: "the old copy was better", notes: "new draft copy, not published" },
      ],
    });
    expect(res).toMatchObject({ verdictsSaved: 4, updated: [] });
    const log = await batch.tasteLog(env);
    expect(log.verdicts).toHaveLength(4);
    expect(log.verdicts[0]).toMatchObject({ stage: "pack", mark: "reject", packVersion: null, batch: "W46", idea: null });
    expect(log.verdicts[1]).toMatchObject({ stage: "pack", packVersion: 1, ownerSaid: "i approve of it" });
    // The final's idea comes from its render.
    expect(log.verdicts[2]).toMatchObject({ stage: "final", key: finalKey, notes: "v2", idea: { stage: "tof", headline: "Somehow the jar is empty again." } });
    expect(log.verdicts[3]).toMatchObject({ stage: "draft", mark: "pass", idea: { stage: "bof" } });
    expect((await batch.tasteLog(env, 1)).verdicts).toHaveLength(1);
  });

  it("refuses a verdict that does not fit the batch, and saves none of the call", async () => {
    const { env, raw, b, ideas, keys, subject, finalKey } = await setup();
    const other = await batch.batchCreate(env, { brandSlug: "wongi", subjectId: subject.id, label: "W47" });
    const bad: [batch.OwnerVerdict, RegExp][] = [
      [{ stage: "final", mark: "pass", key: keys[0], ownerSaid: "x" }, /not a mark of stage 'final'/],
      [{ stage: "draft", mark: "approve", ideaId: ideas[0]!.id, ownerSaid: "x" }, /not a mark of stage 'draft'/],
      [{ stage: "draft", mark: "pass", ownerSaid: "x" }, /needs ideaId/],
      [{ stage: "final", mark: "fix", ownerSaid: "x" }, /needs key/],
      [{ stage: "final", mark: "fix", key: "renders/11111111-1111-4111-8111-111111111111/1.jpg", ownerSaid: "x" }, /not a picture of this batch/],
      [{ stage: "final", mark: "fix", key: finalKey, ideaId: ideas[1]!.id, ownerSaid: "x" }, /picture of another idea/],
      [{ stage: "final", mark: "approve", key: keys[0], ownerSaid: "x" }, /a draft, not a final picture/],
      // The render is of this batch, but the key is not one of its saved pictures.
      [{ stage: "final", mark: "fix", key: `renders/${RID}/9.jpg`, ownerSaid: "x" }, /not a picture of this batch/],
      [{ stage: "pack", mark: "approve", packVersion: 3, ownerSaid: "x" }, /no pack version 3/],
    ];
    for (const [v, msg] of bad) {
      await expect(batch.batchUpdate(env, { id: b.id, ownerVerdicts: [{ stage: "draft", mark: "pass", ideaId: ideas[0]!.id, ownerSaid: "ok" }, v] })).rejects.toThrow(msg);
    }
    // An idea of this batch is refused on another batch.
    await expect(batch.batchUpdate(env, { id: other.id, ownerVerdicts: [{ stage: "draft", mark: "pass", ideaId: ideas[0]!.id, ownerSaid: "x" }] })).rejects.toThrow(/not an idea of this batch/);
    await expect(batch.batchUpdate(env, { id: "00000000-0000-4000-8000-000000000000", ownerVerdicts: [{ stage: "pack", mark: "fix", ownerSaid: "x" }] })).rejects.toThrow(/No batch/);
    expect(raw.prepare("SELECT COUNT(*) AS n FROM verdicts").get()).toEqual({ n: 0 });
    // A refused verdict also keeps the batch row as it was: nothing is half saved.
    const before = raw.prepare("SELECT notes, status, updated_at FROM batches WHERE id = ?").get(other.id);
    await expect(
      batch.batchUpdate(env, { id: other.id, notes: "new", status: "done", ownerVerdicts: [{ stage: "draft", mark: "pass", ideaId: ideas[0]!.id, ownerSaid: "x" }] }),
    ).rejects.toThrow(/not an idea of this batch/);
    expect(raw.prepare("SELECT notes, status, updated_at FROM batches WHERE id = ?").get(other.id)).toEqual(before);
  });

  it("checks ownerVerdicts on the MCP batch_update tool", () => {
    const tool = TOOLS.find((t) => t.name === "batch_update")!;
    const id = "12345678-1234-4234-8234-123456789012";
    expect(() => validate(tool.inputSchema, { id, ownerVerdicts: [{ stage: "final", mark: "fix", key: `renders/${RID}/1.jpg`, ownerSaid: "ok" }] })).not.toThrow();
    expect(() => validate(tool.inputSchema, { id, ownerVerdicts: [{ stage: "final", mark: "fix", ownerSaid: "" }] })).toThrow();
    expect(() => validate(tool.inputSchema, { id, ownerVerdicts: [{ stage: "board", mark: "fix", ownerSaid: "ok" }] })).toThrow();
    expect(() => validate(tool.inputSchema, { id, ownerVerdicts: [{ stage: "final", mark: "fix", ownerSaid: "ok", key: "../x" }] })).toThrow();
    expect(() => validate(tool.inputSchema, { id, ownerVerdicts: Array.from({ length: 21 }, () => ({ stage: "pack", mark: "fix", ownerSaid: "ok" })) })).toThrow();
  });
});

describe("backfill of the old owner marks", () => {
  const { readFileSync } = require("node:fs") as typeof import("node:fs");
  const sql = readFileSync(new URL("../scripts/backfill-verdicts.sql", import.meta.url), "utf8");

  it("imports 21 rows on a database with the W46c batch, and a second run adds none", async () => {
    const { env, raw } = makeEnv();
    const { b } = await seed(env);
    raw.prepare("UPDATE batches SET label = 'W46c WonGi Pop Barley (house recipe)' WHERE id = ?").run(b.id);
    await batch.ideasSave(env, b.id, [{ format: "mof", insight: "m", visual: "m", headline: "M", picked: true }]);
    await batch.ideasUpdate(env, [{ id: (await batch.batchGet(env, b.id)).ideas.find((i: { format: string }) => i.format === "bof")!.id, picked: true }]);
    raw.exec(sql);
    raw.exec(sql);
    expect(raw.prepare("SELECT COUNT(*) AS n FROM verdicts").get()).toEqual({ n: 21 });
    expect(raw.prepare("SELECT COUNT(*) AS n FROM verdicts WHERE batch_id IS NULL").get()).toEqual({ n: 3 });
    expect(raw.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    const log = await batch.tasteLog(env, 100);
    expect(log.verdicts).toHaveLength(21);
    expect(log.verdicts[0]).toMatchObject({ stage: "final", mark: "reject", sourceMark: "v11 worse than v10; revert", idea: { stage: "bof" } });
    expect(log.verdicts.find((v) => v.sourceMark === "Corrected: not a product-truth bar")).toMatchObject({ mark: null, batch: null });
  });

  it("adds no W46c row when two batches have the W46c label", async () => {
    const { env, raw } = makeEnv();
    const { b, subject } = await seed(env);
    raw.prepare("UPDATE batches SET label = 'W46c WonGi Pop Barley (house recipe)' WHERE id = ?").run(b.id);
    await batch.batchCreate(env, { brandSlug: "wongi", subjectId: subject.id, label: "W46c WonGi Pop Barley (house recipe)" });
    raw.exec(sql);
    expect(raw.prepare("SELECT COUNT(*) AS n FROM verdicts").get()).toEqual({ n: 3 });
  });

  it("adds only the 3 Phase 0 rows when the W46c batch is not there", () => {
    const { raw } = makeEnv();
    raw.exec(sql);
    expect(raw.prepare("SELECT id FROM verdicts ORDER BY id").all()).toEqual([{ id: "marks-01" }, { id: "marks-02" }, { id: "marks-09" }]);
  });
});
