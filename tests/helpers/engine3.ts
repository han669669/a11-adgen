import type { DatabaseSync } from "node:sqlite";
import type { Env } from "../../worker/env";
import { TOOLS } from "../../worker/mcp";
import { validate } from "../../worker/schema";
import { exampleBrief, SOURCES } from "../fixtures/brief";
import { fakeD1 } from "./d1";

/** An engine 3 test batch for the a11-engine v3 tests (concepts, the concept review). */

export const E3 = "e3000000-0000-4000-8000-000000000003";

export const run = async (env: Env, name: string, args: unknown) => {
  const t = TOOLS.find((x) => x.name === name)!;
  const c = (await t.run(env, validate(t.inputSchema, t.prepare ? t.prepare(args) : args))).content[0]!;
  return JSON.parse(c.type === "text" ? c.text : "{}");
};

/** An engine 2 batch and an engine 3 copy of it, with stored sources, one fact and (unless brief is false) a brief with 3 insights. */
export async function seeded({ brief = true } = {}) {
  const env = { DB: fakeD1(), SPEND_CAP_USD: "5.00", PUBLIC_BASE_URL: "https://w" } as unknown as Env;
  const raw = (env.DB as unknown as { raw: DatabaseSync }).raw;
  raw.prepare("INSERT INTO brands (id, slug, name, created_at, updated_at) VALUES ('b1', 'pasar', 'Pasar Pantry', 'now', 'now')").run();
  raw.prepare("INSERT INTO brand_kits (id, brand_id, version, kit, created_at) VALUES ('k1', 'b1', 1, '{}', 'now')").run();
  const subject = await run(env, "subject_save", { brandSlug: "pasar", kind: "product", title: "Gula Melaka Granola", url: "https://example.com/p" });
  const e2 = await run(env, "batch_create", { brandSlug: "pasar", subjectId: subject.id, label: "W48" });
  // batch_create makes engine 2 batches only, and the engine of a batch is fixed: copy the row as an engine 3 batch.
  const cols = (raw.prepare("PRAGMA table_info(batches)").all() as { name: string }[]).map((c) => c.name).filter((c) => c !== "id" && c !== "engine");
  raw.prepare(`INSERT INTO batches (id, engine, ${cols.join(", ")}) SELECT ?, 3, ${cols.join(", ")} FROM batches WHERE id = ?`).run(E3, e2.id);
  const add = raw.prepare("INSERT INTO research_sources (id, batch_id, url, title, retrieved_at, via, text) VALUES (?, ?, ?, '', 'now', 'contents', ?)");
  for (const s of SOURCES) add.run(s.id, E3, s.url, s.text);
  const facts = await run(env, "facts_save", {
    subjectId: subject.id,
    facts: [{ label: "pack size", value: "300 g", quote: "300 g pouch", sourceUrl: "https://example.com/p" }],
  });
  const factIds = facts.map((f: { id: number }) => String(f.id)) as string[];
  if (brief) {
    const b = exampleBrief(subject.id, factIds);
    b.buyerInsights.push({ id: "i3", text: "People hide the pouch from the rest of the home.", tension: "Sharing is good; this pouch is mine.", basis: "hypothesis", evidenceIds: [], confidence: "low", market: "unknown" });
    await run(env, "brief_save", { batchId: E3, brief: b });
  }
  return { env, raw, subjectId: subject.id as string, e2: e2.id as string, factIds };
}

export const territory = (key: string, insightId = "i1") => ({
  key,
  name: `Territory ${key}`,
  insightId,
  whyItMatters: "It is what buyers do.",
  productConnection: "The pouch is in every scene.",
  brandConnection: "The kit colours and the logo.",
  commercialOpportunity: "No competitor shows it.",
  mechanisms: ["behavioural_observation"],
});
export const concept = (t: string, over: Record<string, unknown> = {}) => ({
  territory: t,
  name: `Concept in ${t}`,
  insightId: "i1",
  evidenceIds: ["e2"],
  proposition: "The pouch does not last.",
  concept: "The pouch is empty by the second night.",
  mechanism: { type: "product_obsession", how: "An empty pouch on a calm counter." },
  productRole: "The pouch is the evidence.",
  brandRole: "The real pack print.",
  purpose: "Stop a stranger.",
  coverTest: { pictureAlone: "Someone ate it all.", headlineAlone: "A line about a short life." },
  sublineBasis: { kind: "second_beat" },
  risks: ["The empty pouch can look like waste."],
  ...over,
});
export const idea = (t: string, over: Record<string, unknown> = {}) => ({
  format: "tof",
  insight: "Bought for breakfast, gone at night.",
  visual: "An empty pouch on a counter at night.",
  headline: "Gone by Thursday.",
  copy: { subline: "Small batches, every week." },
  concept: concept(t, over),
});
/** 4 territories, 10 concepts: 3, 3, 2, 2. */
export const firstRound = () => ({
  batchId: E3,
  territories: [territory("t1"), territory("t2", "i2"), territory("t3", "i3"), territory("t4", "i2")],
  ideas: [..."1112223344"].map((n) => idea(`t${n}`)),
  promptVersion: "0.2.12",
});

