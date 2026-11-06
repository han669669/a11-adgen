import type { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as batch from "../worker/batch";
import { brandGet, brandSave } from "../worker/brand";
import type { Env } from "../worker/env";
import { TOOLS } from "../worker/mcp";
import { validate } from "../worker/schema";
import { reserve, totals } from "../worker/spend";
import { fakeD1 } from "./helpers/d1";

afterEach(() => vi.unstubAllGlobals());

const img = (url: string, type = "image/png") => ({ url, ok: true, status: 200, headers: new Headers({ "content-type": type }), body: "bytes", arrayBuffer: async () => new ArrayBuffer(4) });

function makeEnv() {
  const saved = new Map<string, unknown>();
  const IMAGES = {
    input: () => {
      const self = { transform: () => self, output: async () => ({ response: () => new Response("png") }) };
      return self;
    },
  };
  const MEDIA = { put: async (k: string, v: unknown) => void saved.set(k, v), get: async () => null };
  const env = { DB: fakeD1(), MEDIA, IMAGES, SPEND_CAP_USD: "5.00", PUBLIC_BASE_URL: "https://w", FAL_KEY: "k" } as unknown as Env;
  return { env, saved, raw: (env.DB as unknown as { raw: DatabaseSync }).raw };
}

const kit = {
  logoUrl: "https://brand.example/logo.png",
  palette: [{ hex: "#F26A21", role: "logo orange" }],
  voice: "Warm, playful, short sentences.",
  refs: [{ url: "https://brand.example/closeup.jpg", label: "kernels close-up", role: "texture" as const }],
};

async function seed(env: Env) {
  vi.stubGlobal("fetch", async (u: string) => img(u, u.endsWith(".jpg") ? "image/jpeg" : "image/png"));
  await brandSave(env, { slug: "wongi", name: "WonGi", kit });
  const subject = await batch.subjectSave(env, { brandSlug: "wongi", kind: "product", title: "Pop Barley", url: "https://brand.example/p" });
  const b = await batch.batchCreate(env, { brandSlug: "wongi", subjectId: subject.id, label: "W46" });
  const ideas = await batch.ideasSave(env, b.id, [
    { format: "hook", insight: "jar empties fast", visual: "empty jar", headline: "Somehow the jar is empty again.", picked: true },
    { format: "offer", insight: "bundle", visual: "three jars", headline: "Three jars. One price." },
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
    const { env, saved } = makeEnv();
    vi.stubGlobal("fetch", async (u: string) => img(u, u.endsWith(".jpg") ? "image/jpeg" : "image/png"));
    const v1 = await brandSave(env, { slug: "wongi", name: "WonGi", kit });
    const v2 = await brandSave(env, { slug: "wongi", name: "WonGi", kit, note: "new voice" });
    expect([v1.version, v2.version]).toEqual([1, 2]);
    expect(v1.kit.logo.key).toMatch(/^brands\/[0-9a-f-]{36}\/v1-logo\.png$/);
    expect(v1.kit.refs[0]!).toMatchObject({ role: "texture", sourceUrl: kit.refs[0]!.url });
    expect(v1.kit.refs[0]!.key).toMatch(/v1-ref1\.jpg$/);
    expect(v1.kit.placement).toEqual({ logoWidthPct: 28, logoTopPct: 3 });
    expect(saved.size).toBe(4);
    expect((await brandGet(env, "wongi")).kit?.version).toBe(2);
    expect((await brandGet(env, "wongi", 1)).kit?.version).toBe(1);
  });
  it("refuses an SVG logo", async () => {
    const { env } = makeEnv();
    vi.stubGlobal("fetch", async (u: string) => img(u, "image/svg+xml"));
    await expect(brandSave(env, { slug: "wongi", name: "WonGi", kit })).rejects.toThrow("not SVG");
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

  it("ranks drafts, records picks and returns them sorted on batch_get", async () => {
    const { env, raw } = makeEnv();
    const { b, ideas } = await seed(env);
    const keys = addDraft(raw, b.id, ideas[0]!.id, "11111111-1111-1111-1111-111111111111");
    await batch.draftsRank(env, b.id, [
      { key: keys[0], rank: 3 },
      { key: keys[1], rank: 1, reason: "clean jar" },
      { key: keys[2], rank: 2 },
    ]);
    await batch.picksSave(env, b.id, [{ key: keys[1], note: "yes" }]);
    const got = await batch.batchGet(env, b.id);
    const hook = got.ideas.find((i) => i.id === ideas[0]!.id)!;
    expect(hook.drafts.map((d) => d.key)).toEqual([keys[1], keys[2], keys[0]]);
    expect(hook.drafts[0]!).toMatchObject({ rank: 1, picked: true, reason: "clean jar" });
    expect(got.picks).toEqual([{ key: keys[1], ideaId: ideas[0]!.id, note: "yes", finalRenderId: null }]);
    expect(got.kit?.logo.key).toMatch(/v1-logo\.png$/);
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
    await batch.picksSave(env, b.id, [{ key: keys[0] }, { key: keys[1] }]);
    raw.prepare("UPDATE picks SET final_render_id = 'f1' WHERE render_key = ?").run(keys[0]);
    await batch.picksSave(env, b.id, [{ key: keys[2] }]);
    const left = raw.prepare("SELECT render_key FROM picks ORDER BY render_key").all().map((r: any) => r.render_key);
    expect(left).toEqual([keys[0], keys[2]]);
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
    await expect(batch.batchUpdate(env, { id: b.id, status: "board" })).rejects.toThrow("finalPrompt");
    await batch.ideasUpdate(env, [{ id: ideas[0]!.id, finalPrompt: "B".repeat(50) }]);
    await expect(batch.batchUpdate(env, { id: b.id, status: "board" })).resolves.toMatchObject({ updated: ["status"] });
  });

  it("reports an unknown idea id on update", async () => {
    const { env } = makeEnv();
    await expect(batch.ideasUpdate(env, [{ id: "55555555-5555-5555-5555-555555555555", picked: true }])).rejects.toThrow("No idea");
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
  const idea = { format: "hook", insight: "insight", visual: "visual", headline: "H" };
  it("fills nested defaults and accepts a good list", () => {
    const out = validate(schema, { batchId: "11111111-1111-1111-1111-111111111111", ideas: [idea] }) as any;
    expect(out.ideas[0].picked).toBe(false);
  });
  it("refuses an unknown nested key with its path", () => {
    expect(() => validate(schema, { batchId: "11111111-1111-1111-1111-111111111111", ideas: [{ ...idea, colour: "red" }] })).toThrow(
      "Unknown argument: ideas[0].colour.",
    );
  });
  it("refuses a wrong nested type", () => {
    expect(() => validate(schema, { batchId: "11111111-1111-1111-1111-111111111111", ideas: [{ ...idea, picked: "yes" }] })).toThrow(
      "ideas[0].picked must be true or false.",
    );
  });
});
