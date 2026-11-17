import { type Check, finalReady } from "./checks";
import type { Env } from "./env";
import { InputError } from "./schema";

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
    replays: await replaySummary(env, f),
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

/*
 * The visual evaluation set (design pack §4.5) and the replay runs (§4.6). The set is derived from the owner's saved
 * decisions up to asOf, never written by hand, and never holds the critic's ranks. No tool returns the labels: the
 * replay critic gets the items without them, and calibration_save scores the answers on the server, so neither the
 * critic nor the main session needs to see the owner's choice before the run is saved.
 */

export type ItemKind = "triplet" | "final";
export type Split = "tuning" | "holdout" | "all";
/** The newest share of the decided items, by decision time, is the holdout (OD 4.1, the pack's default). */
export const HOLDOUT_SHARE = 0.3;

type Derived = {
  id: string;
  kind: ItemKind;
  engine: number;
  batchId: string;
  ideaId: string;
  decidedAt: string;
  keys: string[];
  idea: { stage: string; insight: string; visual: string; headline: string; subline: string; concept: unknown };
  label: string; // the picked key or "pass" (triplet); approve, fix or reject (final)
  ownerSaid: string;
};

/** The end of the asOf day (a date) or the time itself, in the stored millisecond form. */
function asOfCut(asOf?: string) {
  if (!asOf) return new Date().toISOString();
  const d = new Date(asOf);
  if (Number.isNaN(d.valueOf()) || d.toISOString().slice(0, 10) !== asOf.slice(0, 10)) throw new InputError("asOf must be a real UTC date or time.");
  return asOf.length === 10 ? `${asOf}T23:59:59.999Z` : d.toISOString();
}

