import type { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
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
});
