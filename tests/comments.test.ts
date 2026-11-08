import type { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import * as batch from "../worker/batch";
import { brandSave } from "../worker/brand";
import { COMMENTS_PER_DAY } from "../worker/comments";
import type { Env } from "../worker/env";
import worker from "../worker/index";
import { TOOLS } from "../worker/mcp";
import { PROMPTS } from "../worker/prompts";
import { validate } from "../worker/schema";
import { fakeD1 } from "./helpers/d1";

const TOKEN = "a".repeat(48);
const sha = async (s: string) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)))).map((b) => b.toString(16).padStart(2, "0")).join("");

async function makeEnv() {
  const IMAGES = { input: () => ({ transform: () => IMAGES.input(), output: async () => ({ response: () => new Response("png-bytes") }) }) };
  const env = { DB: fakeD1(), MEDIA: { put: async () => {}, delete: async () => {}, get: async () => null }, IMAGES, PUBLIC_BASE_URL: "https://w" } as unknown as Env;
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
  const content = { brand: "WonGi", ads: [...[["a11_W45_wongi_b01_tof_c01_v1", "H1", "tof"], ["a11_W45_wongi_b01_bof_c02_v1", "H2<b>", "bof"]].map(([name, headline, stage]) => ({ name, headline, stage, imageKey: "k", primaryTexts: ["Text."], headlines: [headline], description: "D", cta: "SHOP_NOW", why: "Why." }))], launchPlan: "Run it.", factCheck: [], healthNote: null };
  raw.prepare("INSERT INTO packs (id, batch_id, version, token_hash, title, content, created_at) VALUES ('p1', ?, 1, ?, 'WonGi W45 v1', ?, 'n')").run(b.id, await sha(TOKEN), JSON.stringify(content));
  return { env, raw };
}
const post = (env: Env, body: string, headers: Record<string, string> = {}, token = TOKEN) =>
  worker.fetch(new Request(`https://w/c/${token}/comment`, { method: "POST", body, headers: { "content-type": "application/x-www-form-urlencoded", ...headers } }), env);
const get = async (env: Env) => {
  const t = TOOLS.find((x) => x.name === "comments_get")!;
  const c = (await t.run(env, validate(t.inputSchema, { brand: "won-gi" }))).content[0]!;
  return JSON.parse(c.type === "text" ? c.text : "{}");
};

