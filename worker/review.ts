import type { Env } from "./env";
import { InputError, type ObjectSchema, type StringProp } from "./schema";

/**
 * a11-engine v3 Phase 2: the critic's concept review and the 3 picks (design pack §2.5, §2.6). The server checks the
 * shape only (the ids, the counts, a reason for each concept). The selection rule is taste: it is in plugin/agents/critic.md.
 */

export const SCORES = [
  "originality", "appropriateness", "insight", "headline", "visual", "productRelevance", "brandRecognition", "commercialPurpose", "executionPotential",
] as const;
export const GATES = [
  "falseClaim", "stereotype", "raceReligionInCopy", "misrepresentsProduct", "inaccurateLogo", "headlineImageSplit", "needsRenderDefect", "noProductOrBrandLink",
] as const;
const ROLES = ["tof", "mof", "bof"];
const ID = "^[0-9a-f-]{36}$";
const line = (max = 600): StringProp => ({ type: "string", minLength: 1, maxLength: max });
const passFail: StringProp = { type: "string", enum: ["pass", "fail"] };

export const REVIEW_SCHEMA: ObjectSchema = {
  type: "object",
  description: "Engine 3 only: the critic's review of every concept of the batch (design pack §2.5).",
  properties: {
    concepts: {
      type: "array",
      minItems: 1,
      maxItems: 24,
      items: {
        type: "object",
        properties: {
          ideaId: { type: "string", pattern: ID },
          scores: {
            type: "object",
            description: "1 to 5 for each dimension. Your notes: do not add them up.",
            properties: Object.fromEntries(SCORES.map((k) => [k, { type: "integer", minimum: 1, maximum: 5 }])),
            required: [...SCORES],
            additionalProperties: false,
          },
          gates: {
            type: "object",
            description: "true when the concept breaks the gate. Any true gate rejects the concept.",
            properties: Object.fromEntries(GATES.map((k) => [k, { type: "boolean" }])),
            required: [...GATES],
            additionalProperties: false,
          },
          optionB: passFail,
          ownerGate: passFail,
          works: line(),
          doesNotWork: line(),
          original: line(),
          insightCredible: line(),
          worthPaying: line(),
          verdict: { type: "string", enum: ["select", "reserve", "reject", "rework"] },
        },
        required: ["ideaId", "scores", "gates", "optionB", "ownerGate", "works", "doesNotWork", "original", "insightCredible", "worthPaying", "verdict"],
        additionalProperties: false,
      },
    },
    setVariety: { ...line(), description: "outcome select: why the three are not versions of one another." },
    setReject: { ...line(), description: "outcome rework: what is missing, and what the writer must do next." },
  },
  required: ["concepts"],
  additionalProperties: false,
};

type ConceptReview = { ideaId: string; gates: Record<string, boolean>; optionB: string; ownerGate: string; verdict: string; [k: string]: unknown };
export type Review = { concepts: ConceptReview[]; setVariety?: string; setReject?: string };
export type PickInput = {
  outcome?: "select" | "rework";
  roles?: { ideaId: string; role: string }[];
  reserves?: string[];
  review?: Review;
  promptVersion?: string;
  /** The owner's exact words when he named a reserve in place of a pick (design pack §2.7). The record author is then owner. */
  ownerSwap?: string;
};

/** The newest concept review of a batch with its version, author and time, and how many reviews were a rework. Or null. */
export async function conceptReviewGet(env: Env, batchId: string) {
  const r = await env.DB.prepare(
    `SELECT version, author, created_at, body,
       (SELECT COUNT(*) FROM batch_records WHERE batch_id = ?1 AND kind = 'concept_review' AND json_extract(body, '$.outcome') = 'rework') AS reworks
     FROM batch_records WHERE batch_id = ?1 AND kind = 'concept_review' AND idea_id IS NULL ORDER BY version DESC LIMIT 1`,
  ).bind(batchId).first<{ version: number; author: string; created_at: string; body: string; reworks: number }>();
  if (!r) return null;
  const body = JSON.parse(r.body) as { outcome: string; [k: string]: unknown };
  return { version: r.version, author: r.author, savedAt: r.created_at, reworks: r.reworks, ...body };
}

