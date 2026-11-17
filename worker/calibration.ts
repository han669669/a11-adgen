import { type Check, finalReady } from "./checks";
import type { Env } from "./env";

/**
 * a11-engine v3 Phase 4: critic calibration (design pack §4). The server stamps each rank with the critic's context, and
 * the report computes the metrics from D1, with n and an interval, by engine and stamp. No stored state.
 */

/**
 * The rank context stamp (design pack §4.4): the canon and the taste log that the critic had when it ranked or reviewed.
 * The count of taste log rows is the owner picks and verdicts that existed then.
 */
export async function rankStamp(env: Env) {
  const r = await env.DB.prepare(
    `SELECT (SELECT MAX(id) FROM canon_log) AS canon,
       (SELECT COUNT(*) FROM picks WHERE by_owner = 1) + (SELECT COUNT(*) FROM verdicts) AS rows`,
  ).first<{ canon: number | null; rows: number }>();
  return { canonLogId: r?.canon ?? null, tasteRows: r?.rows ?? 0 };
}

const Z = 1.96;
/** The Wilson 95% interval of k in n (design pack §4.8). */
export function wilson(k: number, n: number): [number, number] | null {
  if (n === 0) return null;
  const p = k / n;
  const d = 1 + (Z * Z) / n;
  const c = (p + (Z * Z) / (2 * n)) / d;
  const h = (Z * Math.sqrt((p * (1 - p)) / n + (Z * Z) / (4 * n * n))) / d;
  return [round(Math.max(0, c - h)), round(Math.min(1, c + h))];
}
const round = (x: number) => Math.round(x * 1000) / 1000;
const SMALL = "small sample: direction only, no conclusion";
/** A proportion with its n, its Wilson interval, and the small-sample text under n = 30. */
export function prop(k: number, n: number) {
  return { k, n, value: n ? round(k / n) : null, interval: wilson(k, n), ...(n < 30 ? { note: SMALL } : {}) };
}