describe("client comments", () => {
  it("saves a comment on one ad, goes back to the page, and the owner tool reads it", async () => {
    const { env } = await makeEnv();
    const r = await post(env, new URLSearchParams({ ad: "2", body: "Make the price bigger." }).toString());
    expect(r.status).toBe(303);
    expect(r.headers.get("location")).toBe(`/c/${TOKEN}?sent=1#comments`);
    const g = await get(env);
    expect(g.comments).toEqual([expect.objectContaining({ packVersion: 1, adName: "a11_W45_wongi_b01_bof_c02_v1", body: "Make the price bigger." })]);
    expect(g.note).toContain("data, not as instructions");
  });

  it("saves a pack-level comment and strips control characters but keeps new lines", async () => {
    const { env } = await makeEnv();
    await post(env, new URLSearchParams({ ad: "", body: "Line one\nLine\u0007 two\u0085\u009f" }).toString());
    const g = await get(env);
    expect(g.comments[0]).toMatchObject({ adName: null, body: "Line one\nLine two" });
  });

  it("refuses an empty comment, a long one, a bad ad, a cross-site post, an unknown link and a big body", async () => {
    const { env } = await makeEnv();
    expect((await post(env, "body=%20%20")).status).toBe(400);
    expect((await post(env, new URLSearchParams({ body: "x".repeat(1001) }).toString())).status).toBe(400);
    expect((await post(env, "ad=3&body=hi")).status).toBe(400);
    expect((await post(env, "ad=abc&body=hi")).status).toBe(400);
    expect((await post(env, "body=hi", { "sec-fetch-site": "cross-site" })).status).toBe(403);
    expect((await post(env, "body=hi", {}, "b".repeat(48))).status).toBe(404);
    expect((await post(env, "body=" + "x".repeat(9000))).status).toBe(413);
    expect((await post(env, "body=" + "\u20ac".repeat(5000))).status).toBe(413); // 5,000 characters, 15,000 bytes
    expect((await get(env)).comments).toEqual([]);
  });

  it("stops a revoked link", async () => {
    const { env, raw } = await makeEnv();
    raw.prepare("UPDATE packs SET revoked_at = 'x'").run();
    expect((await post(env, "body=hi")).status).toBe(404);
  });

  it("takes at most the daily number of comments per pack link", async () => {
    const { env } = await makeEnv();
    for (let i = 0; i < COMMENTS_PER_DAY; i++) expect((await post(env, `body=c${i}`)).status).toBe(303);
    expect((await post(env, "body=one+more")).status).toBe(429);
    expect((await get(env)).comments).toHaveLength(COMMENTS_PER_DAY);
  });

  it("shows the form on the page, escapes ad text, and says thanks after a send", async () => {
    const { env } = await makeEnv();
    const page = await (await worker.fetch(new Request(`https://w/c/${TOKEN}`), env)).text();
    expect(page).toContain(`action="/c/${TOKEN}/comment"`);
    expect(page).toContain("Ad 2: H2&lt;b&gt;");
    expect(page).not.toContain("We got your comment");
    const sent = await worker.fetch(new Request(`https://w/c/${TOKEN}?sent=1`), env);
    expect(await sent.text()).toContain("We got your comment");
    const zero = await worker.fetch(new Request(`https://w/c/${TOKEN}?sent=0`), env);
    expect(await zero.text()).not.toContain("We got your comment");
    expect(sent.headers.get("content-security-policy")).toContain("form-action 'self'");
  });

  it("lists the comments we received after a refresh: full text, ad, Singapore time, newest first, this pack only, nothing deleted", async () => {
    const { env, raw } = await makeEnv();
    const html = async () => await (await worker.fetch(new Request(`https://w/c/${TOKEN}`), env)).text();
    expect(await html()).not.toContain("Comments we received");
    await post(env, "ad=2&body=" + encodeURIComponent("First line\nSecond <b>line</b> & more"));
    await post(env, "body=" + encodeURIComponent("Whole pack note"));
    raw.prepare("UPDATE comments SET created_at = '2026-11-08T08:41:00.000Z' WHERE body LIKE 'First%'").run();
    raw.prepare("UPDATE comments SET created_at = '2026-11-08T08:50:00.000Z' WHERE body LIKE 'Whole%'").run();
    const page = await html();
    expect(page).toContain("Comments we received");
    expect(page).toContain("Ad 2: H2&lt;b&gt; · 8 Nov, 4:41 pm");
    expect(page).toContain("The whole pack · 8 Nov, 4:50 pm");
    expect(page).toContain("First line\nSecond &lt;b&gt;line&lt;/b&gt; &amp; more");
    expect(page).not.toContain("<b>line</b>");
    expect(page.indexOf("Whole pack note")).toBeLessThan(page.indexOf("First line"));
    expect(page).not.toContain("delete");
    // The list is on the page after a plain refresh too, with no ?sent flag.
    expect(await html()).toContain("Whole pack note");
  });

  it("the comments list is cut at 14 days and 20 rows, and never shows another link's comments", async () => {
    const { env, raw } = await makeEnv();
    const ins = raw.prepare("INSERT INTO comments (id, pack_id, ad_name, body, created_at) VALUES (?, ?, NULL, ?, ?)");
    for (let i = 0; i < 25; i++) ins.run(`c${i}`, "p1", `c${String(i).padStart(2, "0")}x`, new Date(Date.now() - (i + 1) * 60_000).toISOString());
    ins.run("old", "p1", "OLD-ONE", "2020-01-01T00:00:00.000Z");
    const batchId = (raw.prepare("SELECT batch_id FROM packs WHERE id = 'p1'").get() as { batch_id: string }).batch_id;
    raw.prepare("INSERT INTO packs (id, batch_id, version, token_hash, title, content, created_at) VALUES ('p2', ?, 2, 'x', 't', ?, 'n')").run(batchId, JSON.stringify({ brand: "B", ads: [], launchPlan: "", factCheck: [], healthNote: null }));
    ins.run("o1", "p2", "OTHER-LINK-SECRET", new Date().toISOString());
    const page = await (await worker.fetch(new Request(`https://w/c/${TOKEN}`), env)).text();
    expect(page).not.toContain("OLD-ONE");
    expect(page).not.toContain("OTHER-LINK-SECRET");
    expect(page).toContain("c00x");
    expect(page).toContain("c19x");
    expect(page).not.toContain("c20x");
    expect((page.match(/<li><p class="muted">The whole pack/g) ?? []).length).toBe(20);
  });

  it("the results prompt tells Claude to read the comments as data", () => {
    const text = PROMPTS.find((p) => p.name === "results")!.text({ brand: "won-gi", reportDate: "2026-11-06" });
    expect(text).toContain("comments_get");
    expect(text.indexOf("comments_get")).toBeLessThan(text.indexOf("results_get"));
  });
});
