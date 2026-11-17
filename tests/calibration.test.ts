import type { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { prop, wilson } from "../worker/calibration";
import { approved, boardReady, E3, renderId, run, seeded } from "./helpers/engine3";

/** a11-engine v3 Phase 4: the rank context stamp, taste_log before and calibration_report (design pack §4, tests 4.3 to 4.10). */

const T1 = "2026-11-10T01:00:00.000Z";
const T2 = "2026-11-10T02:00:00.000Z";

/** One decided draft set of an engine 2 batch: an idea, 3 drafts ranked 1 to 3 at T1, and the owner's pick at T2. */
function decidedSet(raw: DatabaseSync, batchId: string, n: number, pickedRank: number, stamp?: Record<string, unknown>) {
  const idea = `${n}0000000-0000-4000-8000-00000000000${n}`.slice(0, 36);
  raw.prepare("INSERT INTO ideas (id, batch_id, n, format, insight, visual, headline, created_at) VALUES (?, ?, ?, 'tof', 'i', 'v', 'h', ?)").run(idea, batchId, n, T1);
  for (const rank of [1, 2, 3]) {
    const rid = `${n}${rank}000000-0000-4000-8000-000000000000`;
    raw
      .prepare(`INSERT INTO renders (id, batch, idea, kind, status, prompt, refs, width, height, quality, num_images, image_keys, usd_est, created_at, updated_at)
        VALUES (?, ?, ?, 'draft', 'done', 'p', '[]', 1024, 1280, 'low', 1, ?, 0.02, ?, ?)`)
      .run(rid, batchId, idea, JSON.stringify([`renders/${rid}/0.jpg`]), T1, T1);
    raw.prepare("INSERT INTO draft_ranks (render_key, batch_id, idea_id, rank, reason, created_at) VALUES (?, ?, ?, ?, 'r', ?)").run(`renders/${rid}/0.jpg`, batchId, idea, rank, T1);
  }
  raw.prepare("INSERT INTO picks (render_key, batch_id, idea_id, note, by_owner, created_at) VALUES (?, ?, ?, 'his words', 1, ?)").run(`renders/${n}${pickedRank}000000-0000-4000-8000-000000000000/0.jpg`, batchId, idea, T2);
  if (stamp)
    raw.prepare("INSERT INTO batch_records (id, batch_id, kind, idea_id, version, body, author, prompt_version, created_at) VALUES (?, ?, 'rank_context', ?, 1, ?, 'server', ?, ?)")
      .run(crypto.randomUUID(), batchId, idea, JSON.stringify(stamp), String(stamp.promptVersion), T1);
  return idea;
}

describe("calibration", () => {
  it("wilson and prop: the interval, and the small-sample text under n = 30", () => {
    expect(wilson(2, 12)).toEqual([0.047, 0.448]);
    expect(prop(1, 4)).toMatchObject({ k: 1, n: 4, value: 0.25, note: "small sample: direction only, no conclusion" });
    expect(prop(15, 30)).not.toHaveProperty("note");
    expect(prop(0, 0)).toMatchObject({ value: null, interval: null });
  });

  it("(4.3) drafts_rank writes a rank_context record for each idea, with the canon log id, the prompt version and the taste rows", async () => {
    const { env, raw, picks } = await boardReady({ rank: false });
    const canonLogId = (raw.prepare("SELECT MAX(id) AS id FROM canon_log").get() as { id: number | null }).id;
    const tasteRows = (raw.prepare("SELECT (SELECT COUNT(*) FROM picks WHERE by_owner = 1) + (SELECT COUNT(*) FROM verdicts) AS n").get() as { n: number }).n;
    const keys = [1, 2, 3].map((n) => `renders/${renderId(1, n)}/0.jpg`);
    await run(env, "drafts_rank", { batchId: E3, promptVersion: "0.2.17", ranks: keys.map((key, i) => ({ key, rank: i + 1, reason: "The pouch reads first." })) });
    const rows = raw.prepare("SELECT idea_id, version, body, author, prompt_version FROM batch_records WHERE kind = 'rank_context'").all() as Record<string, string>[];
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ idea_id: picks[0]!.id, version: 1, author: "server", prompt_version: "0.2.17" });
    expect(JSON.parse(String(rows[0]!.body))).toEqual({ canonLogId, tasteRows, promptVersion: "0.2.17", keys });
    // A second rank is a new version.
    await run(env, "drafts_rank", { batchId: E3, ranks: [{ key: keys[0], rank: 1, reason: "The pouch reads first." }] });
    expect(raw.prepare("SELECT MAX(version) AS v FROM batch_records WHERE kind = 'rank_context'").get()).toEqual({ v: 2 });
  });

  it("(4.3) the engine 3 concept review record is the stamp of the critic's selection: canon log id and taste rows", async () => {
    const { env, raw } = await approved();
    const canonLogId = (raw.prepare("SELECT MAX(id) AS id FROM canon_log").get() as { id: number | null }).id;
    const body = JSON.parse((raw.prepare("SELECT body FROM batch_records WHERE kind = 'concept_review'").get() as { body: string }).body);
    expect(canonLogId).not.toBeNull();
    expect(body).toMatchObject({ canonLogId, tasteRows: 0 });
    // The concept metrics are by engine and by the prompt version of the review record.
    const r = await run(env, "calibration_report", { engine: 3 });
    const pv = (raw.prepare("SELECT prompt_version AS v FROM batch_records WHERE kind = 'concept_review'").get() as { v: string }).v;
    expect(r.conceptAcceptance.reworkBatches).toEqual([{ engine: 3, promptVersion: pv, ...prop(0, 1) }]);
    expect(r.conceptAcceptance.concepts[0]).toMatchObject({ engine: 3, promptVersion: pv });
    expect((await run(env, "calibration_report", { engine: 3, promptVersion: "no such version" })).conceptAcceptance.concepts).toEqual([]);
  });

  it("false acceptance counts an eligible draft that the owner marked fix", async () => {
    const { env, raw, picks } = await boardReady();
    const key = `renders/${renderId(1, 1)}/0.jpg`;
    raw.prepare("INSERT INTO verdicts (id, batch_id, idea_id, render_key, stage, mark, owner_said, created_at) VALUES ('v1', ?, ?, ?, 'draft', 'fix', 'the lid is wrong', ?)").run(E3, picks[0]!.id, key, T2);
    raw.prepare("INSERT INTO verdicts (id, batch_id, idea_id, stage, mark, owner_said, created_at) VALUES ('v2', ?, ?, 'draft', 'pass', 'none of these', ?)").run(E3, picks[0]!.id, T2);
    const fa = (await run(env, "calibration_report", { engine: 3 })).falseAcceptance;
    expect(fa).toHaveLength(1);
    expect(fa[0]).toMatchObject({ engine: 3, k: 1 });
  });

  it("(4.4, 4.5) the draft-pick agreement and MRR by engine and stamp: 4 decided sets (ranks 1, 2, 2, 3) and one stamped set", async () => {
    const { env, raw, e2 } = await seeded();
    for (const [n, rank] of [[1, 1], [2, 2], [3, 2], [4, 3]] as const) decidedSet(raw, e2, n, rank);
    decidedSet(raw, e2, 5, 1, { promptVersion: "0.2.17", canonLogId: 4, tasteRows: 20 });
    const r = await run(env, "calibration_report", {});
    const unstamped = r.draftPick.find((g: { stamp: unknown }) => g.stamp === "unstamped");
    expect(unstamped).toMatchObject({ engine: 2, n: 4, mrr: 0.583, rank1: { k: 1, n: 4, value: 0.25, note: "small sample: direction only, no conclusion" } });
    expect(unstamped.rank1.interval).toHaveLength(2);
    expect(unstamped.ranksOfPick).toEqual({ 1: 1, 2: 2, 3: 1 });
    expect(r.draftPick).toHaveLength(2);
    expect(r.draftPick.find((g: { stamp: unknown }) => g.stamp !== "unstamped")).toMatchObject({ engine: 2, stamp: { promptVersion: "0.2.17", canonLogId: 4 }, n: 1, mrr: 1 });
    // The filters: a prompt version keeps its stamped group only; engine 3 has no set yet.
    expect((await run(env, "calibration_report", { promptVersion: "0.2.17" })).draftPick).toHaveLength(1);
    expect((await run(env, "calibration_report", { engine: 3 })).draftPick).toEqual([]);
    // A rank saved after the pick does not count (the critic could have seen the answer).
    raw.prepare("UPDATE draft_ranks SET created_at = '2026-11-11T00:00:00.000Z' WHERE idea_id LIKE '1%'").run();
    expect((await run(env, "calibration_report", {})).draftPickUnranked).toBe(1);
    expect(r.ownerPassRate).toEqual([{ engine: 2, ...prop(0, 5) }, { engine: 3, ...prop(0, 0) }]);
    expect(r.notes.join(" ")).toMatch(/text gold set is not a visual result/);
  });

  it("(4.8) taste_log before: no pick or verdict at or after the date", async () => {
    const { env, raw, e2 } = await seeded();
    decidedSet(raw, e2, 1, 1);
    const idea = decidedSet(raw, e2, 2, 2);
    raw.prepare("UPDATE picks SET created_at = '2026-11-12T00:00:00.000Z' WHERE idea_id = ?").run(idea);
    raw.prepare("INSERT INTO verdicts (id, batch_id, idea_id, stage, mark, owner_said, created_at) VALUES ('v1', ?, ?, 'draft', 'fix', 'too dark', '2026-11-12T00:00:00.000Z')").run(e2, idea);
    const all = await run(env, "taste_log", {});
    expect([all.picks.length, all.verdicts.length, all.tally.reviewed]).toEqual([2, 1, 2]);
    const cut = await run(env, "taste_log", { before: "2026-11-12" });
    expect([cut.picks.length, cut.verdicts.length, cut.tally]).toEqual([1, 0, { reviewed: 1, agreed: 1 }]);
    expect(cut.before).toBe("2026-11-12");
    // A UTC time without milliseconds cuts at that instant: the pick and the verdict at 00:00:00.000Z stay out.
    const atInstant = await run(env, "taste_log", { before: "2026-11-12T00:00:00Z" });
    expect([atInstant.picks.length, atInstant.verdicts.length]).toEqual([1, 0]);
    expect((await run(env, "taste_log", { before: "2026-11-12T00:00:01Z" })).verdicts).toHaveLength(1);
    for (const before of ["2026-11-12T25:00Z", "2026-02-30", "2026-02-30T10:00Z"])
      await expect(run(env, "taste_log", { before })).rejects.toThrow("before must be a real UTC date or time");
    // A rank saved at or after the cut is not in the log, and not in the tally either.
    raw.prepare("UPDATE draft_ranks SET created_at = '2026-11-12T00:00:00.000Z' WHERE idea_id LIKE '1%'").run();
    expect((await run(env, "taste_log", { before: "2026-11-12" })).tally).toEqual({ reviewed: 0, agreed: 0 });
  });

  it("(4.9) the copy correction rate: 2 of 3 picked ideas have approved words that differ from the words as written", async () => {
    const { env, raw } = await approved();
    const picked = raw.prepare("SELECT id FROM ideas WHERE batch_id = ? AND picked = 1 ORDER BY n").all(E3) as { id: string }[];
    raw.prepare("UPDATE ideas SET copy = json_set(copy, '$.written', json_object('headline', 'Old words', 'subline', '')) WHERE id IN (?, ?)").run(picked[0]!.id, picked[1]!.id);
    expect((await run(env, "calibration_report", { engine: 3 })).copyCorrectionRate).toMatchObject([{ engine: 3, k: 2, n: 3, value: 0.667 }]);
  });

  it("(4.10) the paid render waste: spend outside an approved final's line ÷ all spend", async () => {
    const { env, raw, e2 } = await seeded();
    const idea = decidedSet(raw, e2, 1, 2); // 3 drafts at 0.02, the owner picked rank 2
    const fid = "f1000000-0000-4000-8000-000000000000";
    raw
      .prepare(`INSERT INTO renders (id, batch, idea, kind, status, prompt, refs, width, height, quality, num_images, image_keys, usd_est, created_at, updated_at)
        VALUES (?, ?, ?, 'final', 'done', 'p', '[]', 1024, 1280, 'high', 1, ?, 0.10, ?, ?), ('f2000000-0000-4000-8000-000000000000', ?, ?, 'final', 'done', 'p', '[]', 1024, 1280, 'high', 1, '[]', 0.10, ?, ?)`)
      .run(fid, e2, idea, JSON.stringify([`renders/${fid}/0.jpg`]), T2, T2, e2, idea, T2, T2);
    raw.prepare("UPDATE picks SET final_render_id = ? WHERE idea_id = ?").run(fid, idea);
    raw.prepare("INSERT INTO verdicts (id, batch_id, idea_id, render_key, stage, mark, owner_said, created_at) VALUES ('v1', ?, ?, ?, 'final', 'approve', 'yes', ?)").run(e2, idea, `renders/${fid}/0.jpg`, T2);
    // The spend ledger: one fal row for each render, a released row (not billed) and a row with no render row (no engine).
    raw.prepare("INSERT INTO spend (at, service, kind, ref, usd_est, status) SELECT created_at, 'fal', kind, id, usd_est, 'spent' FROM renders WHERE batch = ?").run(e2);
    raw.prepare("INSERT INTO spend (at, service, kind, ref, usd_est, status) VALUES (?, 'fal', 'draft', 'gone', 0.05, 'spent'), (?, 'fal', 'draft', ?, 0.02, 'released')").run(T2, T2, fid);
    // Line: the approved final (0.10) and its picked draft (0.02). Waste: 2 drafts (0.04) and the other final (0.10). Total 0.26.
    const r = await run(env, "calibration_report", { engine: 2 });
    expect(r.paidRenderWaste).toMatchObject({ usdWaste: 0.14, usdTotal: 0.26, share: 0.538, jobs: 5, wastedJobs: 3 });
    // With no engine filter, the row with no render row counts, as waste.
    expect((await run(env, "calibration_report", {})).paidRenderWaste).toMatchObject({ usdWaste: 0.19, usdTotal: 0.31, jobs: 6 });
    expect(r.finalApproval).toEqual([{ engine: 2, ...prop(1, 1) }]);
  });

  describe("the visual set and the replay (unit 7b)", () => {
    /** 5 decided sets at distinct times: ideas 1 to 4 picked (ranks 1, 2, 2, 3), idea 5 passed. R2 holds every picture except the missing ones. */
    async function set(missing: string[] = []) {
      const s = await seeded();
      for (const [n, rank] of [[1, 1], [2, 2], [3, 2], [4, 3]] as const) decidedSet(s.raw, s.e2, n, rank);
      const idea5 = decidedSet(s.raw, s.e2, 5, 1);
      s.raw.prepare("DELETE FROM picks WHERE idea_id = ?").run(idea5);
      s.raw.prepare("INSERT INTO verdicts (id, batch_id, idea_id, stage, mark, owner_said, created_at) VALUES ('vp', ?, ?, 'draft', 'pass', 'none of these', ?)").run(s.e2, idea5, T2);
      for (const n of [1, 2, 3, 4]) s.raw.prepare("UPDATE picks SET created_at = ? WHERE idea_id LIKE ?").run(`2026-11-10T0${n + 2}:00:00.000Z`, `${n}%`);
      s.raw.prepare("UPDATE verdicts SET created_at = '2026-11-10T08:00:00.000Z' WHERE id = 'vp'").run();
      (s.env as unknown as { MEDIA: unknown }).MEDIA = { head: async (k: string) => (missing.includes(k) ? null : {}) };
      return s;
    }
    const key = (n: number, rank: number) => `renders/${n}${rank}000000-0000-4000-8000-000000000000/0.jpg`;

    it("(4.6) calibration_items gives no label: no pick, verdict, owner words or rank; the size and class balance", async () => {
      const { env } = await set();
      const r = await run(env, "calibration_items", { kind: "triplet", seed: "run-1" });
      expect(r.size).toEqual({ items: 5, decided: 5, lost: 0 });
      expect(r.classBalance).toEqual({ picked: 4, passed: 1 });
      expect(r.items[0].pictures).toHaveLength(3);
      const text = JSON.stringify(r.items);
      for (const word of ["his words", "none of these", "label", "ownerSaid", "rank", "reason"]) expect(text).not.toContain(word);
      // The same seed gives the same order of items and pictures; the items are not in decision order for every seed.
      expect((await run(env, "calibration_items", { kind: "triplet", seed: "run-1" })).items).toEqual(r.items);
      const orders = new Set<string>();
      for (const seed of ["seed-1", "seed-2", "seed-3", "seed-4", "seed-5"]) orders.add((await run(env, "calibration_items", { kind: "triplet", seed })).items.map((i: { id: string }) => i.id).join());
      expect(orders.size).toBeGreaterThan(1);
    });

    it("(4.7) an item with a picture gone from R2 is not in the set and is counted as lost", async () => {
      const { env } = await set([key(2, 3)]);
      const r = await run(env, "calibration_items", { kind: "triplet", seed: "run-1" });
      expect(r.size).toEqual({ items: 4, decided: 5, lost: 1 });
    });

    it("the holdout is the newest 30% by decision time, and asOf cuts the set", async () => {
      const { env } = await set();
      const hold = await run(env, "calibration_items", { kind: "triplet", seed: "s123", split: "holdout" });
      expect(hold.items).toHaveLength(2);
      expect(hold.splitDate).toBe("2026-11-10T06:00:00.000Z");
      expect((await run(env, "calibration_items", { kind: "triplet", seed: "s123", split: "tuning" })).items).toHaveLength(3);
      expect((await run(env, "calibration_items", { kind: "triplet", seed: "s123", asOf: "2026-11-10T04:30:00Z" })).items).toHaveLength(2);
      await expect(run(env, "calibration_items", { kind: "triplet", seed: "s123", asOf: "2026-02-30" })).rejects.toThrow("asOf must be a real UTC date or time");
    });

    it("calibration_save scores a triplet replay on the server, with the positions, and the report shows the runs", async () => {
      const { env, raw } = await set();
      const items = (await run(env, "calibration_items", { kind: "triplet", seed: "run-1" })).items as { id: string; pictures: string[] }[];
      // The critic is right on idea 1 (its pick) and idea 5 (a pass), wrong on the others.
      const answers = items.map((it) => {
        const n = Number(it.id.split(":")[2]![0]);
        const choice = n === 1 ? key(1, 1) : n === 5 ? "pass" : key(n, n === 4 ? 1 : 3);
        return { itemId: it.id, choice, reason: "The pouch reads first." };
      });
      const r = await run(env, "calibration_save", { kind: "triplet_replay", seed: "run-1", promptVersion: "0.2.18", answers });
      expect(r).toMatchObject({ kind: "triplet_replay", n: 5, contaminated: true, agreement: { k: 2, n: 5 }, splitDate: "2026-11-10T06:00:00.000Z" });
      const posOf = (n: number, k: string) => items.find((i) => i.id.split(":")[2]!.startsWith(`${n}`))!.pictures.indexOf(k) + 1;
      expect(r.items.find((x: { id: string }) => x.id.split(":")[2]!.startsWith("1")).position).toBe(posOf(1, key(1, 1)));
      expect(r.positions.pass).toBe(1);
      expect(JSON.stringify(r.items)).not.toContain("The pouch reads first.");
      const row = raw.prepare("SELECT kind, split, prompt_version, n FROM calibration_runs").get();
      expect(row).toEqual({ kind: "triplet_replay", split: "all", prompt_version: "0.2.18", n: 5 });
      const rep = await run(env, "calibration_report", {});
      expect(rep.replays.runs).toHaveLength(1);
      expect(rep.replays.positionBias).toMatchObject({ choices: 4, alarm: false });
      expect(JSON.parse((raw.prepare("SELECT result FROM calibration_runs").get() as { result: string }).result).splitDate).toBe("2026-11-10T06:00:00.000Z");
      // The report filters hold for the replays too.
      expect((await run(env, "calibration_report", { engine: 3 })).replays).toMatchObject({ runs: [], positionBias: { choices: 0 } });
      expect((await run(env, "calibration_report", { engine: 2 })).replays.runs[0]).toMatchObject({ n: 5, agreement: { k: 2, n: 5 } });
      expect((await run(env, "calibration_report", { promptVersion: "0.2.17" })).replays.runs).toHaveLength(0);
      expect((await run(env, "calibration_report", { since: "2099-01-01" })).replays.runs).toHaveLength(0);
      // Refused: an item of another split, a partial run, a choice that is not a picture, an answer twice, no seed.
      const tuning = (await run(env, "calibration_items", { kind: "triplet", seed: "run-1", split: "tuning" })).items.map((i: { id: string }) => i.id);
      const held = items.find((i) => !tuning.includes(i.id))!.id;
      await expect(run(env, "calibration_save", { kind: "triplet_replay", seed: "run-1", split: "tuning", answers: [{ itemId: held, choice: "pass", reason: "r" }] })).rejects.toThrow("Not items of this set");
      await expect(run(env, "calibration_save", { kind: "triplet_replay", seed: "run-1", answers: answers.slice(1) })).rejects.toThrow("Answer every item of this set (kind, asOf, split): it has 5 and you sent 4.");
      const bad = answers.map((x, i) => (i === 0 ? { ...x, choice: "renders/x/0.jpg" } : x));
      await expect(run(env, "calibration_save", { kind: "triplet_replay", seed: "run-1", answers: bad })).rejects.toThrow("is not one of its pictures");
      await expect(run(env, "calibration_save", { kind: "triplet_replay", seed: "run-1", answers: [answers[0], answers[0]] })).rejects.toThrow("answered once");
      await expect(run(env, "calibration_save", { kind: "triplet_replay", answers })).rejects.toThrow("needs the seed");
    });

    it("a final replay and a concept stability run", async () => {
      const { env, raw, e2 } = await set();
      const idea = (raw.prepare("SELECT id FROM ideas WHERE batch_id = ? AND n = 1").get(e2) as { id: string }).id;
      raw.prepare("INSERT INTO verdicts (id, batch_id, idea_id, render_key, stage, mark, owner_said, created_at) VALUES ('vf', ?, ?, 'renders/f/0.jpg', 'final', 'approve', 'yes', ?)").run(e2, idea, T2);
      const items = (await run(env, "calibration_items", { kind: "final", seed: "run-2" })).items;
      expect(items).toHaveLength(1);
      expect((await run(env, "calibration_save", { kind: "final_replay", seed: "run-2", answers: [{ itemId: items[0].id, choice: "fix", reason: "r" }] })).agreement).toMatchObject({ k: 0, n: 1 });
      const ids = [1, 2, 3, 4].map((n) => `${n}0000000-0000-4000-8000-00000000000${n}`);
      const s = await run(env, "calibration_save", { kind: "concept_stability", stability: { batchId: e2, first: ids.slice(0, 3), second: [ids[0], ids[3], ids[2]] } });
      expect(s).toMatchObject({ common: 2, alarm: false });
      await expect(run(env, "calibration_save", { kind: "concept_stability", stability: { batchId: e2, first: [ids[0], ids[0], ids[1]], second: ids.slice(0, 3) } })).rejects.toThrow("3 different concepts");
      const other = "90000000-0000-4000-8000-000000000009";
      await expect(run(env, "calibration_save", { kind: "concept_stability", stability: { batchId: e2, first: ids.slice(0, 3), second: [other, ids[1], ids[2]] } })).rejects.toThrow(`Not concepts of batch ${e2}: ${other}`);
    });

    it("a triplet holds only the drafts the owner saw: after his previous pass, and for engine 3 the eligible drafts of the round", async () => {
      const { env, raw, e2 } = await set();
      const idea = (raw.prepare("SELECT id FROM ideas WHERE batch_id = ? AND n = 1").get(e2) as { id: string }).id;
      // An earlier full pass on idea 1 at 02:00, after its first 2 drafts: only the third draft was in front of him at his pick.
      raw.prepare("INSERT INTO verdicts (id, batch_id, idea_id, stage, mark, owner_said, created_at) VALUES ('vp0', ?, ?, 'draft', 'pass', 'no', '2026-11-10T02:00:00.000Z')").run(e2, idea);
      raw.prepare("UPDATE renders SET created_at = '2026-11-10T02:30:00.000Z' WHERE idea = ? AND id LIKE '13%'").run(idea);
      raw.prepare("UPDATE renders SET created_at = '2026-11-10T01:00:00.000Z' WHERE idea = ? AND id NOT LIKE '13%'").run(idea);
      const items = (await run(env, "calibration_items", { kind: "triplet", seed: "run-3" })).items as { id: string; pictures: string[] }[];
      // Two decisions on idea 1: the pass (it saw drafts 1 and 2) and the pick (it saw draft 3 only).
      const one = items.filter((i) => i.id.split(":")[2] === idea).sort((a, b) => a.id.localeCompare(b.id));
      expect(one.map((i) => [...i.pictures].sort())).toEqual([[key(1, 1), key(1, 2)], [key(1, 3)]]);
      // Engine 3: one draft not eligible, one checked in an older round; only the eligible draft of the current round stays.
      // Engine 3 (idea 6 of the engine 3 batch): one draft checked in an older round, one not eligible; only the eligible draft of the current round stays.
      const idea6 = decidedSet(raw, E3, 6, 3);
      const rec = (kind: string, body: unknown, at: string, v = 1) =>
        raw.prepare("INSERT INTO batch_records (id, batch_id, kind, idea_id, version, body, author, created_at) VALUES (?, ?, ?, ?, ?, ?, 'art-director', ?)").run(crypto.randomUUID(), E3, kind, idea6, v, JSON.stringify(body), at);
      rec("direction", { drafts: [] }, "2026-11-09T00:00:00.000Z", 1);
      rec("draft_check", { renderId: "61000000-0000-4000-8000-000000000000", eligible: true, round: 1 }, T1, 1);
      rec("direction", { drafts: [] }, "2026-11-09T12:00:00.000Z", 2);
      rec("draft_check", { renderId: "62000000-0000-4000-8000-000000000000", eligible: false, round: 2 }, T1, 2);
      rec("draft_check", { renderId: "63000000-0000-4000-8000-000000000000", eligible: true, round: 2 }, T1, 3);
      const e3 = (await run(env, "calibration_items", { kind: "triplet", seed: "run-3" })).items as { id: string; pictures: string[] }[];
      expect(e3.find((i) => i.id.split(":")[2] === idea6)!.pictures).toEqual([key(6, 3)]);
    });

    it("(4.11) the critic subagent's tools do not hold the calibration tools", () => {
      const tools = readFileSync(new URL("../plugin/agents/critic.md", import.meta.url), "utf8").match(/^tools: (.*)$/m)![1]!;
      expect(tools).not.toMatch(/calibration_/);
      expect(tools).toContain("mcp__a11__taste_log");
    });
  });
});