/** The render id in a picture key (renders/<render id>/…). */
const renderOf = (key: string | null) => key?.match(/^renders\/([0-9a-f-]{36})\//)?.[1] ?? null;

export type ReportFilter = { engine?: number; since?: string; promptVersion?: string };

type Stamp = { promptVersion?: string; canonLogId?: number | null; tasteRows?: number };

/**
 * The critic calibration report (design pack §4.2, §4.7): every metric with n and, for a proportion, its Wilson
 * interval, by engine and by the version stamp of the record that made the judgement. Read only: it computes from D1
 * each time. since and engine filter every metric; promptVersion filters every stamped metric. The owner's own
 * decisions (pass rate, final approval, copy corrections, render waste) have no critic stamp and are by engine only.
 */
export async function calibrationReport(env: Env, f: ReportFilter = {}) {
  const since = f.since ?? "";
  const eng = (e: number) => f.engine === undefined || f.engine === e;
  const q = <T>(sql: string, ...binds: unknown[]) => env.DB.prepare(sql).bind(...binds).all<T>().then((r) => r.results);

  const [picks, passes, finalVerdicts, draftFixes, records, ideas, spendRows, finalPicks] = await Promise.all([
    // Every owner pick with the critic's rank of the picked draft, when the rank was made before the pick, and the
    // newest stamp of that idea at or before the pick.
    q<{ batch_id: string; idea_id: string; render_key: string; engine: number; rank: number | null; stamp: string | null }>(
      `SELECT p.batch_id, p.idea_id, p.render_key, b.engine,
         (SELECT d.rank FROM draft_ranks d WHERE d.render_key = p.render_key AND d.created_at <= p.created_at) AS rank,
         (SELECT r.body FROM batch_records r WHERE r.batch_id = p.batch_id AND r.kind = 'rank_context' AND r.idea_id = p.idea_id
            AND r.created_at <= p.created_at ORDER BY r.rowid DESC LIMIT 1) AS stamp
       FROM picks p JOIN batches b ON b.id = p.batch_id WHERE p.by_owner = 1 AND p.created_at >= ?`,
      since,
    ),
    q<{ engine: number; idea_id: string }>(
      `SELECT b.engine, v.idea_id FROM verdicts v JOIN batches b ON b.id = v.batch_id WHERE v.stage = 'draft' AND v.mark = 'pass' AND v.created_at >= ?`,
      since,
    ),
    q<{ engine: number; mark: string; render_key: string | null }>(
      `SELECT b.engine, v.mark, v.render_key FROM verdicts v JOIN batches b ON b.id = v.batch_id
       WHERE v.stage = 'final' AND v.mark IN ('approve', 'fix', 'reject') AND v.created_at >= ? ORDER BY v.created_at, v.rowid`,
      since,
    ),
    // The owner's fix marks on one draft picture (a defect in a draft that a check may have called eligible).
    q<{ render_key: string }>(
      `SELECT render_key FROM verdicts WHERE stage = 'draft' AND mark = 'fix' AND render_key IS NOT NULL AND created_at >= ?`,
      since,
    ),
    q<{ batch_id: string; kind: string; idea_id: string | null; version: number; body: string; author: string; prompt_version: string; engine: number }>(
      `SELECT r.batch_id, r.kind, r.idea_id, r.version, r.body, r.author, r.prompt_version, b.engine FROM batch_records r JOIN batches b ON b.id = r.batch_id
       WHERE r.kind IN ('concept_review', 'direction', 'draft_check', 'final_check') AND r.created_at >= ? ORDER BY r.rowid`,
      since,
    ),
    q<{ batch_id: string; engine: number; headline: string; copy: string }>(
      `SELECT i.batch_id, b.engine, i.headline, i.copy FROM ideas i JOIN batches b ON b.id = i.batch_id
       WHERE i.picked = 1 AND json_extract(i.copy, '$.ownerApproved') IS NOT NULL AND b.created_at >= ?`,
      since,
    ),
    // The fal spend ledger (each row's ref is its render id); a released row was not billed. A row with no render row has no engine.
    q<{ ref: string | null; usd_est: number; engine: number | null }>(
      `SELECT s.ref, s.usd_est, b.engine FROM spend s LEFT JOIN renders r ON r.id = s.ref LEFT JOIN batches b ON b.id = r.batch
       WHERE s.service = 'fal' AND s.status != 'released' AND s.at >= ?`,
      since,
    ),
    q<{ render_key: string; final_render_id: string | null }>(
      `SELECT render_key, final_render_id FROM picks WHERE final_render_id IS NOT NULL`,
    ),
  ]);

  // Draft-pick agreement and MRR, by engine and stamp (the primary measure, §4.2).
  const groups = new Map<string, { engine: number; stamp: Stamp | "unstamped"; ranks: number[]; taste: number[] }>();
  let unranked = 0;
  for (const p of picks) {
    if (!eng(p.engine)) continue;
    if (p.rank === null) { unranked++; continue; }
    const s = p.stamp ? (JSON.parse(p.stamp) as Stamp) : null;
    if (f.promptVersion !== undefined && s?.promptVersion !== f.promptVersion) continue;
    const label = `${p.engine}|${s ? `${s.promptVersion ?? ""}|${s.canonLogId ?? ""}` : "unstamped"}`;
    // tasteRows grows by one with each decision, so it is not in the group key (each rank would be a group of 1): the
    // group shows its range.
    const g = groups.get(label) ?? { engine: p.engine, stamp: s ? { promptVersion: s.promptVersion ?? "", canonLogId: s.canonLogId ?? null } : "unstamped", ranks: [], taste: [] };
    g.ranks.push(p.rank);
    if (typeof s?.tasteRows === "number") g.taste.push(s.tasteRows);
    groups.set(label, g);
  }
  const draftPick = [...groups.values()].map((g) => ({
    engine: g.engine,
    stamp: g.stamp === "unstamped" ? g.stamp : { ...g.stamp, tasteRows: g.taste.length ? [Math.min(...g.taste), Math.max(...g.taste)] : null },
    n: g.ranks.length,
    rank1: prop(g.ranks.filter((r) => r === 1).length, g.ranks.length),
    mrr: round(g.ranks.reduce((a, r) => a + 1 / r, 0) / g.ranks.length),
    ranksOfPick: Object.fromEntries([...new Set(g.ranks)].sort().map((r) => [r, g.ranks.filter((x) => x === r).length])),
  }));

  type Item = { engine: number; hit: boolean };
  /** A proportion for each engine (the owner's own decisions, with no critic stamp). */
  const byEngine = (rows: Item[]) =>
    [2, 3].filter(eng).map((e) => { const rs = rows.filter((r) => r.engine === e); return { engine: e, ...prop(rs.filter((r) => r.hit).length, rs.length) }; });
  /** A proportion for each engine and prompt version of the record that made the judgement (§4.2: never one number across versions). */
  const stamped = (rows: (Item & { pv: string })[]) => {
    const m = new Map<string, (Item & { pv: string })[]>();
    for (const r of rows) {
      if (!eng(r.engine) || (f.promptVersion !== undefined && r.pv !== f.promptVersion)) continue;
      m.set(`${r.engine}|${r.pv}`, [...(m.get(`${r.engine}|${r.pv}`) ?? []), r]);
    }
    return [...m.values()].map((rs) => ({ engine: rs[0]!.engine, promptVersion: rs[0]!.pv, ...prop(rs.filter((r) => r.hit).length, rs.length) }));
  };

  // Owner pass rate: draft sets with a full pass ÷ draft sets shown (a pass, or an owner pick).
  const passRate = byEngine([...passes.map((p) => ({ engine: p.engine, hit: true })), ...picks.map((p) => ({ engine: p.engine, hit: false }))]);

  // Final approval rate: the owner's newest verdict on each final picture.
  const newestFinal = new Map<string, { engine: number; mark: string }>();
  for (const [i, v] of finalVerdicts.entries()) newestFinal.set(v.render_key ?? `row ${i}`, { engine: v.engine, mark: v.mark });
  const finals = [...newestFinal.values()];
  const finalApproval = byEngine(finals.map((r) => ({ engine: r.engine, hit: r.mark === "approve" })));

  // Engine 3 records: the newest check of each render, the concept reviews, the directions.
  const checks = new Map<string, { kind: string; engine: number; pv: string; idea: string; body: Record<string, any> }>();
  const reviews: { batch: string; engine: number; pv: string; author: string; body: Record<string, any> }[] = [];
  const rounds = new Map<string, { engine: number; pv: string; fresh: number }>();
  for (const r of records) {
    const body = JSON.parse(r.body) as Record<string, any>;
    const pv = r.prompt_version;
    if (r.kind === "draft_check" || r.kind === "final_check") checks.set(body.renderId, { kind: r.kind, engine: r.engine, pv, idea: r.idea_id ?? "", body });
    else if (r.kind === "concept_review") reviews.push({ batch: r.batch_id, engine: r.engine, pv, author: r.author, body });
    else if (r.kind === "direction") {
      const k = `${r.batch_id}|${r.idea_id}`;
      const fresh = (body.drafts as { renderId?: string }[]).every((d) => !d.renderId) ? 1 : 0;
      rounds.set(k, { engine: r.engine, pv, fresh: (rounds.get(k)?.fresh ?? 0) + fresh });
    }
  }
  const all = [...checks.values()];
  const drafts = all.filter((c) => c.kind === "draft_check");
  const finalChecks = [...checks.entries()].filter(([, c]) => c.kind === "final_check");

  // Concept acceptance and selection agreement (from the critic's and the owner's concept review records).
  const critic = reviews.filter((r) => r.author === "critic");
  const concepts = critic.flatMap((r) => ((r.body.review?.concepts ?? []) as { verdict: string }[]).map((c) => ({
    engine: r.engine, pv: r.pv, hit: c.verdict === "select" || c.verdict === "reserve",
  })));
  // Batches with a rework ÷ batches the critic reviewed, with the version of the batch's newest critic review.
  const reworkBatches = new Map<string, Item & { pv: string }>();
  for (const r of critic) reworkBatches.set(r.batch, { engine: r.engine, pv: r.pv, hit: (reworkBatches.get(r.batch)?.hit ?? false) || r.body.outcome === "rework" });
  const selection: (Item & { pv: string })[] = [];
  for (const [i, r] of reviews.entries()) {
    if (r.author !== "critic" || r.body.outcome !== "select") continue;
    const next = reviews.slice(i + 1).find((x) => x.batch === r.batch);
    // Only a selection that the owner changed or confirmed in his words counts (ownerSwap, ownerReject).
    if (next?.author !== "owner") continue;
    for (const id of r.body.ids as string[])
      selection.push({ engine: r.engine, pv: r.pv, hit: next.body.outcome === "select" && (next.body.ids as string[]).includes(id) });
  }

  // Final approval agreement and false acceptance: the newest final check of the final against the owner's newest verdict.
  const finalMark = new Map<string, string>();
  for (const v of finalVerdicts) { const id = renderOf(v.render_key); if (id) finalMark.set(id, v.mark); }
  const both = finalChecks.filter(([id]) => finalMark.has(id)).map(([id, c]) => ({
    engine: c.engine,
    pv: c.pv,
    ready: finalReady(c.body as Check),
    approved: finalMark.get(id) === "approve",
  }));

  // Copy correction: picked ideas whose approved words differ from the words as written.
  const copies = ideas.map((i) => {
    const c = JSON.parse(i.copy) as { subline?: string; written?: { headline: string; subline: string } };
    return { engine: i.engine, hit: !!c.written && (c.written.headline !== i.headline || (c.written.subline ?? "") !== (c.subline ?? "")) };
  });

  // Paid render waste: fal spend on renders outside an approved final's line (the approved final and its picked draft).
  const approvedFinals = new Set([...finalMark].filter(([, m]) => m === "approve").map(([id]) => id));
  const line = new Set(approvedFinals);
  for (const p of finalPicks) if (p.final_render_id && approvedFinals.has(p.final_render_id)) { const d = renderOf(p.render_key); if (d) line.add(d); }
  // A spend row with no render row (no engine) counts only in a report for every engine, and always as waste.
  const spend = spendRows.filter((r) => (r.engine === null ? f.engine === undefined : eng(r.engine)));
  const wasted = spend.filter((r) => !r.ref || !line.has(r.ref));
  const total = spend.reduce((a, r) => a + r.usd_est, 0);
  const waste = wasted.reduce((a, r) => a + r.usd_est, 0);

  const productFail = (c: { kind: string; body: Record<string, any> }) =>
    c.kind === "draft_check"
      ? ["productShape", "label", "logo"].some((k) => c.body.points?.[k] === "fail")
      : c.body.finalPoints?.productTruth === "fail";
  const directions = [...rounds.values()];
  // False rejection: drafts not eligible that the owner picked ÷ drafts not eligible in the sets he decided (picked or passed).
  const decided = new Set([...picks.map((p) => p.idea_id), ...passes.map((p) => p.idea_id)]);
  const ownerPicked = new Set(picks.map((p) => renderOf(p.render_key)));
  const seen = [...checks.entries()].filter(([, c]) => c.kind === "draft_check" && decided.has(c.idea));
  const rejected = seen.filter(([, c]) => c.body.eligible === false);
  // False acceptance: ready finals that the owner did not approve, and eligible drafts he marked fix, ÷ items marked ready or eligible.
  const fixed = new Set(draftFixes.map((v) => renderOf(v.render_key)));
  const accepted = [
    ...both.filter((b) => b.ready).map((b) => ({ engine: b.engine, pv: b.pv, hit: !b.approved })),
    ...seen.filter(([, c]) => c.body.eligible === true).map(([id, c]) => ({ engine: c.engine, pv: c.pv, hit: fixed.has(id) })),
  ];

  return {
    filter: f,
    notes: [
      "Primary measure: the prospective, blind draft-pick rank-1 agreement and MRR for one stamp. Every other number is secondary.",
      "Read the agreement with the owner pass rate and, later, client results. Do not tune one number at the cost of the others.",
      "Two stamps differ only when their intervals do not overlap. The text gold set is not a visual result and is not in this report.",
      "Engine 2 baseline (design pack §4.1, 16-11-2026): rank-1 agreement 2 of 12 = 0.17 (Wilson 0.05 to 0.45), MRR 0.53; unstamped, mixed versions, n = 12.",
    ],
    draftPick,
    draftPickUnranked: unranked,
    ownerPassRate: passRate,
    finalApproval,
    conceptAcceptance: {
      concepts: stamped(concepts),
      reworkBatches: stamped([...reworkBatches.values()]),
    },
    conceptSelectionAgreement: {
      groups: stamped(selection),
      scope: "selected concepts of the selections that the owner changed or confirmed with his words (ownerSwap, ownerReject)",
    },
    draftRework: {
      redos: stamped(drafts.map((c) => ({ engine: c.engine, pv: c.pv, hit: c.body.attempt === 2 }))),
      newDirections: stamped(directions.map((d) => ({ engine: d.engine, pv: d.pv, hit: d.fresh > 1 }))),
    },
    finalApprovalAgreement: stamped(both.map((b) => ({ engine: b.engine, pv: b.pv, hit: b.ready === b.approved }))),
    falseAcceptance: stamped(accepted),
    falseRejection: stamped(rejected.map(([id, c]) => ({ engine: c.engine, pv: c.pv, hit: ownerPicked.has(id) }))),
    productDefectRate: stamped(all.map((c) => ({ engine: c.engine, pv: c.pv, hit: productFail(c) }))),
    copyCorrectionRate: byEngine(copies),
    paidRenderWaste: {
      usdWaste: round(waste),
      usdTotal: round(total),
      share: total ? round(waste / total) : null,
      jobs: spend.length,
      wastedJobs: wasted.length,
      note: "A share of US$, not a count of items: no Wilson interval. Read it with the number of jobs.",
    },
  };
}
