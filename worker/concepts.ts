import type { Env } from "./env";
import { briefGet } from "./research";
import { InputError, type ObjectSchema, type StringProp } from "./schema";

/**
 * a11-engine v3 Phase 2: territories and concepts (design pack §2.2 to §2.4). The checks here are shape checks only
 * (a wrong count, a key or id that is not there). Taste stays in the writer and critic files.
 */

export const MECHANISMS = [
  "behavioural_observation", "product_obsession", "visual_metaphor", "contrast", "product_demonstration",
  "editorial_photography", "typography_led", "unexpected_object", "other",
] as const;

const KEY = "^[A-Za-z0-9_-]{1,40}$";
const line = (max = 600): StringProp => ({ type: "string", minLength: 1, maxLength: max });

export const TERRITORY_SCHEMA: ObjectSchema = {
  type: "object",
  properties: {
    key: { type: "string", pattern: KEY },
    name: line(120),
    insightId: { type: "string", pattern: KEY, description: "the id of a buyer insight in the newest brief" },
    whyItMatters: line(),
    productConnection: line(),
    brandConnection: line(),
    commercialOpportunity: line(),
    mechanisms: { type: "array", minItems: 1, maxItems: 4, items: { type: "string", enum: [...MECHANISMS] } },
  },
  required: ["key", "name", "insightId", "whyItMatters", "productConnection", "brandConnection", "commercialOpportunity", "mechanisms"],
  additionalProperties: false,
};

export const CONCEPT_SCHEMA: ObjectSchema = {
  type: "object",
  description: "Engine 3 only: the concept fields (design pack §2.3). The server adds briefVersion.",
  properties: {
    territory: { type: "string", pattern: KEY, description: "the key of a territory of this batch" },
    name: line(120),
    insightId: { type: "string", pattern: KEY },
    evidenceIds: { type: "array", maxItems: 20, items: { type: "string", pattern: KEY } },
    proposition: line(),
    concept: line(),
    mechanism: {
      type: "object",
      properties: { type: { type: "string", enum: [...MECHANISMS] }, how: line() },
      required: ["type", "how"],
      additionalProperties: false,
    },
    productRole: line(),
    brandRole: line(),
    purpose: line(),
    coverTest: {
      type: "object",
      properties: { pictureAlone: line(), headlineAlone: line() },
      required: ["pictureAlone", "headlineAlone"],
      additionalProperties: false,
    },
    sublineBasis: {
      type: "object",
      description: "fact: the subline states a fact (give factId); second_beat: a second beat that claims nothing; none: a headline-only ad (needs the owner's word at the copy review).",
      properties: { kind: { type: "string", enum: ["fact", "second_beat", "none"] }, factId: { type: "string", pattern: "^[0-9]{1,12}$" } },
      required: ["kind"],
      additionalProperties: false,
    },
    risks: { type: "array", maxItems: 8, items: line(300) },
  },
  required: ["territory", "name", "insightId", "proposition", "concept", "mechanism", "productRole", "brandRole", "purpose", "coverTest", "sublineBasis", "risks"],
  additionalProperties: false,
};

export type Territory = { key: string; name: string; insightId: string; mechanisms: string[]; [k: string]: unknown };
export type Concept = {
  territory: string; insightId: string; evidenceIds?: string[]; sublineBasis: { kind: string; factId?: string }; [k: string]: unknown;
};

/** The first save of concepts: 6 to 15, 2 or 3 for each territory. Later saves (a rework) add; the batch holds at most 24. */
const FIRST_MIN = 6;
const FIRST_MAX = 15;
const BATCH_MAX = 24;

/** The newest territories record of a batch, or null. */
export async function territoriesGet(env: Env, batchId: string) {
  const r = await env.DB.prepare(
    "SELECT version, body FROM batch_records WHERE batch_id = ? AND kind = 'territories' AND idea_id IS NULL ORDER BY version DESC LIMIT 1",
  ).bind(batchId).first<{ version: number; body: string }>();
  return r ? { version: r.version, ...(JSON.parse(r.body) as { briefVersion: number; territories: Territory[] }) } : null;
}

/**
 * Check the territories and concepts of an engine 3 ideas_save. Returns the concepts with briefVersion stamped, the
 * territories record body to add (null when the call sends no territories) and the warnings.
 */