export type Idea = { id: string; n: number };
export const scores = { originality: 4, appropriateness: 5, insight: 4, headline: 4, visual: 4, productRelevance: 5, brandRecognition: 3, commercialPurpose: 4, executionPotential: 4 };
export const gates = {
  falseClaim: false, stereotype: false, raceReligionInCopy: false, misrepresentsProduct: false,
  inaccurateLogo: false, headlineImageSplit: false, needsRenderDefect: false, noProductOrBrandLink: false,
};
export const entry = (ideaId: string, verdict = "reject", over: Record<string, unknown> = {}) => ({
  ideaId, scores, gates, optionB: "pass", ownerGate: "pass",
  works: "The empty pouch is the proof.", doesNotWork: "The night light is generic.", original: "Nobody in the category shows an empty pack.",
  insightCredible: "Yes: two reviews say it.", worthPaying: "Yes.", verdict, ...over,
});

/** An engine 3 batch with the 10 first-round concepts (territories t1 t1 t1 t2 t2 t2 t3 t3 t4 t4). */
export async function withConcepts() {
  const s = await seeded();
  const saved = await run(s.env, "ideas_save", firstRound());
  return { ...s, ideas: saved.ideas as Idea[] };
}
/** ideas 0 (t1), 3 (t2) and 6 (t3) selected; 1 and 4 reserves. */
export const select = (ideas: Idea[], over: Record<string, unknown> = {}) => {
  const ids = [ideas[0]!.id, ideas[3]!.id, ideas[6]!.id];
  return {
    batchId: E3,
    outcome: "select",
    ids,
    roles: [{ ideaId: ids[0], role: "tof" }, { ideaId: ids[1], role: "tof" }, { ideaId: ids[2], role: "bof" }],
    reserves: [ideas[1]!.id, ideas[4]!.id],
    review: { concepts: ideas.map((i) => entry(i.id, ids.includes(i.id) ? "select" : "reserve")), setVariety: "Three truths: the empty pouch, the hidden pouch, the gift." },
    promptVersion: "0.2.13",
    ...over,
  };
};

/** An art direction for one picked concept (design pack §3.3), with 3 drafts that pass the rubric. */
export const PLAN = { size: [1024, 1280], bg: "#EEE8DF", shapes: [{ rect: [0, 0.7, 1, 1], fill: "#F6F5F2" }], products: [{ cx: 0.5, base: 0.82, height: 0.42, side: "up", rot: -0.6 }] };
export const axes = (tag: string) => ({
  composition: `${tag} composition`, productPosition: `${tag} position`, scale: `${tag} scale`, camera: `${tag} camera`,
  light: `${tag} light`, environment: "a plain lit counter", negativeSpace: `${tag} space`, staging: `${tag} staging`,
});
export const draft = (n: number, over: Record<string, unknown> = {}) => ({
  n,
  question: `Question ${n}: is the idea clearer when the pouch is ${["empty", "tipped", "closed"][n - 1]}?`,
  axes: axes(`d${n}`),
  plan: JSON.stringify({ ...PLAN, products: [{ ...PLAN.products[0], cx: 0.3 + n * 0.1 }] }),
  prompt: `A photograph of an empty pouch on a counter at night, draft ${n}.`,
  ...over,
});
export const direction = (over: Record<string, unknown> = {}, shared: Record<string, unknown> = {}) => ({
  why: "The empty pouch is the proof that it does not last. A calm counter at night makes the empty pack the only story.",
  mechanism: { type: "product_obsession", productionRisk: "low" },
  shared: {
    backdrop: "A warm grey wall.", light: "One soft lamp from the left.", colour: "Kit cream, a muted red accent.", supportingObjects: [],
    hierarchy: "The empty pouch, then the headline, then the logo. Back products recede.",
    type: { headlineFont: "Museo Sans Rounded", weight: "800", case: "sentence", reason: "A brand font that is not the logo's font." },
    logo: { placement: "top centre", note: "Optically centred. Ignore the TM mark." },
    recipe: "concept",
    ...shared,
  },
  drafts: [draft(1), draft(2), draft(3)],
  diversity: { pairs: { "1-2": ["composition", "scale", "camera"], "1-3": ["camera", "light", "staging"], "2-3": ["scale", "negativeSpace", "productPosition"] } },
  elementCount: 3,
  ...over,
});

