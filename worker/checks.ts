import type { Env } from "./env";
import { InputError, type ObjectSchema, type StringProp } from "./schema";

/**
 * a11-engine v3 Phase 3: the art director's check of each draft and each final (design pack §3.6). The server keeps the
 * art director's judgement and checks the shape only: the render belongs to the idea, the codes are checklist codes, and
 * a draft marked eligible has no defect found and no failed point.
 */

/** The 12 points of a draft check (a11-engine v3 §7.4). */
export const DRAFT_POINTS = [
  "productShape", "label", "logo", "food", "light", "scale", "props", "physics", "composition", "hierarchy", "headlineSpace", "defects",
] as const;
/** The 8 points of a final check (a11-engine v3 §7.8). */
export const FINAL_POINTS = [
  "conceptQuality", "productTruth", "brandIdentity", "copyAccuracy", "foodAuthenticity", "composition", "visualCraft", "renderChecklist",
] as const;
const ID = "^[0-9a-f-]{36}$";
const text = (max = 600): StringProp => ({ type: "string", maxLength: max });
const mark: StringProp = { type: "string", enum: ["pass", "fail", "na"] };
const points = (keys: readonly string[], description: string): ObjectSchema => ({
  type: "object",
  description,
  properties: Object.fromEntries(keys.map((k) => [k, mark])),
  required: [...keys],
  additionalProperties: false,
});

export const CHECK_SCHEMA: ObjectSchema = {
  type: "object",
  description: "Engine 3 only: the art director's check of one draft render (kind draft_check) or one final render (kind final_check).",
  properties: {
    renderId: { type: "string", pattern: ID },
    eligible: { type: "boolean", description: "draft_check: the owner and the critic may see this draft. False when a D item is found or a point fails." },
    attempt: { type: "integer", minimum: 1, maximum: 2, description: "draft_check: 1, or 2 for the one redo of a draft that was not eligible." },
    measured: {
      type: "object",
      description: "The product shape measured from a grid: height over width.",
      properties: { shapeRatio: { type: "number", minimum: 0 }, targetRatio: { type: "number", minimum: 0 }, tolerance: { type: "number", minimum: 0, maximum: 1 } },
      required: ["shapeRatio", "targetRatio", "tolerance"],
      additionalProperties: false,
    },
    items: {
      type: "array",
      minItems: 1,
      maxItems: 18,
      description: "Both kinds, at least one: the render-checklist codes you checked (D1 to D10, F1 to F8), each found or not.",
      items: {
        type: "object",
        properties: { code: { type: "string", pattern: "^(D[1-9]|D10|F[1-8])$" }, found: { type: "boolean" }, note: text() },
        required: ["code", "found"],
        additionalProperties: false,
      },
    },
    points: points(DRAFT_POINTS, "draft_check: the 12 points, pass, fail or na."),
    finalPoints: points(FINAL_POINTS, "final_check: the 8 points, pass, fail or na (foodAuthenticity na when no food shows)."),
    notes: {
      type: "array",
      maxItems: 12,
      description: "final_check: a note for each point that failed.",
      items: { type: "object", properties: { point: { type: "string", enum: [...FINAL_POINTS] }, note: text() }, required: ["point", "note"], additionalProperties: false },
    },
    checkedAt: { type: "array", minItems: 2, maxItems: 2, items: { type: "string", enum: ["full", "phone"] }, description: "final_check: the sizes you looked at: full and phone." },
    logoCentred: { type: "boolean", description: "final_check: the logo is optically centred at its place." },
    copyMatchesApproved: { type: "boolean", description: "final_check: the words on the picture equal the approved words." },
    reason: { ...text(1000), description: "What you saw, in one or two sentences. For a draft that is not eligible: the fault, so the redo prompt can name it." },
  },
  required: ["renderId", "reason"],
  additionalProperties: false,
};

export type Check = {
  renderId: string;
  eligible?: boolean;
  attempt?: number;
  measured?: { shapeRatio: number; targetRatio: number; tolerance: number };
  items?: { code: string; found: boolean; note?: string }[];
  points?: Record<string, string>;
  finalPoints?: Record<string, string>;
  notes?: { point: string; note: string }[];
  checkedAt?: string[];
  logoCentred?: boolean;
  copyMatchesApproved?: boolean;
  reason: string;
  /** Set by the server: the direction round of the idea when the check was saved (directionRounds). */
  round?: number;
};