export async function checkConcepts(
  env: Env,
  batch: { id: string; subject_id: string },
  ideas: { concept?: Concept }[],
  territories: Territory[] | undefined,
) {
  const brief = await briefGet(env, batch.id);
  if (!brief) throw new InputError("Save the brief first with brief_save: each territory and concept names an insight of the brief.");
  const insightIds = new Set(brief.brief.buyerInsights.map((i) => i.id));
  const evidenceIds = new Set(brief.brief.evidence.map((e) => e.id));
  const [old, used] = await Promise.all([
    territoriesGet(env, batch.id),
    env.DB.prepare("SELECT json_extract(concept, '$.territory') AS t, COUNT(*) AS c FROM ideas WHERE batch_id = ? GROUP BY t").bind(batch.id).all<{ t: string | null; c: number }>(),
  ]);
  const existing = used.results.reduce((n, r) => n + r.c, 0);
  const warnings: string[] = [];

  if (!territories && !old) throw new InputError("An engine 3 batch needs its territories (3 to 5) with the first concepts.");
  if (territories) {
    const keys = territories.map((t) => t.key);
    if (new Set(keys).size !== keys.length) throw new InputError("Each territory key may appear only once.");
    const strange = territories.filter((t) => !insightIds.has(t.insightId)).map((t) => `${t.key} (${t.insightId})`);
    if (strange.length) throw new InputError(`These territories name an insight that is not in the newest brief: ${strange.join(", ")}.`);
    // A new list keeps every territory that a saved concept uses.
    const lost = used.results.filter((r) => r.t !== null && !keys.includes(r.t)).map((r) => r.t);
    if (lost.length) throw new InputError(`The new territory list drops territories that saved concepts use: ${lost.join(", ")}.`);
    const byInsight = new Map<string, string[]>();
    for (const t of territories) byInsight.set(t.insightId, [...(byInsight.get(t.insightId) ?? []), t.key]);
    for (const [insight, ks] of byInsight)
      if (ks.length > 1) warnings.push(`Territories ${ks.join(", ")} start from the same insight ${insight}: each needs a clearly different tension, or they are one territory.`);
  }
  const list = territories ?? old!.territories;
  const keys = new Set(list.map((t) => t.key));

  const missing = ideas.map((idea, n) => (idea.concept ? -1 : n)).filter((n) => n >= 0);
  if (missing.length) throw new InputError(`Every idea of an engine 3 batch needs its concept: ideas ${missing.map((n) => `[${n}]`).join(", ")} have none.`);
  const concepts = ideas.map((i) => i.concept!);
  if (existing === 0 && (concepts.length < FIRST_MIN || concepts.length > FIRST_MAX))
    throw new InputError(`The first concepts of an engine 3 batch are ${FIRST_MIN} to ${FIRST_MAX} (2 or 3 for each territory); this call has ${concepts.length}.`);
  if (existing + concepts.length > BATCH_MAX)
    throw new InputError(`An engine 3 batch holds at most ${BATCH_MAX} concepts; it has ${existing}, and this call adds ${concepts.length}.`);

  const factIds = concepts.flatMap((c) => (c.sublineBasis.factId ? [Number(c.sublineBasis.factId)] : []));
  const facts = factIds.length
    ? await env.DB.prepare("SELECT id FROM facts WHERE subject_id = ? AND id IN (SELECT value FROM json_each(?))").bind(batch.subject_id, JSON.stringify(factIds)).all<{ id: number }>()
    : { results: [] };
  const factKnown = new Set(facts.results.map((f) => f.id));

  concepts.forEach((c, n) => {
    const where = `ideas[${n}].concept`;
    if (!keys.has(c.territory)) throw new InputError(`${where}.territory ${c.territory} is not a territory of this batch.`);
    if (!insightIds.has(c.insightId)) throw new InputError(`${where}.insightId ${c.insightId} is not an insight of the newest brief.`);
    const strangers = (c.evidenceIds ?? []).filter((id) => !evidenceIds.has(id));
    if (strangers.length) throw new InputError(`${where}.evidenceIds are not in the newest brief: ${strangers.join(", ")}.`);
    const f = c.sublineBasis.factId;
    if (f && !factKnown.has(Number(f))) throw new InputError(`${where}.sublineBasis.factId ${f} is not a fact of this batch's subject.`);
    if (c.sublineBasis.kind === "fact" && !f) warnings.push(`${where}: the subline states a fact, but sublineBasis has no factId. Name the fact, or make the subline a second beat.`);
    if (c.sublineBasis.kind === "none") warnings.push(`${where}: a headline-only ad needs the owner's word at the copy review.`);
  });

  if (existing === 0) {
    const count = new Map(list.map((t) => [t.key, 0]));
    for (const c of concepts) count.set(c.territory, (count.get(c.territory) ?? 0) + 1);
    const off = [...count].filter(([, c]) => c < 2 || c > 3).map(([k, c]) => `${k} (${c})`);
    if (off.length) throw new InputError(`The first concepts are 2 or 3 for each territory: ${off.join(", ")}.`);
  }

  return {
    concepts: concepts.map((c) => ({ ...c, briefVersion: brief.version })),
    record: territories ? { briefVersion: brief.version, territories } : null,
    warnings,
  };
}
