import type { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import * as canon from "../worker/canon";
import type { Env } from "../worker/env";
import { TOOLS } from "../worker/mcp";
import { validate } from "../worker/schema";
import { readFileSync } from "node:fs";
import { fakeD1 } from "./helpers/d1";

/** The migration seeds the canon. Most tests start from an empty one; the seed has its own test. */
function makeEnv(opts: { seeded?: boolean } = {}) {
  const env = { DB: fakeD1() } as unknown as Env;
  const raw = (env.DB as unknown as { raw: DatabaseSync }).raw;
  if (!opts.seeded) raw.exec("DELETE FROM canon_log; DELETE FROM canon_rules;");
  return { env, raw };
}
const run = async (env: Env, name: string, args: unknown) => {
  const t = TOOLS.find((x) => x.name === name)!;
  const c = (await t.run(env, validate(t.inputSchema, args))).content[0]!;
  return JSON.parse(c.type === "text" ? c.text : "{}");
};

describe("canon seed", () => {
  it("is in the migration, equal to docs/canon-seed.json, each rule with an exact quote from the owner's notes", async () => {
    const { env } = makeEnv({ seeded: true });
    const seed = JSON.parse(readFileSync(new URL("../docs/canon-seed.json", import.meta.url), "utf8")) as { stage: string; rule: string; source: string; kind: "owner" | "doc"; quote?: string; doc?: string }[];
    const g = await canon.canonGet(env, {});
    expect(g.activeRules).toBe(seed.length);
    expect(g.rules.map((r) => [r.stage, r.rule]).sort()).toEqual(seed.map((s) => [s.stage, s.rule]).sort());
    const notes = (readFileSync(new URL("../docs/taste-seed.md", import.meta.url), "utf8") + readFileSync(new URL("../docs/marks.md", import.meta.url), "utf8")).replaceAll("**", "");
    // "owner" evidence is his own words (a quote); "doc" evidence is the notes' own wording, labelled as such, never a quote.
    for (const s of seed) {
      const text = s.kind === "owner" ? s.quote : s.doc;
      expect(typeof text).toBe("string");
      expect(s.kind === "owner" ? s.doc : s.quote).toBeUndefined();
      expect(notes).toContain(text!);
    }
    const stored = (makeEnv({ seeded: true }).raw.prepare("SELECT evidence FROM canon_rules").all() as { evidence: string }[]).map((r) => JSON.parse(r.evidence)[0] as Record<string, string>);
    expect(stored.filter((e) => "quote" in e)).toHaveLength(seed.filter((s) => s.kind === "owner").length);
    expect(stored.filter((e) => "doc" in e)).toHaveLength(seed.filter((s) => s.kind === "doc").length);
    for (const r of g.rules) expect(r.evidenceCount).toBe(1);
  });
});

describe("taste canon", () => {
  it("adds a rule with its evidence, and reads it back", async () => {
    const { env } = makeEnv();
    const { id } = await canon.canonUpdate(env, { action: "add", rule: "One focal product, little to look at.", source: "B41", quote: "they weren't chaotic or busy" }) as { id: string };
    const g = await canon.canonGet(env, {});
    expect(g.activeRules).toBe(1);
    expect(g.rules[0]).toMatchObject({ id, rule: "One focal product, little to look at.", evidenceCount: 1, hitRate: null, retireDue: false });
    expect(g.recentChanges[0]).toMatchObject({ rule_id: id, action: "add" });
  });

  it("needs a source to add or edit, and an id for the rest", async () => {
    const { env } = makeEnv();
    await expect(canon.canonUpdate(env, { action: "add", rule: "A rule without a source." })).rejects.toThrow(/source/);
    await expect(canon.canonUpdate(env, { action: "retire", reason: "x y z" })).rejects.toThrow(/id/);
    await expect(canon.canonUpdate(env, { action: "retire", id: "deadbeef", reason: "gone" })).rejects.toThrow(/No such rule/);
  });

  it("counts hits and misses into a hit rate, and keeps each as evidence", async () => {
    const { env } = makeEnv();
    const { id } = await canon.canonUpdate(env, { action: "add", rule: "Calm ads win.", source: "B41" }) as { id: string };
    for (const kind of ["hit", "hit", "miss"] as const) await canon.canonUpdate(env, { action: "evidence", id, kind, source: "W46c pick" });
    const r = (await canon.canonGet(env, {})).rules[0]!;
    expect(r).toMatchObject({ hits: 2, misses: 1, hitRate: 0.67, evidenceCount: 4 });
  });

  it("filters by stage but always includes the rules for every stage", async () => {
    const { env } = makeEnv();
    await canon.canonUpdate(env, { action: "add", rule: "Rule for every stage here.", source: "s" });
    await canon.canonUpdate(env, { action: "add", rule: "Rule for the bottom of funnel.", source: "s", stage: "bof" });
    await canon.canonUpdate(env, { action: "add", rule: "Rule for the top of funnel.", source: "s", stage: "tof" });
    const bof = (await canon.canonGet(env, { stage: "bof" })).rules.map((r) => r.rule);
    expect(bof).toEqual(["Rule for every stage here.", "Rule for the bottom of funnel."]);
  });

  it("flags a rule with no evidence for 60 days, retires it, and takes no evidence while it is retired", async () => {
    const { env, raw } = makeEnv();
    const { id } = await canon.canonUpdate(env, { action: "add", rule: "An old rule nobody checked.", source: "s" }) as { id: string };
    raw.prepare("UPDATE canon_rules SET last_evidence_at = ? WHERE id = ?").run(new Date(Date.now() - 61 * 86_400_000).toISOString(), id);
    const g = await canon.canonGet(env, {});
    expect(g.retireDue).toEqual([id]);
    await canon.canonUpdate(env, { action: "retire", id, reason: "no evidence in 60 days" });
    expect((await canon.canonGet(env, {})).activeRules).toBe(0);
    expect((await canon.canonGet(env, { includeRetired: true })).rules[0]).toMatchObject({ status: "retired", retiredReason: "no evidence in 60 days" });
    await expect(canon.canonUpdate(env, { action: "evidence", id, kind: "hit", source: "s" })).rejects.toThrow(/Restore it first/);
    await canon.canonUpdate(env, { action: "restore", id, reason: "the owner said it again" });
    expect((await canon.canonGet(env, {})).rules[0]).toMatchObject({ status: "active", retireDue: true });
    await canon.canonUpdate(env, { action: "evidence", id, kind: "hit", source: "the owner said it again" });
    expect((await canon.canonGet(env, {})).rules[0]).toMatchObject({ status: "active", retireDue: false });
  });

  it("edits a rule, keeps the old words in the log", async () => {
    const { env } = makeEnv();
    const { id } = await canon.canonUpdate(env, { action: "add", rule: "First wording of the rule.", source: "s" }) as { id: string };
    await canon.canonUpdate(env, { action: "edit", id, rule: "Second wording of the rule.", source: "owner, 07-11-2026" });
    const g = await canon.canonGet(env, {});
    expect(g.rules[0]!.rule).toBe("Second wording of the rule.");
    expect(g.recentChanges[0]!.detail).toContain("First wording of the rule.");
  });

  it("does not count an edit as evidence, and refuses an edit of a retired rule", async () => {
    const { env, raw } = makeEnv();
    const { id } = await canon.canonUpdate(env, { action: "add", rule: "An old rule that was reworded.", source: "s", stage: "bof" }) as { id: string };
    raw.prepare("UPDATE canon_rules SET last_evidence_at = ? WHERE id = ?").run(new Date(Date.now() - 70 * 86_400_000).toISOString(), id);
    await canon.canonUpdate(env, { action: "edit", id, rule: "A reworded rule, still stale.", source: "owner" });
    const r = (await canon.canonGet(env, {})).rules[0]!;
    expect(r).toMatchObject({ rule: "A reworded rule, still stale.", stage: "bof", evidenceCount: 1, retireDue: true });
    await canon.canonUpdate(env, { action: "retire", id, reason: "stale" });
    await expect(canon.canonUpdate(env, { action: "edit", id, rule: "Edit of a retired rule.", source: "owner" })).rejects.toThrow(/Restore it first/);
  });

  it("keeps the owner's words with an edit, in the log", async () => {
    const { env } = makeEnv();
    const { id } = await canon.canonUpdate(env, { action: "add", rule: "A rule that will be reworded.", source: "s" }) as { id: string };
    await canon.canonUpdate(env, { action: "edit", id, rule: "The rule, reworded after he said so.", source: "owner, 07-11-2026", quote: "his exact words" });
    expect((await canon.canonGet(env, {})).recentChanges[0]!.detail).toContain("his exact words");
  });

  it("keeps the stage on an edit that does not name one (the tool schema adds no default)", async () => {
    const { env } = makeEnv();
    const { id } = await canon.canonUpdate(env, { action: "add", rule: "A rule for the bottom of funnel.", source: "s", stage: "bof" }) as { id: string };
    const t = TOOLS.find((x) => x.name === "canon_update")!;
    const args = validate(t.inputSchema, { action: "edit", id, rule: "Same rule, reworded a little.", source: "owner" });
    expect(args).not.toHaveProperty("stage");
    await t.run(env, args);
    expect((await canon.canonGet(env, {})).rules[0]!.stage).toBe("bof");
  });

  it("flags a rule at exactly 60 days, and a restore does not make a stale rule fresh", async () => {
    const { env, raw } = makeEnv();
    const { id } = await canon.canonUpdate(env, { action: "add", rule: "A rule at the 60 day line.", source: "s" }) as { id: string };
    raw.prepare("UPDATE canon_rules SET last_evidence_at = ? WHERE id = ?").run(new Date(Date.now() - 60 * 86_400_000 - 1000).toISOString(), id);
    expect((await canon.canonGet(env, {})).retireDue).toEqual([id]);
    await canon.canonUpdate(env, { action: "retire", id, reason: "stale" });
    await canon.canonUpdate(env, { action: "restore", id, reason: "back for a look" });
    expect((await canon.canonGet(env, {})).retireDue).toEqual([id]);
    await canon.canonUpdate(env, { action: "evidence", id, kind: "hit", source: "a pick" });
    expect((await canon.canonGet(env, {})).retireDue).toEqual([]);
  });

  it("lists rules added in the same millisecond in the order they were added", async () => {
    const { env, raw } = makeEnv();
    for (const n of ["first", "second", "third"]) await canon.canonUpdate(env, { action: "add", rule: `The ${n} rule of the day.`, source: "s" });
    raw.prepare("UPDATE canon_rules SET created_at = '2026-11-07T00:00:00.000Z'").run();
    expect((await canon.canonGet(env, {})).rules.map((r) => r.rule)).toEqual(["The first rule of the day.", "The second rule of the day.", "The third rule of the day."]);
  });

  it("stops at 40 active rules with a clear message, and a retire makes room", async () => {
    const { env } = makeEnv();
    let first = "";
    for (let i = 0; i < 40; i++) {
      const r = await canon.canonUpdate(env, { action: "add", rule: `Rule number ${i} of the canon.`, source: "s" }) as { id: string };
      if (i === 0) first = r.id;
    }
    await expect(canon.canonUpdate(env, { action: "add", rule: "One rule too many here.", source: "s" })).rejects.toThrow(/canon is full/);
    await canon.canonUpdate(env, { action: "retire", id: first, reason: "old" });
    await canon.canonUpdate(env, { action: "add", rule: "Now there is room again.", source: "s" });
    await expect(canon.canonUpdate(env, { action: "restore", id: first, reason: "back" })).rejects.toThrow(/canon is full/);
  });

  it("refuses a rule id of the wrong shape and an unknown action at the tool", async () => {
    const { env } = makeEnv();
    const t = TOOLS.find((x) => x.name === "canon_update")!;
    expect(() => validate(t.inputSchema, { action: "retire", id: "nope", reason: "x" })).toThrow();
    expect(() => validate(t.inputSchema, { action: "delete" })).toThrow();
    expect((await run(env, "canon_get", {})).activeRules).toBe(0);
  });
});

describe("swipe file", () => {
  it("keeps the newest 3 per brand and stage, with the brand's own first group included", async () => {
    const { env, raw } = makeEnv();
    for (let i = 0; i < 5; i++) await canon.swipeAdd(env, { title: `Ad ${i}`, why: "A clear reason it works.", source: "owner pick", stage: "tof", brandSlug: "wongi" });
    await canon.swipeAdd(env, { title: "Other brand", why: "A clear reason it works.", source: "research", stage: "tof", brandSlug: "other" });
    raw.prepare("UPDATE swipe SET created_at = '2026-11-0' || (1 + rowid)").run();
    const all = await canon.swipeSearch(env, { stage: "tof" });
    expect(all.examples.filter((e) => e.brand_slug === "wongi")).toHaveLength(3);
    expect(all.examples.filter((e) => e.brand_slug === "other")).toHaveLength(1);
    const wongi = await canon.swipeSearch(env, { brandSlug: "wongi", stage: "tof", perGroup: 2 });
    expect(wongi.examples).toHaveLength(2);
    expect(wongi.examples.map((e) => e.title)).toEqual(["Ad 4", "Ad 3"]);
  });

  it("puts the brand's own older example before a newer generic one, and works with no filter", async () => {
    const { env, raw } = makeEnv();
    await canon.swipeAdd(env, { title: "Brand ad", why: "A clear reason it works.", source: "owner pick", stage: "tof", brandSlug: "wongi" });
    await canon.swipeAdd(env, { title: "Generic ad", why: "A clear reason it works.", source: "research", stage: "tof" });
    raw.prepare("UPDATE swipe SET created_at = CASE title WHEN 'Brand ad' THEN '2026-01-01' ELSE '2026-11-01' END").run();
    const brand = await canon.swipeSearch(env, { brandSlug: "wongi", stage: "tof" });
    expect(brand.examples.map((e) => e.title)).toEqual(["Brand ad", "Generic ad"]);
    expect((await canon.swipeSearch(env, {})).examples).toHaveLength(2);
    expect((await canon.swipeSearch(env, { stage: "mof" })).examples).toEqual([]);
  });

  it("refuses a stage that is not a funnel stage", async () => {
    const t = TOOLS.find((x) => x.name === "swipe_add")!;
    expect(() => validate(t.inputSchema, { title: "Ad", why: "A clear reason it works.", source: "owner pick", stage: "hook" })).toThrow();
  });
});

describe("gold set", () => {
  const items = [
    { label: "B41 ad 1", mark: "use" as const, headline: "Singaporean exclusive products." },
    { label: "B44 ad 2", mark: "pass" as const, headline: "Drip on a cup" },
    { label: "B43 ad 3", mark: "use" as const },
  ];

  it("hides the owner's marks from gold_get, and scores answers against them", async () => {
    const { env } = makeEnv();
    expect(await canon.goldImport(env, items)).toEqual({ imported: 3, skippedAsKnown: 0, goldItems: 3 });
    const g = await canon.goldGet(env, {});
    expect(g.total).toBe(3);
    expect(JSON.stringify(g)).not.toMatch(/"mark"|"use"|"pass"/);
    const mark = new Map(items.map((i) => [i.label, i.mark]));
    const answers = g.items.map((i) => ({ id: i.id as string, mark: (mark.get(i.label as string) === "use" ? "use" : "pass") as "use" | "pass" }));
    expect(await canon.goldScore(env, { note: "before", answers })).toMatchObject({ n: 3, agreed: 3, agreement: 1, baseline: 0.667, balancedAccuracy: 1, previous: null });
    answers[0]!.mark = answers[0]!.mark === "use" ? "pass" : "use";
    const second = await canon.goldScore(env, { note: "after canon change", answers });
    expect(second).toMatchObject({ n: 3, agreed: 2, agreement: 0.667, previous: { note: "before", agreement: 1, balancedAccuracy: 1 } });
    expect((await canon.goldRuns(env)).runs.map((r) => r.note)).toEqual(["after canon change", "before"]);
  });

  it("does not add an item twice when an import is retried", async () => {
    const { env } = makeEnv();
    await canon.goldImport(env, items);
    expect(await canon.goldImport(env, [...items, { label: "B50 ad 4", mark: "pass" as const }])).toEqual({ imported: 1, skippedAsKnown: 3, goldItems: 4 });
    expect((await canon.goldGet(env, {})).total).toBe(4);
  });

  it("takes a full run of up to 500 answers in one call", () => {
    const t = TOOLS.find((x) => x.name === "gold_score")!;
    const answers = Array.from({ length: 200 }, (_, i) => ({ id: `00000000-0000-0000-0000-${String(i).padStart(12, "0")}`, mark: "use" }));
    expect(() => validate(t.inputSchema, { note: "full run", answers })).not.toThrow();
    expect(() => validate(t.inputSchema, { note: "too many", answers: Array.from({ length: 501 }, () => answers[0]) })).toThrow();
    expect(() => validate(TOOLS.find((x) => x.name === "gold_get")!.inputSchema, { limit: 500 })).not.toThrow();
  });

  it("shows that passing everything is no better than a coin: balanced accuracy 0.5 and agreement equal to the baseline", async () => {
    const { env } = makeEnv();
    const many = [
      ...Array.from({ length: 7 }, (_, i) => ({ label: `pass ${i}`, mark: "pass" as const })),
      ...Array.from({ length: 3 }, (_, i) => ({ label: `use ${i}`, mark: "use" as const })),
    ];
    await canon.goldImport(env, many);
    const all = (await canon.goldGet(env, { limit: 500 })).items.map((i) => ({ id: i.id as string, mark: "pass" as const }));
    const r = await canon.goldScore(env, { note: "pass everything", answers: all });
    expect(r).toMatchObject({ n: 10, agreed: 7, agreement: 0.7, baseline: 0.7, useRecall: 0, passRecall: 1, balancedAccuracy: 0.5 });
    const runs = (await canon.goldRuns(env)).runs;
    expect(runs[0]).toMatchObject({ baseline: 0.7, balancedAccuracy: 0.5 });
  });

  it("still lists a run saved before the use counts existed, with agreement only", async () => {
    const { env, raw } = makeEnv();
    raw.prepare("INSERT INTO gold_runs (note, n, agreed, at) VALUES ('old run', 264, 185, 'then')").run();
    const [run] = (await canon.goldRuns(env)).runs;
    expect(run).toMatchObject({ note: "old run", agreement: 0.701 });
    expect(run).not.toHaveProperty("balancedAccuracy");
    await canon.goldImport(env, [{ label: "a", mark: "use" }, { label: "b", mark: "pass" }]);
    const answers = (await canon.goldGet(env, {})).items.map((i) => ({ id: i.id as string, mark: "pass" as const }));
    expect((await canon.goldScore(env, { note: "new", answers })).previous).toMatchObject({ note: "old run", agreement: 0.701 });
  });

  it("refuses answers for ids that are not gold items, and the same id twice", async () => {
    const { env } = makeEnv();
    await canon.goldImport(env, items);
    const id = ((await canon.goldGet(env, {})).items[0]!.id) as string;
    await expect(canon.goldScore(env, { note: "x y z", answers: [{ id: "11111111-1111-1111-1111-111111111111", mark: "use" }] })).rejects.toThrow(/Not gold items/);
    await expect(canon.goldScore(env, { note: "x y z", answers: [{ id, mark: "use" }, { id, mark: "pass" }] })).rejects.toThrow(/once/);
  });

  it("pages the gold set in a fixed order", async () => {
    const { env } = makeEnv();
    await canon.goldImport(env, items);
    const a = (await canon.goldGet(env, { limit: 2 })).items.map((i) => i.id);
    const b = (await canon.goldGet(env, { limit: 2, offset: 2 })).items.map((i) => i.id);
    expect(a).toHaveLength(2);
    expect(b).toHaveLength(1);
    expect(new Set([...a, ...b]).size).toBe(3);
  });
});
