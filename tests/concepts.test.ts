import { describe, expect, it } from "vitest";
import { TOOLS } from "../worker/mcp";
import { validate } from "../worker/schema";
import { concept, E3, firstRound, idea, run, seeded, territory } from "./helpers/engine3";

/** a11-engine v3 Phase 2: territories and concepts in ideas_save (design pack §2.2, §2.3, tests 2.1 to 2.4). */

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
    expect(got.ideas[0].concept).toMatchObject({ territory: "t1", insightId: "i1", briefVersion: 1, promptVersion: "0.2.12", mechanism: { type: "product_obsession" } });
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
    const { env, raw, factIds } = await seeded();
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
    // Nothing was saved by the refused calls.
    expect((raw.prepare("SELECT COUNT(*) AS c FROM ideas WHERE batch_id = ?").get(E3) as { c: number }).c).toBe(0);
    expect((raw.prepare("SELECT COUNT(*) AS c FROM batch_records WHERE batch_id = ? AND kind = 'territories'").get(E3) as { c: number }).c).toBe(0);
    // A good fact id is kept.
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

  it("refuses the whole save when another save of the batch commits first", async () => {
    const { env, raw } = await seeded();
    const db = env.DB as unknown as { batch: (s: unknown[]) => Promise<unknown> };
    const batchFn = db.batch.bind(db);
    // Another save commits idea 1 after this save read the numbers and ran its checks.
    db.batch = async (stmts) => {
      raw.prepare("INSERT INTO ideas (id, batch_id, n, format, insight, visual, headline, copy, picked, created_at) VALUES ('other', ?, 1, 'tof', 'x', 'x', 'x', '{}', 0, 'now')").run(E3);
      return batchFn(stmts);
    };
    await expect(run(env, "ideas_save", firstRound())).rejects.toThrow("Another save of this batch ran at the same time");
    expect((raw.prepare("SELECT COUNT(*) AS c FROM ideas WHERE batch_id = ?").get(E3) as { c: number }).c).toBe(1);
    expect((raw.prepare("SELECT COUNT(*) AS c FROM batch_records WHERE batch_id = ? AND kind = 'territories'").get(E3) as { c: number }).c).toBe(0);
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
      "ideas[1].concept: a headline-only ad needs the owner's word, and render_submit refuses a draft without a subline. Give it a subline unless he asked for none.",
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
      "territories, concept and promptVersion are for an engine 3 batch only.",
    );
    await expect(run(env, "ideas_save", { batchId: e2, promptVersion: "0.2.12", ideas: [plain] })).rejects.toThrow("for an engine 3 batch only.");
    await expect(run(env, "ideas_save", { batchId: e2, territories: firstRound().territories, ideas: [plain] })).rejects.toThrow(
      "territories, concept and promptVersion are for an engine 3 batch only.",
    );
    const got = await run(env, "batch_get", { id: e2 });
    expect(got.territories).toBeNull();
    expect(got.ideas[0].concept).toEqual({});
  });
});
