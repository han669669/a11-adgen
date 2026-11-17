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