const DRAFT_ONLY = ["eligible", "attempt", "points"] as const;
const FINAL_ONLY = ["finalPoints", "notes", "checkedAt", "logoCentred", "copyMatchesApproved"] as const;

/** The render-checklist rule (§3 of docs/render-checklist.md): any D item, or two F items, rejects a draft or a final. */
const checklistFault = (c: Check) => {
  const found = (c.items ?? []).filter((i) => i.found).map((i) => i.code);
  return found.some((k) => k.startsWith("D")) || found.filter((k) => k.startsWith("F")).length >= 2;
};

/**
 * A final is ready for the owner when every point passes (foodAuthenticity may be na when no food shows), the checklist
 * finds no D item and fewer than two F items, the words match the approved words and the logo sits right.
 */
export const finalReady = (c: Check) =>
  Object.entries(c.finalPoints ?? {}).every(([k, v]) => v === "pass" || (k === "foodAuthenticity" && v === "na")) &&
  !checklistFault(c) && c.copyMatchesApproved === true && c.logoCentred === true;

/**
 * The direction round of an idea: the newest direction version that has no draft renderId yet. A direction saved again
 * with the renderIds stays in its round; a new direction (for example the one lower-risk redo of design pack §3.6) starts
 * a new round, and the checks of the drafts of an older round no longer count.
 */
export async function directionRounds(env: Env, batchId: string) {
  const rows = await env.DB.prepare(
    `SELECT idea_id, MAX(version) AS v FROM batch_records d WHERE batch_id = ? AND kind = 'direction' AND idea_id IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM json_each(d.body, '$.drafts') WHERE json_extract(value, '$.renderId') IS NOT NULL)
     GROUP BY idea_id`,
  ).bind(batchId).all<{ idea_id: string; v: number }>();
  return new Map(rows.results.map((r) => [r.idea_id, r.v]));
}