const dupes = (xs: string[]) => [...new Set(xs.filter((x, i) => xs.indexOf(x) !== i))];

/**
 * ideas_pick for an engine 3 batch: save the review record and, for outcome select, the 3 picks with their roles, in
 * one D1 batch. A rework picks nothing and clears the picks, so no draft can be paid for from a rejected set.
 */
export async function conceptPick(env: Env, batchId: string, ids: string[], input: PickInput) {
  const { outcome, roles = [], reserves = [], review, promptVersion = "", ownerSwap } = input;
  if (!outcome) throw new InputError("An engine 3 batch needs outcome: select (3 ids with roles) or rework (no ids).");
  if (!review) throw new InputError("An engine 3 batch needs the review: every concept of the batch, with its scores, gates and reasons.");

  const [ideas, frozen, canon, last] = await Promise.all([
    env.DB.prepare("SELECT id, concept FROM ideas WHERE batch_id = ? ORDER BY n").bind(batchId).all<{ id: string; concept: string }>(),
    env.DB.prepare(
      "SELECT 1 FROM renders r JOIN ideas i ON i.id = r.idea AND i.batch_id = r.batch WHERE r.batch = ? AND i.picked = 1 LIMIT 1",
    ).bind(batchId).first(),
    env.DB.prepare("SELECT MAX(id) AS id FROM canon_log").first<{ id: number | null }>(),
    conceptReviewGet(env, batchId),
  ]);
  if (frozen)
    throw new InputError("A picked idea of this batch has a render, so the picks and roles are frozen. Only the owner can change them, with ideas_update.");
  const all = new Set(ideas.results.map((i) => i.id));

  const reviewed = review.concepts.map((c) => c.ideaId);
  if (dupes(reviewed).length) throw new InputError(`Review each concept once: ${dupes(reviewed).join(", ")} appear more than once.`);
  const strange = reviewed.filter((id) => !all.has(id));
  if (strange.length) throw new InputError(`The review names ideas that are not in batch ${batchId}: ${strange.join(", ")}.`);
  const unread = [...all].filter((id) => !reviewed.includes(id));
  if (unread.length) throw new InputError(`Review every concept of the batch before you judge: ${unread.length} have no review (${unread.join(", ")}).`);

  if (ownerSwap && outcome !== "select") throw new InputError("ownerSwap is for a select only: the owner names a reserve in place of a pick.");
  if (ownerSwap && last?.outcome !== "select") throw new InputError("ownerSwap changes a saved selection, and this batch has none.");

  const warnings: string[] = [];
  if (outcome === "rework") {
    if (ids.length || roles.length || reserves.length) throw new InputError("A rework picks nothing: send no ids, roles or reserves.");
    if (!review.setReject) throw new InputError("A rework needs review.setReject: what is missing, and what the writer must do next.");
  } else {
    if (ids.length !== 3 || new Set(ids).size !== 3) throw new InputError(`A select has exactly 3 different idea ids; this call has ${ids.length}.`);
    const outside = ids.filter((id) => !all.has(id));
    if (outside.length) throw new InputError(`No idea of batch ${batchId} with id: ${outside.join(", ")}.`);
    const roled = roles.map((r) => r.ideaId);
    if (roled.length !== 3 || new Set(roled).size !== 3 || !ids.every((id) => roled.includes(id)))
      throw new InputError("Give each of the 3 selected ids one role (tof, mof or bof), and no other id.");
    if (roles.some((r) => !ROLES.includes(r.role))) throw new InputError("A role is tof, mof or bof.");
    if (dupes(reserves).length || reserves.some((id) => ids.includes(id) || !all.has(id)))
      throw new InputError("A reserve is an idea of this batch, named once, and not one of the 3 selected.");
    if (!review.setVariety) throw new InputError("A select needs review.setVariety: why the three are not versions of one another.");

    const byId = new Map(review.concepts.map((c) => [c.ideaId, c]));
    for (const id of ids) {
      const c = byId.get(id)!;
      const gates = Object.entries(c.gates).filter(([, v]) => v).map(([k]) => k);
      const why = [
        ...(gates.length ? [`gate ${gates.join(", ")} is true`] : []),
        ...(c.verdict !== "select" ? [`its verdict is ${c.verdict}`] : []),
        ...(c.optionB !== "pass" ? ["it fails option B"] : []),
        ...(c.ownerGate !== "pass" ? ["it fails the owner gate"] : []),
      ];
      if (why.length) warnings.push(`Selected idea ${id}: ${why.join("; ")}. A selected concept passes every gate.`);
    }
    const concept = new Map(ideas.results.map((i) => [i.id, JSON.parse(i.concept || "{}") as { territory?: string; mechanism?: { type?: string } }]));
    const picked = ids.map((id) => ({ id, t: concept.get(id)?.territory, m: concept.get(id)?.mechanism?.type }));
    if (new Set(picked.map((p) => p.t)).size === 1) warnings.push(`All 3 selected concepts are from territory ${picked[0]!.t}: select from at least 2 territories.`);
    for (let a = 0; a < 3; a++)
      for (let b = a + 1; b < 3; b++)
        if (picked[a]!.t === picked[b]!.t && picked[a]!.m === picked[b]!.m)
          warnings.push(`Ideas ${picked[a]!.id} and ${picked[b]!.id} have the same territory and the same mechanism: they are versions of one concept.`);
  }

  const recordId = crypto.randomUUID();
  const body = {
    outcome,
    ids,
    roles,
    reserves,
    review,
    canonLogId: canon?.id ?? null,
    ...(ownerSwap ? { ownerSwap } : {}),
  };
  // The record is the gate of the whole D1 batch: it is added only when no picked idea has a render and the batch still
  // has the ideas that were reviewed. The pick statements run only when that record exists, so a render or an ideas save
  // that commits between the checks above and this batch makes the whole call a no-op, and the call is refused.
  const gate = "EXISTS (SELECT 1 FROM batch_records WHERE id = ?)";
  const stmts = [
    env.DB.prepare(
      `INSERT INTO batch_records (id, batch_id, kind, idea_id, version, body, author, prompt_version, created_at)
       SELECT ?, ?, 'concept_review', NULL, v, ?, ?, ?, ? FROM
         (SELECT COALESCE(MAX(version), 0) + 1 AS v FROM batch_records WHERE batch_id = ? AND kind = 'concept_review' AND idea_id IS NULL)
       WHERE NOT EXISTS (SELECT 1 FROM renders r JOIN ideas i ON i.id = r.idea AND i.batch_id = r.batch WHERE r.batch = ? AND i.picked = 1)
         AND (SELECT COUNT(*) FROM ideas WHERE batch_id = ?) = ?`,
    ).bind(recordId, batchId, JSON.stringify(body), ownerSwap ? "owner" : "critic", promptVersion, new Date().toISOString(), batchId, batchId, batchId, all.size),
    // Unpick first: the pick-cap trigger allows 3 picked ideas for each batch.
    env.DB.prepare(
      `UPDATE ideas SET picked = 0 WHERE batch_id = ? AND picked = 1 AND id NOT IN (SELECT value FROM json_each(?)) AND ${gate}`,
    ).bind(batchId, JSON.stringify(ids), recordId),
    ...roles.map((r) =>
      env.DB.prepare(`UPDATE ideas SET picked = 1, format = ? WHERE id = ? AND batch_id = ? AND ${gate}`).bind(r.role, r.ideaId, batchId, recordId),
    ),
  ];
  const [saved] = await env.DB.batch(stmts);
  if (saved?.meta.changes !== 1)
    throw new InputError("The batch changed while you reviewed it (a new concept or a render), and nothing was saved. Read batch_get and review again.");
  return { batchId, outcome, picked: ids, roles, reserves, warnings, version: (last?.version ?? 0) + 1 };
}