/** An engine 3 batch with 3 picks (ideas 0, 3 and 6) whose words (headline and subline as they are) the owner approved. */
export async function approved() {
  const s = await withConcepts();
  await run(s.env, "ideas_pick", select(s.ideas));
  s.raw.prepare(`UPDATE ideas SET copy = json_set(copy, '$.ownerApproved', json_object('headline', headline, 'subline', json_extract(copy, '$.subline'))) WHERE batch_id = ? AND picked = 1`).run(E3);
  return s;
}

/** A draft check (design pack §3.6) that passes every point. */
export const draftCheck = (renderId: string, over: Record<string, unknown> = {}) => ({
  renderId,
  eligible: true,
  attempt: 1,
  measured: { shapeRatio: 0.668, targetRatio: 0.667, tolerance: 0.02 },
  items: [{ code: "D3", found: false }, { code: "F6", found: false }],
  points: {
    productShape: "pass", label: "pass", logo: "na", food: "pass", light: "pass", scale: "pass", props: "pass", physics: "pass",
    composition: "pass", hierarchy: "pass", headlineSpace: "pass", defects: "pass",
  },
  reason: "The pouch shape is exact and the counter is calm.",
  ...over,
});

/** A finished draft render of an idea (one image), as render_submit and render_status leave it. */
export function addRender(raw: DatabaseSync, id: string, ideaId: string, kind = "draft", at = "2026-11-17T07:00:00.000Z") {
  raw
    .prepare(
      `INSERT INTO renders (id, batch, idea, kind, status, prompt, refs, width, height, quality, num_images, image_keys, usd_est, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'done', 'p', '[]', 1024, 1280, 'low', 1, ?, 0.02, ?, ?)`,
    )
    .run(id, E3, ideaId, kind, JSON.stringify([`renders/${id}/0.jpg`]), at, at);
}
export const renderId = (pick: number, n: number) => `${pick}${n}000000-0000-4000-8000-000000000000`.slice(0, 36);

/** The critic's rank of every draft that the critic view shows (the eligible current drafts). */
export async function rankAll(env: Env) {
  const critic = await run(env, "batch_get", { id: E3, view: "critic" });
  const ranks = (critic.ideas as { drafts: { key: string }[] }[]).flatMap((i) => i.drafts.map((d, n) => ({ key: d.key, rank: n + 1, reason: "The pouch reads first." })));
  return run(env, "drafts_rank", { batchId: E3, ranks });
}

/**
 * An engine 3 batch ready for the board: 3 picks with approved words and a direction each, 3 finished drafts each, all
 * checked eligible, a final prompt, and (with rank) the critic's rank.
 */
export async function boardReady({ rank = true } = {}) {
  const s = await approved();
  const picks = [s.ideas[0]!, s.ideas[3]!, s.ideas[6]!];
  for (const [p, idea] of picks.entries()) {
    await run(s.env, "direction_save", { batchId: E3, ideaId: idea.id, direction: direction() });
    for (const n of [1, 2, 3]) {
      addRender(s.raw, renderId(p + 1, n), idea.id);
      await run(s.env, "checks_save", { batchId: E3, ideaId: idea.id, kind: "draft_check", check: draftCheck(renderId(p + 1, n)) });
    }
  }
  s.raw.prepare("UPDATE ideas SET final_prompt = 'final' WHERE batch_id = ? AND picked = 1").run(E3);
  if (rank) await rankAll(s.env);
  return { ...s, picks };
}
