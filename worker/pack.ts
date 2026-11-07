import type { Env } from "./env";
import { InputError } from "./schema";

const now = () => new Date().toISOString();

export const CTAS = ["SHOP_NOW", "LEARN_MORE", "ORDER_NOW", "GET_OFFER", "SIGN_UP", "BUY_NOW"] as const;

export interface PackAdInput {
  renderId: string;
  primaryTexts: string[];
  headlines: string[];
  description: string;
  cta: (typeof CTAS)[number];
  why: string;
}

export interface PackAd {
  name: string;
  stage: string;
  headline: string;
  imageKey: string;
  primaryTexts: string[];
  headlines: string[];
  description: string;
  cta: string;
  why: string;
}

export interface PackContent {
  brand: string;
  ads: PackAd[];
  launchPlan: string;
  factCheck: { claim: string; fact: string; quote: string; sourceUrl: string }[];
  healthNote: string | null;
}

export const DEFAULT_LAUNCH_PLAN =
  "Put all the ads in one ad set with one audience. Let them run for 72 hours. After 72 hours, pause any ad whose click-through rate (CTR) is below your usual CTR, once it has had enough impressions (at least 1,000). Keep the ads above your usual CTR running. Send us the Ads Manager screenshot or CSV and we use it to make the next pack.";
export const HEALTH_NOTE =
  "Health products: every claim comes from the product's own page. The ads make no claim to treat, cure or prevent a disease. Check the claims against HSA and Meta health-ad rules before you launch.";

/** ISO 8601 week number of a date (UTC). */
export function isoWeek(d: Date): number {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const y0 = Date.UTC(t.getUTCFullYear(), 0, 1);
  return Math.ceil(((t.getTime() - y0) / 86_400_000 + 1) / 7);
}

/** a11_W46_wongi_tof_c03_v1: week, brand, stage, idea number, pack version. The client uses these names, so results map back. */
export function adName(week: number, brandSlug: string, stage: string, n: number, version: number): string {
  return `a11_W${String(week).padStart(2, "0")}_${brandSlug.replace(/-/g, "")}_${stage}_c${String(n).padStart(2, "0")}_v${version}`;
}

/** Numbers in a text: S$8.90, 35, 4, 70g. A trailing dot or comma is punctuation, not part of the number. */
export function numbersIn(text: string): string[] {
  return [...text.matchAll(/\d[\d,]*(?:\.\d+)?/g)].map((m) => m[0].replace(/,$/, ""));
}

const sha256Hex = async (s: string) =>
  [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)))].map((b) => b.toString(16).padStart(2, "0")).join("");

interface FactRow {
  label: string;
  value: string;
  quote: string;
  source_url: string;
}

/**
 * Publish the pack for a batch. Hard check 1 (docs/blueprint.md section 8): every number in the Meta text must appear in the
 * fact sheet (a fact's value or its quote). The pack shows each such number with the fact, its source and its quote.
 * The link holds a token that is shown once: only its hash is stored.
 */