/** Every decided item up to asOf, oldest first, with its label, and the items whose pictures are no longer in R2. */
async function deriveItems(env: Env, kind: ItemKind, asOf?: string) {
  const cut = asOfCut(asOf);
  const q = <T>(sql: string, ...b: unknown[]) => env.DB.prepare(sql).bind(...b).all<T>().then((r) => r.results);
  const ideaCols = "i.format, i.insight, i.visual, i.headline, i.copy, i.concept, b.engine";
  type IdeaRow = { format: string; insight: string; visual: string; headline: string; copy: string | null; concept: string | null; engine: number };
  const ideaOf = (r: IdeaRow) => {
    const copy = r.copy ? (JSON.parse(r.copy) as { subline?: string }) : {};
    return { stage: r.format, insight: r.insight, visual: r.visual, headline: r.headline, subline: copy.subline ?? "", concept: r.concept ? JSON.parse(r.concept) : null };
  };
  let items: Derived[];
  if (kind === "triplet") {
    // A decision on a draft set: the owner's pick, or his full pass. The drafts he saw are the finished drafts of that idea
    // made after his previous full pass on it and at or before the decision; for engine 3, only the eligible drafts of the
    // direction round of that time (the board shows him those, design pack §3.6).
    const decisions = await q<IdeaRow & { batch_id: string; idea_id: string; at: string; label: string; said: string }>(
      `SELECT d.batch_id, d.idea_id, d.at, d.label, d.said, ${ideaCols} FROM (
         SELECT batch_id, idea_id, created_at AS at, render_key AS label, COALESCE(note, '') AS said FROM picks WHERE by_owner = 1 AND created_at <= ?1
         UNION ALL
         SELECT batch_id, idea_id, created_at, 'pass', owner_said FROM verdicts WHERE stage = 'draft' AND mark = 'pass' AND idea_id IS NOT NULL AND created_at <= ?1
       ) d JOIN ideas i ON i.id = d.idea_id AND i.batch_id = d.batch_id JOIN batches b ON b.id = d.batch_id ORDER BY d.at, d.idea_id`,
      cut,
    );
    const drafts = await q<{ id: string; batch: string; idea: string; image_keys: string; created_at: string }>(
      `SELECT id, batch, idea, image_keys, created_at FROM renders WHERE kind = 'draft' AND status = 'done' AND created_at <= ? ORDER BY created_at, id`,
      cut,
    );
    const passes = await q<{ batch_id: string; idea_id: string; created_at: string }>(
      "SELECT batch_id, idea_id, created_at FROM verdicts WHERE stage = 'draft' AND mark = 'pass' AND idea_id IS NOT NULL AND created_at <= ?",
      cut,
    );
    // Engine 3: each draft check (oldest first) and each direction that starts a round (no draft renderId), with their times.
    const checks = await q<{ body: string; created_at: string }>(
      "SELECT body, created_at FROM batch_records WHERE kind = 'draft_check' AND created_at <= ? ORDER BY created_at, rowid",
      cut,
    );
    const roundStarts = await q<{ batch_id: string; idea_id: string; version: number; created_at: string }>(
      `SELECT batch_id, idea_id, version, created_at FROM batch_records d WHERE kind = 'direction' AND idea_id IS NOT NULL AND created_at <= ?
         AND NOT EXISTS (SELECT 1 FROM json_each(d.body, '$.drafts') WHERE json_extract(value, '$.renderId') IS NOT NULL)`,
      cut,
    );
    const seen = (d: (typeof decisions)[number]) => {
      const prev = passes.filter((p) => p.batch_id === d.batch_id && p.idea_id === d.idea_id && p.created_at < d.at).reduce((m, p) => (p.created_at > m ? p.created_at : m), "");
      const own = drafts.filter((r) => r.batch === d.batch_id && r.idea === d.idea_id && r.created_at > prev && r.created_at <= d.at);
      if (d.engine !== 3) return own;
      const round = roundStarts.filter((r) => r.batch_id === d.batch_id && r.idea_id === d.idea_id && r.created_at <= d.at).reduce((m, r) => Math.max(m, r.version), 0);
      const newest = new Map<string, { eligible?: boolean; round?: number }>();
      for (const c of checks) if (c.created_at <= d.at) {
        const b = JSON.parse(c.body) as { renderId: string; eligible?: boolean; round?: number };
        newest.set(b.renderId, b);
      }
      return own.filter((r) => newest.get(r.id)?.eligible === true && (newest.get(r.id)!.round ?? 0) >= round);
    };
    items = decisions.map((d) => ({
      id: `t:${d.batch_id}:${d.idea_id}:${d.at}`,
      kind,
      engine: d.engine,
      batchId: d.batch_id,
      ideaId: d.idea_id,
      decidedAt: d.at,
      keys: seen(d).flatMap((r) => JSON.parse(r.image_keys) as string[]),
      idea: ideaOf(d),
      label: d.label,
      ownerSaid: d.said,
    }));
  } else {
    // A final with the owner's newest verdict on it (the verdict at or before asOf).
    const rows = await q<IdeaRow & { batch_id: string; idea_id: string; render_key: string; mark: string; owner_said: string; created_at: string }>(
      `SELECT v.batch_id, v.idea_id, v.render_key, v.mark, v.owner_said, v.created_at, ${ideaCols} FROM verdicts v
       JOIN ideas i ON i.id = v.idea_id AND i.batch_id = v.batch_id JOIN batches b ON b.id = v.batch_id
       WHERE v.stage = 'final' AND v.mark IN ('approve', 'fix', 'reject') AND v.render_key IS NOT NULL AND v.created_at <= ? ORDER BY v.created_at, v.rowid`,
      cut,
    );
    const newest = new Map<string, (typeof rows)[number]>();
    for (const r of rows) newest.set(r.render_key, r);
    items = [...newest.values()].sort((a, b) => a.created_at.localeCompare(b.created_at)).map((r) => ({
      id: `f:${r.render_key}`,
      kind,
      engine: r.engine,
      batchId: r.batch_id,
      ideaId: r.idea_id,
      decidedAt: r.created_at,
      keys: [r.render_key],
      idea: ideaOf(r),
      label: r.mark,
      ownerSaid: r.owner_said,
    }));
  }
  // Rule 1: an item enters the set only when all its pictures are still in R2.
  const present = new Map<string, boolean>();
  for (const key of new Set(items.flatMap((i) => i.keys))) present.set(key, (await env.MEDIA.head(key)) !== null);
  const kept = items.filter((i) => i.keys.length > 0 && i.keys.every((k) => present.get(k)));
  const holdoutFrom = kept.length - Math.round(kept.length * HOLDOUT_SHARE);
  return { cut, kept, lost: items.length - kept.length, holdoutFrom, splitDate: kept[holdoutFrom]?.decidedAt ?? null };
}

const inSplit = (i: number, holdoutFrom: number, split: Split) => split === "all" || (split === "holdout" ? i >= holdoutFrom : i < holdoutFrom);

