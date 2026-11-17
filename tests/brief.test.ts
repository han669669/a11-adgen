import type { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as batch from "../worker/batch";
import type { Env } from "../worker/env";
import { TOOLS } from "../worker/mcp";
import { normalise, quoteIn } from "../worker/research";
import { validate } from "../worker/schema";
import { exampleBrief, SOURCES, SRC } from "./fixtures/brief";
import { fakeD1 } from "./helpers/d1";

/** a11-engine v3 Phase 1: research sources, the quote check and the brief (design pack §1.12). */

afterEach(() => vi.unstubAllGlobals());

function makeEnv() {
  const env = { DB: fakeD1(), SPEND_CAP_USD: "5.00", PUBLIC_BASE_URL: "https://w", EXA_API_KEY: "k" } as unknown as Env;
  const raw = (env.DB as unknown as { raw: DatabaseSync }).raw;
  raw.prepare("INSERT INTO brands (id, slug, name, created_at, updated_at) VALUES ('b1', 'pasar', 'Pasar Pantry', 'now', 'now')").run();
  raw.prepare("INSERT INTO brand_kits (id, brand_id, version, kit, created_at) VALUES ('k1', 'b1', 1, '{}', 'now')").run();
  return { env, raw };
}
const run = async (env: Env, name: string, args: unknown) => {
  const t = TOOLS.find((x) => x.name === name)!;
  const c = (await t.run(env, validate(t.inputSchema, t.prepare ? t.prepare(args) : args))).content[0]!;
  return JSON.parse(c.type === "text" ? c.text : "{}");
};

/** A batch with the example's sources stored and two facts, one of them checked against a stored page. */
async function seeded(engine: 2 | 3 = 2) {
  const { env, raw } = makeEnv();
  const subject = await run(env, "subject_save", { brandSlug: "pasar", kind: "product", title: "Gula Melaka Granola", url: "https://example.com/p" });
  let b = await run(env, "batch_create", { brandSlug: "pasar", subjectId: subject.id, label: "W48" });
  if (engine === 3) {
    // batch_create makes engine 2 batches only, and the engine of a batch is fixed: copy the row as an engine 3 batch.
    const cols = (raw.prepare("PRAGMA table_info(batches)").all() as { name: string }[]).map((c) => c.name).filter((c) => c !== "id" && c !== "engine");
    raw.prepare(`INSERT INTO batches (id, engine, ${cols.join(", ")}) SELECT ?, 3, ${cols.join(", ")} FROM batches WHERE id = ?`).run("e3000000-0000-4000-8000-000000000003", b.id);
    b = { id: "e3000000-0000-4000-8000-000000000003" };
  }
  const add = raw.prepare(
    "INSERT INTO research_sources (id, batch_id, url, title, retrieved_at, via, text) VALUES (?, ?, ?, '', '2026-11-17T00:00:00.000Z', 'contents', ?)",
  );
  for (const s of SOURCES) add.run(s.id, b.id, s.url, s.text);
  add.run("50000000-0000-4000-8000-000000000007", b.id, "https://example.com/p", "Gula Melaka Granola. 300 g pouch. S$12.90.");
  const facts = await run(env, "facts_save", {
    subjectId: subject.id,
    batchId: b.id,
    facts: [
      { label: "pack size", value: "300 g", quote: "300 g pouch", sourceUrl: "https://example.com/p" },
      { label: "price", value: "S$12.90", quote: "S$12.90", sourceUrl: "https://example.com/p" },
    ],
  });
  return { env, raw, subjectId: subject.id as string, batchId: b.id as string, factIds: facts.map((f: { id: number }) => String(f.id)) as string[] };
}
const save = (env: Env, batchId: string, brief: unknown) => run(env, "brief_save", { batchId, brief, promptVersion: "0.2.10" });

describe("quote check", () => {
  it("(1.6) matches across case, curly quotes, dashes and line breaks, and never an empty quote", () => {
    expect(normalise("  It’s “NOT”\n\tbreakfast — ok ")).toBe("it's \"not\" breakfast - ok");
    expect(quoteIn("it's not breakfast - it's a lifestyle", SOURCES.find((s) => s.id === SRC.curly)!.text)).toBe(true);
    expect(quoteIn("it's not lunch", SOURCES.find((s) => s.id === SRC.curly)!.text)).toBe(false);
    expect(quoteIn("   ", "anything")).toBe(false);
  });
});

describe("research sources", () => {
  const stubExa = () =>
    vi.stubGlobal("fetch", async (url: string) => {
      const results = url.endsWith("/search")
        ? [
            { title: "Reddit thread", url: "https://r.example/t", publishedDate: "2026-10-01", highlights: ["too sweet", "kids love it"] },
            { title: "Review", url: "https://r.example/r", highlights: ["gone in a day"] },
          ]
        : [{ url: "https://r.example/t", title: "Reddit thread", text: "x".repeat(25_000) }];
      return new Response(JSON.stringify({ results }), { status: 200, headers: { "content-type": "application/json" } });
    });

  it("(1.1, 1.2) keeps each result once per batch and tool, and returns its sourceId", async () => {
    const { env, raw, batchId } = await seeded();
    stubExa();
    const first = await run(env, "exa_search", { query: "granola singapore", batchId });
    expect(first.results.map((r: { sourceId: string }) => r.sourceId)).toEqual([expect.stringMatching(/^[0-9a-f-]{36}$/), expect.stringMatching(/^[0-9a-f-]{36}$/)]);
    const again = await run(env, "exa_search", { query: "granola again", batchId });
    expect(again.results[0].sourceId).toBe(first.results[0].sourceId);
    const rows = raw.prepare("SELECT url, text, published_date AS p, query FROM research_sources WHERE via = 'search' ORDER BY url").all();
    expect(rows).toEqual([
      { url: "https://r.example/r", text: "gone in a day", p: null, query: "granola singapore" },
      { url: "https://r.example/t", text: "too sweet\nkids love it", p: "2026-10-01", query: "granola singapore" },
    ]);
    // The same URL through the other tool is another row; its text is cut at 20,000 characters.
    const page = await run(env, "exa_contents", { urls: ["https://r.example/t"], batchId });
    expect(page.pages[0].sourceId).not.toBe(first.results[0].sourceId);
    expect(raw.prepare("SELECT length(text) AS n FROM research_sources WHERE via = 'contents' AND url = 'https://r.example/t'").get()).toEqual({ n: 20_000 });
    // batch_get lists the sources without their text.
    const got = await batch.batchGet(env, batchId);
    expect(got.sources.length).toBe(SOURCES.length + 1 + 3);
    expect(JSON.stringify(got.sources)).not.toContain("too sweet");
  });

  it("(1.3) without batchId keeps nothing and answers as before", async () => {
    const { env, raw } = await seeded();
    stubExa();
    const before = raw.prepare("SELECT COUNT(*) AS n FROM research_sources").get();
    const s = await run(env, "exa_search", { query: "granola singapore" });
    expect(s.results[0]).toEqual({ title: "Reddit thread", url: "https://r.example/t", publishedDate: "2026-10-01", highlights: ["too sweet", "kids love it"] });
    expect(raw.prepare("SELECT COUNT(*) AS n FROM research_sources").get()).toEqual(before);
  });

  it("does not block research when the batch is unknown", async () => {
    const { env } = await seeded();
    stubExa();
    const s = await run(env, "exa_search", { query: "granola singapore", batchId: "99999999-9999-4999-8999-999999999999" });
    expect(s.results[0].sourceId).toBeNull();
    expect(s.warning).toMatch(/not stored/);
  });
});

describe("facts check", () => {
  it("(1.15, 1.16) marks a fact verified when its quote is on the stored page, false when not, null when the page is not stored", async () => {
    const { env, subjectId, batchId } = await seeded();
    const facts = await run(env, "facts_save", {
      subjectId,
      batchId,
      facts: [
        { label: "offer", value: "1 for 1", quote: "1-for-1 this week", sourceUrl: "https://example.com/p" },
        { label: "award", value: "Best granola", quote: "best granola 2025", sourceUrl: "https://example.com/awards" },
      ],
    });
    expect(facts.map((f: { label: string; verified: boolean | null }) => [f.label, f.verified])).toEqual([
      ["pack size", true],
      ["price", true],
      ["offer", false],
      ["award", null],
    ]);
    expect(facts[0].retrievedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    // Without batchId, nothing is checked.
    const plain = await run(env, "facts_save", { subjectId, facts: [{ label: "x", value: "y", quote: "300 g pouch", sourceUrl: "https://example.com/p" }] });
    expect(plain.at(-1).verified).toBeNull();
    // A batch of another subject is refused.
    const other = await run(env, "subject_save", { brandSlug: "pasar", kind: "brand", title: "Pasar Pantry" });
    await expect(run(env, "facts_save", { subjectId: other.id, batchId, facts: [{ label: "x", value: "y", quote: "q", sourceUrl: "https://example.com/p" }] })).rejects.toThrow(/not a batch of subject/);
  });
});

describe("brief_save", () => {
  it("(1.4, 1.10, 1.11) saves version 1 with every quote verified, version 2 next to it, and batch_get returns the newest", async () => {
    const { env, raw, subjectId, batchId, factIds } = await seeded();
    const r1 = await save(env, batchId, exampleBrief(subjectId, factIds));
    expect(r1).toMatchObject({ version: 1, unverified: [] });
    // The forum and the review are two domains, so 'high' has no warning; the facts are verified.
    expect(r1.warnings).toEqual([]);
    const stored = (await batch.batchGet(env, batchId)).brief!;
    expect(stored.version).toBe(1);
    const e1 = (stored.brief.evidence as { id: string; verified: boolean; url: string; retrievedAt: string }[]).find((e) => e.id === "e1")!;
    expect(e1).toMatchObject({ verified: true, url: "https://example.com/about", retrievedAt: "2026-11-17T00:00:00.000Z" });
    const r2 = await save(env, batchId, { ...exampleBrief(subjectId, factIds), unknowns: [] });
    expect(r2.version).toBe(2);
    expect(raw.prepare("SELECT version, author, prompt_version AS pv FROM batch_records WHERE kind = 'brief' ORDER BY version").all()).toEqual([
      { version: 1, author: "main", pv: "0.2.10" },
      { version: 2, author: "main", pv: "0.2.10" },
    ]);
    const got = await batch.batchGet(env, batchId);
    expect(got.brief).toMatchObject({ version: 2, brief: { unknowns: [] } });
    expect(got.engine).toBe(2);
    // A new session reads the same brief through the tool.
    const viaTool = await run(env, "batch_get", { id: batchId });
    expect(viaTool.brief.version).toBe(2);
  });

  it("(1.5, 1.7) marks a changed quote not verified, warns on the insight it supports, and still saves", async () => {
    const { env, subjectId, batchId, factIds } = await seeded();
    const brief = exampleBrief(subjectId, factIds);
    brief.evidence[1]!.quote = "bought it for lunch but i keep eating it straight from the bag at night";
    brief.evidence[2]!.quote = "supposed to last three weeks";
    const r = await save(env, batchId, brief);
    expect(r.version).toBe(1);
    expect(r.unverified).toEqual(["e2", "e3"]);
    expect(r.warnings.join("\n")).toMatch(/buyerInsights\[0\] \(i1\) has basis 'evidence' but no verified evidence/);
  });

  it("(1.8) warns on an SG insight with no SG evidence, buyer evidence that is not a buyer, and high confidence from one domain", async () => {
    const { env, subjectId, batchId, factIds } = await seeded();
    const brief = exampleBrief(subjectId, factIds);
    brief.buyerInsights.push({ id: "i3", text: "x", tension: "y", basis: "evidence", evidenceIds: ["e4"], confidence: "high", market: "SG" });
    brief.buyerInsights.push({ id: "i4", text: "x", tension: "y", basis: "evidence", evidenceIds: ["e1"], confidence: "medium", market: "SG" });
    const w = (await save(env, batchId, brief)).warnings.join("\n");
    expect(w).toMatch(/\(i3\) is marked SG but has no SG evidence/);
    expect(w).toMatch(/\(i4\) has basis 'evidence' but none of its evidence is a buyer/);
    expect(w).toMatch(/buyerInsights\[2\] has confidence 'high' with evidence from 1 domain/);
  });

  it("(1.13) gives owner-supplied evidence verified null and no warning", async () => {
    const { env, subjectId, batchId, factIds } = await seeded();
    const brief = exampleBrief(subjectId, factIds);
    brief.evidence.push({ id: "e6", sourceType: "owner_supplied", quote: "our best seller in October", speaker: "brand", market: "SG" } as unknown as (typeof brief.evidence)[number]);
    brief.brand.positioning.evidenceIds = ["e1", "e6"];
    const r = await save(env, batchId, brief);
    expect(r.unverified).toEqual([]);
    expect(r.warnings).toEqual([]);
    const e6 = ((await batch.batchGet(env, batchId)).brief!.brief.evidence as { id: string; verified: unknown }[]).find((e) => e.id === "e6")!;
    expect(e6.verified).toBeNull();
    // Public evidence with no source is not verified.
    brief.evidence.push({ id: "e7", url: "https://example.com/x", sourceType: "forum", quote: "no source", speaker: "buyer", market: "SG" } as unknown as (typeof brief.evidence)[number]);
    expect((await save(env, batchId, brief)).unverified).toEqual(["e7"]);
  });

  it("(1.17) warns on a fact that is not verified", async () => {
    const { env, subjectId, batchId } = await seeded();
    const facts = await run(env, "facts_save", { subjectId, facts: [{ label: "halal", value: "yes", quote: "Halal certified", sourceUrl: "https://example.com/h" }] });
    const r = await save(env, batchId, exampleBrief(subjectId, [String(facts.at(-1).id)]));
    expect(r.warnings).toEqual([expect.stringMatching(/^Fact \d+ \(halal\) is not verified: its quote was not checked against a stored page/)]);
  });

  it("(1.9) refuses evidence that is not there, a fact of another subject, a source of another batch and a wrong shape", async () => {
    const { env, raw, subjectId, batchId, factIds } = await seeded();
    const missing = exampleBrief(subjectId, factIds);
    missing.buyerInsights[0]!.evidenceIds = ["e2", "e99"];
    await expect(save(env, batchId, missing)).rejects.toThrow(/not in the evidence list: e99/);
    const other = await run(env, "subject_save", { brandSlug: "pasar", kind: "brand", title: "Pasar Pantry" });
    const foreign = await run(env, "facts_save", { subjectId: other.id, facts: [{ label: "x", value: "y", quote: "q", sourceUrl: "https://example.com/p" }] });
    await expect(save(env, batchId, exampleBrief(subjectId, [String(foreign[0].id)]))).rejects.toThrow(/not facts of this batch's subject/);
    await expect(save(env, batchId, exampleBrief(other.id, []))).rejects.toThrow(/must be the subject of batch/);
    const stranger = exampleBrief(subjectId, factIds);
    stranger.evidence[0]!.sourceId = "50000000-0000-4000-8000-0000000000ff";
    await expect(save(env, batchId, stranger)).rejects.toThrow(/not sources of this batch/);
    const twice = exampleBrief(subjectId, factIds);
    twice.evidence.push({ ...twice.evidence[0]! });
    await expect(save(env, batchId, twice)).rejects.toThrow(/only once/);
    await expect(save(env, "99999999-9999-4999-8999-999999999999", exampleBrief(subjectId, factIds))).rejects.toThrow(/No batch/);
    const bad = exampleBrief(subjectId, factIds) as Record<string, unknown>;
    bad.buyerInsights = Array.from({ length: 13 }, (_, i) => ({ ...exampleBrief(subjectId, factIds).buyerInsights[0]!, id: `i${i}` }));
    await expect(save(env, batchId, bad)).rejects.toThrow(/at most 12/);
    await expect(save(env, batchId, { ...exampleBrief(subjectId, factIds), customerData: "x" })).rejects.toThrow(/Unknown argument/);
    expect(raw.prepare("SELECT COUNT(*) AS n FROM batch_records").get()).toEqual({ n: 0 });
  });

  it("saves a brief read back with batch_get again as it is, and takes the url and date from the stored source", async () => {
    const { env, subjectId, batchId, factIds } = await seeded();
    const brief = exampleBrief(subjectId, factIds);
    brief.evidence[0] = { ...brief.evidence[0]!, url: "https://wrong.example/x", publishedDate: "1999-01-01" } as (typeof brief.evidence)[0];
    brief.evidence.push({ id: "e6", sourceId: undefined as unknown as string, sourceType: "owner_supplied", quote: "We bake on Tuesdays.", speaker: "brand", market: "SG" });
    await save(env, batchId, brief);
    const read = await run(env, "batch_get", { id: batchId });
    const e1 = read.brief.brief.evidence.find((e: { id: string }) => e.id === "e1");
    expect(e1).toMatchObject({ url: "https://example.com/about", verified: true });
    expect(e1).not.toHaveProperty("publishedDate");
    expect(read.brief.brief.evidence.find((e: { id: string }) => e.id === "e6").verified).toBeNull();
    // The brief as batch_get gave it, with verified null and retrievedAt, is a valid input.
    const again = await save(env, batchId, read.brief.brief);
    expect(again).toMatchObject({ version: 2, unverified: [] });
  });

  it("(1.12) an engine 2 batch has brief null and keeps every old field", async () => {
    const { env, batchId } = await seeded();
    const got = await batch.batchGet(env, batchId);
    expect(got).toMatchObject({ engine: 2, brief: null, status: "research" });
    expect(got).toHaveProperty("insights");
    expect(got).toHaveProperty("ideas");
    expect(got).not.toHaveProperty("nextStep");
  });

  it("(1.11) an engine 3 batch gives nextStep brief, then concepts after the brief", async () => {
    const { env, subjectId, batchId, factIds } = await seeded(3);
    expect((await batch.batchGet(env, batchId)).nextStep).toBe("brief");
    await save(env, batchId, exampleBrief(subjectId, factIds));
    expect(await batch.batchGet(env, batchId)).toMatchObject({ engine: 3, nextStep: "concepts" });
  });
});

describe("nextStepV3", () => {
  const idea = (id: string, over: Record<string, unknown> = {}) => ({
    id, picked: true, copy: { ownerApproved: "ok" }, directed: true, ranked: true, draftsDone: true, finals: [{ status: "done", ready: true }], ...over,
  });
  const three = (over: Record<string, unknown> = {}) => [idea("a", over), idea("b"), idea("c"), idea("d", { picked: false })];
  const all = new Set(["a", "b", "c"]);

  it("gives the first step that is not done, in the batch order", () => {
    expect(batch.nextStepV3("research", false, [], all)).toBe("brief");
    expect(batch.nextStepV3("research", true, [], all)).toBe("concepts");
    expect(batch.nextStepV3("ideas", true, [idea("a"), idea("b"), idea("c", { picked: false })], all)).toBe("concept_review");
    expect(batch.nextStepV3("ideas", true, three({ copy: {} }), all)).toBe("copy_review");
    expect(batch.nextStepV3("ideas", true, three({ directed: false }), all)).toBe("direction");
    expect(batch.nextStepV3("drafts", true, three({ draftsDone: false }), all)).toBe("drafts");
    expect(batch.nextStepV3("drafts", true, three({ ranked: false }), all)).toBe("draft_rank");
    expect(batch.nextStepV3("drafts", true, three(), all)).toBe("board");
    expect(batch.nextStepV3("board", true, three(), new Set(["b", "c"]))).toBe("owner_pick");
    expect(batch.nextStepV3("finals", true, three({ finals: [] }), all)).toBe("finals");
    // A queued or failed final is not done.
    expect(batch.nextStepV3("finals", true, three({ finals: [{ status: "queued" }, { status: "failed" }] }), all)).toBe("finals");
    // A done final without a ready final check is not done either (design pack §3.6).
    expect(batch.nextStepV3("finals", true, three({ finals: [{ status: "done", ready: false }] }), all)).toBe("finals");
    expect(batch.nextStepV3("done", true, three(), all)).toBe("done");
  });

  it("asks for new drafts after a full pass (no current drafts, so the drafts are not done)", () => {
    expect(batch.nextStepV3("board", true, three({ draftsDone: false }), new Set(["b", "c"]))).toBe("drafts");
  });
});