export async function packPublish(
  env: Env,
  a: { batchId: string; ads: PackAdInput[]; launchPlan?: string; healthProduct?: boolean; at?: Date },
) {
  const b = await env.DB.prepare(
    `SELECT b.id, b.label, b.subject_id, br.slug, br.name FROM batches b JOIN brands br ON br.id = b.brand_id WHERE b.id = ?`,
  ).bind(a.batchId).first<{ id: string; label: string; subject_id: string; slug: string; name: string }>();
  if (!b) throw new InputError("No such batch.");
  const facts = (await env.DB.prepare("SELECT label, value, quote, source_url FROM facts WHERE subject_id = ? ORDER BY id LIMIT 200")
    .bind(b.subject_id).all<FactRow>()).results;
  const version = ((await env.DB.prepare("SELECT MAX(version) AS v FROM packs WHERE batch_id = ?").bind(a.batchId).first<{ v: number | null }>())?.v ?? 0) + 1;
  const week = isoWeek(a.at ?? new Date());

  const ads: PackAd[] = [];
  const factCheck: PackContent["factCheck"] = [];
  const seenIdeas = new Set<string>();
  for (const ad of a.ads) {
    const r = await env.DB.prepare(
      `SELECT r.id, r.kind, r.status, r.composed_key, i.id AS idea_id, i.n, i.format, i.headline
       FROM renders r JOIN ideas i ON i.id = r.idea AND i.batch_id = r.batch WHERE r.id = ? AND r.batch = ?`,
    ).bind(ad.renderId, a.batchId).first<{ id: string; kind: string; status: string; composed_key: string | null; idea_id: string; n: number; format: string; headline: string }>();
    if (!r) throw new InputError(`Render ${ad.renderId} is not a render of this batch.`);
    if (r.kind !== "final" || r.status !== "done") throw new InputError(`Render ${ad.renderId} is not a finished final.`);
    if (!r.composed_key?.startsWith("renders/")) throw new InputError(`Render ${ad.renderId} has no composed image yet: run compose_final first.`);
    if (seenIdeas.has(r.idea_id)) throw new InputError("Two ads are for the same idea. Send one final per idea.");
    seenIdeas.add(r.idea_id);
    const texts = [...ad.primaryTexts, ...ad.headlines, ad.description];
    for (const n of new Set(texts.flatMap(numbersIn))) {
      const f = facts.find((x) => numbersIn(`${x.value} ${x.quote}`).includes(n));
      if (!f) throw new InputError(`The number ${n} in the copy for "${r.headline}" is not in the fact sheet. Add the fact with its source (facts_save) or remove the number.`);
      const fact = `${f.label}: ${f.value}`;
      if (!factCheck.some((c) => c.claim === n && c.fact === fact)) factCheck.push({ claim: n, fact, quote: f.quote, sourceUrl: f.source_url });
    }
    ads.push({
      name: adName(week, b.slug, r.format, r.n, version),
      stage: r.format,
      headline: r.headline,
      imageKey: r.composed_key,
      primaryTexts: ad.primaryTexts,
      headlines: ad.headlines,
      description: ad.description,
      cta: ad.cta,
      why: ad.why,
    });
  }
  const content: PackContent = {
    brand: b.name,
    ads,
    launchPlan: a.launchPlan ?? DEFAULT_LAUNCH_PLAN,
    factCheck,
    healthNote: a.healthProduct ? HEALTH_NOTE : null,
  };
  const token = [...crypto.getRandomValues(new Uint8Array(24))].map((x) => x.toString(16).padStart(2, "0")).join("");
  const id = crypto.randomUUID();
  await env.DB.prepare("INSERT INTO packs (id, batch_id, version, token_hash, title, content, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .bind(id, a.batchId, version, await sha256Hex(token), `${b.name} ${b.label} v${version}`, JSON.stringify(content), now()).run();
  return {
    packId: id,
    version,
    link: `${env.PUBLIC_BASE_URL}/c/${token}`,
    note: "The link is shown once. Send it to the client. packRevoke stops it.",
    adNames: ads.map((x) => x.name),
    numbersChecked: factCheck.length,
  };
}

export async function packRevoke(env: Env, packId: string) {
  const r = await env.DB.prepare("UPDATE packs SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL").bind(now(), packId).run();
  if (!r.meta.changes) throw new InputError("No such pack, or it is already revoked.");
  return { packId, revoked: true };
}

/** The pack for a client link, or null for an unknown or revoked link. */
export async function packByToken(env: Env, token: string): Promise<{ id: string; title: string; content: PackContent } | null> {
  if (!/^[0-9a-f]{48}$/.test(token)) return null;
  const row = await env.DB.prepare("SELECT id, title, content FROM packs WHERE token_hash = ? AND revoked_at IS NULL")
    .bind(await sha256Hex(token)).first<{ id: string; title: string; content: string }>();
  return row ? { id: row.id, title: row.title, content: JSON.parse(row.content) as PackContent } : null;
}
