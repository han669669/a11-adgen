import { brandBySlug } from "./brand";
import type { Env } from "./env";
import { InputError } from "./schema";

const now = () => new Date().toISOString();

/** An ad is judged only after this many impressions (the launch plan in the pack says the same). */
export const MIN_IMPRESSIONS = 1000;

/** a11_W47_catfiddle_b01_tof_c03_v1 (see adName in pack.ts). */
export const AD_NAME = /^a11_W(\d{2})_([a-z0-9]+)_b(\d{2})_([a-z]+)_c(\d{2})_v(\d+)$/;

export interface ResultRowInput {
  adName: string;
  impressions: number;
  clicks: number;
  spendSgd?: number;
}

/** The client's usual CTR, from one Ads Manager screenshot at onboarding. A new value replaces the old one for the brand; the old rows stay. */
export async function baselineSave(env: Env, input: { brand: string; ctrPct: number; source: string }) {
  const b = await brandBySlug(env, input.brand);
  const id = crypto.randomUUID();
  await env.DB.prepare("INSERT INTO baselines (id, brand_id, ctr, source, created_at) VALUES (?, ?, ?, ?, ?)")
    .bind(id, b.id, input.ctrPct / 100, input.source, now())
    .run();
  return { brand: b.slug, baselineCtrPct: input.ctrPct, source: input.source };
}

/**
 * Save one report: the numbers per ad name. Every ad name must be an ad in a published pack of this brand, or nothing is saved.
 * Saving the same ad and date again replaces that row (a fix to a misread number).
 */
export async function resultsSave(env: Env, input: { brand: string; reportDate: string; source: string; rows: ResultRowInput[] }) {
  const b = await brandBySlug(env, input.brand);
  const day = new Date(`${input.reportDate}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.reportDate) || Number.isNaN(day.getTime()) || day.toISOString().slice(0, 10) !== input.reportDate) throw new InputError("reportDate must be a real date, YYYY-MM-DD.");
  if (input.reportDate > now().slice(0, 10)) throw new InputError("reportDate is in the future.");
  const seen = new Set<string>();
  for (const r of input.rows) {
    if (!AD_NAME.test(r.adName)) throw new InputError(`"${r.adName}" is not an a11 ad name (a11_W47_catfiddle_b01_tof_c03_v1).`);
    if (seen.has(r.adName)) throw new InputError(`${r.adName} is twice in this report.`);
    seen.add(r.adName);
    if (r.clicks > r.impressions) throw new InputError(`${r.adName}: clicks (${r.clicks}) are more than impressions (${r.impressions}). Read the numbers again.`);
    const m = AD_NAME.exec(r.adName)!;
    if (m[2] !== b.slug.replace(/-/g, "")) throw new InputError(`${r.adName} is not an ad of ${b.slug}.`);
    const pack = await env.DB.prepare("SELECT 1 AS ok FROM packs p JOIN batches ba ON ba.id = p.batch_id WHERE ba.brand_id = ? AND instr(p.content, ?) > 0 LIMIT 1")
      .bind(b.id, `"name":"${r.adName}"`)
      .first();
    if (!pack) throw new InputError(`${r.adName} is not in any published pack of ${b.slug}. Check the name against the pack.`);
  }
  const at = now();
  await env.DB.batch(
    input.rows.map((r) =>
      env.DB.prepare(
        `INSERT INTO results (id, brand_id, ad_name, report_date, impressions, clicks, spend_sgd, source, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (ad_name, report_date) DO UPDATE SET impressions = excluded.impressions, clicks = excluded.clicks, spend_sgd = excluded.spend_sgd, source = excluded.source, created_at = excluded.created_at`,
      ).bind(crypto.randomUUID(), b.id, r.adName, input.reportDate, r.impressions, r.clicks, r.spendSgd ?? null, input.source, at),
    ),
  );
  return { brand: b.slug, reportDate: input.reportDate, saved: input.rows.length };
}

type Verdict = "winner" | "below baseline" | "too early" | "no baseline";

/**
 * The week report data: each ad's latest report against the client's baseline CTR.
 * A winner has at least `minImpressions` and a CTR above the baseline (docs/blueprint.md section 4).
 */
export async function resultsGet(env: Env, input: { brand: string; minImpressions?: number }) {
  const b = await brandBySlug(env, input.brand);
  const min = input.minImpressions ?? MIN_IMPRESSIONS;
  const base = await env.DB.prepare("SELECT ctr, source, created_at FROM baselines WHERE brand_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1")
    .bind(b.id)
    .first<{ ctr: number; source: string; created_at: string }>();
  const rows = (
    await env.DB.prepare(
      `SELECT r.ad_name, r.report_date, r.impressions, r.clicks, r.spend_sgd, r.source FROM results r
       WHERE r.brand_id = ? AND r.report_date = (SELECT MAX(report_date) FROM results WHERE brand_id = r.brand_id AND ad_name = r.ad_name)
       ORDER BY r.ad_name`,
    )
      .bind(b.id)
      .all<{ ad_name: string; report_date: string; impressions: number; clicks: number; spend_sgd: number | null; source: string }>()
  ).results;
  const ads = rows.map((r) => {
    const m = AD_NAME.exec(r.ad_name)!;
    const ctr = r.impressions ? r.clicks / r.impressions : 0;
    const verdict: Verdict = !base ? "no baseline" : r.impressions < min ? "too early" : ctr > base.ctr ? "winner" : "below baseline";
    return {
      adName: r.ad_name,
      stage: m[4]!,
      idea: Number(m[5]),
      version: Number(m[6]),
      reportDate: r.report_date,
      impressions: r.impressions,
      clicks: r.clicks,
      ctrPct: Math.round(ctr * 10_000) / 100,
      spendSgd: r.spend_sgd,
      verdict,
      ...(base && r.impressions >= min ? { vsBaselinePct: Math.round((ctr - base.ctr) * 10_000) / 100 } : {}),
    };
  });
  return {
    brand: b.slug,
    baseline: base ? { ctrPct: Math.round(base.ctr * 10_000) / 100, source: base.source, savedAt: base.created_at } : null,
    minImpressions: min,
    ads,
    winners: ads.filter((a) => a.verdict === "winner").map((a) => a.adName),
    belowBaseline: ads.filter((a) => a.verdict === "below baseline").map((a) => a.adName),
    note: base ? undefined : "No baseline yet. Ask the client for one Ads Manager screenshot of their usual ads, then baseline_save.",
  };
}
