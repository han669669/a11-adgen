import type { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import * as canon from "../worker/canon";
import type { Env } from "../worker/env";
import { TOOLS } from "../worker/mcp";
import { validate } from "../worker/schema";
import { readFileSync } from "node:fs";
import { fakeD1 } from "./helpers/d1";

/** A learning record with 2 pieces of evidence, so a rule for every brand is allowed. */
const L: canon.Learning = { observation: "Seen in a test.", examples: ["pick 1", "pick 2"], counterexamples: [], evidenceCount: 2, confidence: "medium", expectedEffect: "Calmer drafts." };

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
    const { id } = await canon.canonUpdate(env, { action: "add", learning: L, rule: "One focal product, little to look at.", source: "B41", quote: "they weren't chaotic or busy" }) as { id: string };
    const g = await canon.canonGet(env, {});
    expect(g.activeRules).toBe(1);
    expect(g.rules[0]).toMatchObject({ id, rule: "One focal product, little to look at.", evidenceCount: 1, hitRate: null, retireDue: false });
    expect(g.recentChanges[0]).toMatchObject({ rule_id: id, action: "add" });
  });

  it("needs a source to add or edit, and an id for the rest", async () => {
    const { env } = makeEnv();
    await expect(canon.canonUpdate(env, { action: "add", learning: L, rule: "A rule without a source." })).rejects.toThrow(/source/);
    await expect(canon.canonUpdate(env, { action: "retire", reason: "x y z" })).rejects.toThrow(/id/);
    await expect(canon.canonUpdate(env, { action: "retire", id: "deadbeef", reason: "gone" })).rejects.toThrow(/No such rule/);
  });

  it("counts hits and misses into a hit rate, and keeps each as evidence", async () => {
    const { env } = makeEnv();
    const { id } = await canon.canonUpdate(env, { action: "add", learning: L, rule: "Calm ads win.", source: "B41" }) as { id: string };
    for (const kind of ["hit", "hit", "miss"] as const) await canon.canonUpdate(env, { action: "evidence", id, kind, source: "W46c pick" });
    const r = (await canon.canonGet(env, {})).rules[0]!;
    expect(r).toMatchObject({ hits: 2, misses: 1, hitRate: 0.67, evidenceCount: 4 });
  });

  it("filters by stage but always includes the rules for every stage", async () => {
    const { env } = makeEnv();
    await canon.canonUpdate(env, { action: "add", learning: L, rule: "Rule for every stage here.", source: "s" });
    await canon.canonUpdate(env, { action: "add", learning: L, rule: "Rule for the bottom of funnel.", source: "s", stage: "bof" });
    await canon.canonUpdate(env, { action: "add", learning: L, rule: "Rule for the top of funnel.", source: "s", stage: "tof" });
    const bof = (await canon.canonGet(env, { stage: "bof" })).rules.map((r) => r.rule);
    expect(bof).toEqual(["Rule for every stage here.", "Rule for the bottom of funnel."]);
  });

  it("flags a rule with no evidence for 60 days, retires it, and takes no evidence while it is retired", async () => {
    const { env, raw } = makeEnv();
    const { id } = await canon.canonUpdate(env, { action: "add", learning: L, rule: "An old rule nobody checked.", source: "s" }) as { id: string };
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
    const { id } = await canon.canonUpdate(env, { action: "add", learning: L, rule: "First wording of the rule.", source: "s" }) as { id: string };
    await canon.canonUpdate(env, { action: "edit", learning: L, id, rule: "Second wording of the rule.", source: "owner, 07-11-2026" });
    const g = await canon.canonGet(env, {});
    expect(g.rules[0]!.rule).toBe("Second wording of the rule.");
    expect(g.recentChanges[0]!.detail).toContain("First wording of the rule.");
  });

  it("does not count an edit as evidence, and refuses an edit of a retired rule", async () => {
    const { env, raw } = makeEnv();
    const { id } = await canon.canonUpdate(env, { action: "add", learning: L, rule: "An old rule that was reworded.", source: "s", stage: "bof" }) as { id: string };
    raw.prepare("UPDATE canon_rules SET last_evidence_at = ? WHERE id = ?").run(new Date(Date.now() - 70 * 86_400_000).toISOString(), id);
    await canon.canonUpdate(env, { action: "edit", learning: L, id, rule: "A reworded rule, still stale.", source: "owner" });
    const r = (await canon.canonGet(env, {})).rules[0]!;
    expect(r).toMatchObject({ rule: "A reworded rule, still stale.", stage: "bof", evidenceCount: 1, retireDue: true });
    await canon.canonUpdate(env, { action: "retire", id, reason: "stale" });
    await expect(canon.canonUpdate(env, { action: "edit", learning: L, id, rule: "Edit of a retired rule.", source: "owner" })).rejects.toThrow(/Restore it first/);
  });

  it("keeps the owner's words with an edit, in the log", async () => {
    const { env } = makeEnv();
    const { id } = await canon.canonUpdate(env, { action: "add", learning: L, rule: "A rule that will be reworded.", source: "s" }) as { id: string };
    await canon.canonUpdate(env, { action: "edit", learning: L, id, rule: "The rule, reworded after he said so.", source: "owner, 07-11-2026", quote: "his exact words" });
    expect((await canon.canonGet(env, {})).recentChanges[0]!.detail).toContain("his exact words");
  });

  it("keeps the stage on an edit that does not name one (the tool schema adds no default)", async () => {
    const { env } = makeEnv();
    const { id } = await canon.canonUpdate(env, { action: "add", learning: L, rule: "A rule for the bottom of funnel.", source: "s", stage: "bof" }) as { id: string };
    const t = TOOLS.find((x) => x.name === "canon_update")!;
    const args = validate(t.inputSchema, { action: "edit", learning: L, id, rule: "Same rule, reworded a little.", source: "owner" });
    expect(args).not.toHaveProperty("stage");
    await t.run(env, args);
    expect((await canon.canonGet(env, {})).rules[0]!.stage).toBe("bof");
  });

  it("flags a rule at exactly 60 days, and a restore does not make a stale rule fresh", async () => {
    const { env, raw } = makeEnv();
    const { id } = await canon.canonUpdate(env, { action: "add", learning: L, rule: "A rule at the 60 day line.", source: "s" }) as { id: string };
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
    for (const n of ["first", "second", "third"]) await canon.canonUpdate(env, { action: "add", learning: L, rule: `The ${n} rule of the day.`, source: "s" });
    raw.prepare("UPDATE canon_rules SET created_at = '2026-11-07T00:00:00.000Z'").run();
    expect((await canon.canonGet(env, {})).rules.map((r) => r.rule)).toEqual(["The first rule of the day.", "The second rule of the day.", "The third rule of the day."]);
  });

  it("stops at 40 active rules with a clear message, and a retire makes room", async () => {
    const { env } = makeEnv();
    let first = "";
    for (let i = 0; i < 40; i++) {
      const r = await canon.canonUpdate(env, { action: "add", learning: L, rule: `Rule number ${i} of the canon.`, source: "s" }) as { id: string };
      if (i === 0) first = r.id;
    }
    await expect(canon.canonUpdate(env, { action: "add", learning: L, rule: "One rule too many here.", source: "s" })).rejects.toThrow(/canon is full/);
    await canon.canonUpdate(env, { action: "retire", id: first, reason: "old" });
    await canon.canonUpdate(env, { action: "add", learning: L, rule: "Now there is room again.", source: "s" });
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

describe("canon scopes (migration 0016)", () => {
  const withBrands = () => {
    const m = makeEnv();
    m.raw.exec(`INSERT INTO brands (id, slug, name, created_at, updated_at) VALUES ('b1', 'wongi', 'WonGi', 't', 't'), ('b2', 'irvins', 'IRVINS', 't', 't')`);
    return m;
  };
  const add = (env: Env, rule: string, more: Partial<canon.CanonChange> = {}) =>
    canon.canonUpdate(env, { action: "add", learning: L, rule, source: "owner 17-11", ...more }) as Promise<{ id: string; scope: string; brandSlug?: string }>;

  it("gives a batch the rules that are not brand rules plus its own brand's rules, never another brand's", async () => {
    const { env } = withBrands();
    const owner = await add(env, "Calm ads win, for every brand.");
    await add(env, "A creative principle for all.", { scope: "creative" });
    const w = await add(env, "WonGi: the jar lid stays gold.", { scope: "brand", brandSlug: "wongi" });
    const i = await add(env, "IRVINS: the fish skin stays crisp.", { scope: "brand", brandSlug: "irvins" });
    expect(owner.scope).toBe("owner");
    expect(w).toMatchObject({ scope: "brand", brandSlug: "wongi" });
    const plain = await canon.canonGet(env, {});
    expect(plain.rules.map((r) => r.rule)).toEqual(["Calm ads win, for every brand.", "A creative principle for all."]);
    expect(plain).not.toHaveProperty("brandRules");
    const wongi = await run(env, "canon_get", { brandSlug: "wongi" });
    expect(wongi.rules.map((r: { rule: string }) => r.rule)).toEqual(["Calm ads win, for every brand.", "A creative principle for all.", "WonGi: the jar lid stays gold."]);
    expect(wongi.rules[2]).toMatchObject({ scope: "brand", brandSlug: "wongi" });
    expect(wongi).toMatchObject({ activeRules: 2, max: 40, brandRules: { brandSlug: "wongi", active: 1, max: 10 } });
    // The recent changes follow the same filter: another brand's rule text never reaches this batch.
    expect(wongi.recentChanges.map((l: { rule_id: string }) => l.rule_id)).not.toContain(i.id);
    expect(JSON.stringify(wongi)).not.toContain("IRVINS");
    // A review of every brand's rules, and of one scope.
    expect((await canon.canonGet(env, { scope: "brand" })).rules.map((r) => r.brandSlug)).toEqual(["wongi", "irvins"]);
    expect((await canon.canonGet(env, { scope: "creative" })).rules).toHaveLength(1);
    expect((await canon.canonGet(env, { scope: "brand", brandSlug: "irvins" })).rules.map((r) => r.id)).toEqual([i.id]);
    await expect(canon.canonGet(env, { scope: "owner", brandSlug: "irvins" })).rejects.toThrow(/brandSlug goes with scope brand/);
    await expect(canon.canonGet(env, { brandSlug: "nobody" })).rejects.toThrow(/No brand nobody/);
  });

  it("needs a brand that exists for a brand rule, and no brand for any other rule", async () => {
    const { env, raw } = withBrands();
    await expect(add(env, "A brand rule without a brand.", { scope: "brand" })).rejects.toThrow(/needs brandSlug/);
    await expect(add(env, "A brand rule for no brand.", { scope: "brand", brandSlug: "nobody" })).rejects.toThrow(/No brand nobody/);
    await expect(add(env, "An owner rule with a brand.", { brandSlug: "wongi" })).rejects.toThrow(/Only a brand rule/);
    // The database refuses the same, also for a write that does not go through the tool.
    const ins = (scope: string, brand: string | null) =>
      raw.prepare("INSERT INTO canon_rules (id, stage, scope, brand_slug, text, created_at, updated_at, last_evidence_at) VALUES (?, 'all', ?, ?, 'x', 't', 't', 't')").run(crypto.randomUUID().slice(0, 8), scope, brand);
    expect(() => ins("brand", null)).toThrow(/canon scope/);
    expect(() => ins("brand", "nobody")).toThrow(/canon scope/);
    expect(() => ins("owner", "wongi")).toThrow(/canon scope/);
    expect(() => ins("taste", null)).toThrow(/CHECK/);
    const t = TOOLS.find((x) => x.name === "canon_update")!;
    expect(() => validate(t.inputSchema, { action: "add", learning: L, rule: "x x x x x x x x", source: "s s", scope: "product" })).toThrow();
  });

  it("moves a rule between scopes on an edit, logs the move, and keeps the scope when the edit names none", async () => {
    const { env, raw } = withBrands();
    const { id } = await add(env, "Gold lids look premium for this jar.");
    await canon.canonUpdate(env, { action: "edit", learning: L, id, rule: "Gold lids look premium for this jar.", source: "owner 17-11: only WonGi", scope: "brand", brandSlug: "wongi" });
    expect((await canon.canonGet(env, { brandSlug: "wongi" })).rules[0]).toMatchObject({ id, scope: "brand", brandSlug: "wongi" });
    expect((await canon.canonGet(env, { brandSlug: "irvins" })).rules).toEqual([]);
    // A reword alone keeps the scope and the brand.
    await canon.canonUpdate(env, { action: "edit", learning: L, id, rule: "Gold lids look premium on the WonGi jar.", source: "s" });
    expect((await canon.canonGet(env, { scope: "brand" })).rules[0]).toMatchObject({ id, brandSlug: "wongi", rule: "Gold lids look premium on the WonGi jar." });
    // Evidence from other brands: back to an owner rule, and the brand goes.
    await canon.canonUpdate(env, { action: "edit", learning: L, id, rule: "Gold lids look premium.", source: "IRVINS and WonGi picks", scope: "owner" });
    expect((await canon.canonGet(env, {})).rules[0]).toMatchObject({ id, scope: "owner" });
    expect((await canon.canonGet(env, {})).rules[0]).not.toHaveProperty("brandSlug");
    const logs = (raw.prepare("SELECT detail FROM canon_log WHERE rule_id = ? AND action = 'edit' ORDER BY id").all(id) as { detail: string }[]).map((l) => JSON.parse(l.detail));
    expect(logs[0]).toMatchObject({ fromScope: "owner", toScope: "brand", toBrand: "wongi" });
    expect(logs[1]).not.toHaveProperty("fromScope");
    expect(logs[2]).toMatchObject({ fromScope: "brand", toScope: "owner", fromBrand: "wongi" });
    expect(logs[2]).not.toHaveProperty("toBrand");
    await expect(canon.canonUpdate(env, { action: "edit", learning: L, id, rule: "Gold lids look premium.", source: "s", scope: "brand" })).rejects.toThrow(/needs brandSlug/);
  });

  it("keeps 10 active rules for each brand apart from the 40 for every batch", async () => {
    const { env } = withBrands();
    const ids: string[] = [];
    for (let n = 0; n < 10; n++) ids.push((await add(env, `WonGi lesson number ${n}.`, { scope: "brand", brandSlug: "wongi" })).id);
    await expect(add(env, "One WonGi lesson too many.", { scope: "brand", brandSlug: "wongi" })).rejects.toThrow(/This brand has 10 active rules/);
    await add(env, "IRVINS has its own room.", { scope: "brand", brandSlug: "irvins" });
    for (let n = 0; n < 40; n++) await add(env, `Owner rule number ${n}.`);
    await expect(add(env, "One owner rule too many.")).rejects.toThrow(/The canon is full \(40 active rules\)/);
    // A brand rule cannot become the 41st rule for every batch.
    await expect(canon.canonUpdate(env, { action: "edit", learning: L, id: ids[0]!, rule: "Now for every brand.", source: "s", scope: "owner" })).rejects.toThrow(/canon is full/);
    await canon.canonUpdate(env, { action: "retire", id: ids[1]!, reason: "old" });
    await add(env, "Room again for WonGi.", { scope: "brand", brandSlug: "wongi" });
    await expect(canon.canonUpdate(env, { action: "restore", id: ids[1]!, reason: "back" })).rejects.toThrow(/This brand has 10 active rules/);
    // A reword of a rule in a full scope is fine.
    await canon.canonUpdate(env, { action: "edit", learning: L, id: ids[2]!, rule: "WonGi lesson, reworded.", source: "s" });
  });
});

describe("learning records (specification 9.7, 9.8)", () => {
  /** A gold run row: balanced accuracy = mean of use recall (useAgreed / 30) and pass recall ((agreed - useAgreed) / 70). */
  const goldRow = (raw: DatabaseSync, agreed: number, useAgreed: number, note = "a run") =>
    Number(raw.prepare("INSERT INTO gold_runs (note, n, agreed, use_agreed, use_truth, at) VALUES (?, 100, ?, ?, 30, 't')").run(note, agreed, useAgreed).lastInsertRowid);
  const one = { ...L, examples: ["W47 mof note"], evidenceCount: 1 };
  const logOf = (raw: DatabaseSync, id: string) =>
    (raw.prepare("SELECT action, detail FROM canon_log WHERE rule_id = ? ORDER BY id").all(id) as { action: string; detail: string }[]).map((l) => ({ action: l.action, ...JSON.parse(l.detail) }));

  it("needs a learning record for add and edit, and keeps it in the log with a snapshot of the gold run before", async () => {
    const { env, raw } = makeEnv();
    await expect(canon.canonUpdate(env, { action: "add", rule: "A rule with no record.", source: "s" })).rejects.toThrow(/add needs learning/);
    await expect(canon.canonUpdate(env, { action: "add", rule: "A rule with a lost run.", source: "s", learning: { ...L, goldBefore: 99 } })).rejects.toThrow(/No gold run 99/);
    await expect(canon.canonUpdate(env, { action: "add", rule: "More examples than evidence.", source: "s", learning: { ...L, evidenceCount: 1, ownerApproval: "yes" } })).rejects.toThrow(/evidenceCount must count every example/);
    const before = goldRow(raw, 76, 20);
    const { id } = await canon.canonUpdate(env, { action: "add", rule: "Calm ads win.", source: "B41", learning: { ...L, goldBefore: before } }) as { id: string };
    await expect(canon.canonUpdate(env, { action: "edit", id, rule: "Calm ads win, always.", source: "s" })).rejects.toThrow(/edit needs learning/);
    const [add] = logOf(raw, id);
    expect(add.learning).toMatchObject({ observation: "Seen in a test.", evidenceCount: 2, confidence: "medium", goldBefore: { runId: before, scope: "all", balancedAccuracy: 0.733 } });
    // A retire may carry a record too; it is not needed.
    await canon.canonUpdate(env, { action: "retire", id, reason: "he contradicted it", learning: one });
    expect(logOf(raw, id)[1]!.learning).toMatchObject({ evidenceCount: 1 });
    const t = TOOLS.find((x) => x.name === "canon_update")!;
    expect(() => validate(t.inputSchema, { action: "add", rule: "x x x x x x x x", source: "s s", learning: { observation: "x x x", examples: ["a b c"], evidenceCount: 1, confidence: "medium", expectedEffect: "x x x" } })).toThrow(/counterexamples/);
    expect(() => validate(t.inputSchema, { action: "add", rule: "x x x x x x x x", source: "s s", learning: { ...L, confidence: "sure" } })).toThrow();
  });

  it("does not make one correction a rule for every brand without the owner's words", async () => {
    const { env, raw } = makeEnv();
    raw.exec(`INSERT INTO brands (id, slug, name, created_at, updated_at) VALUES ('b1', 'wongi', 'WonGi', 't', 't')`);
    await expect(canon.canonUpdate(env, { action: "add", rule: "Gold lids look premium.", source: "W47", learning: one })).rejects.toThrow(/One piece of evidence is not enough/);
    await expect(canon.canonUpdate(env, { action: "add", rule: "Gold lids look premium.", source: "W47", scope: "creative", learning: one })).rejects.toThrow(/One piece of evidence/);
    const { id } = await canon.canonUpdate(env, { action: "add", rule: "Gold lids look premium.", source: "W47", scope: "brand", brandSlug: "wongi", learning: one }) as { id: string };
    await canon.canonUpdate(env, { action: "add", rule: "The owner made this a rule.", source: "owner 12-11", learning: { ...one, ownerApproval: "a b c yes" } });
    // A brand rule moves out of its brand only with more evidence or his words; a reword in its scope needs neither.
    await expect(canon.canonUpdate(env, { action: "edit", id, rule: "Gold lids look premium.", source: "s", scope: "owner", learning: one })).rejects.toThrow(/One piece of evidence/);
    await canon.canonUpdate(env, { action: "edit", id, rule: "Gold lids look premium on WonGi.", source: "s", learning: one });
    await canon.canonUpdate(env, { action: "edit", id, rule: "Gold lids look premium.", source: "IRVINS and WonGi", scope: "owner", learning: L });
    expect((await canon.canonGet(env, {})).rules.map((r) => r.id)).toContain(id);
  });

  it("tests the newest change against the gold run before it: held, fell, untestable or no baseline", async () => {
    const { env, raw } = makeEnv();
    const before = goldRow(raw, 76, 20);
    const { id } = await canon.canonUpdate(env, { action: "add", rule: "Calm ads win.", source: "B41", learning: { ...L, goldBefore: before } }) as { id: string };
    await expect(canon.canonUpdate(env, { action: "test", id })).rejects.toThrow(/goldAfter .* or untestable/);
    await expect(canon.canonUpdate(env, { action: "test", id, goldAfter: before })).rejects.toThrow(/made after/);
    const inScope = goldRow(raw, 75, 19, "[in_scope] after");
    await expect(canon.canonUpdate(env, { action: "test", id, goldAfter: inScope })).rejects.toThrow(/same scope/);
    expect(await canon.canonUpdate(env, { action: "test", id, goldAfter: goldRow(raw, 75, 19) })).toEqual({ id, tested: "add", result: "held", delta: -0.016 });
    expect(await canon.canonUpdate(env, { action: "test", id, goldAfter: goldRow(raw, 66, 15) })).toMatchObject({ result: "fell", delta: -0.119 });
    expect(await canon.canonUpdate(env, { action: "test", id, untestable: "a visual rule: the gold set is text only" })).toMatchObject({ result: "untestable", delta: null });
    const tests = logOf(raw, id).filter((l) => l.action === "test");
    expect(tests.map((l) => l.result)).toEqual(["held", "fell", "untestable"]);
    expect(tests[0]).toMatchObject({ of: "add", goldBefore: before, goldAfter: { balancedAccuracy: 0.717 } });
    // A change with no run before it has no baseline.
    await canon.canonUpdate(env, { action: "edit", id, rule: "Calm ads win, mostly.", source: "s", learning: L });
    expect(await canon.canonUpdate(env, { action: "test", id, goldAfter: goldRow(raw, 75, 19) })).toMatchObject({ tested: "edit", result: "no_baseline" });
  });

  it("gives the gold run id, so a learning record can name it", async () => {
    const { env, raw } = makeEnv();
    raw.exec("INSERT INTO gold_items (id, label, mark, created_at) VALUES ('g1', 'a', 'use', 't'), ('g2', 'b', 'pass', 't')");
    const r = await canon.goldScore(env, { note: "before x", answers: [{ id: "g1", mark: "use" }, { id: "g2", mark: "use" }] });
    expect(r.runId).toBeGreaterThan(0);
    expect((await canon.goldRuns(env)).runs[0]).toMatchObject({ runId: r.runId, note: "before x", balancedAccuracy: 0.5 });
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

  it("takes a full run of up to 2000 answers in one call", () => {
    const t = TOOLS.find((x) => x.name === "gold_score")!;
    const answers = Array.from({ length: 2000 }, (_, i) => ({ id: `00000000-0000-0000-0000-${String(i).padStart(12, "0")}`, mark: "use" }));
    expect(() => validate(t.inputSchema, { note: "full run", answers })).not.toThrow();
    expect(() => validate(t.inputSchema, { note: "too many", answers: [...answers, answers[0]] })).toThrow();
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
    expect(run).not.toHaveProperty("baseline");
    expect(run).not.toHaveProperty("useRecall");
    expect(run).not.toHaveProperty("passRecall");
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

  it("refuses a run that does not answer every gold item", async () => {
    const { env } = makeEnv();
    await canon.goldImport(env, items);
    const g = (await canon.goldGet(env, {})).items;
    await expect(canon.goldScore(env, { note: "easy subset", answers: [{ id: g[0]!.id as string, mark: "pass" }] })).rejects.toThrow(/Answer every gold item of the scope: the set has 3 and you sent 1/);
    expect((await canon.goldRuns(env)).runs).toHaveLength(0);
  });

  it("the in_scope score leaves out the out-of-scope products and compares only with runs of its own scope", async () => {
    const { env } = makeEnv();
    await canon.goldImport(env, [...items, { label: "v1 Poplin Trapeze Dress 2026-10-20 ad1 #x", mark: "pass" as const }, { label: "v1 ErgoTune Joobie 2026-10-21 ad0 #y", mark: "use" as const }]);
    const full = await canon.goldGet(env, { limit: 500 });
    const scoped = await canon.goldGet(env, { limit: 500, scope: "in_scope" });
    expect([full.total, scoped.total, scoped.scope]).toEqual([5, 3, "in_scope"]);
    expect(scoped.items.map((i) => i.label)).not.toContain("v1 ErgoTune Joobie 2026-10-21 ad0 #y");
    const pass = (g: typeof full) => g.items.map((i) => ({ id: i.id as string, mark: "pass" as const }));
    await canon.goldScore(env, { note: "full before", answers: pass(full) });
    // An out-of-scope item is refused in an in_scope run, and the run must cover the 3 in-scope items.
    const dress = full.items.find((i) => String(i.label).includes("Poplin"))!.id as string;
    await expect(canon.goldScore(env, { note: "x y z", scope: "in_scope", answers: [{ id: dress, mark: "pass" }] })).rejects.toThrow(/Not gold items of the in_scope set/);
    const r = await canon.goldScore(env, { note: "scoped before", scope: "in_scope", answers: pass(scoped) });
    expect(r).toMatchObject({ scope: "in_scope", n: 3, previous: null });
    expect((await canon.goldScore(env, { note: "full after", answers: pass(full) })).previous).toMatchObject({ scope: "all", note: "full before" });
    expect((await canon.goldScore(env, { note: "scoped after", scope: "in_scope", answers: pass(scoped) })).previous).toMatchObject({ scope: "in_scope", note: "scoped before" });
    expect((await canon.goldRuns(env)).runs.map((x) => `${x.scope}:${x.note}`)).toEqual(["in_scope:scoped after", "all:full after", "in_scope:scoped before", "all:full before"]);
    // The tag is the server's: a note may not start with it, or an all-scope run would read as an in_scope run.
    await expect(canon.goldScore(env, { note: "[in_scope] mine", answers: pass(full) })).rejects.toThrow(/may not start with \[in_scope\]/);
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
