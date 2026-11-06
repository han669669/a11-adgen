import { brandBySlug, latestKit } from "./brand";
import type { Env } from "./env";
import * as fal from "./fal";

export const FORMATS = ["hook", "anatomy", "usvsthem", "offer"] as const;
export const STATUSES = ["research", "ideas", "drafts", "board", "finals", "done"] as const;
const MAX_BATCH_RENDERS = fal.MAX_BATCH_RENDERS;

const now = () => new Date().toISOString();

export async function subjectSave(
  env: Env,
  input: { brandSlug: string; kind: "product" | "brand" | "redesign"; title: string; url?: string; imageUrls?: string[]; notes?: string },
) {
  const brand = await brandBySlug(env, input.brandSlug);
  const id = crypto.randomUUID();
  const data = { imageUrls: input.imageUrls ?? [], notes: input.notes ?? "" };
  await env.DB.prepare("INSERT INTO subjects (id, brand_id, kind, title, url, data, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .bind(id, brand.id, input.kind, input.title, input.url ?? null, JSON.stringify(data), now())
    .run();
  return { id, brandSlug: brand.slug, kind: input.kind, title: input.title };
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

export async function batchUpdate(env: Env, input: { id: string; status?: string; insights?: unknown[]; notes?: string }) {
  // The board is the owner's one step (D2): every picked idea with drafts must be ready to render when he sees it.
  if (input.status === "board") {
    const notReady = await env.DB.prepare(
      `SELECT i.n FROM ideas i WHERE i.batch_id = ? AND i.picked = 1 AND i.final_prompt IS NULL
       AND EXISTS (SELECT 1 FROM renders r WHERE r.batch = i.batch_id AND r.idea = i.id AND r.kind = 'draft')`,
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
  if (sets.length === 0) throw new Error("Nothing to update.");
  const res = await env.DB.prepare(`UPDATE batches SET ${sets.join(", ")}, updated_at = ? WHERE id = ?`)
    .bind(...args, now(), input.id)
    .run();
  if (res.meta.changes !== 1) throw new Error(`No batch with id ${input.id}.`);
  return { id: input.id, updated: sets.map((s) => s.split(" ")[0]) };
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
 * The owner's picks (D2). Picks that already have a final render stay; other old picks not in the list are removed.
 */
export async function picksSave(env: Env, batchId: string, picks: { key: string; note?: string }[]) {
  const keys = await draftKeys(env, batchId);
  const at = now();
  for (const p of picks) if (!keys.has(p.key)) throw new Error(`${p.key} is not a finished draft of batch ${batchId}.`);
  const listed = picks.map((p) => p.key);
  const stmts = [
    env.DB.prepare(
      `DELETE FROM picks WHERE batch_id = ? AND final_render_id IS NULL AND render_key NOT IN (SELECT value FROM json_each(?))`,
    ).bind(batchId, JSON.stringify(listed)),
    ...picks.map((p) =>
      env.DB.prepare(
        `INSERT INTO picks (render_key, batch_id, idea_id, note, created_at) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (render_key) DO UPDATE SET note = excluded.note`,
      ).bind(p.key, batchId, keys.get(p.key)!, p.note ?? null, at),
    ),
  ];
  await env.DB.batch(stmts);
  return { picks: listed.length };
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
  if (pick.final_render_id) return { id: pick.final_render_id, status: "already started" };
  if (!pick.final_prompt) throw new Error(`Idea ${pick.idea_id} has no final prompt. Set it with ideas_update.`);
  // Claim the pick before the paid call, so two taps (or a retry) cannot start two finals.
  const claim = `pending:${crypto.randomUUID()}`;
  const claimed = await env.DB.prepare("UPDATE picks SET final_render_id = ? WHERE render_key = ? AND final_render_id IS NULL")
    .bind(claim, key)
    .run();
  if (claimed.meta.changes !== 1) return { id: null, status: "already started" };
  const refs = [fal.mediaUrl(env, key), ...(JSON.parse(pick.final_refs) as string[])];
  let r: Awaited<ReturnType<typeof fal.submit>>;
  try {
    r = await fal.submit(env, { batch: batchId, idea: pick.idea_id, kind: "final", prompt: pick.final_prompt, referenceUrls: refs, numImages: 1 });
  } catch (e) {
    // fal did not take the job: free the pick so the owner can tap Render again.
    await env.DB.prepare("UPDATE picks SET final_render_id = NULL WHERE render_key = ? AND final_render_id = ?").bind(key, claim).run();
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
      `SELECT id, idea, kind, status, image_keys, composed_key, error, usd_est, created_at FROM renders WHERE batch = ? ORDER BY created_at LIMIT ${MAX_BATCH_RENDERS}`,
    ).bind(id).all<Record<string, any>>(),
    env.DB.prepare("SELECT render_key, idea_id, rank, reason FROM draft_ranks WHERE batch_id = ? LIMIT 200").bind(id).all<Record<string, any>>(),
    env.DB.prepare("SELECT render_key, idea_id, note, final_render_id, created_at FROM picks WHERE batch_id = ? LIMIT 100").bind(id).all<Record<string, any>>(),
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
      drafts: renders.results
        .filter((r) => r.idea === i.id && r.kind === "draft")
        .flatMap((r) => (r.image_keys ? (JSON.parse(r.image_keys) as string[]) : []))
        .map((key) => ({ ...img(key), rank: rankBy.get(key)?.rank ?? null, reason: rankBy.get(key)?.reason ?? null, picked: pickBy.has(key) }))
        .sort((x, y) => (x.rank ?? 99) - (y.rank ?? 99)),
      finals: renders.results
        .filter((r) => r.idea === i.id && r.kind === "final")
        .map((r) => ({
          id: r.id,
          status: r.status,
          error: r.error,
          images: (r.image_keys ? (JSON.parse(r.image_keys) as string[]) : []).map(img),
          composed: r.composed_key ? img(r.composed_key) : null,
        })),
    })),
    picks: picks.results.map((p) => ({ key: p.render_key, ideaId: p.idea_id, note: p.note, finalRenderId: p.final_render_id })),
    drafting: renders.results.filter((r) => r.status === "queued").map((r) => r.id),
  };
}

