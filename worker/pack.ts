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

/** The owner and the clients work in Singapore (UTC+8, no daylight saving). A new ISO week starts there on Monday 00:00, which is Sunday 16:00 UTC. isoWeek reads UTC fields, so shift the clock by 8 hours first. */
export const singaporeClock = (d: Date) => new Date(d.getTime() + 8 * 3_600_000);

/**
 * a11_W46_wongi_b02_tof_c03_v1: week, brand, the brand's batch number, stage, idea number, pack version. The client uses these names, so results map back.
 * The idea number and the version restart in each batch. The batch number keeps two batches of one brand apart, in one week or across weeks.
 */
export function adName(week: number, brandSlug: string, batchNo: number, stage: string, n: number, version: number): string {
  return `a11_W${String(week).padStart(2, "0")}_${brandSlug.replace(/-/g, "")}_b${String(batchNo).padStart(2, "0")}_${stage}_c${String(n).padStart(2, "0")}_v${version}`;
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
    `SELECT b.id, b.label, b.subject_id, b.brand_id, b.created_at, br.slug, br.name FROM batches b JOIN brands br ON br.id = b.brand_id WHERE b.id = ?`,
  ).bind(a.batchId).first<{ id: string; label: string; subject_id: string; brand_id: string; created_at: string; slug: string; name: string }>();
  if (!b) throw new InputError("No such batch.");
  // The batch's place among the brand's batches, oldest first (index batches_brand). It never changes, so every version of a pack keeps it.
  const batchNo = (await env.DB.prepare("SELECT COUNT(*) AS n FROM batches WHERE brand_id = ? AND (created_at < ? OR (created_at = ? AND id <= ?))")
    .bind(b.brand_id, b.created_at, b.created_at, b.id).first<{ n: number }>())!.n;
  const facts = (await env.DB.prepare("SELECT label, value, quote, source_url FROM facts WHERE subject_id = ? ORDER BY id LIMIT 200")
    .bind(b.subject_id).all<FactRow>()).results;
  const week = isoWeek(singaporeClock(a.at ?? new Date()));

  const ads: PackAd[] = [];
  const factCheck: PackContent["factCheck"] = [];
  const ideaNumbers: number[] = [];
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
    ideaNumbers.push(r.n);
    const texts = [...ad.primaryTexts, ...ad.headlines, ad.description];
    for (const n of new Set(texts.flatMap(numbersIn))) {
      const f = facts.find((x) => numbersIn(`${x.value} ${x.quote}`).includes(n));
      if (!f) throw new InputError(`The number ${n} in the copy for "${r.headline}" is not in the fact sheet. Add the fact with its source (facts_save) or remove the number.`);
      const fact = `${f.label}: ${f.value}`;
      if (!factCheck.some((c) => c.claim === n && c.fact === fact)) factCheck.push({ claim: n, fact, quote: f.quote, sourceUrl: f.source_url });
    }
    ads.push({
      name: "", // set with the version, below
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
    launchPlan: a.launchPlan?.trim() || DEFAULT_LAUNCH_PLAN,
    factCheck,
    healthNote: a.healthProduct ? HEALTH_NOTE : null,
  };
  const token = [...crypto.getRandomValues(new Uint8Array(24))].map((x) => x.toString(16).padStart(2, "0")).join("");
  const id = crypto.randomUUID();
  // Two publishes for one batch at the same moment can pick the same version. The unique key refuses the second; it takes the next one.
  for (let attempt = 0; ; attempt++) {
    const version = ((await env.DB.prepare("SELECT MAX(version) AS v FROM packs WHERE batch_id = ?").bind(a.batchId).first<{ v: number | null }>())?.v ?? 0) + 1;
    const named = { ...content, ads: ads.map((x, i) => ({ ...x, name: adName(week, b.slug, batchNo, x.stage, ideaNumbers[i]!, version) })) };
    try {
      await env.DB.prepare("INSERT INTO packs (id, batch_id, version, token_hash, title, content, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
        .bind(id, a.batchId, version, await sha256Hex(token), `${b.name} ${b.label} v${version}`, JSON.stringify(named), now()).run();
    } catch (e) {
      if (attempt < 4 && /UNIQUE/i.test(String(e))) continue;
      throw e;
    }
    return {
      packId: id,
      version,
      link: `${env.PUBLIC_BASE_URL}/c/${token}`,
      note: "The link is shown once. Send it to the client. packRevoke stops it.",
      adNames: named.ads.map((x) => x.name),
      numbersChecked: factCheck.length,
    };
  }
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

/**
 * The part of an ad name that stays across versions of one batch's pack: the stage and the idea number (…_tof_c07_v3 gives tof_c07).
 * Both packs are of one batch, so brand and batch are the same. Packs published before 07-11-2026 have no batch number in the name
 * (a11_W45_catandthefiddle_tof_c07_v3), so the match must not use it.
 */
const adKey = (name: string) => /_([a-z]+_c\d+)_v\d+$/.exec(name)?.[1] ?? name;

/**
 * Put the pictures of a newer pack (fromVersion) into an older pack (version) of the same batch, in place.
 * The older pack keeps its link, its title and its ad names, so the client's comments, uploads and results still map to it.
 * Each ad is matched by stage and idea number. Both packs must hold the same ideas.
 * The older pack keeps its own Meta text unless text is true (owner, 09-11-2026: v5 copied rewritten copy over the approved v3 copy).
 * With text true the Meta text, fact check, launch plan and health note come across too; the newer text passed the fact check at publish.
 * Every change keeps the old content in pack_updates. undo puts back the content before the latest change that is not yet undone.
 */
export async function packUpdate(env: Env, a: { batchId: string; version: number; fromVersion?: number; undo?: boolean; text?: boolean }) {
  const row = (v: number) =>
    env.DB.prepare("SELECT id, version, content, revoked_at FROM packs WHERE batch_id = ? AND version = ?")
      .bind(a.batchId, v).first<{ id: string; version: number; content: string; revoked_at: string | null }>();
  const target = await row(a.version);
  if (!target) throw new InputError(`This batch has no pack version ${a.version}.`);
  if (target.revoked_at) throw new InputError(`Pack version ${a.version} is revoked: its link does not open. Nothing changed.`);
  const at = now();
  // One transaction: the audit row is written only when the pack still holds the content we read, and so is the change.
  const swap = async (next: string, audit: D1PreparedStatement) => {
    const [, u] = await env.DB.batch([
      audit,
      env.DB.prepare("UPDATE packs SET content = ? WHERE id = ? AND content = ? AND revoked_at IS NULL").bind(next, target.id, target.content),
    ]);
    if (!u?.meta.changes) throw new InputError("The pack changed or was revoked while this ran. Nothing changed.");
  };

  if (a.undo) {
    if (a.fromVersion !== undefined || a.text !== undefined) throw new InputError("Give fromVersion (and text) or undo, not both.");
    const last = await env.DB.prepare("SELECT id, from_pack_id, old_content FROM pack_updates WHERE pack_id = ? AND undone_at IS NULL ORDER BY created_at DESC, rowid DESC LIMIT 1")
      .bind(target.id).first<{ id: string; from_pack_id: string; old_content: string }>();
    if (!last) throw new InputError(`Pack version ${a.version} has no change to undo.`);
    await swap(last.old_content, env.DB.prepare("UPDATE pack_updates SET undone_at = ? WHERE id = ? AND undone_at IS NULL AND EXISTS (SELECT 1 FROM packs WHERE id = ? AND content = ? AND revoked_at IS NULL)")
      .bind(at, last.id, target.id, target.content));
    const ads = (JSON.parse(last.old_content) as PackContent).ads;
    return { packId: target.id, version: target.version, undone: true, ads: ads.map((x) => ({ name: x.name, imageKey: x.imageKey })), note: "The pack shows its content from before the last change again. Same link." };
  }

  if (a.fromVersion === undefined) throw new InputError("Give fromVersion (the pack whose ads and text to copy in), or undo true.");
  // Only forward: an older pack never overwrites a newer link. undo is the way back.
  if (a.fromVersion <= a.version) throw new InputError("fromVersion must be newer than version. To go back, use undo.");
  const source = await row(a.fromVersion);
  if (!source) throw new InputError(`This batch has no pack version ${a.fromVersion}.`);
  if (source.revoked_at) throw new InputError(`Pack version ${a.fromVersion} is revoked. Nothing changed.`);
  const old = JSON.parse(target.content) as PackContent;
  const src = JSON.parse(source.content) as PackContent;
  const byKey = new Map(src.ads.map((x) => [adKey(x.name), x]));
  const missing = old.ads.filter((x) => !byKey.has(adKey(x.name))).map((x) => x.name);
  const extra = src.ads.filter((x) => !old.ads.some((o) => adKey(o.name) === adKey(x.name))).map((x) => x.name);
  if (missing.length || extra.length)
    throw new InputError(
      `The two packs do not hold the same ideas. Nothing changed.${missing.length ? ` Not in v${a.fromVersion}: ${missing.join(", ")}.` : ""}${extra.length ? ` Not in v${a.version}: ${extra.join(", ")}.` : ""}`,
    );
  const next: PackContent = a.text
    ? {
        ...src,
        brand: old.brand,
        ads: old.ads.map((o) => {
          const n = byKey.get(adKey(o.name))!;
          // Keep the name (the client's Ads Manager and results use it) and the stage; take everything the client sees from the newer pack.
          return { ...n, name: o.name, stage: o.stage };
        }),
      }
    : // Pictures only: the approved Meta text, fact check, launch plan and health note of the older pack stay.
      { ...old, ads: old.ads.map((o) => ({ ...o, imageKey: byKey.get(adKey(o.name))!.imageKey })) };
  const content = JSON.stringify(next);
  if (content === target.content)
    throw new InputError(`Pack version ${a.version} already shows the ${a.text ? "pictures and text" : "pictures"} of v${a.fromVersion}. Nothing changed.`);
  await swap(content, env.DB.prepare("INSERT INTO pack_updates (id, pack_id, from_pack_id, old_content, created_at) SELECT ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM packs WHERE id = ? AND content = ? AND revoked_at IS NULL)")
    .bind(crypto.randomUUID(), target.id, source.id, target.content, at, target.id, target.content));
  return {
    packId: target.id,
    version: target.version,
    from: a.fromVersion,
    ads: next.ads.map((x, i) => ({
      name: x.name,
      picture: old.ads[i]!.imageKey === x.imageKey ? "same" : { was: old.ads[i]!.imageKey, now: x.imageKey },
      textChanged: JSON.stringify([old.ads[i]!.primaryTexts, old.ads[i]!.headlines, old.ads[i]!.description, old.ads[i]!.cta, old.ads[i]!.why, old.ads[i]!.headline]) !==
        JSON.stringify([x.primaryTexts, x.headlines, x.description, x.cta, x.why, x.headline]),
    })),
    text: a.text ? `copied from v${a.fromVersion}: show the owner the text before and after` : `kept: v${a.version}'s own Meta text stays`,
    note: `Same link, same ad names. The client's comments and uploads on v${a.version} stay. The old content is kept: pack_update undo puts it back.`,
  };
}
