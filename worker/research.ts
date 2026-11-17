import type { Env } from "./env";
import { InputError, type ObjectSchema, type Prop } from "./schema";

/**
 * a11-engine v3 Phase 1 (docs/a11-engine-v3-fable-design-pack.md §1): research sources, the quote check and the
 * Creative Strategy Brief. The server stores what Exa returned, checks that each quote is in the stored text, and
 * keeps every version of the brief. It judges nothing: the main session writes the brief.
 */

const now = () => new Date().toISOString();
/** OD 1.4: the text kept for one source. About 40 sources for a batch stay under 1 MB. */
export const SOURCE_TEXT_MAX = 20_000;

/** Lower case, curly quotes to straight, every dash to '-', all white space to one space. */
export function normalise(s: string) {
  return s
    .toLowerCase()
    .replace(/[‘’‚‛′]/g, "'")
    .replace(/[“”„‟″]/g, '"')
    .replace(/[‐-―−]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

/** True when the quote, normalised, is in the text, normalised. An empty quote is never found. */
export function quoteIn(quote: string, text: string) {
  const q = normalise(quote);
  return q.length > 0 && normalise(text).includes(q);
}

export interface SourceInput {
  url: string;
  title: string | null;
  publishedDate?: string | null;
  text: string;
}

/**
 * Keep each Exa result as a research source of the batch (once per batch, URL and tool; a later call changes nothing)
 * and give back its id. A storage error never blocks research: the ids are null and the warning says why.
 */
export async function storeSources(env: Env, batchId: string, via: "search" | "contents", query: string, items: SourceInput[]) {
  try {
    const batch = await env.DB.prepare("SELECT 1 FROM batches WHERE id = ?").bind(batchId).first();
    if (!batch) return { ids: items.map(() => null), warning: `No batch ${batchId}: the results were not stored.` };
    const at = now();
    await env.DB.batch(
      items.map((r) =>
        env.DB.prepare(
          `INSERT INTO research_sources (id, batch_id, url, title, published_date, retrieved_at, via, query, text)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (batch_id, url, via) DO NOTHING`,
        ).bind(crypto.randomUUID(), batchId, r.url, r.title ?? "", r.publishedDate ?? null, at, via, query.slice(0, 500), r.text.slice(0, SOURCE_TEXT_MAX)),
      ),
    );
    const rows = await env.DB.prepare(
      "SELECT id, url FROM research_sources WHERE batch_id = ? AND via = ? AND url IN (SELECT value FROM json_each(?))",
    ).bind(batchId, via, JSON.stringify(items.map((r) => r.url))).all<{ id: string; url: string }>();
    const byUrl = new Map(rows.results.map((r) => [r.url, r.id]));
    return { ids: items.map((r) => byUrl.get(r.url) ?? null), warning: null };
  } catch (e) {
    return { ids: items.map(() => null), warning: `The results were not stored (${(e as Error).message}). Research goes on; quotes from them cannot be checked.` };
  }
}

/** The sources of a batch, without their text (the text stays on the server for the quote check). */
export async function sourcesList(env: Env, batchId: string) {
  const rows = await env.DB.prepare(
    `SELECT id, url, title, published_date AS publishedDate, retrieved_at AS retrievedAt, via FROM research_sources
     WHERE batch_id = ? ORDER BY retrieved_at, rowid LIMIT 200`,
  ).bind(batchId).all();
  return rows.results;
}

/**
 * The fact check (design pack §1.4): for each fact, look for its quote in the stored text of this batch's sources
 * with the same URL. 1: found. 0: the page is stored and the quote is not in it. NULL: the page is not stored.
 */
export async function factMarks(env: Env, batchId: string, facts: { quote: string; sourceUrl: string }[]) {
  const urls = [...new Set(facts.map((f) => f.sourceUrl))];
  const rows = await env.DB.prepare("SELECT url, text FROM research_sources WHERE batch_id = ? AND url IN (SELECT value FROM json_each(?))")
    .bind(batchId, JSON.stringify(urls))
    .all<{ url: string; text: string }>();
  return facts.map((f) => {
    const texts = rows.results.filter((r) => r.url === f.sourceUrl);
    if (texts.length === 0) return null;
    return texts.some((r) => quoteIn(f.quote, r.text)) ? 1 : 0;
  });
}

// ---- The brief -------------------------------------------------------------------------------------------------

const TEXT = 2000;
const text = (max = TEXT): Prop => ({ type: "string", maxLength: max });
const BASIS: Prop = { type: "string", enum: ["evidence", "interpretation", "hypothesis"] };
const CONFIDENCE: Prop = { type: "string", enum: ["high", "medium", "low"] };
const MARKET: Prop = { type: "string", enum: ["SG", "non-SG", "unknown"] };
const IDS: Prop = { type: "array", maxItems: 40, items: { type: "string", pattern: "^[A-Za-z0-9_-]{1,40}$" } };
const claim = (required: string[] = ["text", "basis"]): ObjectSchema => ({
  type: "object",
  properties: { text: text(), basis: BASIS, evidenceIds: IDS, confidence: CONFIDENCE },
  required,
  additionalProperties: false,
});
const texts: Prop = { type: "array", maxItems: 20, items: { type: "string", maxLength: TEXT } };
export const SOURCE_TYPES = [
  "brand_site", "product_page", "retailer_listing", "public_review", "forum", "social_public",
  "news_media", "competitor_site", "ad_library_public", "owner_supplied", "client_supplied",
] as const;
const PRIVATE = new Set(["owner_supplied", "client_supplied"]);

/** The Creative Strategy Brief (v3 §4.1, design pack §1.3). Size limits are shape checks: 12 insights, 40 evidence items, 20 unknowns. */
export const BRIEF_SCHEMA: ObjectSchema = {
  type: "object",
  properties: {
    brand: {
      type: "object",
      properties: { name: text(200), category: text(200), positioning: claim() },
      required: ["name", "category", "positioning"],
      additionalProperties: false,
    },
    product: {
      type: "object",
      properties: { subjectId: { type: "string", pattern: "^[0-9a-f-]{36}$" }, name: text(200), variant: text(200) },
      required: ["subjectId", "name"],
      additionalProperties: false,
    },
    productFacts: {
      type: "object",
      properties: { factIds: { type: "array", maxItems: 40, items: { type: "string", pattern: "^[0-9]{1,12}$" } }, note: text(400) },
      required: ["factIds"],
      additionalProperties: false,
    },
    productTruth: {
      type: "object",
      properties: {
        shape: text(), texture: text(), packaging: text(), realAppearance: text(),
        referenceKeys: { type: "array", maxItems: 10, items: { type: "string", maxLength: 200 } },
      },
      required: ["shape", "packaging"],
      additionalProperties: false,
    },
    buyer: claim(["text", "basis", "confidence"]),
    buyerInsights: {
      type: "array",
      minItems: 1,
      maxItems: 12,
      items: {
        type: "object",
        properties: {
          id: { type: "string", pattern: "^[A-Za-z0-9_-]{1,40}$" }, text: text(), tension: text(),
          basis: BASIS, evidenceIds: IDS, confidence: CONFIDENCE, market: MARKET,
        },
        required: ["id", "text", "tension", "basis", "confidence", "market"],
        additionalProperties: false,
      },
    },
    categoryConventions: { type: "array", maxItems: 12, items: claim() },
    categoryOpportunities: { type: "array", maxItems: 12, items: claim() },
    brandIdentity: {
      type: "object",
      properties: { kitSlug: text(80), voice: text(), personality: text(), note: text(400) },
      required: ["voice"],
      additionalProperties: false,
    },
    commercialObjective: {
      type: "object",
      properties: { text: text(), source: { type: "string", enum: ["owner", "client", "default"] }, basis: BASIS },
      required: ["text", "source", "basis"],
      additionalProperties: false,
    },
    constraints: {
      type: "object",
      properties: { claims: texts, cultural: texts, product: texts, visual: texts },
      additionalProperties: false,
    },
    evidence: {
      type: "array",
      maxItems: 40,
      items: {
        type: "object",
        properties: {
          id: { type: "string", pattern: "^[A-Za-z0-9_-]{1,40}$" },
          sourceId: { type: "string", pattern: "^[0-9a-f-]{36}$" },
          url: { type: "string", format: "uri" },
          sourceType: { type: "string", enum: [...SOURCE_TYPES] },
          quote: { type: "string", minLength: 1, maxLength: 600 },
          speaker: { type: "string", enum: ["buyer", "brand", "competitor", "press", "unknown"] },
          market: MARKET,
          publishedDate: text(40),
        },
        required: ["id", "sourceType", "quote", "speaker", "market"],
        additionalProperties: false,
      },
    },
    unknowns: {
      type: "array",
      maxItems: 20,
      items: {
        type: "object",
        properties: {
          field: text(80), question: text(), whyItMatters: text(),
          howToResolve: { type: "string", enum: ["owner", "client", "public_research"] },
        },
        required: ["field", "question", "whyItMatters", "howToResolve"],
        additionalProperties: false,
      },
    },
  },
  required: ["brand", "product", "productFacts", "productTruth", "buyer", "buyerInsights", "brandIdentity", "commercialObjective", "evidence", "unknowns"],
  additionalProperties: false,
};

type Claim = { text: string; basis: string; evidenceIds?: string[]; confidence?: string };
type Evidence = {
  id: string; sourceId?: string; url?: string; sourceType: string; quote: string; speaker: string; market: string;
  publishedDate?: string; retrievedAt?: string; verified?: boolean | null;
};
type Insight = Claim & { id: string; tension: string; market: string };
export interface Brief {
  brand: { name: string; category: string; positioning: Claim };
  product: { subjectId: string; name: string; variant?: string };
  productFacts: { factIds: string[]; note?: string };
  buyer: Claim;
  buyerInsights: Insight[];
  categoryConventions?: Claim[];
  categoryOpportunities?: Claim[];
  evidence: Evidence[];
  [k: string]: unknown;
}

const domain = (url?: string) => {
  try {
    return url ? new URL(url).hostname.replace(/^www\./, "") : null;
  } catch {
    return null;
  }
};

/**
 * Save a new version of the brief. Refusals are shape checks only (an evidence id or fact id that is not there, a
 * subject of another batch). The quote check and the evidence rules give marks and warnings, never a refusal (OD 1.1).
 */
export async function briefSave(env: Env, batchId: string, input: Brief, promptVersion = "") {
  const b = await env.DB.prepare("SELECT subject_id, engine FROM batches WHERE id = ?").bind(batchId).first<{ subject_id: string; engine: number }>();
  if (!b) throw new InputError(`No batch with id ${batchId}.`);
  const brief = structuredClone(input);
  if (brief.product.subjectId !== b.subject_id) throw new InputError(`product.subjectId must be the subject of batch ${batchId} (${b.subject_id}).`);

  // Every evidence id that a claim names must be in the evidence list; ids are unique.
  const evidenceIds = brief.evidence.map((e) => e.id);
  if (new Set(evidenceIds).size !== evidenceIds.length) throw new InputError("Each evidence id may appear only once.");
  const insightIds = brief.buyerInsights.map((i) => i.id);
  if (new Set(insightIds).size !== insightIds.length) throw new InputError("Each buyer insight id may appear only once.");
  const known = new Set(evidenceIds);
  const claims: [string, Claim][] = [
    ["brand.positioning", brief.brand.positioning],
    ["buyer", brief.buyer],
    ...brief.buyerInsights.map((c, i): [string, Claim] => [`buyerInsights[${i}]`, c]),
    ...(brief.categoryConventions ?? []).map((c, i): [string, Claim] => [`categoryConventions[${i}]`, c]),
    ...(brief.categoryOpportunities ?? []).map((c, i): [string, Claim] => [`categoryOpportunities[${i}]`, c]),
  ];
  for (const [where, c] of claims) {
    const missing = (c.evidenceIds ?? []).filter((id) => !known.has(id));
    if (missing.length) throw new InputError(`${where} names evidence that is not in the evidence list: ${missing.join(", ")}.`);
  }

  // The facts must be facts of the batch's subject.
  const factIds = brief.productFacts.factIds.map(Number);
  const facts = await env.DB.prepare("SELECT id, label, verified FROM facts WHERE subject_id = ? AND id IN (SELECT value FROM json_each(?))")
    .bind(b.subject_id, JSON.stringify(factIds))
    .all<{ id: number; label: string; verified: number | null }>();
  const factById = new Map(facts.results.map((f) => [f.id, f]));
  const strangers = factIds.filter((id) => !factById.has(id));
  if (strangers.length) throw new InputError(`productFacts.factIds are not facts of this batch's subject: ${strangers.join(", ")}.`);

  // The quote check against the stored text of each source. The input value of verified is ignored.
  const sourceIds = [...new Set(brief.evidence.map((e) => e.sourceId).filter((s): s is string => !!s))];
  const sources = await env.DB.prepare(
    "SELECT id, url, text, retrieved_at, published_date FROM research_sources WHERE batch_id = ? AND id IN (SELECT value FROM json_each(?))",
  ).bind(batchId, JSON.stringify(sourceIds)).all<{ id: string; url: string; text: string; retrieved_at: string; published_date: string | null }>();
  const sourceById = new Map(sources.results.map((s) => [s.id, s]));
  const strangeSources = sourceIds.filter((id) => !sourceById.has(id));
  if (strangeSources.length) throw new InputError(`evidence names sources that are not sources of this batch: ${strangeSources.join(", ")}.`);
  for (const e of brief.evidence) {
    const s = e.sourceId ? sourceById.get(e.sourceId) : undefined;
    if (s) {
      e.url ??= s.url;
      e.retrievedAt = s.retrieved_at;
      if (s.published_date) e.publishedDate = s.published_date;
      e.verified = quoteIn(e.quote, s.text);
    } else {
      delete e.retrievedAt;
      e.verified = PRIVATE.has(e.sourceType) ? null : false;
    }
  }
  const unverified = brief.evidence.filter((e) => e.verified === false).map((e) => e.id);

  // Warnings: the evidence rules of design pack §1.3 and §1.5. Not refusals.
  const byId = new Map(brief.evidence.map((e) => [e.id, e]));
  const warnings: string[] = [];
  for (const [i, ins] of brief.buyerInsights.entries()) {
    const ev = (ins.evidenceIds ?? []).map((id) => byId.get(id)!);
    const where = `buyerInsights[${i}] (${ins.id})`;
    if (ins.basis === "evidence" && !ev.some((e) => e.verified !== false))
      warnings.push(`${where} has basis 'evidence' but no verified evidence: correct the quote or lower the basis.`);
    if (ins.basis === "evidence" && !ev.some((e) => e.speaker === "buyer"))
      warnings.push(`${where} has basis 'evidence' but none of its evidence is a buyer speaking: only buyer evidence can support it.`);
    if (ins.market === "SG" && !ev.some((e) => e.market === "SG")) warnings.push(`${where} is marked SG but has no SG evidence: its basis is a hypothesis.`);
    if (ins.basis === "interpretation" && ev.length === 0) warnings.push(`${where} has basis 'interpretation' but names no evidence.`);
  }
  for (const [where, c] of claims) {
    if (c.confidence !== "high") continue;
    const domains = new Set((c.evidenceIds ?? []).map((id) => domain(byId.get(id)?.url)).filter(Boolean));
    if (domains.size < 2) warnings.push(`${where} has confidence 'high' with evidence from ${domains.size} domain(s): high needs 2 or more.`);
  }
  for (const id of factIds) {
    const f = factById.get(id)!;
    if (f.verified !== 1)
      warnings.push(`Fact ${id} (${f.label}) is not verified: its quote was ${f.verified === 0 ? "not found on" : "not checked against"} a stored page. Do not use it as a claim until it is, or until the owner approves that copy after he saw this mark.`);
  }

  // A new version; two saves at once: the unique index refuses one, which tries once more with the next number.
  const insert = async () => {
    const last = await env.DB.prepare("SELECT MAX(version) AS v FROM batch_records WHERE batch_id = ? AND kind = 'brief' AND idea_id IS NULL")
      .bind(batchId)
      .first<{ v: number | null }>();
    const version = (last?.v ?? 0) + 1;
    await env.DB.prepare(
      `INSERT INTO batch_records (id, batch_id, kind, idea_id, version, body, author, prompt_version, created_at)
       VALUES (?, ?, 'brief', NULL, ?, ?, 'main', ?, ?)`,
    ).bind(crypto.randomUUID(), batchId, version, JSON.stringify(brief), promptVersion, now()).run();
    return version;
  };
  let version: number;
  try {
    version = await insert();
  } catch (e) {
    if (!/UNIQUE/i.test((e as Error).message)) throw e;
    version = await insert();
  }
  return { batchId, version, unverified, warnings, ...(b.engine === 2 ? { note: "This is an engine 2 batch: its flow does not read the brief." } : {}) };
}

/** The newest brief of a batch, or null. */
export async function briefGet(env: Env, batchId: string) {
  const r = await env.DB.prepare(
    "SELECT version, body, prompt_version, created_at FROM batch_records WHERE batch_id = ? AND kind = 'brief' AND idea_id IS NULL ORDER BY version DESC LIMIT 1",
  ).bind(batchId).first<{ version: number; body: string; prompt_version: string; created_at: string }>();
  return r ? { version: r.version, promptVersion: r.prompt_version, savedAt: r.created_at, brief: JSON.parse(r.body) as Brief } : null;
}
