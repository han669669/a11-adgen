import type { Env } from "./env";

/**
 * Cost estimates in US$, from the fal and Exa price pages (read 2026-11-06).
 * fal bills by token; these are upper estimates per item. Phase 0 measures the real numbers.
 */
export const PRICE = {
  falDraftImage: 0.006, // low, about 1024x1280
  falFinalImage: 0.06, // high, about 1536x1920
  falReference: 0.01, // each reference image, billed as image input
  falPrompt: 0.003, // a long prompt
  exaSearch: 0.007, // type auto, up to 10 results, contents included
  exaSearchLite: 0.004,
  exaContentsPage: 0.001,
} as const;

export class BudgetError extends Error {}

/**
 * A reservation that was never settled (the request was cut off) stops counting after this time.
 * Settled rows ('spent') always count.
 */
const STALE_RESERVATION = "-15 minutes";

/** The cap is per calendar month (UTC): AGENTS.md §8 asks for a monthly cap. */
const THIS_MONTH = `at >= strftime('%Y-%m-01T00:00:00.000Z', 'now')`;

const COUNTED = `(${THIS_MONTH} AND (status = 'spent' OR (status = 'reserved' AND at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '${STALE_RESERVATION}'))))`;

/**
 * Reserve an estimated spend. The cap check and the insert are one statement, so parallel calls cannot pass the cap.
 * Throws BudgetError when the cap would be passed.
 */
export async function reserve(
  env: Env,
  service: "fal" | "exa" | "images",
  kind: string,
  ref: string,
  usd: number,
): Promise<number> {
  const cap = Number(env.SPEND_CAP_USD);
  if (!Number.isFinite(cap) || cap <= 0) throw new BudgetError("SPEND_CAP_USD is not set.");
  const res = await env.DB.prepare(
    `INSERT INTO spend (at, service, kind, ref, usd_est)
     SELECT ?, ?, ?, ?, ?
     WHERE (SELECT COALESCE(SUM(usd_est), 0) FROM spend WHERE ${COUNTED}) + ? <= ?`,
  )
    .bind(new Date().toISOString(), service, kind, ref.slice(0, 200), usd, usd, cap)
    .run();
  if (res.meta.changes !== 1) {
    const row = await env.DB.prepare(`SELECT COALESCE(SUM(usd_est), 0) AS total FROM spend WHERE ${COUNTED}`).first<{ total: number }>();
    const total = row?.total ?? 0;
    throw new BudgetError(
      `Spend cap reached: US$${total.toFixed(4)} used of US$${cap.toFixed(2)}; this call needs about US$${usd.toFixed(4)}.`,
    );
  }
  return Number(res.meta.last_row_id);
}

/** ok = the provider accepted (and will bill) the call; otherwise the reservation is released. */
export async function settle(env: Env, id: number, ok: boolean): Promise<void> {
  await env.DB.prepare("UPDATE spend SET status = ? WHERE id = ?")
    .bind(ok ? "spent" : "released", id)
    .run();
}

export async function totals(env: Env) {
  const rows = await env.DB.prepare(
    `SELECT service, kind, COUNT(*) AS n, ROUND(SUM(usd_est), 4) AS usd FROM spend WHERE ${COUNTED} GROUP BY service, kind`,
  ).all<{ service: string; kind: string; n: number; usd: number }>();
  const total = rows.results.reduce((s, r) => s + r.usd, 0);
  return { month: new Date().toISOString().slice(0, 7), capUsd: Number(env.SPEND_CAP_USD), totalUsd: Number(total.toFixed(4)), byKind: rows.results };
}
