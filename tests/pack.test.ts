import type { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as batch from "../worker/batch";
import { brandSave } from "../worker/brand";
import type { Env } from "../worker/env";
import worker from "../worker/index";
import * as pack from "../worker/pack";
import { TOOLS } from "../worker/mcp";
import { validate } from "../worker/schema";
import { fakeD1 } from "./helpers/d1";

afterEach(() => vi.unstubAllGlobals());

function makeEnv() {
  const files = new Map<string, string>();
  const outputs: unknown[] = [];
  const MEDIA = {
    put: async (k: string, v: unknown) => void files.set(k, String(v)),
    get: async (k: string) => (files.has(k) ? { body: new Response(files.get(k)).body, httpMetadata: { contentType: "image/jpeg" } } : null),
    delete: async () => {},
  };
  const IMAGES = {
    input: () => ({
      transform: () => IMAGES.input(),
      output: async (o: unknown) => (outputs.push(o), { response: () => new Response("png-bytes", { headers: { "content-type": "image/png" } }) }),
    }),
  };
  const env = { DB: fakeD1(), MEDIA, IMAGES, SPEND_CAP_USD: "5.00", PUBLIC_BASE_URL: "https://w", FAL_KEY: "k" } as unknown as Env;
  return { env, files, outputs, raw: (env.DB as unknown as { raw: DatabaseSync }).raw };
}

const okImage = (u: string) => ({ url: u, ok: true, status: 200, headers: new Headers({ "content-type": u.endsWith(".jpg") ? "image/jpeg" : "image/png" }), body: new Response(new Uint8Array(4)).body });

async function seed(env: Env, raw: DatabaseSync, files: Map<string, string>) {
  vi.stubGlobal("fetch", async (u: string) => okImage(u));
  await brandSave(env, { slug: "won-gi", name: "WonGi", kit: { logoUrl: "https://b.example/logo.png", palette: [{ hex: "#F26A21", role: "logo" }], voice: "Warm and short." } });
  const subject = await batch.subjectSave(env, { brandSlug: "won-gi", kind: "product", title: "Pop Barley", url: "https://b.example/p" });
  await batch.factsSave(env, subject.id, [
    { label: "Price", value: "S$8.90 a jar", quote: "Caramel Pop Barley 70g S$8.90", sourceUrl: "https://b.example/p" },
    { label: "Delivery", value: "Free delivery from S$35", quote: "Free delivery for orders from S$35", sourceUrl: "https://b.example/ship" },
  ]);
  const b = await batch.batchCreate(env, { brandSlug: "won-gi", subjectId: subject.id, label: "W46c" });
  const ideas = await batch.ideasSave(env, b.id, [
    { format: "tof", insight: "jar empties fast", visual: "empty jar", headline: "10 minutes later, poof.", picked: true },
    { format: "bof", insight: "bundle", visual: "four jars", headline: "One shot buy four." },
  ]);
  const finals = ideas.map((idea, i) => {
    const id = `aaaaaaaa-aaaa-aaaa-aaaa-00000000000${i}`;
    raw
      .prepare(
        `INSERT INTO renders (id, batch, idea, kind, status, prompt, refs, width, height, quality, num_images, image_keys, composed_key, usd_est, created_at, updated_at)
         VALUES (?, ?, ?, 'final', 'done', 'p', '[]', 1536, 1920, 'high', 1, ?, ?, 0.06, 'now', 'now')`,
      )
      .run(id, b.id, idea.id, JSON.stringify([`renders/${id}/1.jpg`]), `renders/${id}/1-c1.jpg`);
    files.set(`renders/${id}/1-c1.jpg`, `jpeg-${i}`);
    return id;
  });
  return { b, ideas, finals };
}

const copy = (over: Record<string, unknown> = {}) => ({
  primaryTexts: ["The jar is empty again. S$8.90 a jar, so go on.", "Air-popped, not fried. Free delivery from S$35."],
  headlines: ["Gone in one sitting", "Free delivery from S$35"],
  description: "Air-popped barley",
  cta: "SHOP_NOW" as const,
  why: "The buyer says the jar vanishes (Reddit thread, 07-11-2026).",
  ...over,
});

describe("pack_publish", () => {
  it("publishes a pack with ad names, a one-time link and the fact check", async () => {
    const { env, raw, files } = makeEnv();
    const { b, finals } = await seed(env, raw, files);
    const r = await pack.packPublish(env, { batchId: b.id, ads: [{ renderId: finals[0]!, ...copy() }, { renderId: finals[1]!, ...copy() }], at: new Date("2026-11-07T04:00:00Z") });
    expect(r.version).toBe(1);
    expect(r.adNames).toEqual(["a11_W45_wongi_tof_c01_v1", "a11_W45_wongi_bof_c02_v1"]);
    expect(r.link).toMatch(/^https:\/\/w\/c\/[0-9a-f]{48}$/);
    expect(r.numbersChecked).toBe(2);
    const stored = raw.prepare("SELECT token_hash, content FROM packs").get() as { token_hash: string; content: string };
    expect(stored.token_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(stored.content).not.toContain(r.link.split("/c/")[1]!);
    const again = await pack.packPublish(env, { batchId: b.id, ads: [{ renderId: finals[0]!, ...copy() }] });
    expect(again.version).toBe(2);
    expect(again.adNames[0]).toMatch(/_v2$/);
  });

  it("refuses a number that is not in the fact sheet", async () => {
    const { env, raw, files } = makeEnv();
    const { b, finals } = await seed(env, raw, files);
    await expect(pack.packPublish(env, { batchId: b.id, ads: [{ renderId: finals[0]!, ...copy({ headlines: ["Only S$7.90 a jar", "Gone in one sitting"] }) }] })).rejects.toThrow(/number 7\.90.*not in the fact sheet/);
    expect(raw.prepare("SELECT COUNT(*) AS n FROM packs").get()).toEqual({ n: 0 });
  });

  it("refuses a render that is a draft, from another batch, not composed, or used twice", async () => {
    const { env, raw, files } = makeEnv();
    const { b, ideas, finals } = await seed(env, raw, files);
    const publish = (ads: unknown[], batchId = b.id) => pack.packPublish(env, { batchId, ads: ads as pack.PackAdInput[] });
    raw.prepare("UPDATE renders SET kind = 'draft' WHERE id = ?").run(finals[1]!);
    await expect(publish([{ renderId: finals[1]!, ...copy() }])).rejects.toThrow(/not a finished final/);
    raw.prepare("UPDATE renders SET kind = 'final', composed_key = NULL WHERE id = ?").run(finals[1]!);
    await expect(publish([{ renderId: finals[1]!, ...copy() }])).rejects.toThrow(/compose_final/);
    await expect(publish([{ renderId: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb", ...copy() }])).rejects.toThrow(/not a render of this batch/);
    // A real, composed final that belongs to ANOTHER batch is refused too.
    const other = await batch.batchCreate(env, { brandSlug: "won-gi", subjectId: (raw.prepare("SELECT subject_id FROM batches WHERE id = ?").get(b.id) as { subject_id: string }).subject_id, label: "W47" });
    const [otherIdea] = await batch.ideasSave(env, other.id, [{ format: "tof", insight: "other batch idea", visual: "an empty jar", headline: "Another batch.", picked: true }]);
    const otherRender = "dddddddd-dddd-dddd-dddd-dddddddd0001";
    raw.prepare("INSERT INTO renders (id, batch, idea, kind, status, prompt, refs, width, height, quality, num_images, composed_key, usd_est, created_at, updated_at) VALUES (?, ?, ?, 'final', 'done', 'p', '[]', 1, 1, 'high', 1, 'renders/y/1-c1.jpg', 0, 'n', 'n')").run(otherRender, other.id, otherIdea!.id);
    await expect(publish([{ renderId: otherRender, ...copy() }])).rejects.toThrow(/not a render of this batch/);
    raw.prepare("INSERT INTO renders (id, batch, idea, kind, status, prompt, refs, width, height, quality, num_images, composed_key, usd_est, created_at, updated_at) VALUES (?, ?, ?, 'final', 'done', 'p', '[]', 1, 1, 'high', 1, 'renders/x/1-c1.jpg', 0, 'n', 'n')").run("cccccccc-cccc-cccc-cccc-cccccccccccc", b.id, ideas[0]!.id);
    await expect(publish([{ renderId: finals[0]!, ...copy() }, { renderId: "cccccccc-cccc-cccc-cccc-cccccccccccc", ...copy() }])).rejects.toThrow(/same idea/);
    await expect(publish([{ renderId: finals[0]!, ...copy() }], "dddddddd-dddd-dddd-dddd-dddddddddddd")).rejects.toThrow(/No such batch/);
  });

  it("checks the tool input: two texts, headline 40 characters at most, a known button", () => {
    const t = TOOLS.find((x) => x.name === "pack_publish")!;
    const base = { batchId: "11111111-1111-1111-1111-111111111111" };
    const ad = { renderId: "22222222-2222-2222-2222-222222222222", ...copy() };
    expect(() => validate(t.inputSchema, { ...base, ads: [ad] })).not.toThrow();
    expect(() => validate(t.inputSchema, { ...base, ads: [{ ...ad, headlines: ["x".repeat(41), "fine one"] }] })).toThrow();
    expect(() => validate(t.inputSchema, { ...base, ads: [{ ...ad, primaryTexts: [ad.primaryTexts[0]] }] })).toThrow();
    expect(() => validate(t.inputSchema, { ...base, ads: [{ ...ad, cta: "CLICK_ME" }] })).toThrow();
  });

  it("refuses whitespace-only copy, and uses the default plan for a blank launch plan", async () => {
    const t = TOOLS.find((x) => x.name === "pack_publish")!;
    const base = { batchId: "11111111-1111-1111-1111-111111111111" };
    const ad = { renderId: "22222222-2222-2222-2222-222222222222", ...copy() };
    expect(() => validate(t.inputSchema, { ...base, ads: [{ ...ad, primaryTexts: ["          ", ad.primaryTexts[1]] }] })).toThrow();
    expect(() => validate(t.inputSchema, { ...base, ads: [{ ...ad, headlines: ["   ", "Gone in one sitting"] }] })).toThrow();
    expect(() => validate(t.inputSchema, { ...base, ads: [{ ...ad, description: "   " }] })).toThrow();
    expect(() => validate(t.inputSchema, { ...base, ads: [{ ...ad, why: "                    " }] })).toThrow();
    expect(() => validate(t.inputSchema, { ...base, ads: [ad], launchPlan: " ".repeat(30) })).toThrow();
    const { env, raw, files } = makeEnv();
    const { b, finals } = await seed(env, raw, files);
    const r = await pack.packPublish(env, { batchId: b.id, ads: [{ renderId: finals[0]!, ...copy() }], launchPlan: "   " });
    const stored = JSON.parse((raw.prepare("SELECT content FROM packs WHERE id = ?").get(r.packId) as { content: string }).content);
    expect(stored.launchPlan).toBe(pack.DEFAULT_LAUNCH_PLAN);
  });

  it("gives two publishes for one batch at the same moment two versions, not an error", async () => {
    const { env, raw, files } = makeEnv();
    const { b, finals } = await seed(env, raw, files);
    const one = () => pack.packPublish(env, { batchId: b.id, ads: [{ renderId: finals[0]!, ...copy() }] });
    const [x, y] = await Promise.all([one(), one()]);
    expect([x.version, y.version].sort()).toEqual([1, 2]);
    expect(x.adNames[0]).toMatch(new RegExp(`_v${x.version}$`));
    expect(y.adNames[0]).toMatch(new RegExp(`_v${y.version}$`));
  });

  it("reads numbers and the ISO week", () => {
    expect(pack.numbersIn("S$8.90 a jar, 70g, 1,000 now. Free from S$35.")).toEqual(["8.90", "70", "1,000", "35"]);
    expect(pack.isoWeek(new Date("2026-01-01T00:00:00Z"))).toBe(1);
    expect(pack.isoWeek(new Date("2026-12-31T00:00:00Z"))).toBe(53);
  });
});

import { sentences as sentencesOf } from "../worker/portal";

describe("client portal", () => {
  const get = (env: Env, path: string, method = "GET") => worker.fetch(new Request(`https://w${path}`, { method }), env);

  async function published(extra: Partial<Parameters<typeof pack.packPublish>[1]> = {}) {
    const m = makeEnv();
    const { b, finals } = await seed(m.env, m.raw, m.files);
    const r = await pack.packPublish(m.env, { batchId: b.id, ads: [{ renderId: finals[0]!, ...copy() }], ...extra });
    return { ...m, path: new URL(r.link).pathname, r, finals };
  }

  it("shows the pack, with private headers and no scripts", async () => {
    const { env, path } = await published({ healthProduct: true });
    const r = await get(env, path);
    expect(r.status).toBe(200);
    const html = await r.text();
    expect(html).toContain("10 minutes later, poof.");
    expect(html).toContain("a11_W");
    expect(html).toContain("Launch plan");
    expect(html).toContain("HSA");
    expect(html).toContain("Caramel Pop Barley 70g S$8.90");
    expect(html).not.toContain("<script");
    expect(r.headers.get("x-robots-tag")).toMatch(/noindex/);
    expect(r.headers.get("cache-control")).toBe("private, no-store");
    expect(r.headers.get("referrer-policy")).toBe("no-referrer");
    expect(r.headers.get("content-security-policy")).toMatch(/default-src 'none'/);
  });

  it("puts each sentence of the launch plan on its own line and lets the client enlarge the pictures without scripts", async () => {
    const { env, path } = await published({ launchPlan: "Run all ads for 72 hours. Pause any ad under 1,000 impressions at S$8.90! Send us the CSV.\nThank you." });
    const html = await (await get(env, path)).text();
    expect(html).toContain('<div class="plan"><p>Run all ads for 72 hours.</p><p>Pause any ad under 1,000 impressions at S$8.90!</p><p>Send us the CSV.</p><p>Thank you.</p></div>');
    expect(html).toContain('href="#view-1"');
    expect(html).toContain('id="view-1"');
    expect(html).not.toContain("<script");
    expect(sentencesOf(pack.DEFAULT_LAUNCH_PLAN)).toHaveLength(5);
    expect(sentencesOf('He said "go now." Then (really) stop. Next one.')).toEqual(['He said "go now."', "Then (really) stop.", "Next one."]);
  });

  it("builds the lightbox controls for each ad: close, previous, next and download", async () => {
    const m = makeEnv();
    const { b, finals } = await seed(m.env, m.raw, m.files);
    const r = await pack.packPublish(m.env, { batchId: b.id, ads: [{ renderId: finals[0]!, ...copy() }, { renderId: finals[1]!, ...copy() }] });
    const html = await (await get(m.env, new URL(r.link).pathname)).text();
    const box = (n: number) => html.slice(html.indexOf(`id="view-${n}"`), html.indexOf("</div>", html.indexOf(`id="view-${n}"`)));
    const one = box(1);
    const two = box(2);
    expect(one).toContain('aria-modal="true"');
    expect(one).toContain('class="x" href="#ad-1"');
    expect(one).toContain('class="nav next" href="#view-2"');
    expect(one).not.toContain("nav prev");
    expect(one).toContain('class="dl"');
    expect(two).toContain('class="nav prev" href="#view-1"');
    expect(two).not.toContain("nav next");
    expect(two).toContain('class="x" href="#ad-2"');
    expect(two).toContain('class="dl"');
  });

  it("escapes every value, including copy that carries markup", async () => {
    const m = makeEnv();
    const { b, finals } = await seed(m.env, m.raw, m.files);
    const r = await pack.packPublish(m.env, { batchId: b.id, ads: [{ renderId: finals[0]!, ...copy({ why: `<script>alert(1)</script> & "quotes" at S$8.90` }) }] });
    const html = await (await get(m.env, new URL(r.link).pathname)).text();
    expect(html).not.toContain("<script>alert");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt; &amp; &quot;quotes&quot;");
  });

  it("serves the picture as JPEG, and as PNG through the Images binding", async () => {
    const { env, path, outputs } = await published();
    const jpg = await get(env, `${path}/ad/1.jpg`);
    expect(jpg.headers.get("content-type")).toBe("image/jpeg");
    expect(await jpg.text()).toBe("jpeg-0");
    outputs.length = 0; // the brand kit's logo trim also used the Images binding
    const png = await get(env, `${path}/ad/1.png`);
    expect(png.headers.get("content-type")).toBe("image/png");
    expect(outputs).toEqual([{ format: "image/png" }]);
    expect((await get(env, `${path}/ad/2.jpg`)).status).toBe(404);
  });

  it("answers 404 for a wrong token, a revoked link, a bad path and a POST", async () => {
    const { env, path, r } = await published();
    expect((await get(env, `/c/${"0".repeat(48)}`)).status).toBe(404);
    expect((await get(env, "/c/short")).status).toBe(404);
    expect((await get(env, `${path}/../x`)).status).toBeGreaterThanOrEqual(404);
    expect((await get(env, path, "POST")).status).toBe(404);
    await pack.packRevoke(env, r.packId);
    expect((await get(env, path)).status).toBe(404);
    expect((await get(env, `${path}/ad/1.jpg`)).status).toBe(404);
    await expect(pack.packRevoke(env, r.packId)).rejects.toThrow(/already revoked/);
  });
});
