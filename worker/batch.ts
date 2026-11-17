import { brandBySlug, latestKit } from "./brand";
import type { Env } from "./env";
import { checkConcepts, type Concept, type Territory, territoriesGet } from "./concepts";
import { briefGet, factMarks, sourcesList } from "./research";
import { conceptPick, conceptReviewGet, type PickInput } from "./review";
import { InputError } from "./schema";
import * as fal from "./fal";
import { storeSubjectImages } from "./subjectimages";

/** Funnel stages (owner, 2026-11-06). Picks per batch (a database trigger enforces it): 1 per stage for engine 2; 3 in any mix for engine 3, where the stage is the critic's role. */
export const FORMATS = ["tof", "mof", "bof"] as const;
export const STATUSES = ["research", "ideas", "drafts", "board", "finals", "done"] as const;
const MAX_BATCH_RENDERS = fal.MAX_BATCH_RENDERS;

const now = () => new Date().toISOString();

export async function subjectSave(
  env: Env,
  input: { brandSlug: string; kind: "product" | "brand" | "redesign"; title: string; url?: string; imageUrls?: string[]; notes?: string },
) {
  const brand = await brandBySlug(env, input.brandSlug);
  const id = crypto.randomUUID();
  // The images are fetched now and kept: a live ad can be taken down, and the agent looks at the copy with image_get.
  const { keys: imageKeys, errors: imageErrors } = await storeSubjectImages(env, id, input.imageUrls ?? []);
  const data = { imageUrls: input.imageUrls ?? [], imageKeys, imageErrors, notes: input.notes ?? "" };
  try {
    await env.DB.prepare("INSERT INTO subjects (id, brand_id, kind, title, url, data, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .bind(id, brand.id, input.kind, input.title, input.url ?? null, JSON.stringify(data), now())
      .run();
  } catch (e) {
    // The write may have committed before the error: delete the files only when no row points at them.
    // When the check itself fails, keep the files (an orphan is harmless; a row without its images is not).
    const row = await env.DB.prepare("SELECT id FROM subjects WHERE id = ?").bind(id).first().catch(() => ({ id }));
    if (!row) await Promise.all(imageKeys.map((k) => env.MEDIA.delete(k).catch(() => undefined)));
    throw e;
  }
  return { id, brandSlug: brand.slug, kind: input.kind, title: input.title, imageKeys, imageErrors };
}

export interface FactInput {
  label: string;
  value: string;
  quote: string;
  sourceUrl: string;
}

/**
 * Add facts to a subject. With batchId (a batch of this subject), each fact's quote is looked for in the stored source
 * text of that batch with the same URL (design pack §1.4): verified 1 or 0, or NULL when the page is not stored.
 */
export async function factsSave(env: Env, subjectId: string, facts: FactInput[], batchId?: string) {
  const subject = await env.DB.prepare("SELECT id FROM subjects WHERE id = ?").bind(subjectId).first();
  if (!subject) throw new Error(`No subject with id ${subjectId}.`);
  let marks: (number | null)[] = facts.map(() => null);
  if (batchId) {
    const b = await env.DB.prepare("SELECT subject_id FROM batches WHERE id = ?").bind(batchId).first<{ subject_id: string }>();
    if (!b || b.subject_id !== subjectId) throw new Error(`Batch ${batchId} is not a batch of subject ${subjectId}.`);
    marks = await factMarks(env, batchId, facts);
  }
  const at = now();
  await env.DB.batch(
    facts.map((f, i) =>
      env.DB.prepare("INSERT INTO facts (subject_id, label, value, quote, source_url, created_at, verified) VALUES (?, ?, ?, ?, ?, ?, ?)").bind(
        subjectId, f.label, f.value, f.quote, f.sourceUrl, at, marks[i],
      ),
    ),
  );
  return factsGet(env, subjectId);
}

/** retrievedAt is when the fact was saved. verified: true (quote found on a stored page), false (not found), null (not checked). */
export async function factsGet(env: Env, subjectId: string) {
  const rows = await env.DB.prepare(
    "SELECT id, label, value, quote, source_url AS sourceUrl, created_at AS retrievedAt, verified FROM facts WHERE subject_id = ? ORDER BY id LIMIT 200",
  ).bind(subjectId).all<Record<string, unknown>>();
  return rows.results.map((r) => ({ ...r, verified: r.verified === null || r.verified === undefined ? null : r.verified === 1 }));
}

export async function batchCreate(env: Env, input: { brandSlug: string; subjectId: string; label: string }) {
  const brand = await brandBySlug(env, input.brandSlug);
  const kit = await latestKit(env, brand.id);
  if (!kit) throw new Error(`Brand ${brand.slug} has no kit yet. Save one with brand_save first.`);
  const subject = await env.DB.prepare("SELECT brand_id FROM subjects WHERE id = ?").bind(input.subjectId).first<{ brand_id: string }>();
  if (!subject || subject.brand_id !== brand.id) throw new Error(`Subject ${input.subjectId} does not belong to ${brand.slug}.`);
  const id = crypto.randomUUID();
  const at = now();
  await env.DB.prepare(
    "INSERT INTO batches (id, brand_id, subject_id, kit_version, label, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'research', ?, ?)",
  )
    .bind(id, brand.id, input.subjectId, kit.version, input.label, at, at)
    .run();
  return { id, label: input.label, kitVersion: kit.version, status: "research" };
}

/** The marks of each stage (docs/design/owner-verdicts.md 2.1). The table has the same CHECK rule. */
export const VERDICT_MARKS = { draft: ["pass", "fix"], final: ["fix", "approve", "reject"], pack: ["fix", "approve", "reject"] } as const;

export interface OwnerVerdict {
  stage: keyof typeof VERDICT_MARKS;
  mark: string;
  ownerSaid: string;
  ideaId?: string;
  key?: string;
  packVersion?: number;
  notes?: string;
}

/** Check each verdict against the batch and make its insert. The owner's words are saved as he said them, only added, never changed. */
async function verdictInserts(env: Env, batchId: string, verdicts: OwnerVerdict[]) {
  const at = now();
  const out = [];
  for (const [i, v] of verdicts.entries()) {
    const where = `ownerVerdicts[${i}]`;
    if (!(VERDICT_MARKS[v.stage] as readonly string[]).includes(v.mark)) {
      throw new Error(`${where}: mark '${v.mark}' is not a mark of stage '${v.stage}' (use ${VERDICT_MARKS[v.stage].join(", ")}).`);
    }
    if (v.stage === "draft" && !v.ideaId) throw new Error(`${where}: a draft verdict needs ideaId.`);
    if (v.stage === "final" && !v.key) throw new Error(`${where}: a final verdict needs key (the final picture).`);
    let ideaId = v.ideaId ?? null;
    if (v.ideaId) {
      const idea = await env.DB.prepare("SELECT 1 FROM ideas WHERE id = ? AND batch_id = ?").bind(v.ideaId, batchId).first();
      if (!idea) throw new Error(`${where}: idea ${v.ideaId} is not an idea of this batch.`);
    }
    if (v.key) {
      const render = await env.DB.prepare("SELECT idea, kind, image_keys, composed_key FROM renders WHERE id = ? AND batch = ?")
        .bind(v.key.split("/")[1] ?? "", batchId)
        .first<{ idea: string | null; kind: string; image_keys: string | null; composed_key: string | null }>();
      // The key must be a saved picture of the render: one of its images, or its composed final.
      const saved = !!render && ((JSON.parse(render.image_keys ?? "[]") as string[]).includes(v.key) || render.composed_key === v.key);
      if (!render || !saved) throw new Error(`${where}: ${v.key} is not a picture of this batch.`);
      if (v.stage === "final" && render.kind === "draft") throw new Error(`${where}: ${v.key} is a draft, not a final picture.`);
      if (ideaId && render.idea && render.idea !== ideaId) throw new Error(`${where}: ${v.key} is a picture of another idea.`);
      ideaId ??= render.idea;
    }
    let packId: string | null = null;
    if (v.packVersion !== undefined) {
      const pack = await env.DB.prepare("SELECT id FROM packs WHERE batch_id = ? AND version = ?").bind(batchId, v.packVersion).first<{ id: string }>();
      if (!pack) throw new Error(`${where}: this batch has no pack version ${v.packVersion}.`);
      packId = pack.id;
    }
    out.push(
      env.DB.prepare(
        `INSERT INTO verdicts (id, batch_id, idea_id, render_key, pack_id, stage, mark, owner_said, notes, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(crypto.randomUUID(), batchId, ideaId, v.key ?? null, packId, v.stage, v.mark, v.ownerSaid, v.notes ?? null, at),
    );
  }
  return out;
}

export async function batchUpdate(
  env: Env,
  input: { id: string; status?: string; insights?: unknown[]; notes?: string; ownerVerdicts?: OwnerVerdict[] },
) {
  // Every picked idea with drafts must have its final prompt before the picks are made (D2: Claude picks the drafts).
  if (input.status === "board") {
    const b = await env.DB.prepare("SELECT engine FROM batches WHERE id = ?").bind(input.id).first<{ engine: number }>();
    // Engine 3: exactly 3 picked ideas in any mix of roles (design pack §2.6). The direction and draft checks come with Phase 3.
    if (b?.engine === 3) {
      const p = await env.DB.prepare("SELECT COUNT(*) AS n FROM ideas WHERE batch_id = ? AND picked = 1").bind(input.id).first<{ n: number }>();
      if (p?.n !== 3) throw new Error(`An engine 3 batch needs exactly 3 picked ideas before status 'board' (it has ${p?.n ?? 0}).`);
    }
    // An engine 2 funnel batch needs exactly one picked idea per stage. Batches made before the stages are exempt.
    const counts = b?.engine === 3 ? { results: [] } : await env.DB.prepare(
      "SELECT format, SUM(picked) AS n FROM ideas WHERE batch_id = ? AND format IN ('tof', 'mof', 'bof') GROUP BY format",
    ).bind(input.id).all<{ format: string; n: number }>();
    if (counts.results.length) {
      const n = new Map(counts.results.map((r) => [r.format, r.n]));
      const missing = FORMATS.filter((f) => n.get(f) !== 1);
      if (missing.length) throw new Error(`Pick exactly one idea for each stage before status 'board' (missing: ${missing.join(", ")}).`);
    }
    const notReady = await env.DB.prepare(
      `SELECT i.n FROM ideas i WHERE i.batch_id = ? AND i.picked = 1 AND i.final_prompt IS NULL
       AND EXISTS (SELECT 1 FROM renders r WHERE r.batch = i.batch_id AND r.idea = i.id AND r.kind = 'draft' AND r.image_keys IS NOT NULL)`,
    ).bind(input.id).all<{ n: number }>();
    if (notReady.results.length) {
      throw new Error(`Set finalPrompt (ideas_update) for picked idea(s) ${notReady.results.map((r) => r.n).join(", ")} before status 'board'.`);
    }
  }
  const sets: string[] = [];
  const args: unknown[] = [];
  if (input.status) (sets.push("status = ?"), args.push(input.status));
  if (input.insights) (sets.push("insights = ?"), args.push(JSON.stringify(input.insights)));
  if (input.notes !== undefined) (sets.push("notes = ?"), args.push(input.notes));
  const verdicts = input.ownerVerdicts ?? [];
  if (sets.length === 0 && verdicts.length === 0) throw new Error("Nothing to update.");
  // An unknown batch is refused, and every verdict is checked, before anything is written.
  if (!(await env.DB.prepare("SELECT 1 FROM batches WHERE id = ?").bind(input.id).first())) throw new Error(`No batch with id ${input.id}.`);
  const inserts = await verdictInserts(env, input.id, verdicts);
  // One D1 batch is one transaction: the batch row and its verdicts are saved together or not at all.
  const [res] = await env.DB.batch([
    env.DB.prepare(`UPDATE batches SET ${[...sets, "updated_at = ?"].join(", ")} WHERE id = ?`).bind(...args, now(), input.id),
    ...inserts,
  ]);
  if (res?.meta.changes !== 1) throw new Error(`No batch with id ${input.id}.`);
  return { id: input.id, updated: sets.map((s) => s.split(" ")[0]), verdictsSaved: verdicts.length };
}

export interface IdeaInput {
  format: (typeof FORMATS)[number];
  insight: string;
  sourceUrl?: string;
  visual: string;
  headline: string;
  copy?: Record<string, unknown>;
  picked?: boolean;
  /** Engine 3 only: the concept fields (a11-engine v3 design pack §2.3). */
  concept?: Concept;
}

export async function ideasSave(env: Env, batchId: string, ideas: IdeaInput[]) {
  return (await ideasSaveFull(env, batchId, ideas)).ideas;
}

/**
 * Save ideas. An engine 2 batch takes the old shape only. An engine 3 batch takes concepts: each idea has its concept,
 * and the first save has the territories (design pack §2.2, §2.3). The ideas and the territories record are one D1
 * batch: all or nothing.
 */
export async function ideasSaveFull(env: Env, batchId: string, ideas: IdeaInput[], territories?: Territory[], promptVersion = "") {
  const batch = await env.DB.prepare("SELECT id, subject_id, engine FROM batches WHERE id = ?").bind(batchId).first<{ id: string; subject_id: string; engine: number }>();
  if (!batch) throw new Error(`No batch with id ${batchId}.`);
  if (batch.engine !== 3 && (territories || promptVersion || ideas.some((i) => i.concept)))
    throw new InputError("territories, concept and promptVersion are for an engine 3 batch only. This batch is engine 2: save the ideas without them.");
  // Read the idea numbers before the checks: a save that commits between this read and the insert takes the same
  // numbers, so UNIQUE (batch_id, n) refuses this whole save when another ideas save of the batch commits in between.
  // (A brief saved in between is not caught: the concepts then carry the brief version that they were checked against.)
  const max = await env.DB.prepare("SELECT COALESCE(MAX(n), 0) AS n FROM ideas WHERE batch_id = ?").bind(batchId).first<{ n: number }>();
  const v3 = batch.engine === 3 ? await checkConcepts(env, batch, ideas, territories, promptVersion) : null;
  const at = now();
  const saved = ideas.map((idea, i) => ({ id: crypto.randomUUID(), n: (max?.n ?? 0) + i + 1, ...idea, concept: v3?.concepts[i] ?? {} }));
  const stmts = saved.map((s) =>
    env.DB.prepare(
      `INSERT INTO ideas (id, batch_id, n, format, insight, source_url, visual, headline, copy, picked, created_at, concept)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(s.id, batchId, s.n, s.format, s.insight, s.sourceUrl ?? null, s.visual, s.headline, JSON.stringify(s.copy ?? {}), s.picked ? 1 : 0, at, JSON.stringify(s.concept)),
  );
  if (v3?.record)
    // The next version in the same statement, so two saves at the same time cannot get one number.
    stmts.push(
      env.DB.prepare(
        `INSERT INTO batch_records (id, batch_id, kind, idea_id, version, body, author, prompt_version, created_at)
         SELECT ?, ?, 'territories', NULL, COALESCE(MAX(version), 0) + 1, ?, 'writer', ?, ? FROM batch_records
         WHERE batch_id = ? AND kind = 'territories' AND idea_id IS NULL`,
      ).bind(crypto.randomUUID(), batchId, JSON.stringify(v3.record), promptVersion, at, batchId),
    );
  try {
    await env.DB.batch(stmts);
  } catch (e) {
    if (/UNIQUE/i.test((e as Error).message) && /ideas/i.test((e as Error).message))
      throw new InputError("Another save of this batch ran at the same time, and nothing of this save was kept. Read batch_get and save again.");
    throw e;
  }
  return {
    engine: batch.engine,
    ideas: saved.map((s) => ({ id: s.id, n: s.n, format: s.format, headline: s.headline, picked: !!s.picked })),
    warnings: v3?.warnings ?? [],
  };
}

export interface IdeaUpdate {
  id: string;
  picked?: boolean;
  finalPrompt?: string;
  finalRefs?: string[];
  /** The owner's change to the words on the picture. */
  headline?: string;
  subline?: string;
  /** The owner's exact words when he approved this idea's headline and subline (the copy review). */
  copyApproved?: string;
}

export async function ideasUpdate(env: Env, updates: IdeaUpdate[]) {
  const stmts: D1PreparedStatement[] = [];
  const owner: (string | null)[] = []; // the idea id each statement must change (null: a statement that may change nothing)
  for (const u of updates) {
    // Before the owner's first change of the words, keep the words as written (copy.written, once), so the copy
    // correction rate can be measured (a11-engine v3 design pack §2.7).
    if (u.headline !== undefined || u.subline !== undefined) {
      stmts.push(
        env.DB.prepare(
          `UPDATE ideas SET copy = json_set(copy, '$.written', json_object('headline', headline, 'subline', COALESCE(json_extract(copy, '$.subline'), '')))
           WHERE id = ? AND json_extract(copy, '$.written') IS NULL`,
        ).bind(u.id),
      );
      owner.push(null);
    }
    const sets: string[] = [];
    const args: unknown[] = [];
    if (u.picked !== undefined) (sets.push("picked = ?"), args.push(u.picked ? 1 : 0));
    if (u.finalPrompt !== undefined) (sets.push("final_prompt = ?"), args.push(u.finalPrompt));
    if (u.finalRefs !== undefined) (sets.push("final_refs = ?"), args.push(JSON.stringify(u.finalRefs)));
    if (u.headline !== undefined) (sets.push("headline = ?"), args.push(u.headline));
    if (u.subline !== undefined) (sets.push("copy = json_set(copy, '$.subline', ?)"), args.push(u.subline));
    if (sets.length === 0 && u.copyApproved === undefined) throw new Error(`Nothing to update for idea ${u.id}.`);
    if (sets.length) (stmts.push(env.DB.prepare(`UPDATE ideas SET ${sets.join(", ")} WHERE id = ?`).bind(...args, u.id)), owner.push(u.id));
    // A second statement, so the approval keeps the words as they are after the change above.
    if (u.copyApproved !== undefined) {
      stmts.push(
        env.DB.prepare(
          `UPDATE ideas SET copy = json_set(copy, '$.ownerApproved',
             json_object('headline', headline, 'subline', COALESCE(json_extract(copy, '$.subline'), ''), 'ownerSaid', ?, 'at', ?))
           WHERE id = ?`,
        ).bind(u.copyApproved, now(), u.id),
      );
      owner.push(u.id);
    }
  }
  const res = await env.DB.batch(stmts);
  const missing = [...new Set(owner.filter((id, i): id is string => id !== null && res[i]?.meta.changes !== 1))];
  if (missing.length) throw new Error(`No idea with id: ${missing.join(", ")}.`);
  return { updated: updates.length };
}

/**
 * The copy review (owner, 12-11-2026: "ill approve of the headlines and all copywriting that goes on the ad images").
 * A draft is rendered only for an idea whose headline and subline the owner approved, as they are now.
 */
export async function copyApprovedCheck(env: Env, batchId: string, ideaId: string) {
  const row = await env.DB.prepare("SELECT headline, copy, picked FROM ideas WHERE id = ? AND batch_id = ?")
    .bind(ideaId, batchId)
    .first<{ headline: string; copy: string; picked: number }>();
  if (!row) throw new Error(`No idea ${ideaId} in batch ${batchId}. A draft belongs to an idea of its batch.`);
  // A paid draft only for an idea the critic picked (a11-engine v3 design pack §2.6).
  if (row.picked !== 1) throw new Error(`Idea ${ideaId} is not picked. Drafts are made only for the picked ideas of a batch.`);
  const copy = JSON.parse(row.copy) as { subline?: string; ownerApproved?: { headline: string; subline: string } };
  const ok = copy.ownerApproved;
  if (!copy.subline?.trim())
    throw new Error(`Idea ${ideaId} has no subline. Every ad has one (the owner found ads without one incomplete): set it, show it to the owner, and save his approval.`);
  if (!ok)
    throw new Error(
      `The owner has not approved the words of idea ${ideaId}. Show him the headline and subline as text first (docs/creative-playbook.md §8, copy review), then save his words with ideas_update copyApproved.`,
    );
  if (ok.headline !== row.headline || ok.subline !== copy.subline)
    throw new Error(`The words of idea ${ideaId} changed after the owner approved them. Show him the new words and save his approval again.`);
}

/**
 * The critic's pick. Engine 2: set picked on ideas of one batch; it cannot unpick, write a prompt or touch another batch
 * (the pick limit, 1 per stage, still holds). Engine 3: the concept review and the 3 picks with their roles (worker/review.ts).
 */
export async function ideasPick(env: Env, batchId: string, ids: string[] = [], v3: PickInput = {}) {
  const batch = await env.DB.prepare("SELECT engine FROM batches WHERE id = ?").bind(batchId).first<{ engine: number }>();
  if (!batch) throw new Error(`No batch with id ${batchId}.`);
  if (batch.engine === 3) return conceptPick(env, batchId, ids, v3);
  if (Object.values(v3).some((v) => v !== undefined))
    throw new InputError("outcome, roles, reserves, review, promptVersion and ownerSwap are for an engine 3 batch only. This batch is engine 2: send the ids only.");
  if (!ids.length) throw new InputError("Name 1 to 3 ideas to pick.");
  if (new Set(ids).size !== ids.length) throw new Error("Each idea id may appear only once.");
  // Check every id first, so a wrong id never leaves the others picked.
  const rows = await env.DB.prepare("SELECT id FROM ideas WHERE batch_id = ? AND id IN (SELECT value FROM json_each(?))").bind(batchId, JSON.stringify(ids)).all<{ id: string }>();
  const found = new Set(rows.results.map((r) => r.id));
  const missing = ids.filter((id) => !found.has(id));
  if (missing.length) throw new Error(`No idea of batch ${batchId} with id: ${missing.join(", ")}.`);
  await env.DB.batch(ids.map((id) => env.DB.prepare("UPDATE ideas SET picked = 1 WHERE id = ? AND batch_id = ?").bind(id, batchId)));
  return { batchId, picked: ids };
}

interface DraftRow {
  id: string;
  idea: string;
  image_keys: string | null;
}

/** The batch's finished draft images, as key → idea id. */
async function draftKeys(env: Env, batchId: string): Promise<Map<string, string>> {
  // Only renders whose idea belongs to this same batch count (render_submit takes free-form ids).
  const rows = await env.DB.prepare(
    `SELECT r.id, r.idea, r.image_keys FROM renders r JOIN ideas i ON i.id = r.idea AND i.batch_id = r.batch
     WHERE r.batch = ? AND r.kind = 'draft' AND r.image_keys IS NOT NULL LIMIT ${MAX_BATCH_RENDERS}`,
  ).bind(batchId).all<DraftRow>();
  const map = new Map<string, string>();
  for (const r of rows.results) for (const k of JSON.parse(r.image_keys!) as string[]) map.set(k, r.idea);
  return map;
}

export async function draftsRank(env: Env, batchId: string, ranks: { key: string; rank: number; reason?: string }[]) {
  const keys = await draftKeys(env, batchId);
  const at = now();
  const stmts = ranks.map((r) => {
    const ideaId = keys.get(r.key);
    if (!ideaId) throw new Error(`${r.key} is not a finished draft of batch ${batchId}.`);
    return env.DB.prepare(
      `INSERT INTO draft_ranks (render_key, batch_id, idea_id, rank, reason, created_at) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT (render_key) DO UPDATE SET rank = excluded.rank, reason = excluded.reason, created_at = excluded.created_at`,
    ).bind(r.key, batchId, ideaId, r.rank, r.reason ?? null, at);
  });
  await env.DB.batch(stmts);
  return { ranked: ranks.length };
}

/**
 * The owner's picks (2026-11-07: the owner picks 1 of the 3 drafts per idea; Claude never picks for him).
 * Picks that already have a final render stay; other old picks not in the list are removed.
 * Returns how each pick compares with the critic's blind rank, and the running tally over all batches.
 */
export async function picksSave(env: Env, batchId: string, picks: { key: string; note?: string }[]) {
  const keys = await draftKeys(env, batchId);
  const at = now();
  for (const p of picks) if (!keys.has(p.key)) throw new Error(`${p.key} is not a finished draft of batch ${batchId}.`);
  // One draft per idea in a call: each pick becomes a paid final.
  const ideaIds = picks.map((p) => keys.get(p.key)!);
  if (new Set(ideaIds).size !== ideaIds.length) throw new Error("Pick one draft per idea.");
  // A pick that has a final stays, so another draft of that idea would start a second paid final.
  const finalled = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM picks WHERE batch_id = ? AND final_render_id IS NOT NULL
     AND idea_id IN (SELECT value FROM json_each(?)) AND render_key NOT IN (SELECT value FROM json_each(?))`,
  ).bind(batchId, JSON.stringify(ideaIds), JSON.stringify(picks.map((p) => p.key))).first<{ n: number }>();
  if (finalled?.n) throw new Error("An idea in this call already has a final. To render it again, use render_submit (kind 'final').");
  const listed = picks.map((p) => p.key);
  const stmts = [
    env.DB.prepare(
      `DELETE FROM picks WHERE batch_id = ? AND final_render_id IS NULL AND render_key NOT IN (SELECT value FROM json_each(?))`,
    ).bind(batchId, JSON.stringify(listed)),
    ...picks.map((p) =>
      env.DB.prepare(
        `INSERT INTO picks (render_key, batch_id, idea_id, note, by_owner, created_at) VALUES (?, ?, ?, ?, 1, ?)
         ON CONFLICT (render_key) DO UPDATE SET note = excluded.note, by_owner = 1`,
      ).bind(p.key, batchId, keys.get(p.key)!, p.note ?? null, at),
    ),
  ];
  await env.DB.batch(stmts);
  const ranks = await env.DB.prepare(
    "SELECT render_key, rank FROM draft_ranks WHERE batch_id = ? AND render_key IN (SELECT value FROM json_each(?))",
  ).bind(batchId, JSON.stringify(listed)).all<{ render_key: string; rank: number }>();
  const rankOf = new Map(ranks.results.map((r) => [r.render_key, r.rank]));
  return {
    picks: listed.length,
    review: picks.map((p) => ({ key: p.key, criticRank: rankOf.get(p.key) ?? null, agreed: rankOf.get(p.key) === 1 })),
    tally: await tasteTally(env),
  };
}

/** How often the owner's pick was the critic's rank 1, over every owner pick that has a rank. */
async function tasteTally(env: Env) {
  const r = await env.DB.prepare(
    `SELECT COUNT(*) AS reviewed, COALESCE(SUM(d.rank = 1), 0) AS agreed
     FROM picks p JOIN draft_ranks d ON d.render_key = p.render_key WHERE p.by_owner = 1`,
  ).first<{ reviewed: number; agreed: number }>();
  return { reviewed: r?.reviewed ?? 0, agreed: r?.agreed ?? 0 };
}

/**
 * What the owner chose and what he passed over, newest first, so the next ideas and ranks learn from it.
 * Each row has his words, the critic's rank and reason for the chosen draft, and the same for the drafts he passed.
 */
export async function tasteLog(env: Env, limit = 30) {
  const picks = await env.DB.prepare(
    `SELECT p.render_key, p.idea_id, p.batch_id, p.note, p.created_at, i.format, i.headline, i.visual, b.label
     FROM picks p JOIN ideas i ON i.id = p.idea_id AND i.batch_id = p.batch_id JOIN batches b ON b.id = p.batch_id
     WHERE p.by_owner = 1 ORDER BY p.created_at DESC LIMIT ?`,
  ).bind(limit).all<Record<string, any>>();
  const ideaIds = [...new Set(picks.results.map((p) => p.idea_id as string))];
  const ranks = await env.DB.prepare(
    "SELECT render_key, idea_id, rank, reason FROM draft_ranks WHERE idea_id IN (SELECT value FROM json_each(?)) ORDER BY rank",
  ).bind(JSON.stringify(ideaIds)).all<{ render_key: string; idea_id: string; rank: number; reason: string | null }>();
  const verdicts = await env.DB.prepare(
    `SELECT v.created_at, v.stage, v.mark, v.source_mark, v.owner_said, v.notes, v.render_key, b.label, i.format, i.headline, pk.version
     FROM verdicts v LEFT JOIN batches b ON b.id = v.batch_id LEFT JOIN ideas i ON i.id = v.idea_id LEFT JOIN packs pk ON pk.id = v.pack_id
     ORDER BY v.created_at DESC, v.rowid DESC LIMIT ?`,
  ).bind(limit).all<Record<string, any>>();
  return {
    tally: await tasteTally(env),
    verdicts: verdicts.results.map((v) => ({
      at: v.created_at,
      batch: v.label ?? null,
      stage: v.stage,
      mark: v.mark,
      sourceMark: v.source_mark,
      ownerSaid: v.owner_said,
      notes: v.notes,
      idea: v.format ? { stage: v.format, headline: v.headline } : null,
      key: v.render_key,
      packVersion: v.version ?? null,
    })),
    picks: picks.results.map((p) => {
      const mine = ranks.results.filter((r) => r.idea_id === p.idea_id);
      const chosen = mine.find((r) => r.render_key === p.render_key);
      return {
        batch: p.label,
        stage: p.format,
        headline: p.headline,
        visual: p.visual,
        at: p.created_at,
        ownerSaid: p.note,
        chosen: { key: p.render_key, criticRank: chosen?.rank ?? null, criticReason: chosen?.reason ?? null },
        passed: mine.filter((r) => r.render_key !== p.render_key).map((r) => ({ key: r.render_key, criticRank: r.rank, criticReason: r.reason })),
      };
    }),
  };
}

/**
 * Start the high final for one picked draft: the idea's final prompt, the draft as the first reference
 * (so the layout stays), then the idea's extra references (a texture photo, only when its product state matches).
 */
export async function finalRender(env: Env, batchId: string, key: string) {
  const pick = await env.DB.prepare(
    `SELECT p.idea_id, p.final_render_id, i.final_prompt, i.final_refs FROM picks p JOIN ideas i ON i.id = p.idea_id
     WHERE p.batch_id = ? AND p.render_key = ?`,
  ).bind(batchId, key).first<{ idea_id: string; final_render_id: string | null; final_prompt: string | null; final_refs: string }>();
  if (!pick) throw new Error(`${key} is not a pick of batch ${batchId}.`);
  const held = pick.final_render_id;
  if (held?.startsWith("accepted:"))
    return { id: null, status: "already started", note: "fal accepted this final but its row was not saved; tell the owner; do not submit again." };
  // A claim with a time (pending:<ISO time>:<uuid>) can go stale. An old claim (pending:<uuid>) has no time: it stays as it is.
  const claimedAt = held?.match(/^pending:(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z):/)?.[1];
  const stale = claimedAt ? held! : null;
  if (held && !stale) return { id: held.startsWith("pending:") ? null : held, status: "already started" };
  if (stale && claimedAt) {
    if (Date.now() - Date.parse(claimedAt) < 120_000) return { id: null, status: "already started" };
    // Take a stale claim over only when no paid job can exist for it. A final made since the claim is that job: adopt it.
    const made = await env.DB.prepare(
      "SELECT id FROM renders WHERE batch = ? AND idea = ? AND kind = 'final' AND created_at >= ? ORDER BY created_at LIMIT 1",
    ).bind(batchId, pick.idea_id, claimedAt).first<{ id: string }>();
    if (made) {
      await env.DB.batch([
        env.DB.prepare("UPDATE picks SET final_render_id = ? WHERE render_key = ? AND final_render_id = ?").bind(made.id, key, stale),
        env.DB.prepare("UPDATE batches SET status = 'finals', updated_at = ? WHERE id = ? AND status IN ('drafts', 'board')").bind(now(), batchId),
      ]);
      return { id: made.id, status: "already started" };
    }
  }
  if (!pick.final_prompt) throw new Error(`Idea ${pick.idea_id} has no final prompt. Set it with ideas_update.`);
  // Claim the pick before the paid call, so two taps (or a retry) cannot start two finals.
  const claim = `pending:${new Date().toISOString()}:${crypto.randomUUID()}`;
  const claimed = await (stale
    ? env.DB.prepare("UPDATE picks SET final_render_id = ? WHERE render_key = ? AND final_render_id = ?").bind(claim, key, stale)
    : env.DB.prepare("UPDATE picks SET final_render_id = ? WHERE render_key = ? AND final_render_id IS NULL").bind(claim, key)
  ).run();
  if (claimed.meta.changes !== 1) return { id: null, status: "already started" };
  const refs = [fal.mediaUrl(env, key), ...(JSON.parse(pick.final_refs) as string[])];
  let r: Awaited<ReturnType<typeof fal.submit>>;
  try {
    r = await fal.submit(env, { batch: batchId, idea: pick.idea_id, kind: "final", prompt: pick.final_prompt, referenceUrls: refs, numImages: 1 });
  } catch (e) {
    // fal took the job (billed) but its row was not saved: keep the pick closed for ever, so no second final is paid.
    // Any other error: fal did not take the job, so free the pick and the owner can tap Render again.
    const mark = () =>
      env.DB.prepare("UPDATE picks SET final_render_id = ? WHERE render_key = ? AND final_render_id = ?")
        .bind(e instanceof fal.AcceptedError ? `accepted:${e.renderId}` : null, key, claim)
        .run();
    // Try the write twice. If both fail after fal took the job, say so: the claim then goes stale and could be paid again.
    await mark().catch(mark).catch((w) => {
      if (e instanceof fal.AcceptedError)
        throw new fal.AcceptedError(`${e.message} The pick was not closed (${(w as Error).message}): do not tap Render for it.`, e.renderId);
    });
    throw e;
  }
  await env.DB.batch([
    env.DB.prepare("UPDATE picks SET final_render_id = ? WHERE render_key = ? AND final_render_id = ?").bind(r.id, key, claim),
    env.DB.prepare("UPDATE batches SET status = 'finals', updated_at = ? WHERE id = ? AND status IN ('drafts', 'board')").bind(now(), batchId),
  ]);
  return r;
}

export async function batchList(env: Env, brandSlug?: string) {
  const sql = `SELECT b.id, b.label, b.status, b.created_at AS createdAt, br.slug AS brandSlug, br.name AS brandName
    FROM batches b JOIN brands br ON br.id = b.brand_id ${brandSlug ? "WHERE br.slug = ?" : ""} ORDER BY b.created_at DESC LIMIT 30`;
  const stmt = env.DB.prepare(sql);
  return (await (brandSlug ? stmt.bind(brandSlug) : stmt).all()).results;
}

/** A stable order for one batch that is not the order the writer gave (FNV-1a, 32 bit). */
function shuffleKey(s: string) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193) >>> 0;
  return h;
}

/**
 * The critic's view of a batch (a11-engine v3 design pack §2.5): what it needs to judge, and nothing that shows
 * a favourite. No batch notes, no picks or finals, no owner words, no rank or reason (also not of decided ideas),
 * no final prompt, and the ideas in a stable shuffled order without their numbers.
 */
export async function batchGetCritic(env: Env, id: string) {
  // conceptReview is left out too: the critic judges every concept again from the concepts alone.
  const { notes: _notes, picks: _picks, conceptReview: _cr, ideas, ...rest } = await batchGet(env, id);
  return {
    ...rest,
    view: "critic" as const,
    ideas: ideas
      .map(({ n: _n, finals: _f, finalPrompt: _fp, finalRefs: _fr, copy, drafts, ...i }) => {
        const { ownerApproved: _oa, written: _w, ...words } = (copy ?? {}) as Record<string, unknown>;
        return { ...i, copy: words, drafts: drafts.map(({ key, url }) => ({ key, url })) };
      })
      .sort((a, b) => shuffleKey(`${id}:${a.id}`) - shuffleKey(`${id}:${b.id}`)),
  };
}

/** Everything about one batch, for Claude and for the board. */
export async function batchGet(env: Env, id: string) {
  const b = await env.DB.prepare(
    `SELECT b.*, br.slug AS brand_slug, br.name AS brand_name FROM batches b JOIN brands br ON br.id = b.brand_id WHERE b.id = ?`,
  ).bind(id).first<Record<string, any>>();
  if (!b) throw new Error(`No batch with id ${id}.`);
  const [subject, ideas, renders, ranks, picks, passes, kit] = await Promise.all([
    env.DB.prepare("SELECT id, kind, title, url, data FROM subjects WHERE id = ?").bind(b.subject_id).first<Record<string, any>>(),
    env.DB.prepare("SELECT * FROM ideas WHERE batch_id = ? ORDER BY n LIMIT 60").bind(id).all<Record<string, any>>(),
    env.DB.prepare(
      `SELECT id, idea, kind, status, image_keys, composed_key, error, usd_est, created_at FROM renders WHERE batch = ? ORDER BY created_at, rowid LIMIT ${MAX_BATCH_RENDERS}`,
    ).bind(id).all<Record<string, any>>(),
    env.DB.prepare("SELECT render_key, idea_id, rank, reason FROM draft_ranks WHERE batch_id = ? LIMIT 200").bind(id).all<Record<string, any>>(),
    env.DB.prepare("SELECT render_key, idea_id, note, by_owner, final_render_id, created_at FROM picks WHERE batch_id = ? LIMIT 100").bind(id).all<Record<string, any>>(),
    // The owner's newest full pass on each idea's drafts (docs/design/owner-verdicts.md).
    env.DB.prepare(
      "SELECT idea_id, MAX(created_at) AS at FROM verdicts WHERE batch_id = ? AND stage = 'draft' AND mark = 'pass' GROUP BY idea_id LIMIT 60",
    ).bind(id).all<{ idea_id: string; at: string }>(),
    latestKit(env, b.brand_id, b.kit_version),
  ]);
  const rankBy = new Map(ranks.results.map((r) => [r.render_key, r]));
  const pickBy = new Map(picks.results.map((p) => [p.render_key, p]));
  // The blind rank is held on the server until the owner decides (a11-engine v3 design pack §4.3): an owner pick on the idea
  // shows the rank of all its drafts; a full pass shows it only for the drafts that existed when he passed. No flag turns this off.
  const ownerPicked = new Set(picks.results.filter((p) => p.by_owner === 1).map((p) => p.idea_id as string));
  const passedAt = new Map(passes.results.map((p) => [p.idea_id, p.at]));
  const img = (key: string) => ({ key, url: fal.mediaUrl(env, key) });
  const [brief, conceptReview] = await Promise.all([briefGet(env, id), conceptReviewGet(env, id)]);
  const currentDrafts = new Map<string, number>();
  const ideasOut = ideas.results.map((i) => {
    const drafts = renders.results
      .filter((r) => r.idea === i.id && r.kind === "draft")
      .flatMap((r) => (r.image_keys ? (JSON.parse(r.image_keys) as string[]).map((key) => ({ key, at: r.created_at as string })) : []));
    const passed = passedAt.get(i.id);
    const shown = (at: string) => ownerPicked.has(i.id) || (passed !== undefined && at <= passed);
    // ranked: the critic's rank of the newest 3 current drafts is saved (the critic ranks the newest 3; after a full pass,
    // only the drafts made since count).
    const current = drafts.filter((d) => passed === undefined || d.at > passed);
    const newest = (current.length ? current : drafts).slice(-3);
    currentDrafts.set(i.id, current.length);
    return {
      id: i.id,
      n: i.n,
      format: i.format,
      insight: i.insight,
      sourceUrl: i.source_url,
      visual: i.visual,
      headline: i.headline,
      copy: JSON.parse(i.copy),
      // Engine 3: the concept fields; an engine 2 idea has {}.
      concept: JSON.parse(i.concept ?? "{}"),
      picked: i.picked === 1,
      finalPrompt: i.final_prompt,
      finalRefs: JSON.parse(i.final_refs),
      ranked: newest.length > 0 && newest.every((d) => rankBy.has(d.key)),
      // Submit order, then image order. Never rank order: the order must not show the critic's rank.
      // rank and reason are null until the owner decides on the idea (see shown above).
      drafts: drafts.map(({ key, at }) => ({
        ...img(key),
        rank: shown(at) ? (rankBy.get(key)?.rank ?? null) : null,
        reason: shown(at) ? (rankBy.get(key)?.reason ?? null) : null,
        picked: pickBy.has(key),
      })),
      finals: renders.results
        .filter((r) => r.idea === i.id && r.kind === "final")
        .map((r) => ({
          id: r.id,
          status: r.status,
          error: r.error,
          images: (r.image_keys ? (JSON.parse(r.image_keys) as string[]) : []).map(img),
          composed: r.composed_key?.startsWith("renders/") ? img(r.composed_key) : null,
          composeError: r.composed_key?.startsWith("error:") ? r.composed_key.slice(6) : null,
        })),
    };
  });
  const engine = (b.engine as number | undefined) ?? 2;
  return {
    id: b.id,
    label: b.label,
    status: b.status,
    brand: { slug: b.brand_slug, name: b.brand_name, kitVersion: b.kit_version },
    kit: kit?.kit ?? null,
    subject: subject && { ...subject, data: JSON.parse(subject.data) },
    facts: await factsGet(env, b.subject_id),
    // a11-engine v3 Phase 1: the engine (2 for every batch made before engine 3), the newest brief and the research
    // sources (no text). brief is null when no brief is saved (the usual case for an engine 2 batch).
    engine,
    brief,
    sources: await sourcesList(env, id),
    // Engine 3: the newest territories list with its version, or null.
    territories: await territoriesGet(env, id),
    // Engine 3: the critic's newest concept review (with reworks, the number of rework rounds), or null.
    conceptReview,
    insights: JSON.parse(b.insights),
    notes: b.notes,
    ideas: ideasOut,
    picks: picks.results.map((p) => ({ key: p.render_key, ideaId: p.idea_id, note: p.note, byOwner: p.by_owner === 1, finalRenderId: p.final_render_id })),
    drafting: renders.results.filter((r) => r.status === "queued").map((r) => r.id),
    // Engine 3 only: the next step of the batch, from its rows (design pack §1.11). Engine 2 batches have none.
    ...(engine === 3 ? { nextStep: nextStepV3(b.status as string, brief !== null, ideasOut.map((i) => ({ ...i, currentDrafts: currentDrafts.get(i.id) ?? 0 })), ownerPicked, conceptReview && { outcome: conceptReview.outcome, reworks: conceptReview.reworks, newIdeas: ideas.results.some((i) => i.created_at > conceptReview.savedAt) }) } : {}),
  };
}

type IdeaState = { id: string; picked: boolean; copy: { ownerApproved?: unknown }; ranked: boolean; currentDrafts: number; finals: { status: unknown }[] };

/** The first step of an engine 3 batch that is not done yet. Pure: it reads only the rows that batchGet has read. */
export function nextStepV3(
  status: string,
  hasBrief: boolean,
  ideas: IdeaState[],
  ownerPicked: Set<string>,
  review: { outcome: string; reworks: number; newIdeas: boolean } | null = null,
): string {
  const picked = ideas.filter((i) => i.picked);
  if (!hasBrief) return "brief";
  if (ideas.length === 0) return "concepts";
  // The critic rejected the set: the writer adds concepts (concepts_rework). After 3 rework rounds the owner decides
  // (more research, another product angle, or stop). Concepts saved after the review go back to the critic.
  if (review?.outcome === "rework" && !review.newIdeas) return review.reworks >= 3 ? "owner_decision" : "concepts_rework";
  if (picked.length < 3) return "concept_review";
  if (picked.some((i) => !i.copy.ownerApproved)) return "copy_review";
  if (picked.some((i) => i.currentDrafts < 3)) return "drafts";
  if (picked.some((i) => !i.ranked)) return "draft_rank";
  if (!["board", "finals", "done"].includes(status)) return "board";
  if (picked.some((i) => !ownerPicked.has(i.id))) return "owner_pick";
  // A queued or failed final is not a final: the step is done only when each picked idea has a finished one.
  if (picked.some((i) => !i.finals.some((f) => f.status === "done"))) return "finals";
  return "done";
}