/** Keys in the order of the seed: the same seed gives the same order, so the server can check a position. */
async function shuffled(keys: string[], seed: string) {
  const h = async (k: string) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${seed}|${k}`)))].map((b) => b.toString(16).padStart(2, "0")).join("");
  const hashed = await Promise.all(keys.map(async (k) => [await h(k), k] as const));
  return hashed.sort((a, b) => a[0].localeCompare(b[0])).map(([, k]) => k);
}

/**
 * calibration_items (design pack §4.7): the derived set for asOf and split, WITHOUT labels (no pick, verdict, owner words
 * or rank), with each triplet's pictures in the order of the seed. Also the size, the class balance and the lost count.
 */
export async function calibrationItems(env: Env, a: { kind: ItemKind; asOf?: string; split?: Split; seed: string }) {
  const split = a.split ?? "all";
  const d = await deriveItems(env, a.kind, a.asOf);
  const chosen = d.kept.filter((_, i) => inSplit(i, d.holdoutFrom, split));
  // The items in the order of the seed too, so the replay critic cannot read the decision order from the list.
  const order = await shuffled(chosen.map((i) => i.id), a.seed);
  const byId = new Map(chosen.map((i) => [i.id, i]));
  const balance = a.kind === "triplet"
    ? { picked: chosen.filter((i) => i.label !== "pass").length, passed: chosen.filter((i) => i.label === "pass").length }
    : Object.fromEntries(["approve", "fix", "reject"].map((m) => [m, chosen.filter((i) => i.label === m).length]));
  return {
    kind: a.kind,
    asOf: d.cut,
    split,
    splitDate: d.splitDate,
    holdoutShare: HOLDOUT_SHARE,
    size: { items: chosen.length, decided: d.kept.length + d.lost, lost: d.lost },
    classBalance: balance,
    notes: [
      SMALL_SET,
      "Contamination: the critic's canon is the current one and may hold lessons from these items. Give the replay critic taste_log with before set to each item's decidedAt.",
    ],
    items: await Promise.all(order.map((id) => byId.get(id)!).map(async (i) => ({
      id: i.id,
      engine: i.engine,
      decidedAt: i.decidedAt,
      idea: i.idea,
      pictures: a.kind === "triplet" ? await shuffled(i.keys, a.seed) : i.keys,
    }))),
  };
}
const SMALL_SET = "The set is small: report its size and class balance with every result, and do not act on a replay alone.";

export type ReplayAnswer = { itemId: string; choice: string; reason: string };

/**
 * calibration_save (design pack §4.6, §4.7): score a replay on the server against the owner's labels and write one
 * calibration_runs row. triplet_replay: choice is a picture key or "pass"; final_replay: approve, fix or reject;
 * concept_stability: two selections of the same batch (no labels).
 */
export async function calibrationSave(
  env: Env,
  a: {
    kind: "triplet_replay" | "final_replay" | "concept_stability";
    asOf?: string;
    split?: Split;
    seed?: string;
    promptVersion?: string;
    note?: string;
    answers?: ReplayAnswer[];
    stability?: { batchId: string; first: string[]; second: string[] };
  },
) {
  const stamp = await rankStamp(env);
  const split = a.split ?? "all";
  let n: number, result: Record<string, unknown>, asOf: string;
  if (a.kind === "concept_stability") {
    if (!a.stability) throw new InputError("concept_stability needs stability: the batch id and the two selections.");
    const both = [...a.stability.first, ...a.stability.second];
    if (new Set(a.stability.first).size !== a.stability.first.length || new Set(a.stability.second).size !== a.stability.second.length)
      throw new InputError("Each selection must name 3 different concepts.");
    const known = await env.DB.prepare(`SELECT id FROM ideas WHERE batch_id = ? AND id IN (${both.map(() => "?").join(", ")})`)
      .bind(a.stability.batchId, ...both).all<{ id: string }>();
    const ids = new Set(known.results.map((r) => r.id));
    const strange = both.filter((id) => !ids.has(id));
    if (strange.length) throw new InputError(`Not concepts of batch ${a.stability.batchId}: ${[...new Set(strange)].slice(0, 3).join(", ")}.`);
    const common = a.stability.first.filter((id) => a.stability!.second.includes(id)).length;
    asOf = new Date().toISOString();
    n = 1;
    result = { batchId: a.stability.batchId, common, alarm: common < 2, first: a.stability.first, second: a.stability.second };
  } else {
    if (!a.answers?.length) throw new InputError("A replay needs answers: one for each item, with the item id, the choice and a reason.");
    if (!a.seed) throw new InputError("A replay needs the seed that calibration_items used, so the server can check each position.");
    const kind: ItemKind = a.kind === "triplet_replay" ? "triplet" : "final";
    const d = await deriveItems(env, kind, a.asOf);
    asOf = d.cut;
    const set = new Map(d.kept.map((i, x) => [i.id, { item: i, x }]));
    const ids = a.answers.map((x) => x.itemId);
    if (new Set(ids).size !== ids.length) throw new InputError("Each item may be answered once.");
    const unknown = ids.filter((id) => !set.has(id) || !inSplit(set.get(id)!.x, d.holdoutFrom, split));
    if (unknown.length) throw new InputError(`Not items of this set (kind, asOf, split): ${unknown.slice(0, 3).join(", ")}.`);
    // A run covers the whole set of its split, or two runs would not compare (the same rule as gold_score).
    const expected = d.kept.filter((_, x) => inSplit(x, d.holdoutFrom, split)).length;
    if (ids.length !== expected) throw new InputError(`Answer every item of this set (kind, asOf, split): it has ${expected} and you sent ${ids.length}.`);
    const scored = await Promise.all(a.answers.map(async (ans) => {
      const it = set.get(ans.itemId)!.item;
      let position: number | "pass" | null = null;
      if (kind === "triplet") {
        const order = await shuffled(it.keys, a.seed!);
        if (ans.choice === "pass") position = "pass";
        else {
          const p = order.indexOf(ans.choice);
          if (p < 0) throw new InputError(`The choice for ${ans.itemId} is not one of its pictures, and not "pass".`);
          position = p + 1;
        }
      } else if (!["approve", "fix", "reject"].includes(ans.choice)) throw new InputError(`The choice for ${ans.itemId} must be approve, fix or reject.`);
      return { id: it.id, engine: it.engine, right: ans.choice === it.label, position, pictures: it.keys.length, reason: ans.reason };
    }));
    n = scored.length;
    const right = scored.filter((s) => s.right).length;
    const positions: Record<string, number> = {};
    for (const s of scored) if (s.position !== null) positions[String(s.position)] = (positions[String(s.position)] ?? 0) + 1;
    result = {
      agreement: prop(right, n),
      chance: kind === "triplet" ? "1 in the number of pictures (1/3 for 3 drafts), or the class balance for a pass" : "the class balance",
      positions,
      splitDate: d.splitDate,
      contaminated: true,
      stamp,
      items: scored.map(({ reason: _r, ...s }) => s),
    };
  }
  const id = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO calibration_runs (id, kind, as_of, split, canon_log_id, prompt_version, n, result, note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(id, a.kind, asOf, split, stamp.canonLogId === null ? null : String(stamp.canonLogId), a.promptVersion ?? "", n, JSON.stringify(result), a.note ?? "", new Date().toISOString()).run();
  return { id, kind: a.kind, asOf, split, n, ...result };
}

/**
 * The replay runs for the report: the newest runs and the position bias of the triplet replays (design pack §4.9).
 * since and promptVersion filter the runs; engine keeps the replay runs with an item of that engine, and the position
 * bias counts the choices on those items only (a concept stability run has no engine, so engine leaves it out).
 */
export async function replaySummary(env: Env, f: ReportFilter = {}) {
  type Row = { id: string; kind: string; as_of: string; split: string; canon_log_id: string | null; prompt_version: string; n: number; result: string; created_at: string };
  type Res = { agreement?: unknown; common?: number; alarm?: boolean; items?: { engine: number; position: number | "pass" | null }[] };
  const rows = (await env.DB.prepare(
    `SELECT id, kind, as_of, split, canon_log_id, prompt_version, n, result, created_at FROM calibration_runs
     WHERE created_at >= ?1 AND (?2 IS NULL OR prompt_version = ?2) ORDER BY created_at DESC`,
  ).bind(f.since ?? "", f.promptVersion ?? null).all<Row>()).results
    .map((r) => ({ r, res: JSON.parse(r.result) as Res }))
    .filter(({ res }) => f.engine === undefined || (res.items ?? []).some((i) => i.engine === f.engine));
  const counts: Record<string, number> = {};
  for (const { r, res } of rows) if (r.kind === "triplet_replay")
    for (const i of res.items ?? []) if (typeof i.position === "number" && (f.engine === undefined || i.engine === f.engine)) counts[String(i.position)] = (counts[String(i.position)] ?? 0) + 1;
  const chose = ["1", "2", "3"].reduce((s, p) => s + (counts[p] ?? 0), 0);
  const share = Object.fromEntries(["1", "2", "3"].map((p) => [p, chose ? round((counts[p] ?? 0) / chose) : null]));
  return {
    runs: rows.slice(0, 10).map(({ r, res }) => ({
      id: r.id, kind: r.kind, asOf: r.as_of, split: r.split, canonLogId: r.canon_log_id, promptVersion: r.prompt_version, n: r.n,
      agreement: res.agreement ?? null, common: res.common, alarm: res.alarm, at: r.created_at,
    })),
    positionBias: { choices: chose, share, alarm: chose >= 20 && Object.values(share).some((s) => (s ?? 0) > 0.5) },
  };
}