/** Save one check of a draft or a final render of a picked idea (design pack §3.6, §3.7). */
export async function checksSave(env: Env, batchId: string, ideaId: string, kind: "draft_check" | "final_check", check: Check, promptVersion = "") {
  const b = await env.DB.prepare("SELECT engine FROM batches WHERE id = ?").bind(batchId).first<{ engine: number }>();
  if (!b) throw new InputError(`No batch with id ${batchId}.`);
  if (b.engine !== 3) throw new InputError("checks_save is for an engine 3 batch only. An engine 2 batch names its D items in chat, as today.");
  const idea = await env.DB.prepare("SELECT n, picked FROM ideas WHERE id = ? AND batch_id = ?").bind(ideaId, batchId).first<{ n: number; picked: number }>();
  if (!idea) throw new InputError(`${ideaId} is not an idea of batch ${batchId}.`);
  if (idea.picked !== 1) throw new InputError(`Idea ${idea.n} is not picked.`);
  const renderKind = kind === "draft_check" ? "draft" : "final";
  const render = await env.DB.prepare("SELECT kind, image_keys FROM renders WHERE id = ? AND batch = ? AND idea = ?")
    .bind(check.renderId, batchId, ideaId)
    .first<{ kind: string; image_keys: string | null }>();
  if (!render || render.kind !== renderKind) throw new InputError(`${check.renderId} is not a ${renderKind} render of idea ${idea.n}.`);
  if (!render.image_keys) throw new InputError(`Render ${check.renderId} has no image yet: check it after render_status says done.`);

  const wrong = (kind === "draft_check" ? FINAL_ONLY : DRAFT_ONLY).filter((k) => check[k] !== undefined);
  if (wrong.length) throw new InputError(`${kind} does not take ${wrong.join(", ")}.`);
  // The render checklist is part of both checks: the eligible and ready rules read its D and F items.
  if (!check.items?.length) throw new InputError(`${kind} needs items: each render-checklist code you checked (D1 to D10, F1 to F8), found or not.`);
  const codes = check.items.map((i) => i.code);
  if (new Set(codes).size !== codes.length) throw new InputError("items names a code twice.");
  if (kind === "draft_check") {
    for (const k of DRAFT_ONLY) if (check[k] === undefined) throw new InputError(`draft_check needs ${k}.`);
    if (!check.measured) throw new InputError("draft_check needs measured: the product shape from a grid.");
    const found = (check.items ?? []).filter((i) => i.found).map((i) => i.code);
    const faults = [...found.filter((k) => k.startsWith("D")), ...(found.filter((k) => k.startsWith("F")).length >= 2 ? found.filter((k) => k.startsWith("F")) : [])];
    const failed = Object.entries(check.points!).filter(([, v]) => v === "fail").map(([k]) => k);
    if (check.eligible && (faults.length || failed.length))
      throw new InputError(`A draft with ${[...faults, ...failed.map((p) => `${p} fail`)].join(", ")} is not eligible (any D item, two F items or a failed point): set eligible false and give the fault in reason.`);
  } else {
    for (const k of FINAL_ONLY.filter((k) => k !== "notes")) if (check[k] === undefined) throw new InputError(`final_check needs ${k}.`);
    if (new Set(check.checkedAt).size !== 2) throw new InputError("final_check needs checkedAt full and phone: look at both sizes.");
    const failed = Object.entries(check.finalPoints!).filter(([, v]) => v === "fail").map(([k]) => k);
    const noted = new Set((check.notes ?? []).map((n) => n.point));
    const missing = failed.filter((p) => !noted.has(p));
    if (missing.length) throw new InputError(`Give a note for each failed point: ${missing.join(", ")}.`);
  }

  const body = JSON.stringify({ ...check, round: (await directionRounds(env, batchId)).get(ideaId) ?? 0 });
  const recordId = crypto.randomUUID();
  for (let attempt = 1; ; attempt++) {
    try {
      // A save at the same time gets the next version (the unique index refuses a repeated one; then try again).
      const r = await env.DB.prepare(
        `INSERT INTO batch_records (id, batch_id, kind, idea_id, version, body, author, prompt_version, created_at)
         SELECT ?, ?, ?, ?, v, ?, 'art-director', ?, ? FROM
           (SELECT COALESCE(MAX(version), 0) + 1 AS v FROM batch_records WHERE batch_id = ? AND kind = ? AND idea_id = ?)
         WHERE EXISTS (SELECT 1 FROM ideas WHERE id = ? AND batch_id = ? AND picked = 1)`,
      ).bind(recordId, batchId, kind, ideaId, body, promptVersion, new Date().toISOString(), batchId, kind, ideaId, ideaId, batchId).run();
      if (r.meta.changes !== 1) throw new InputError(`Idea ${idea.n} was unpicked while the check was written. Nothing was saved.`);
      break;
    } catch (e) {
      if (!/UNIQUE/i.test((e as Error).message) || attempt >= 5) throw e;
    }
  }
  const v = await env.DB.prepare("SELECT version FROM batch_records WHERE id = ?").bind(recordId).first<{ version: number }>();
  return {
    batchId, ideaId, kind, renderId: check.renderId, version: v?.version,
    ...(kind === "draft_check" ? { eligible: check.eligible } : { ready: finalReady(check) }),
  };
}

/** The newest check of each render of a batch, as render id → check (with its version and time). */
export async function checksGet(env: Env, batchId: string) {
  // One row for each render (its newest check), so the rows are bounded by the renders of the batch.
  const rows = await env.DB.prepare(
    `SELECT version, body, created_at FROM batch_records WHERE rowid IN (
       SELECT MAX(rowid) FROM batch_records WHERE batch_id = ? AND kind IN ('draft_check', 'final_check')
       GROUP BY json_extract(body, '$.renderId'))`,
  ).bind(batchId).all<{ version: number; body: string; created_at: string }>();
  const out = new Map<string, Check & { version: number; savedAt: string }>();
  for (const r of rows.results) {
    const c = JSON.parse(r.body) as Check;
    out.set(c.renderId, { ...c, version: r.version, savedAt: r.created_at });
  }
  return out;
}
