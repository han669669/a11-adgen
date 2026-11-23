import { brandBySlug, latestKit } from "./brand";
import type { Env } from "./env";
import { checkConcepts, type Concept, type Territory, territoriesGet } from "./concepts";
import { briefGet, factMarks, sourcesList } from "./research";
import { rankStamp } from "./calibration";
import { checksGet, directionRounds, finalReady } from "./checks";
import { directionsGet, draftPlans } from "./direction";
import { conceptPick, conceptReviewGet, type PickInput } from "./review";
import { InputError } from "./schema";
import * as fal from "./fal";
import { storeSubjectImages } from "./subjectimages";
import { copyWarnings } from "./copycheck";

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
  // a11-engine v3 Phase 5 (lasting product): a product page that this brand already has a subject for is the same
  // product, so its facts and lessons carry over. Images or notes make a new subject, as before (they belong to that batch).
  if (input.kind === "product" && input.url && !input.imageUrls?.length && !input.notes) {
    const url = productUrlKey(input.url);
    const earlier = await env.DB.prepare(
      "SELECT id, title, url, data, created_at FROM subjects WHERE brand_id = ? AND kind = 'product' AND url IS NOT NULL ORDER BY created_at DESC, rowid DESC",
    ).bind(brand.id).all<{ id: string; title: string; url: string; data: string; created_at: string }>();
    // Only a plain earlier subject (no images, no notes) is the product: images and notes belong to their own batch.
    const plain = (d: string) => {
      const x = JSON.parse(d) as { imageKeys?: string[]; imageUrls?: string[]; notes?: string };
      return !x.imageKeys?.length && !x.imageUrls?.length && !x.notes;
    };
    const same = earlier.results.find((r) => productUrlKey(r.url) === url && plain(r.data));
    if (same) {
      const facts = await env.DB.prepare("SELECT COUNT(*) AS n FROM facts WHERE subject_id = ?").bind(same.id).first<{ n: number }>();
      return { id: same.id, brandSlug: brand.slug, kind: input.kind, title: same.title, imageKeys: [], imageErrors: [], reused: true, since: same.created_at, facts: facts?.n ?? 0 };
    }
  }
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
  return { id, brandSlug: brand.slug, kind: input.kind, title: input.title, imageKeys, imageErrors, reused: false };
}

/** A product page URL as a key: the host in lower case, no fragment, no trailing slash. The query stays (it can name a variant). */
function productUrlKey(u: string) {
  try {
    const x = new URL(u);
    return `${x.protocol}//${x.host.toLowerCase()}${x.pathname.replace(/\/+$/, "")}${x.search}`;
  } catch {
    return u;
  }
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
    // The newest 200, oldest first: a lasting product (subject_save reused) keeps growing, and the new facts must show.
    "SELECT * FROM (SELECT id, label, value, quote, source_url AS sourceUrl, created_at AS retrievedAt, verified FROM facts WHERE subject_id = ? ORDER BY id DESC LIMIT 200) ORDER BY id",
  ).bind(subjectId).all<Record<string, unknown>>();
  return rows.results.map((r) => ({ ...r, verified: r.verified === null || r.verified === undefined ? null : r.verified === 1 }));
}

const START = "Engine 3 started by the owner";
/** Engine v1 (wild concepts, owner 23-11-2026; house rules WI): the first notes line, as for engine 3. */
const START_E1 = "Engine 1 (wild) started by the owner";

