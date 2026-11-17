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
 * interval, by engine; the draft-pick agreement also by version stamp. Read only: it computes from D1 each time.
 * since and engine filter every metric; promptVersion filters the stamped draft-pick groups only.
 */
export async function calibrationReport(env: Env, f: ReportFilter = {}) {
  const since = f.since ?? "";
  const eng = (e: number) => f.engine === undefined || f.engine === e;
  const q = <T>(sql: string, ...binds: unknown[]) => env.DB.prepare(sql).bind(...binds).all<T>().then((r) => r.results);

  const [picks, passes, finalVerdicts, records, ideas, renders, finalPicks] = await Promise.all([
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
    q<{ batch_id: string; kind: string; idea_id: string | null; version: number; body: string; author: string; engine: number }>(
      `SELECT r.batch_id, r.kind, r.idea_id, r.version, r.body, r.author, b.engine FROM batch_records r JOIN batches b ON b.id = r.batch_id
       WHERE r.kind IN ('concept_review', 'direction', 'draft_check', 'final_check') AND r.created_at >= ? ORDER BY r.rowid`,
      since,
    ),
    q<{ batch_id: string; engine: number; headline: string; copy: string }>(
      `SELECT i.batch_id, b.engine, i.headline, i.copy FROM ideas i JOIN batches b ON b.id = i.batch_id
       WHERE i.picked = 1 AND json_extract(i.copy, '$.ownerApproved') IS NOT NULL AND b.created_at >= ?`,
      since,
    ),
    q<{ id: string; kind: string; usd_est: number | null; engine: number }>(
      `SELECT r.id, r.kind, r.usd_est, b.engine FROM renders r JOIN batches b ON b.id = r.batch WHERE r.created_at >= ?`,
      since,
    ),
    q<{ render_key: string; final_render_id: string | null }>(
      `SELECT render_key, final_render_id FROM picks WHERE final_render_id IS NOT NULL`,
    ),
  ]);

  // Draft-pick agreement and MRR, by engine and stamp (the primary measure, §4.2).
  const groups = new Map<string, { engine: number; stamp: Stamp | "unstamped"; ranks: number[] }>();
  let unranked = 0;
  for (const p of picks) {
    if (!eng(p.engine)) continue;
    if (p.rank === null) { unranked++; continue; }
    const s = p.stamp ? (JSON.parse(p.stamp) as Stamp) : null;
    if (f.promptVersion !== undefined && s?.promptVersion !== f.promptVersion) continue;
    const label = `${p.engine}|${s ? `${s.promptVersion ?? ""}|${s.canonLogId ?? ""}` : "unstamped"}`;
    const g = groups.get(label) ?? { engine: p.engine, stamp: s ? { promptVersion: s.promptVersion ?? "", canonLogId: s.canonLogId ?? null } : "unstamped", ranks: [] };
    g.ranks.push(p.rank);
    groups.set(label, g);
  }
  const draftPick = [...groups.values()].map((g) => ({
    engine: g.engine,
    stamp: g.stamp,
    n: g.ranks.length,
    rank1: prop(g.ranks.filter((r) => r === 1).length, g.ranks.length),
    mrr: round(g.ranks.reduce((a, r) => a + 1 / r, 0) / g.ranks.length),
    ranksOfPick: Object.fromEntries([...new Set(g.ranks)].sort().map((r) => [r, g.ranks.filter((x) => x === r).length])),
  }));

  const byEngine = <T extends { engine: number }>(rows: T[]) => [2, 3].filter(eng).map((e) => [e, rows.filter((r) => r.engine === e)] as const);

  // Owner pass rate: draft sets with a full pass ÷ draft sets shown (a pass, or an owner pick).
  const passRate = byEngine([...passes.map((p) => ({ ...p, pass: true })), ...picks.map((p) => ({ engine: p.engine, pass: false }))]).map(
    ([e, rows]) => ({ engine: e, ...prop(rows.filter((r) => r.pass).length, rows.length) }),
  );

  // Final approval rate: the owner's newest verdict on each final picture.
  const newestFinal = new Map<string, { engine: number; mark: string }>();
  for (const [i, v] of finalVerdicts.entries()) newestFinal.set(v.render_key ?? `row ${i}`, { engine: v.engine, mark: v.mark });
  const finals = [...newestFinal.values()];
  const finalApproval = byEngine(finals).map(([e, rows]) => ({ engine: e, ...prop(rows.filter((r) => r.mark === "approve").length, rows.length) }));

  // Engine 3 records: the newest check of each render, the concept reviews, the directions.
  const checks = new Map<string, { kind: string; engine: number; idea: string; body: Record<string, any> }>();
  const reviews: { batch: string; engine: number; author: string; body: Record<string, any> }[] = [];
  const rounds = new Map<string, { engine: number; fresh: number }>();
  for (const r of records) {
    const body = JSON.parse(r.body) as Record<string, any>;
    if (r.kind === "draft_check" || r.kind === "final_check") checks.set(body.renderId, { kind: r.kind, engine: r.engine, idea: r.idea_id ?? "", body });
    else if (r.kind === "concept_review") reviews.push({ batch: r.batch_id, engine: r.engine, author: r.author, body });
    else if (r.kind === "direction") {
      const k = `${r.batch_id}|${r.idea_id}`;
      const fresh = (body.drafts as { renderId?: string }[]).every((d) => !d.renderId) ? 1 : 0;
      rounds.set(k, { engine: r.engine, fresh: (rounds.get(k)?.fresh ?? 0) + fresh });
    }
  }
  const all = [...checks.values()].filter((c) => eng(c.engine));
  const drafts = all.filter((c) => c.kind === "draft_check");
  const finalChecks = [...checks.entries()].filter(([, c]) => c.kind === "final_check" && eng(c.engine));

  // Concept acceptance and selection agreement (from the critic's and the owner's concept review records).
  const critic = reviews.filter((r) => r.author === "critic" && eng(r.engine));
  const concepts = critic.flatMap((r) => (r.body.review?.concepts ?? []) as { verdict: string }[]);
  let selected = 0, kept = 0;
  for (const [i, r] of reviews.entries()) {
    if (r.author !== "critic" || r.body.outcome !== "select" || !eng(r.engine)) continue;
    const next = reviews.slice(i + 1).find((x) => x.batch === r.batch);
    // Only a selection that the owner changed or confirmed in his words counts (ownerSwap, ownerReject).
    if (next?.author !== "owner") continue;
    selected += r.body.ids.length;
    kept += next.body.outcome === "select" ? (r.body.ids as string[]).filter((id) => (next.body.ids as string[]).includes(id)).length : 0;
  }

  // Final approval agreement and false acceptance: the newest final check of the final against the owner's newest verdict.
  const finalMark = new Map<string, string>();
  for (const v of finalVerdicts) { const id = renderOf(v.render_key); if (id) finalMark.set(id, v.mark); }
  const both = finalChecks.filter(([id]) => finalMark.has(id)).map(([id, c]) => ({
    ready: finalReady(c.body as Check),
    approved: finalMark.get(id) === "approve",
  }));

  // Copy correction: picked ideas whose approved words differ from the words as written.
  const copies = ideas.filter((i) => eng(i.engine)).map((i) => {
    const c = JSON.parse(i.copy) as { subline?: string; written?: { headline: string; subline: string } };
    return !!c.written && (c.written.headline !== i.headline || (c.written.subline ?? "") !== (c.subline ?? ""));
  });

  // Paid render waste: fal spend on renders outside an approved final's line (the approved final and its picked draft).
  const approvedFinals = new Set([...finalMark].filter(([, m]) => m === "approve").map(([id]) => id));
  const line = new Set(approvedFinals);
  for (const p of finalPicks) if (p.final_render_id && approvedFinals.has(p.final_render_id)) { const d = renderOf(p.render_key); if (d) line.add(d); }
  const spend = renders.filter((r) => eng(r.engine));
  const total = spend.reduce((a, r) => a + (r.usd_est ?? 0), 0);
  const waste = spend.filter((r) => !line.has(r.id)).reduce((a, r) => a + (r.usd_est ?? 0), 0);

  const productFail = (c: { kind: string; body: Record<string, any> }) =>
    c.kind === "draft_check"
      ? ["productShape", "label", "logo"].some((k) => c.body.points?.[k] === "fail")
      : c.body.finalPoints?.productTruth === "fail";
  const directions = [...rounds.values()].filter((r) => eng(r.engine));
  // False rejection: drafts not eligible that the owner picked ÷ drafts not eligible in the sets he decided (picked or passed).
  const decided = new Set([...picks.map((p) => p.idea_id), ...passes.map((p) => p.idea_id)]);
  const ownerPicked = new Set(picks.map((p) => renderOf(p.render_key)));
  const rejected = [...checks.entries()].filter(([, c]) => c.kind === "draft_check" && eng(c.engine) && c.body.eligible === false && decided.has(c.idea));

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
      concepts: prop(concepts.filter((c) => c.verdict === "select" || c.verdict === "reserve").length, concepts.length),
      reworkReviews: prop(critic.filter((r) => r.body.outcome === "rework").length, critic.length),
    },
    conceptSelectionAgreement: { ...prop(kept, selected), scope: "selected concepts of the selections that the owner changed or confirmed with his words (ownerSwap, ownerReject)" },
    draftRework: {
      redos: prop(drafts.filter((c) => c.body.attempt === 2).length, drafts.length),
      newDirections: prop(directions.filter((d) => d.fresh > 1).length, directions.length),
    },
    finalApprovalAgreement: prop(both.filter((b) => b.ready === b.approved).length, both.length),
    falseAcceptance: prop(both.filter((b) => b.ready && !b.approved).length, both.filter((b) => b.ready).length),
    falseRejection: prop(rejected.filter(([id]) => ownerPicked.has(id)).length, rejected.length),
    productDefectRate: prop(all.filter(productFail).length, all.length),
    copyCorrectionRate: prop(copies.filter(Boolean).length, copies.length),
    paidRenderWaste: { usdWaste: round(waste), usdTotal: round(total), share: total ? round(waste / total) : null },
  };
}
