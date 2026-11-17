import type { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import type { Env } from "../worker/env";
import { TOOLS } from "../worker/mcp";
import { validate } from "../worker/schema";
import { exampleBrief, SOURCES } from "./fixtures/brief";
import { fakeD1 } from "./helpers/d1";

/** a11-engine v3 Phase 2: territories and concepts in ideas_save (design pack §2.2, §2.3, tests 2.1 to 2.4). */

const E3 = "e3000000-0000-4000-8000-000000000003";

const run = async (env: Env, name: string, args: unknown) => {
  const t = TOOLS.find((x) => x.name === name)!;
  const c = (await t.run(env, validate(t.inputSchema, t.prepare ? t.prepare(args) : args))).content[0]!;
  return JSON.parse(c.type === "text" ? c.text : "{}");
};

/** An engine 2 batch and an engine 3 copy of it, with stored sources, two facts and (unless brief is false) a brief with 3 insights. */
async function seeded({ brief = true } = {}) {
  const env = { DB: fakeD1(), SPEND_CAP_USD: "5.00", PUBLIC_BASE_URL: "https://w" } as unknown as Env;
  const raw = (env.DB as unknown as { raw: DatabaseSync }).raw;
  raw.prepare("INSERT INTO brands (id, slug, name, created_at, updated_at) VALUES ('b1', 'pasar', 'Pasar Pantry', 'now', 'now')").run();
  raw.prepare("INSERT INTO brand_kits (id, brand_id, version, kit, created_at) VALUES ('k1', 'b1', 1, '{}', 'now')").run();
  const subject = await run(env, "subject_save", { brandSlug: "pasar", kind: "product", title: "Gula Melaka Granola", url: "https://example.com/p" });
  const e2 = await run(env, "batch_create", { brandSlug: "pasar", subjectId: subject.id, label: "W48" });
  // batch_create makes engine 2 batches only, and the engine of a batch is fixed: copy the row as an engine 3 batch.
  const cols = (raw.prepare("PRAGMA table_info(batches)").all() as { name: string }[]).map((c) => c.name).filter((c) => c !== "id" && c !== "engine");
  raw.prepare(`INSERT INTO batches (id, engine, ${cols.join(", ")}) SELECT ?, 3, ${cols.join(", ")} FROM batches WHERE id = ?`).run(E3, e2.id);
  const add = raw.prepare("INSERT INTO research_sources (id, batch_id, url, title, retrieved_at, via, text) VALUES (?, ?, ?, '', 'now', 'contents', ?)");
  for (const s of SOURCES) add.run(s.id, E3, s.url, s.text);
  const facts = await run(env, "facts_save", {
    subjectId: subject.id,
    facts: [{ label: "pack size", value: "300 g", quote: "300 g pouch", sourceUrl: "https://example.com/p" }],
  });
  const factIds = facts.map((f: { id: number }) => String(f.id)) as string[];
  if (brief) {
    const b = exampleBrief(subject.id, factIds);
    b.buyerInsights.push({ id: "i3", text: "People hide the pouch from the rest of the home.", tension: "Sharing is good; this pouch is mine.", basis: "hypothesis", evidenceIds: [], confidence: "low", market: "unknown" });
    await run(env, "brief_save", { batchId: E3, brief: b });
  }
  return { env, raw, subjectId: subject.id as string, e2: e2.id as string, factIds };
}

const territory = (key: string, insightId = "i1") => ({
  key,
  name: `Territory ${key}`,
  insightId,
  whyItMatters: "It is what buyers do.",
  productConnection: "The pouch is in every scene.",
  brandConnection: "The kit colours and the logo.",
  commercialOpportunity: "No competitor shows it.",
  mechanisms: ["behavioural_observation"],
});
const concept = (t: string, over: Record<string, unknown> = {}) => ({
  territory: t,
  name: `Concept in ${t}`,
  insightId: "i1",
  evidenceIds: ["e2"],
  proposition: "The pouch does not last.",
  concept: "The pouch is empty by the second night.",
  mechanism: { type: "product_obsession", how: "An empty pouch on a calm counter." },
  productRole: "The pouch is the evidence.",
  brandRole: "The real pack print.",
  purpose: "Stop a stranger.",
  coverTest: { pictureAlone: "Someone ate it all.", headlineAlone: "A line about a short life." },
  sublineBasis: { kind: "second_beat" },
  risks: ["The empty pouch can look like waste."],
  ...over,
});
const idea = (t: string, over: Record<string, unknown> = {}) => ({
  format: "tof",
  insight: "Bought for breakfast, gone at night.",
  visual: "An empty pouch on a counter at night.",
  headline: "Gone by Thursday.",
  copy: { subline: "Small batches, every week." },
  concept: concept(t, over),
});
/** 4 territories, 10 concepts: 3, 3, 2, 2. */
const firstRound = () => ({
  batchId: E3,
  territories: [territory("t1"), territory("t2", "i2"), territory("t3", "i3"), territory("t4", "i2")],
  ideas: [..."1112223344"].map((n) => idea(`t${n}`)),
  promptVersion: "0.2.12",
});

describe("ideas_save on an engine 3 batch", () => {
  it("(2.1) saves 4 territories and 10 concepts: the concept on each row, one territories record, both in batch_get", async () => {
    const { env, raw } = await seeded();
    const r = await run(env, "ideas_save", firstRound());
    expect(r.ideas).toHaveLength(10);
    // Two territories on insight i2: a warning, not a refusal.
    expect(r.warnings).toEqual([expect.stringContaining("t2, t4 start from the same insight i2")]);
    const rows = raw.prepare("SELECT kind, version, author, prompt_version, body FROM batch_records WHERE batch_id = ? AND kind = 'territories'").all(E3) as Record<string, any>[];
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ version: 1, author: "writer", prompt_version: "0.2.12" });
    expect(JSON.parse(rows[0]!.body)).toMatchObject({ briefVersion: 1, territories: [{ key: "t1" }, { key: "t2" }, { key: "t3" }, { key: "t4" }] });
    const got = await run(env, "batch_get", { id: E3 });
    expect(got.territories).toMatchObject({ version: 1, briefVersion: 1 });
    expect(got.territories.territories).toHaveLength(4);
    expect(got.ideas[0].concept).toMatchObject({ territory: "t1", insightId: "i1", briefVersion: 1, mechanism: { type: "product_obsession" } });
    expect(got.nextStep).toBe("concept_review");
    // The critic reads the concepts and territories too.
    const critic = await run(env, "batch_get", { id: E3, view: "critic" });
    expect(critic.territories.territories).toHaveLength(4);
    expect(critic.ideas.every((i: { concept: { territory?: string } }) => i.concept.territory)).toBe(true);
  });

  it("(2.2) refuses 2 or 6 territories", () => {
    const schema = TOOLS.find((t) => t.name === "ideas_save")!.inputSchema;
    const base = firstRound();
    expect(() => validate(schema, { ...base, territories: base.territories.slice(0, 2) })).toThrow(/territories/);
    expect(() => validate(schema, { ...base, territories: [...base.territories, territory("t5"), territory("t6")] })).toThrow(/territories/);
  });

  it("(2.3) refuses a concept whose territory is not in the list, and ids that are not in the brief or the facts", async () => {
    const { env, factIds } = await seeded();
    const with0 = (over: Record<string, unknown>) => {
      const a = firstRound();
      a.ideas[0] = idea("t1", over);
      return a;
    };
    await expect(run(env, "ideas_save", with0({ territory: "t9" }))).rejects.toThrow("ideas[0].concept.territory t9 is not a territory of this batch.");
    await expect(run(env, "ideas_save", with0({ insightId: "i9" }))).rejects.toThrow("insightId i9 is not an insight of the newest brief.");
    await expect(run(env, "ideas_save", with0({ evidenceIds: ["e2", "e99"] }))).rejects.toThrow("evidenceIds are not in the newest brief: e99.");
    await expect(run(env, "ideas_save", with0({ sublineBasis: { kind: "fact", factId: "999" } }))).rejects.toThrow("factId 999 is not a fact of this batch's subject.");
    const t = firstRound();
    t.territories[0] = territory("t1", "i9");
    await expect(run(env, "ideas_save", t)).rejects.toThrow("name an insight that is not in the newest brief: t1 (i9).");
    const dup = firstRound();
    dup.territories[1] = territory("t1", "i2");
    await expect(run(env, "ideas_save", dup)).rejects.toThrow("Each territory key may appear only once.");
    // A good fact id is kept; nothing was saved by the refused calls.
    const ok = await run(env, "ideas_save", with0({ sublineBasis: { kind: "fact", factId: factIds[0] } }));
    expect(ok.ideas).toHaveLength(10);
  });

  it("refuses a first save with the wrong count, and a concept with no concept fields", async () => {
    const { env } = await seeded();
    const few = firstRound();
    few.ideas = few.ideas.slice(0, 5);
    await expect(run(env, "ideas_save", few)).rejects.toThrow("The first concepts of an engine 3 batch are 6 to 15");
    const one = firstRound();
    one.ideas = [..."111122334"].map((n) => idea(`t${n}`)); // t1 4, t4 1
    await expect(run(env, "ideas_save", one)).rejects.toThrow("2 or 3 for each territory: t1 (4), t4 (1).");
    const bare = firstRound();
    const { concept: _c, ...plain } = bare.ideas[3]!;
    bare.ideas[3] = plain as ReturnType<typeof idea>;
    await expect(run(env, "ideas_save", bare)).rejects.toThrow("ideas [3] have none.");
    const noT = { ...firstRound(), territories: undefined };
    await expect(run(env, "ideas_save", noT)).rejects.toThrow("needs its territories (3 to 5) with the first concepts.");
  });

  it("refuses concepts before the brief", async () => {
    const { env } = await seeded({ brief: false });
    await expect(run(env, "ideas_save", firstRound())).rejects.toThrow("Save the brief first with brief_save");
  });

  it("warns about a fact subline with no fact id and a headline-only ad", async () => {
    const { env } = await seeded();
    const a = firstRound();
    a.territories[3] = territory("t4", "i1");
    a.ideas[0] = idea("t1", { sublineBasis: { kind: "fact" } });
    a.ideas[1] = idea("t1", { sublineBasis: { kind: "none" } });
    const r = await run(env, "ideas_save", a);
    expect(r.warnings).toEqual([
      expect.stringContaining("t1, t4 start from the same insight i1"),
      "ideas[0].concept: the subline states a fact, but sublineBasis has no factId. Name the fact, or make the subline a second beat.",
      "ideas[1].concept: a headline-only ad needs the owner's word at the copy review.",
    ]);
  });

  it("adds concepts in a later round: the territories stay, a new list keeps the used keys, the batch holds at most 24", async () => {
    const { env, raw } = await seeded();
    await run(env, "ideas_save", firstRound());
    // A rework round: two new concepts, no new list, no count per territory.
    const more = await run(env, "ideas_save", { batchId: E3, ideas: [idea("t3"), idea("t1")] });
    expect(more.ideas.map((i: { n: number }) => i.n)).toEqual([11, 12]);
    // A new list must keep t1 to t4; with t5 added it is version 2.
    const keep = firstRound().territories;
    await expect(run(env, "ideas_save", { batchId: E3, territories: keep.slice(0, 3), ideas: [idea("t1")] })).rejects.toThrow(
      "drops territories that saved concepts use: t4.",
    );
    await expect(run(env, "ideas_save", { batchId: E3, territories: [...keep, territory("t5", "i3")], ideas: [idea("t5"), idea("t5")] })).resolves.toMatchObject({
      ideas: [{ n: 13 }, { n: 14 }],
    });
    expect((await run(env, "batch_get", { id: E3 })).territories).toMatchObject({ version: 2 });
    const eleven = Array.from({ length: 11 }, () => idea("t5"));
    await expect(run(env, "ideas_save", { batchId: E3, ideas: eleven })).rejects.toThrow("at most 24 concepts; it has 14, and this call adds 11.");
    expect((raw.prepare("SELECT COUNT(*) AS c FROM ideas WHERE batch_id = ?").get(E3) as { c: number }).c).toBe(14);
  });
});

describe("ideas_save on an engine 2 batch", () => {
  it("(2.4) works as today and refuses the engine 3 fields", async () => {
    const { env, e2 } = await seeded();
    const plain = { format: "tof", insight: "Bought for breakfast.", visual: "A pouch.", headline: "Gone." };
    const r = await run(env, "ideas_save", { batchId: e2, ideas: [plain] });
    expect(r).toEqual([{ id: expect.any(String), n: 1, format: "tof", headline: "Gone.", picked: false }]);
    await expect(run(env, "ideas_save", { batchId: e2, ideas: [{ ...plain, concept: concept("t1") }] })).rejects.toThrow(
      "territories and concept are for an engine 3 batch only.",
    );
    await expect(run(env, "ideas_save", { batchId: e2, territories: firstRound().territories, ideas: [plain] })).rejects.toThrow(
      "territories and concept are for an engine 3 batch only.",
    );
    const got = await run(env, "batch_get", { id: e2 });
    expect(got.territories).toBeNull();
    expect(got.ideas[0].concept).toEqual({});
  });
});