/** Engine v1 batches need migration 0018 (the CHECK of batches.engine takes 1). Before it is live, refuse with a clear message. */
async function engine1Live(env: Env): Promise<boolean> {
  const t = await env.DB.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'batches'").first<{ sql: string }>();
  return /engine\s+IN\s*\(\s*1\s*,/i.test(t?.sql ?? "");
}

/**
 * A new batch. Engine 2 by default. Engine 3 (a11-engine v3 Phase 7, the controlled rollout) and engine v1 (wild concepts,
 * owner 23-11-2026) only with the owner's own words that start it (ownerStart): the batch notes keep them, so every such
 * batch shows who started it and how.
 */
export async function batchCreate(env: Env, input: { brandSlug: string; subjectId: string; label: string; engine?: 1 | 2 | 3; ownerStart?: string }) {
  const engine = input.engine ?? 2;
  if (engine !== 2 && !input.ownerStart?.trim())
    throw new InputError(`An engine ${engine} batch needs ownerStart: the owner's own words that start engine ${engine} for this batch.`);
  if (engine === 2 && input.ownerStart) throw new InputError("ownerStart goes with engine 1 or engine 3 only.");
  if (engine === 1 && !(await engine1Live(env)))
    throw new Error("Engine 1 batches need migration 0018_engine_1, which is not live yet. Ask the owner to run it (docs/deploy.md step 3).");
  const brand = await brandBySlug(env, input.brandSlug);
  const kit = await latestKit(env, brand.id);
  if (!kit) throw new Error(`Brand ${brand.slug} has no kit yet. Save one with brand_save first.`);
  const subject = await env.DB.prepare("SELECT brand_id FROM subjects WHERE id = ?").bind(input.subjectId).first<{ brand_id: string }>();
  if (!subject || subject.brand_id !== brand.id) throw new Error(`Subject ${input.subjectId} does not belong to ${brand.slug}.`);
  const id = crypto.randomUUID();
  const at = now();
  // One line, so a later note can keep it (batchUpdate).
  const start = engine === 3 ? START : engine === 1 ? START_E1 : null;
  const notes = start ? `${start} (${at}): "${input.ownerStart!.trim().replace(/\s+/g, " ")}"` : null;
  await env.DB.prepare(
    "INSERT INTO batches (id, brand_id, subject_id, kit_version, label, status, engine, notes, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'research', ?, ?, ?, ?)",
  )
    .bind(id, brand.id, input.subjectId, kit.version, input.label, engine, notes, at, at)
    .run();
  return { id, label: input.label, kitVersion: kit.version, status: "research", engine };
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
      if (v.stage === "final" && render.kind !== "final") throw new Error(`${where}: ${v.key} is a ${render.kind}, not a final picture.`);
      if (v.stage === "draft" && render.kind === "rough") throw new Error(`${where}: ${v.key} is a rough, not a draft picture.`);
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

/** The engine 3 steps that come before the board (nextStepV3). */
const BEFORE_BOARD = ["brief", "concepts", "concepts_rework", "owner_decision", "concept_review", "copy_review", "direction", "drafts", "draft_rank"];

/** The engine 3 board checks again, in the status write: exactly 3 picks, and each picked idea with drafts has its final prompt. */
const BOARD3_GUARD = ` AND (SELECT COUNT(*) FROM ideas WHERE batch_id = batches.id AND picked = 1) = 3
  AND NOT EXISTS (SELECT 1 FROM ideas i WHERE i.batch_id = batches.id AND i.picked = 1 AND i.final_prompt IS NULL
    AND EXISTS (SELECT 1 FROM renders r WHERE r.batch = i.batch_id AND r.idea = i.id AND r.kind = 'draft' AND r.image_keys IS NOT NULL))`;

/** Engine v1 board check, in the status write too: BOARD3_GUARD, and each picked idea has a finished picture. */
const BOARD1_GUARD = `${BOARD3_GUARD}
  AND NOT EXISTS (SELECT 1 FROM ideas i WHERE i.batch_id = batches.id AND i.picked = 1
    AND NOT EXISTS (SELECT 1 FROM renders r WHERE r.batch = i.batch_id AND r.idea = i.id AND r.kind = 'draft' AND r.image_keys IS NOT NULL))`;

export async function batchUpdate(
  env: Env,
  input: { id: string; status?: string; insights?: unknown[]; notes?: string; ownerVerdicts?: OwnerVerdict[] },
) {
  // Every picked idea with drafts must have its final prompt before the picks are made (D2: Claude picks the drafts).
  let guard = "";
  if (input.status === "board") {
    const b = await env.DB.prepare("SELECT engine FROM batches WHERE id = ?").bind(input.id).first<{ engine: number }>();
    guard = b?.engine === 3 ? BOARD3_GUARD : b?.engine === 1 ? BOARD1_GUARD : "";
    // Engine v1 (house rules WI): exactly 3 picked concepts in any mix of stages, each with its finished picture.
    if (b?.engine === 1) {
      const step = ((await batchGet(env, input.id)) as { nextStep?: string }).nextStep ?? "";
      if (["concepts", "concept_pick", "pictures"].includes(step))
        throw new Error(`An engine 1 batch reaches status 'board' only with 3 picked concepts, each with its finished picture (nextStep is '${step}': read batch_get).`);
    }
    // Engine 3: exactly 3 picked ideas in any mix of roles (design pack §2.6), each with approved words, a current
    // direction and its checked drafts (3 eligible, or fewer after a failed redo for each missing one, §3.6).
    if (b?.engine === 3) {
      // The status write repeats the pick checks (BOARD3_GUARD), so a pick that changes in between cannot reach the board.
      const p = await env.DB.prepare("SELECT COUNT(*) AS n FROM ideas WHERE batch_id = ? AND picked = 1").bind(input.id).first<{ n: number }>();
      if (p?.n !== 3) throw new Error(`An engine 3 batch needs exactly 3 picked ideas before status 'board' (it has ${p?.n ?? 0}).`);
      const step = ((await batchGet(env, input.id)) as { nextStep?: string }).nextStep ?? "";
      if (BEFORE_BOARD.includes(step))
        throw new Error(`An engine 3 batch reaches status 'board' only after the words, the directions and the draft checks of its 3 picks (nextStep is '${step}': read batch_get).`);
    }
    // An engine 2 funnel batch needs exactly one picked idea per stage. Batches made before the stages are exempt.
    const counts = b?.engine === 3 || b?.engine === 1 ? { results: [] } : await env.DB.prepare(
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
  if (input.notes !== undefined) {
    // The first line of an engine 3 or engine 1 batch's notes is the owner's start (batchCreate): a new note keeps it.
    const old = await env.DB.prepare("SELECT notes FROM batches WHERE id = ? AND engine IN (1, 3)").bind(input.id).first<{ notes: string | null }>();
    const start = old?.notes?.startsWith(START) || old?.notes?.startsWith(START_E1) ? old.notes.split("\n")[0]! : null;
    sets.push("notes = ?");
    args.push(start && !(input.notes ?? "").startsWith(start) ? `${start}\n${input.notes ?? ""}` : input.notes);
  }
  const verdicts = input.ownerVerdicts ?? [];
  if (sets.length === 0 && verdicts.length === 0) throw new Error("Nothing to update.");
  // An unknown batch is refused, and every verdict is checked, before anything is written.
  if (!(await env.DB.prepare("SELECT 1 FROM batches WHERE id = ?").bind(input.id).first())) throw new Error(`No batch with id ${input.id}.`);
  const inserts = await verdictInserts(env, input.id, verdicts);
  // One D1 batch is one transaction: the batch row and its verdicts are saved together or not at all.
  const [res] = await env.DB.batch([
    env.DB.prepare(`UPDATE batches SET ${[...sets, "updated_at = ?"].join(", ")} WHERE id = ?${guard}`).bind(...args, now(), input.id),
    ...inserts,
  ]);
  if (res?.meta.changes !== 1) throw new Error(guard ? "The picks changed while the status was set: the batch needs exactly 3 picked ideas, each with its final prompt after its drafts. Read batch_get and try again." : `No batch with id ${input.id}.`);
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
    throw new InputError(`territories, concept and promptVersion are for an engine 3 batch only. This batch is engine ${batch.engine}: save the ideas without them.`);
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
    // Engine v1 sets no words on the picture (house rules WI): its headline is the concept's short name, so no copy warning.
    warnings: [...(v3?.warnings ?? []), ...(batch.engine === 1 ? [] : copyWarnings(ideas))],
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
 * Engine v1 (house rules WI, owner 23-11-2026: "no text at all and simply just the branding company logo") has no words
 * to approve: its draft needs only a picked idea. Returns the batch's engine, so render_submit sizes the draft.
 */
export async function copyApprovedCheck(env: Env, batchId: string, ideaId: string): Promise<{ engine: number }> {
  const row = await env.DB.prepare("SELECT i.headline, i.copy, i.picked, b.engine FROM ideas i JOIN batches b ON b.id = i.batch_id WHERE i.id = ? AND i.batch_id = ?")
    .bind(ideaId, batchId)
    .first<{ headline: string; copy: string; picked: number; engine: number }>();
  if (!row) throw new Error(`No idea ${ideaId} in batch ${batchId}. A draft belongs to an idea of its batch.`);
  // A paid draft only for an idea the critic picked (a11-engine v3 design pack §2.6).
  if (row.picked !== 1) throw new Error(`Idea ${ideaId} is not picked. Drafts are made only for the picked ideas of a batch.`);
  if (row.engine === 1) return { engine: 1 };
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
  return { engine: row.engine };
}

/** Engine 3 roughs (owner, 18-11-2026, decision D3 = A): at most this many for each concept, and for each batch. */
export const MAX_ROUGHS_IDEA = 2;
export const MAX_ROUGHS_BATCH = 8;

/**
 * A rough: one cheap low render of a concept before the copy review (docs/engine-3-overhaul.md C7), so the owner and the
 * critic judge the picture, not only the words. Engine 3 only; any concept of the batch (it need not be picked, and its
 * words need no approval yet); at most 2 for each concept (one redo) and 8 for each batch. A failed render does not count.
 */
export async function roughCheck(env: Env, batchId: string, ideaId: string) {
  // The renders table takes 'rough' only after migration 0017: refuse before fal is paid, not after.
  const table = await env.DB.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'renders'").first<{ sql: string }>();
  if (!table?.sql.includes("'rough'")) throw new Error("Roughs need migration 0017_roughs, which is not live yet. Ask the owner to run it (docs/deploy.md step 3).");
  const row = await env.DB.prepare("SELECT b.engine FROM ideas i JOIN batches b ON b.id = i.batch_id WHERE i.id = ? AND i.batch_id = ?")
    .bind(ideaId, batchId)
    .first<{ engine: number }>();
  if (!row) throw new Error(`No idea ${ideaId} in batch ${batchId}. A rough belongs to a concept of its batch.`);
  if (row.engine !== 3) throw new Error("Roughs are for engine 3 batches only.");
  const n = await env.DB.prepare(
    "SELECT COUNT(*) AS batch, COALESCE(SUM(idea = ?), 0) AS idea FROM renders WHERE batch = ? AND kind = 'rough' AND status != 'failed'",
  ).bind(ideaId, batchId).first<{ batch: number; idea: number }>();
  if ((n?.idea ?? 0) >= MAX_ROUGHS_IDEA) throw new Error(`This concept has ${MAX_ROUGHS_IDEA} roughs, the limit.`);
  if ((n?.batch ?? 0) >= MAX_ROUGHS_BATCH) throw new Error(`This batch has ${MAX_ROUGHS_BATCH} roughs, the limit (one for each of the critic's top 5 concepts, with a few redos).`);
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
    throw new InputError(`outcome, roles, reserves, review, promptVersion and ownerSwap are for an engine 3 batch only. This batch is engine ${batch.engine}: send the ids only.`);
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

/**
 * Engine 3: the keys of the drafts whose newest check says eligible and that count now (current): the drafts the critic
 * sees. anyRound: also the eligible drafts of an earlier direction round or from before a full pass (the owner's pick).
 */
async function eligibleKeys(env: Env, batchId: string, opts: { anyRound?: boolean } = {}): Promise<Set<string>> {
  const g = (await batchGet(env, batchId)) as { ideas: { drafts: { key: string; eligible?: boolean | null; current?: boolean }[] }[] };
  return new Set(g.ideas.flatMap((i) => i.drafts.filter((d) => d.eligible === true && (opts.anyRound || d.current === true)).map((d) => d.key)));
}

export async function draftsRank(env: Env, batchId: string, ranks: { key: string; rank: number; reason?: string }[], promptVersion = "") {
  const keys = await draftKeys(env, batchId);
  // Engine 3: the critic ranks the eligible drafts only (design pack §3.6, test 3.9).
  const b = await env.DB.prepare("SELECT engine FROM batches WHERE id = ?").bind(batchId).first<{ engine: number }>();
  const eligible = b?.engine === 3 ? await eligibleKeys(env, batchId) : null;
  const at = now();
  const stmts = ranks.map((r) => {
    const ideaId = keys.get(r.key);
    if (!ideaId) throw new Error(`${r.key} is not a finished draft of batch ${batchId}.`);
    if (eligible && !eligible.has(r.key))
      throw new InputError(`${r.key} is not an eligible current draft: rank only the drafts that batch_get view 'critic' shows.`);
    return env.DB.prepare(
      `INSERT INTO draft_ranks (render_key, batch_id, idea_id, rank, reason, created_at) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT (render_key) DO UPDATE SET rank = excluded.rank, reason = excluded.reason, created_at = excluded.created_at`,
    ).bind(r.key, batchId, ideaId, r.rank, r.reason ?? null, at);
  });
  // One rank_context record for each idea ranked, in the same write as the ranks (author server, a new version each time).
  const stamp = await rankStamp(env);
  const byIdea = new Map<string, string[]>();
  for (const r of ranks) byIdea.set(keys.get(r.key)!, [...(byIdea.get(keys.get(r.key)!) ?? []), r.key]);
  const stamps = [...byIdea].map(([ideaId, ranked]) =>
    env.DB.prepare(
      `INSERT INTO batch_records (id, batch_id, kind, idea_id, version, body, author, prompt_version, created_at)
       SELECT ?, ?, 'rank_context', ?, COALESCE(MAX(version), 0) + 1, ?, 'server', ?, ?
       FROM batch_records WHERE batch_id = ? AND kind = 'rank_context' AND idea_id = ?`,
    ).bind(crypto.randomUUID(), batchId, ideaId, JSON.stringify({ ...stamp, promptVersion, keys: ranked }), promptVersion, at, batchId, ideaId),
  );
  for (let attempt = 1; ; attempt++) {
    try {
      // A rank saved at the same time takes the same version; the unique index refuses it, and the whole write is tried again.
      await env.DB.batch([...stmts, ...stamps]);
      break;
    } catch (e) {
      if (!/UNIQUE/i.test((e as Error).message) || attempt >= 5) throw e;
    }
  }
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
  // A full pass is not a pick (issue 147: a pass on all nine drafts was sent here): it is a verdict, with its own tool. Checked before
  // the engine 3 eligibility, so a pass that names a draft that is not eligible gets this answer too.
  if (new Set(ideaIds).size !== ideaIds.length)
    throw new InputError(
      "Pick one draft per idea: each pick becomes a paid final. When the owner passed on all the drafts of an idea, make no pick for it: save his exact words with batch_update ownerVerdicts (stage 'draft', mark 'pass', the ideaId). When he keeps one draft, pick only that one; his words on the others go in the pick's note.",
    );
  // Engine 3 (design pack §3.6): the owner picks a draft whose newest check says eligible. The board shows the current
  // ones; a draft of an earlier direction round, or from before a full pass, is his choice too (owner, 21-11-2026: he kept
  // a round 1 draft over the later round's final). A draft that failed its check, or has none, is refused.
  // A pick that already has a final stays valid, even after a later check.
  const eng = await env.DB.prepare("SELECT engine FROM batches WHERE id = ?").bind(batchId).first<{ engine: number }>();
  if (eng?.engine === 3 && picks.length) {
    const ok = await eligibleKeys(env, batchId, { anyRound: true });
    const done = await env.DB.prepare("SELECT render_key FROM picks WHERE batch_id = ? AND final_render_id IS NOT NULL").bind(batchId).all<{ render_key: string }>();
    for (const r of done.results) ok.add(r.render_key);
    const bad = picks.find((p) => !ok.has(p.key));
    if (bad) throw new InputError(`${bad.key} is not an eligible draft: its newest check must say eligible (batch_get drafts[].eligible).`);
  }
  // A pick that has a final stays, so another draft of that idea would start a second paid final.
  const finalled = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM picks WHERE batch_id = ? AND final_render_id IS NOT NULL
     AND idea_id IN (SELECT value FROM json_each(?)) AND render_key NOT IN (SELECT value FROM json_each(?))`,
  ).bind(batchId, JSON.stringify(ideaIds), JSON.stringify(picks.map((p) => p.key))).first<{ n: number }>();
  if (finalled?.n) throw new Error("An idea in this call already has a final. To render it again, use render_submit (kind 'final').");
  const listed = picks.map((p) => p.key);
  // A pick saved again keeps its time (taste_log and the replay cut read it). Engine 3 only: after a full pass on its idea,
  // a pick saved again with new words is his newest decision, and batch_get reads its time against the pass (index
  // verdicts_batch). The same words are not a new decision: the board and picks_save send every pick again on each save.
  const renew = eng?.engine === 3
    ? `, created_at = CASE WHEN picks.note IS NOT excluded.note AND EXISTS (SELECT 1 FROM verdicts v WHERE v.batch_id = picks.batch_id
         AND v.idea_id = picks.idea_id AND v.stage = 'draft' AND v.mark = 'pass' AND v.created_at >= picks.created_at) THEN excluded.created_at ELSE picks.created_at END`
    : "";
  const stmts = [
    env.DB.prepare(
      `DELETE FROM picks WHERE batch_id = ? AND final_render_id IS NULL AND render_key NOT IN (SELECT value FROM json_each(?))`,
    ).bind(batchId, JSON.stringify(listed)),
    ...picks.map((p) =>
      env.DB.prepare(
        `INSERT INTO picks (render_key, batch_id, idea_id, note, by_owner, created_at) VALUES (?, ?, ?, ?, 1, ?)
         ON CONFLICT (render_key) DO UPDATE SET note = excluded.note, by_owner = 1${renew}`,
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
async function tasteTally(env: Env, before = "9999") {
  const r = await env.DB.prepare(
    `SELECT COUNT(*) AS reviewed, COALESCE(SUM(d.rank = 1), 0) AS agreed
     FROM picks p JOIN draft_ranks d ON d.render_key = p.render_key AND d.created_at < ?1 WHERE p.by_owner = 1 AND p.created_at < ?1`,
  ).bind(before).first<{ reviewed: number; agreed: number }>();
  return { reviewed: r?.reviewed ?? 0, agreed: r?.agreed ?? 0 };
}

/**
 * What the owner chose and what he passed over, newest first, so the next ideas and ranks learn from it.
 * Each row has his words, the critic's rank and reason for the chosen draft, and the same for the drafts he passed.
 */
export async function tasteLog(env: Env, limit = 30, before?: string) {
  // before (design pack §4.5 rule 5): only the decisions made before that time, so a replay cannot see its own answer.
  // The stored times have milliseconds: a time cut is normalised to that form, so a cut at 10:00:00Z keeps out 10:00:00.200Z.
  // A date cut stays as it is (it sorts before every time of that day).
  const parsed = before ? new Date(before) : null;
  // Date rolls an impossible day over (2026-02-30 becomes 03-02): the date part must come back unchanged.
  if (parsed && (Number.isNaN(parsed.valueOf()) || parsed.toISOString().slice(0, 10) !== before!.slice(0, 10))) throw new InputError("before must be a real UTC date or time, such as 2026-11-12 or 2026-11-12T10:00:00.000Z.");
  const cut = !before ? "9999" : before.length === 10 ? before : parsed!.toISOString();
  const picks = await env.DB.prepare(
    `SELECT p.render_key, p.idea_id, p.batch_id, p.note, p.created_at, i.format, i.headline, i.visual, b.label, b.engine
     FROM picks p JOIN ideas i ON i.id = p.idea_id AND i.batch_id = p.batch_id JOIN batches b ON b.id = p.batch_id
     WHERE p.by_owner = 1 AND p.created_at < ? ORDER BY p.created_at DESC LIMIT ?`,
  ).bind(cut, limit).all<Record<string, any>>();
  const ideaIds = [...new Set(picks.results.map((p) => p.idea_id as string))];
  const ranks = await env.DB.prepare(
    "SELECT render_key, idea_id, rank, reason FROM draft_ranks WHERE idea_id IN (SELECT value FROM json_each(?)) AND created_at < ? ORDER BY rank",
  ).bind(JSON.stringify(ideaIds), cut).all<{ render_key: string; idea_id: string; rank: number; reason: string | null }>();
  const verdicts = await env.DB.prepare(
    `SELECT v.created_at, v.stage, v.mark, v.source_mark, v.owner_said, v.notes, v.render_key, b.label, b.engine, i.format, i.headline, pk.version
     FROM verdicts v LEFT JOIN batches b ON b.id = v.batch_id LEFT JOIN ideas i ON i.id = v.idea_id LEFT JOIN packs pk ON pk.id = v.pack_id
     WHERE v.created_at < ? ORDER BY v.created_at DESC, v.rowid DESC LIMIT ?`,
  ).bind(cut, limit).all<Record<string, any>>();
  // Copy corrections (store 1, owner taste): the words as written and the words he approved, when they differ.
  const copies = await env.DB.prepare(
    `SELECT i.format, i.copy, b.label FROM ideas i JOIN batches b ON b.id = i.batch_id
     WHERE json_extract(i.copy, '$.written') IS NOT NULL AND json_extract(i.copy, '$.ownerApproved.at') < ?
       AND (json_extract(i.copy, '$.ownerApproved.headline') IS NOT json_extract(i.copy, '$.written.headline')
         OR json_extract(i.copy, '$.ownerApproved.subline') IS NOT json_extract(i.copy, '$.written.subline'))
     ORDER BY json_extract(i.copy, '$.ownerApproved.at') DESC LIMIT ?`,
  ).bind(cut, limit).all<{ format: string; copy: string; label: string }>();
  // The query keeps only the ideas whose words changed, so the limit counts corrections.
  const corrections = copies.results.map((r) => {
    const c = JSON.parse(r.copy) as { written: { headline: string; subline: string }; ownerApproved: { headline: string; subline: string; ownerSaid: string; at: string } };
    const a = c.ownerApproved;
    return { at: a.at, batch: r.label, stage: r.format, written: c.written, approved: { headline: a.headline, subline: a.subline }, ownerSaid: a.ownerSaid };
  });
  return {
    ...(before ? { before } : {}),
    tally: await tasteTally(env, cut),
    copyCorrections: corrections,
    verdicts: verdicts.results.map((v) => ({
      at: v.created_at,
      batch: v.label ?? null,
      engine: v.engine ?? null,
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
        engine: p.engine,
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
    `SELECT p.idea_id, p.final_render_id, i.final_prompt, i.final_refs, b.engine FROM picks p JOIN ideas i ON i.id = p.idea_id
     JOIN batches b ON b.id = p.batch_id WHERE p.batch_id = ? AND p.render_key = ?`,
  ).bind(batchId, key).first<{ idea_id: string; final_render_id: string | null; final_prompt: string | null; final_refs: string; engine: number }>();
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
    r = await fal.submit(env, { batch: batchId, idea: pick.idea_id, kind: "final", prompt: pick.final_prompt, referenceUrls: refs, numImages: 1, wild: pick.engine === 1 });
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
      .map(({ n: _n, finals: _f, finalPrompt: _fp, finalRefs: _fr, direction: _d, copy, drafts, ...i }) => {
        const { ownerApproved: _oa, written: _w, ...words } = (copy ?? {}) as Record<string, unknown>;
        // Engine 3: only the eligible current drafts, and never the art director's check: the critic ranks them, blind.
        const shown = drafts.filter((d) => !("eligible" in d) || (d.eligible === true && d.current === true));
        return { ...i, copy: words, drafts: shown.map(({ key, url }) => ({ key, url })) };
      })
      .sort((a, b) => shuffleKey(`${id}:${a.id}`) - shuffleKey(`${id}:${b.id}`)),
  };
}

/**
 * The owner's board (worker/api.ts). Engine 3 (design pack §3.6): each idea shows only its eligible current drafts,
 * and any draft that is already picked, so a failed draft or an old round never reaches the owner. Engine 2: batch_get.
 */
export async function batchGetOwner(env: Env, id: string) {
  const g = await batchGet(env, id);
  if (g.engine !== 3) return g;
  const picked = new Set(g.picks.map((p) => p.key));
  return {
    ...g,
    ideas: g.ideas.map((i) => ({ ...i, drafts: i.drafts.filter((d) => picked.has(d.key) || (d.eligible === true && d.current === true)) })),
  };
}

/**
 * Each idea's active full pass: the newest 'pass' verdict that the owner did not correct. Verdict rows are only added, and
 * the newest is his current view: a 'fix' on the same idea that comes after a pass, with no new draft of that idea made
 * between the two, withdraws that pass (owner, 18-11-2026: a usable draft saved as 'pass' by mistake hid it from picks).
 * An earlier pass then counts again. After a redraft, a 'fix' is about the new drafts, so the pass stays.
 * verdicts: oldest first.
 */
export function activePasses(
  verdicts: { idea_id: string; mark: string; at: string }[],
  renders: { idea: string; kind: string; created_at: string }[],
): Map<string, string> {
  const passes = new Map<string, string[]>(); // each idea's passes that stand, oldest first
  for (const v of verdicts) {
    const list = passes.get(v.idea_id) ?? [];
    if (v.mark === "pass") passes.set(v.idea_id, [...list, v.at]);
    else if (v.mark === "fix") {
      const at = list[list.length - 1];
      if (at !== undefined && !renders.some((r) => r.idea === v.idea_id && r.kind === "draft" && r.created_at > at && r.created_at <= v.at)) {
        list.pop();
      }
    }
  }
  return new Map([...passes].filter(([, list]) => list.length > 0).map(([idea, list]) => [idea, list[list.length - 1] as string]));
}

/** Everything about one batch, for Claude and for the board. */
export async function batchGet(env: Env, id: string, { withPlans = false } = {}) {
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
    // The owner's newest draft verdicts (bounded; reversed to oldest first below): they give each idea's active full pass
    // (docs/design/owner-verdicts.md).
    env.DB.prepare(
      "SELECT idea_id, mark, created_at AS at FROM verdicts WHERE batch_id = ? AND stage = 'draft' AND idea_id IS NOT NULL ORDER BY created_at DESC, rowid DESC LIMIT 400",
    ).bind(id).all<{ idea_id: string; mark: string; at: string }>(),
    latestKit(env, b.brand_id, b.kit_version),
  ]);
  const rankBy = new Map(ranks.results.map((r) => [r.render_key, r]));
  const pickBy = new Map(picks.results.map((p) => [p.render_key, p]));
  // The blind rank is held on the server until the owner decides (a11-engine v3 design pack §4.3): an owner pick on the idea
  // shows the rank of all its drafts; a full pass shows it only for the drafts that existed when he passed. No flag turns this off.
  const ownerPicked = new Set(picks.results.filter((p) => p.by_owner === 1).map((p) => p.idea_id as string));
  // The newest owner pick of each idea: an engine 3 pick saved after a full pass ends the draft steps of that idea.
  const ownerPickAt = new Map<string, string>();
  for (const p of picks.results) if (p.by_owner === 1 && String(p.created_at) > (ownerPickAt.get(p.idea_id) ?? "")) ownerPickAt.set(p.idea_id, String(p.created_at));
  const passedAt = activePasses([...passes.results].reverse(), renders.results as { idea: string; kind: string; created_at: string }[]);
  const img = (key: string) => ({ key, url: fal.mediaUrl(env, key) });
  const [brief, conceptReview, directions, checks, rounds, plans] = await Promise.all([
    briefGet(env, id),
    conceptReviewGet(env, id),
    directionsGet(env, id, withPlans),
    checksGet(env, id),
    directionRounds(env, id),
    withPlans && b.engine === 3 ? draftPlans(env, id) : new Map<string, string>(),
  ]);
  const e3 = b.engine === 3;
  const draftsDone = new Map<string, boolean>();
  // Engine v1: the idea has a picture made after the owner's newest full pass (or he picked one).
  const hasPicture = new Map<string, boolean>();
  const redirect = new Map<string, boolean>();
  const ownerDecided = new Map<string, boolean>();
  const ideasOut = ideas.results.map((i) => {
    const drafts = renders.results
      .filter((r) => r.idea === i.id && r.kind === "draft")
      .flatMap((r) => (r.image_keys ? (JSON.parse(r.image_keys) as string[]).map((key) => ({ key, at: r.created_at as string, check: checks.get(r.id), plan: plans.get(r.id) })) : []));
    const passed = passedAt.get(i.id);
    const shown = (at: string) => ownerPicked.has(i.id) || (passed !== undefined && at <= passed);
    // Engine 3: a draft whose check is from an older direction round (a new direction came after it) does not count now.
    const round = rounds.get(i.id) ?? 0;
    const counts = (d: { at: string; check?: { round?: number } }) =>
      (passed === undefined || d.at > passed) && (!e3 || !d.check || (d.check.round ?? 0) >= round);
    // ranked: the critic's rank of the newest 3 current drafts is saved (the critic ranks the newest 3; after a full pass,
    // only the drafts made since count).
    const current = drafts.filter(counts);
    const newest = (current.length ? current : drafts).slice(-3);
    // Engine 3 (design pack §3.6): the owner and the critic see the eligible drafts. Each missing eligible draft has its one
    // redo (attempt 2). After the redos, 3 or 2 eligible drafts are done (the owner is told why there are 2); 0 or 1 mean the
    // direction is wrong: one new direction (a new round), and after it 1 eligible draft is done. 0 after the new round
    // stays at drafts: the main session tells the owner.
    const eligible = current.filter((d) => d.check?.eligible === true);
    const failedRedos = current.filter((d) => d.check?.eligible === false && d.check.attempt === 2).length;
    const settled = current.every((d) => d.check) && (eligible.length >= 3 || failedRedos >= 3 - eligible.length);
    const redirected = drafts.some((d) => (passed === undefined || d.at > passed) && d.check && (d.check.round ?? 0) < round);
    // Engine 3: the owner has chosen a draft of this idea (picks_save takes an eligible draft of any round), and no full pass
    // came after his pick: the idea needs no more drafts, direction or rank (owner, 21-11-2026). The critic and the board
    // still see the current round only.
    const pickAt = ownerPickAt.get(i.id);
    const decided = e3 && pickAt !== undefined && (passed === undefined || pickAt > passed);
    draftsDone.set(i.id, decided || (settled && (eligible.length >= 2 || (eligible.length === 1 && redirected))));
    redirect.set(i.id, !decided && settled && eligible.length <= 1 && !redirected);
    // Engine 3: ranked is the critic's rank of every eligible current draft (it ranks eligible drafts only).
    const ranked = e3 ? eligible.length > 0 && eligible.every((d) => rankBy.has(d.key)) : newest.length > 0 && newest.every((d) => rankBy.has(d.key));
    ownerDecided.set(i.id, decided);
    hasPicture.set(i.id, ownerPicked.has(i.id) || current.length > 0);
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
      // Engine 3: the art director's newest direction (design pack §3.3), or null. Engine 2 ideas have no such field.
      // Only a picked idea shows it: the direction of a concept that a swap or a rework unpicked is not for use.
      ...(b.engine === 3 ? { direction: i.picked === 1 ? (directions.get(i.id) ?? null) : null } : {}),
      // Engine 3: the concept's roughs, oldest first (docs/engine-3-overhaul.md C7): a cheap picture of the idea before the
      // copy review. Never a draft: no rank, no check, no pick.
      ...(e3 ? { roughs: renders.results.filter((r) => r.idea === i.id && r.kind === "rough" && r.image_keys).flatMap((r) => (JSON.parse(r.image_keys) as string[]).map(img)) } : {}),
      ranked,
      // Submit order, then image order. Never rank order: the order must not show the critic's rank.
      // rank and reason are null until the owner decides on the idea (see shown above).
      drafts: drafts.map(({ key, at, check, plan }) => ({
        ...img(key),
        // Engine 3, withPlans only: the draft's own layout plan (also a draft of an earlier round), for a reprint.
        ...(plan !== undefined ? { plan } : {}),
        // Engine 3: the art director's newest check of the draft (design pack §3.6), or null when it has none yet.
        // current: made after the owner's newest full pass, and not checked in an older direction round (they count now).
        ...(e3 ? { eligible: check?.eligible ?? null, check: check ?? null, current: counts({ at, check }) } : {}),
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
          // Engine 3: the art director's newest final check, and ready: no failed point, the approved words, the logo right.
          ...(e3 ? { check: checks.get(r.id) ?? null, ready: checks.has(r.id) ? finalReady(checks.get(r.id)!) : false } : {}),
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
    // Engine 1 and engine 3: the next step of the batch, from its rows (design pack §1.11). Engine 2 batches have none.
    ...(engine === 1 ? { nextStep: nextStepV1(b.status as string, ideasOut.map((i) => ({ ...i, hasPicture: hasPicture.get(i.id) === true })), ownerPicked) } : {}),
    ...(engine === 3 ? { nextStep: nextStepV3(b.status as string, brief !== null, ideasOut.map((i) => ({ ...i, draftsDone: draftsDone.get(i.id) === true, redirect: redirect.get(i.id) === true, decided: ownerDecided.get(i.id) === true, rendered: renders.results.some((r) => r.idea === i.id && r.kind !== "rough"), directed: directions.get(i.id)?.current === true })), ownerPicked, conceptReview && { outcome: conceptReview.outcome, reworks: conceptReview.reworks, newIdeas: ideas.results.some((i) => i.n > conceptReview.lastN) }) } : {}),
  };
}

type IdeaState = {
  id: string;
  picked: boolean;
  copy: { ownerApproved?: unknown };
  ranked: boolean;
  finals: { status: unknown; ready?: boolean }[];
  /** Every current draft is checked, with 3 eligible, or fewer after a failed redo for each missing one (design pack §3.6). */
  draftsDone: boolean;
  /** Engine 3: 0 or 1 eligible drafts after the redos, and no new direction yet: the art director writes one (§3.6). */
  redirect?: boolean;
  /** Engine 3: the owner picked a draft of the idea after his newest full pass: no more drafts or rank for it. */
  decided?: boolean;
  /** Any render row of the idea, also a queued or failed one (ideas_pick freezes the picks then). */
  rendered?: boolean;
  /** The idea has a direction record that is newer than the newest concept review (design pack §1.11 step 6). */
  directed: boolean;
};

/**
 * The first step of an engine v1 batch (wild concepts, house rules WI) that is not done yet. Pure, like nextStepV3.
 * concepts: the writer saves 6 to 10 concepts. concept_pick: the critic picks 3 blind. pictures: one low draft for each
 * pick (and a new one after a full pass). board, owner_pick, finals, done: as for engine 2. No copy review, no rank.
 */
export function nextStepV1(
  status: string,
  ideas: { id: string; picked: boolean; hasPicture: boolean; finals: { status: unknown }[] }[],
  ownerPicked: Set<string>,
): string {
  const picked = ideas.filter((i) => i.picked);
  if (ideas.length === 0) return "concepts";
  if (picked.length < 3) return "concept_pick";
  if (picked.some((i) => !i.hasPicture)) return "pictures";
  if (!["board", "finals", "done"].includes(status)) return "board";
  if (picked.some((i) => !ownerPicked.has(i.id))) return "owner_pick";
  if (picked.some((i) => !i.finals.some((f) => f.status === "done"))) return "finals";
  return "done";
}

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
  // (more research, another product angle, or stop). Concepts saved after the newest review go back to the critic, also
  // after a select, until a picked idea has a render of any status (then the picks are frozen).
  if (review?.outcome === "rework" && !review.newIdeas) return review.reworks >= 3 ? "owner_decision" : "concepts_rework";
  if (review?.newIdeas && !picked.some((i) => i.rendered)) return "concept_review";
  if (picked.length < 3) return "concept_review";
  if (picked.some((i) => !i.copy.ownerApproved)) return "copy_review";
  if (picked.some((i) => !i.directed || i.redirect)) return "direction";
  if (picked.some((i) => !i.draftsDone)) return "drafts";
  if (picked.some((i) => !i.ranked && !i.decided)) return "draft_rank";
  if (!["board", "finals", "done"].includes(status)) return "board";
  if (picked.some((i) => !ownerPicked.has(i.id))) return "owner_pick";
  // A queued or failed final is not a final: the step is done only when each picked idea has a finished one.
  // Engine 3: a final counts when the art director's final check says it is ready (design pack §3.6).
  if (picked.some((i) => !i.finals.some((f) => f.status === "done" && f.ready === true))) return "finals";
  return "done";
}

