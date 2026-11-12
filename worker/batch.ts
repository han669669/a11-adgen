import { brandBySlug, latestKit } from "./brand";
import type { Env } from "./env";
import * as fal from "./fal";
import { storeSubjectImages } from "./subjectimages";

/** Funnel stages (owner, 2026-11-06). Picks per batch: 1 per stage (a database trigger enforces it). */
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

export async function factsSave(env: Env, subjectId: string, facts: FactInput[]) {
  const subject = await env.DB.prepare("SELECT id FROM subjects WHERE id = ?").bind(subjectId).first();
  if (!subject) throw new Error(`No subject with id ${subjectId}.`);
  const at = now();
  await env.DB.batch(
    facts.map((f) =>
      env.DB.prepare("INSERT INTO facts (subject_id, label, value, quote, source_url, created_at) VALUES (?, ?, ?, ?, ?, ?)").bind(
        subjectId, f.label, f.value, f.quote, f.sourceUrl, at,
      ),
    ),
  );
  return factsGet(env, subjectId);
}

export async function factsGet(env: Env, subjectId: string) {
  const rows = await env.DB.prepare(
    "SELECT id, label, value, quote, source_url AS sourceUrl FROM facts WHERE subject_id = ? ORDER BY id LIMIT 200",
  ).bind(subjectId).all();
  return rows.results;
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
    // A funnel batch needs exactly one picked idea per stage. Batches made before the stages are exempt.
    const counts = await env.DB.prepare(
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
}

export async function ideasSave(env: Env, batchId: string, ideas: IdeaInput[]) {
  const batch = await env.DB.prepare("SELECT id FROM batches WHERE id = ?").bind(batchId).first();
  if (!batch) throw new Error(`No batch with id ${batchId}.`);
  const max = await env.DB.prepare("SELECT COALESCE(MAX(n), 0) AS n FROM ideas WHERE batch_id = ?").bind(batchId).first<{ n: number }>();
  const at = now();
  const saved = ideas.map((idea, i) => ({ id: crypto.randomUUID(), n: (max?.n ?? 0) + i + 1, ...idea }));
  await env.DB.batch(
    saved.map((s) =>
      env.DB.prepare(
        `INSERT INTO ideas (id, batch_id, n, format, insight, source_url, visual, headline, copy, picked, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(s.id, batchId, s.n, s.format, s.insight, s.sourceUrl ?? null, s.visual, s.headline, JSON.stringify(s.copy ?? {}), s.picked ? 1 : 0, at),
    ),
  );
  return saved.map((s) => ({ id: s.id, n: s.n, format: s.format, headline: s.headline, picked: !!s.picked }));
}

export async function ideasUpdate(env: Env, updates: { id: string; picked?: boolean; finalPrompt?: string; finalRefs?: string[] }[]) {
  const stmts = updates.map((u) => {
    const sets: string[] = [];
    const args: unknown[] = [];
    if (u.picked !== undefined) (sets.push("picked = ?"), args.push(u.picked ? 1 : 0));
    if (u.finalPrompt !== undefined) (sets.push("final_prompt = ?"), args.push(u.finalPrompt));
    if (u.finalRefs !== undefined) (sets.push("final_refs = ?"), args.push(JSON.stringify(u.finalRefs)));
    if (sets.length === 0) throw new Error(`Nothing to update for idea ${u.id}.`);
    return env.DB.prepare(`UPDATE ideas SET ${sets.join(", ")} WHERE id = ?`).bind(...args, u.id);
  });
  const res = await env.DB.batch(stmts);
  const missing = updates.filter((_, i) => res[i]?.meta.changes !== 1).map((u) => u.id);
  if (missing.length) throw new Error(`No idea with id: ${missing.join(", ")}.`);
  return { updated: updates.length };
}

/** The critic's pick: set picked on ideas of one batch. It cannot unpick, write a prompt or touch another batch (the pick limit, 1 per stage, still holds). */
export async function ideasPick(env: Env, batchId: string, ids: string[]) {
  const res = await env.DB.batch(ids.map((id) => env.DB.prepare("UPDATE ideas SET picked = 1 WHERE id = ? AND batch_id = ?").bind(id, batchId)));
  const missing = ids.filter((_, i) => res[i]?.meta.changes !== 1);
  if (missing.length) throw new Error(`No idea of batch ${batchId} with id: ${missing.join(", ")}.`);
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

/** Everything about one batch, for Claude and for the board. */
export async function batchGet(env: Env, id: string) {
  const b = await env.DB.prepare(
    `SELECT b.*, br.slug AS brand_slug, br.name AS brand_name FROM batches b JOIN brands br ON br.id = b.brand_id WHERE b.id = ?`,
  ).bind(id).first<Record<string, any>>();
  if (!b) throw new Error(`No batch with id ${id}.`);
  const [subject, ideas, renders, ranks, picks, kit] = await Promise.all([
    env.DB.prepare("SELECT id, kind, title, url, data FROM subjects WHERE id = ?").bind(b.subject_id).first<Record<string, any>>(),
    env.DB.prepare("SELECT * FROM ideas WHERE batch_id = ? ORDER BY n LIMIT 60").bind(id).all<Record<string, any>>(),
    env.DB.prepare(
      `SELECT id, idea, kind, status, image_keys, composed_key, error, usd_est, created_at FROM renders WHERE batch = ? ORDER BY created_at, rowid LIMIT ${MAX_BATCH_RENDERS}`,
    ).bind(id).all<Record<string, any>>(),
    env.DB.prepare("SELECT render_key, idea_id, rank, reason FROM draft_ranks WHERE batch_id = ? LIMIT 200").bind(id).all<Record<string, any>>(),
    env.DB.prepare("SELECT render_key, idea_id, note, by_owner, final_render_id, created_at FROM picks WHERE batch_id = ? LIMIT 100").bind(id).all<Record<string, any>>(),
    latestKit(env, b.brand_id, b.kit_version),
  ]);
  const rankBy = new Map(ranks.results.map((r) => [r.render_key, r]));
  const pickBy = new Map(picks.results.map((p) => [p.render_key, p]));
  const img = (key: string) => ({ key, url: fal.mediaUrl(env, key) });
  return {
    id: b.id,
    label: b.label,
    status: b.status,
    brand: { slug: b.brand_slug, name: b.brand_name, kitVersion: b.kit_version },
    kit: kit?.kit ?? null,
    subject: subject && { ...subject, data: JSON.parse(subject.data) },
    facts: await factsGet(env, b.subject_id),
    insights: JSON.parse(b.insights),
    notes: b.notes,
    ideas: ideas.results.map((i) => ({
      id: i.id,
      n: i.n,
      format: i.format,
      insight: i.insight,
      sourceUrl: i.source_url,
      visual: i.visual,
      headline: i.headline,
      copy: JSON.parse(i.copy),
      picked: i.picked === 1,
      finalPrompt: i.final_prompt,
      finalRefs: JSON.parse(i.final_refs),
      // Submit order, then image order. Never rank order: the order must not show the critic's rank. rank and reason stay as fields; the board hides them until the owner picks.
      drafts: renders.results
        .filter((r) => r.idea === i.id && r.kind === "draft")
        .flatMap((r) => (r.image_keys ? (JSON.parse(r.image_keys) as string[]) : []))
        .map((key) => ({ ...img(key), rank: rankBy.get(key)?.rank ?? null, reason: rankBy.get(key)?.reason ?? null, picked: pickBy.has(key) })),
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
    })),
    picks: picks.results.map((p) => ({ key: p.render_key, ideaId: p.idea_id, note: p.note, byOwner: p.by_owner === 1, finalRenderId: p.final_render_id })),
    drafting: renders.results.filter((r) => r.status === "queued").map((r) => r.id),
  };
}

