import type { Env } from "./env";
import { InputError, type ObjectSchema, type StringProp } from "./schema";

/**
 * a11-engine v3 Phase 3: the art direction of a picked concept (design pack §3.3, §3.4). The server checks the shape only:
 * 3 drafts, each with a question, a layout plan and a prompt, and the diversity pairs. The rubric is taste: it is in
 * plugin/agents/art-director.md. A pair with fewer than 3 axes gets a warning, not a refusal.
 */

export const AXES = ["composition", "productPosition", "scale", "camera", "light", "environment", "negativeSpace", "staging"] as const;
const ID = "^[0-9a-f-]{36}$";
const line = (max = 600): StringProp => ({ type: "string", minLength: 1, maxLength: max, pattern: "\\S" });
const obj = (properties: ObjectSchema["properties"], description?: string): ObjectSchema => ({
  type: "object",
  ...(description ? { description } : {}),
  properties,
  required: Object.keys(properties),
  additionalProperties: false,
});
const axisList = { type: "array" as const, minItems: 0, maxItems: AXES.length, items: { type: "string" as const, enum: [...AXES] } };

export const DIRECTION_SCHEMA: ObjectSchema = {
  type: "object",
  description: "Engine 3 only: the art director's direction for one picked concept (design pack §3.3).",
  properties: {
    why: { ...line(1000), description: "Why this look communicates the concept, in 2 or 3 sentences." },
    mechanism: {
      type: "object",
      properties: {
        type: line(80),
        productionRisk: { type: "string", enum: ["low", "medium", "high"] },
        riskReason: { type: "string", maxLength: 600, description: "Why the concept needs a medium or high risk staging. Required in words for high." },
      },
      required: ["type", "productionRisk"],
      additionalProperties: false,
    },
    shared: {
      type: "object",
      properties: {
        backdrop: line(),
        light: line(),
        colour: line(),
        supportingObjects: { type: "array", maxItems: 5, items: line(200), description: "Each object with its reason. None is fine." },
        hierarchy: { ...line(), description: "What the eye reads first, second, third. Back products recede: shadow, soft focus." },
        type: obj({ headlineFont: line(120), weight: line(60), case: line(60), reason: { ...line(), description: "A brand font that is not the logo's font." } }),
        logo: obj({ placement: line(), note: line() }),
        recipe: { type: "string", enum: ["concept", "house"], description: "house: the house recipe of creative-playbook §7, only as the fallback the owner approved." },
        recipeApproval: { ...line(1000), description: "recipe house only: the owner's exact words that approve the fallback." },
      },
      required: ["backdrop", "light", "colour", "hierarchy", "type", "logo", "recipe"],
      additionalProperties: false,
    },
    drafts: {
      type: "array",
      minItems: 3,
      maxItems: 3,
      items: {
        type: "object",
        properties: {
          n: { type: "integer", minimum: 1, maximum: 3 },
          question: { ...line(), description: "What this draft asks the owner, for example: is the idea clearer when the pouch is empty?" },
          axes: obj(Object.fromEntries(AXES.map((k) => [k, line(300)]))),
          plan: {
            ...line(20000),
            description: "The layout plan JSON as scripts/product_lock.py layout reads it (the text of the plan file): reprint needs the same plan.",
          },
          prompt: { ...line(6000), description: "The draft prompt before the server adds its suffix." },
          renderId: { type: "string", pattern: ID, description: "A later version, after render_submit: the draft render made from this plan and prompt." },
        },
        required: ["n", "question", "axes", "plan", "prompt"],
        additionalProperties: false,
      },
    },
    diversity: obj({ pairs: obj({ "1-2": axisList, "1-3": axisList, "2-3": axisList }, "The axes on which each pair of drafts differs.") }),
    elementCount: { type: "integer", minimum: 1, maximum: 30, description: "The elements in the scene. The calm rule: 5 or fewer." },
  },
  required: ["why", "mechanism", "shared", "drafts", "diversity", "elementCount"],
  additionalProperties: false,
};

type Draft = { n: number; question: string; axes: Record<string, string>; plan: string; prompt: string; renderId?: string };
export type Direction = {
  why: string;
  mechanism: { type: string; productionRisk: string; riskReason?: string };
  shared: { recipe: string; recipeApproval?: string; [k: string]: unknown };
  drafts: Draft[];
  diversity: { pairs: Record<string, string[]> };
  elementCount: number;
};

const num = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
/** A colour as scripts/product_lock.py rgb() reads it: #RRGGBB, or three numbers with commas. */
const colour = (v: unknown) => /^(#[0-9a-fA-F]{6}|\s*-?\d+(\.\d+)?\s*(,\s*-?\d+(\.\d+)?\s*){2})$/.test(String(v));

/** The plan text as an object, or a refusal: the checks of load_plan in scripts/product_lock.py, so reprint can read it. */
function parsePlan(n: number, text: string): Record<string, unknown> {
  const bad = (why: string): never => {
    throw new InputError(`drafts n ${n}: ${why} (scripts/product_lock.py load_plan). Give the text of the plan file that product_lock.py layout read.`);
  };
  let plan: unknown;
  try {
    plan = JSON.parse(text);
  } catch {
    return bad("plan is not JSON");
  }
  if (!plan || typeof plan !== "object" || Array.isArray(plan)) return bad("the plan must be a JSON object");
  const p = plan as { size?: unknown; bg?: unknown; products?: unknown; shapes?: unknown };
  if (!Array.isArray(p.products) || p.products.length === 0) bad('the plan needs a non-empty "products" list');
  if (p.size !== undefined && !(Array.isArray(p.size) && p.size.length === 2 && p.size.every((v) => Number.isInteger(v) && v > 0)))
    bad('the plan\'s "size" must be [W, H] in whole pixels');
  if (p.bg !== undefined && !colour(p.bg)) bad('the plan\'s "bg" must be a colour such as #EEE8DF');
  for (const [i, q] of (p.products as unknown[]).entries()) {
    if (!q || typeof q !== "object" || Array.isArray(q)) bad(`product ${i + 1} must be an object`);
    const { side = "up", rot = 0, cx, base, height } = q as Record<string, unknown>;
    if (!["up", "L", "R"].includes(side as string)) bad(`product ${i + 1}: side must be one of up, L, R`);
    if (![cx, base, height, rot].every(num)) bad(`product ${i + 1}: cx, base, height and rot must be numbers`);
    const [x, y, h, r] = [cx, base, height, rot] as [number, number, number, number];
    if (!(h > 0 && h <= 1.5 && x >= -0.5 && x <= 1.5 && y > 0 && y <= 1.5 && Math.abs(r) <= 45))
      bad(`product ${i + 1}: height must be above 0, cx and base near the canvas, rot within 45 degrees`);
  }
  if (p.shapes !== undefined && !Array.isArray(p.shapes)) bad('the plan\'s "shapes" must be a list');
  for (const [i, sh] of ((p.shapes ?? []) as unknown[]).entries()) {
    const r = (sh as { rect?: unknown } | null)?.rect;
    if (!(Array.isArray(r) && r.length === 4 && r.every(num) && r[0]! < r[2]! && r[1]! < r[3]!)) bad(`shape ${i + 1}: rect must be [x0, y0, x1, y1] with x0<x1, y0<y1`);
    const fill = (sh as { fill?: unknown }).fill;
    if (fill !== undefined && !colour(fill)) bad(`shape ${i + 1}: fill must be a colour such as #F6F5F2`);
  }
  return plan as Record<string, unknown>;
}

/** Save a new version of the direction of a picked idea with approved words (design pack §3.7). */
export async function directionSave(env: Env, batchId: string, ideaId: string, direction: Direction, promptVersion = "") {
  const b = await env.DB.prepare("SELECT engine FROM batches WHERE id = ?").bind(batchId).first<{ engine: number }>();
  if (!b) throw new InputError(`No batch with id ${batchId}.`);
  if (b.engine !== 3) throw new InputError("direction_save is for an engine 3 batch only. An engine 2 batch keeps the art director's plans in its notes, as today.");
  const idea = await env.DB.prepare("SELECT n, picked, headline, copy FROM ideas WHERE id = ? AND batch_id = ?")
    .bind(ideaId, batchId)
    .first<{ n: number; picked: number; headline: string; copy: string }>();
  if (!idea) throw new InputError(`${ideaId} is not an idea of batch ${batchId}.`);
  if (idea.picked !== 1) throw new InputError(`Idea ${idea.n} is not picked: only the 3 picked concepts get a direction.`);
  const copy = JSON.parse(idea.copy) as { subline?: string; ownerApproved?: { headline?: string; subline?: string } };
  if (!copy.ownerApproved)
    throw new InputError(`The owner has not approved the words of idea ${idea.n}: show him the copy review first (ideas_update copyApproved).`);
  // As copyApprovedCheck (worker/batch.ts) for a render: the direction leaves space for the words he approved, not old ones.
  if (copy.ownerApproved.headline !== idea.headline || copy.ownerApproved.subline !== copy.subline)
    throw new InputError(`The words of idea ${idea.n} changed after the owner approved them: show him the new words and save his approval again first.`);

  const ns = direction.drafts.map((d) => d.n).sort();
  if (ns.join() !== "1,2,3") throw new InputError("drafts needs n 1, 2 and 3, once each.");
  const { recipe, recipeApproval } = direction.shared;
  if (recipe === "house" && !recipeApproval)
    throw new InputError("recipe 'house' is the fallback the owner approves: give his exact words in shared.recipeApproval. A proposal is not an approval: ask him first.");
  if (recipe !== "house" && recipeApproval) throw new InputError("shared.recipeApproval is for recipe 'house' only.");
  const renderIds = direction.drafts.flatMap((d) => (d.renderId ? [d.renderId] : []));
  if (new Set(renderIds).size !== renderIds.length) throw new InputError("Two drafts name the same renderId.");
  if (renderIds.length) {
    const found = await env.DB.prepare(
      "SELECT id FROM renders WHERE batch = ? AND idea = ? AND kind = 'draft' AND id IN (SELECT value FROM json_each(?))",
    ).bind(batchId, ideaId, JSON.stringify(renderIds)).all<{ id: string }>();
    const ok = new Set(found.results.map((r) => r.id));
    const bad = renderIds.filter((id) => !ok.has(id));
    if (bad.length) throw new InputError(`Not a draft render of idea ${idea.n}: ${bad.join(", ")}.`);
  }
  const drafts = [...direction.drafts].sort((x, y) => x.n - y.n).map((d) => ({ ...d, plan: parsePlan(d.n, d.plan) }));

  // Warnings: the rubric and the calm rules of design pack §3.4. Not refusals.
  const warnings: string[] = [];
  for (const [pair, axes] of Object.entries(direction.diversity.pairs)) {
    const set = new Set(axes);
    if (set.size < 3) warnings.push(`Drafts ${pair} differ on ${set.size} axis(es): each pair needs 3 or more. Change one draft, or say why in the report.`);
    if (!["composition", "camera", "scale"].some((a) => set.has(a))) warnings.push(`Drafts ${pair} do not differ in composition, camera or scale: one of them is needed.`);
  }
  if (direction.elementCount > 5) warnings.push(`The scene has ${direction.elementCount} elements: the calm rule is 5 or fewer.`);
  if (direction.mechanism.productionRisk === "high" && !direction.mechanism.riskReason?.trim())
    warnings.push("The staging is high risk with no riskReason: say why the concept needs it, or choose a lower risk staging.");

  const body = { ...direction, drafts };
  const recordId = crypto.randomUUID();
  // The record is added only while the idea is still picked with approved words: a rework that commits between the checks
  // above and this insert makes it a no-op, and the call is refused. A save at the same time gets the next version.
  const insert = () =>
    env.DB.prepare(
      `INSERT INTO batch_records (id, batch_id, kind, idea_id, version, body, author, prompt_version, created_at)
       SELECT ?, ?, 'direction', ?, v, ?, 'art-director', ?, ? FROM
         (SELECT COALESCE(MAX(version), 0) + 1 AS v FROM batch_records WHERE batch_id = ? AND kind = 'direction' AND idea_id = ?)
       WHERE EXISTS (SELECT 1 FROM ideas WHERE id = ? AND batch_id = ? AND picked = 1 AND json_extract(copy, '$.ownerApproved') IS NOT NULL)`,
    ).bind(recordId, batchId, ideaId, JSON.stringify(body), promptVersion, new Date().toISOString(), batchId, ideaId, ideaId, batchId).run();
  for (let attempt = 1; ; attempt++) {
    try {
      const r = await insert();
      if (r.meta.changes !== 1) throw new InputError(`Idea ${idea.n} was unpicked, or its approval was taken back, while the direction was written. Nothing was saved. Read batch_get.`);
      break;
    } catch (e) {
      if (!/UNIQUE/i.test((e as Error).message) || attempt >= 5) throw e;
    }
  }
  const v = await env.DB.prepare("SELECT version FROM batch_records WHERE id = ?").bind(recordId).first<{ version: number }>();
  return { batchId, ideaId, version: v?.version, warnings };
}

/** direction_save input: drop the fields that batch_get adds, so a direction read back with withPlans can be saved again. */
export function dropDirectionServerFields(args: unknown): unknown {
  const d = (args as { direction?: unknown } | null)?.direction;
  if (d && typeof d === "object") for (const k of ["version", "promptVersion", "savedAt", "current"]) delete (d as Record<string, unknown>)[k];
  return args;
}

/**
 * The newest direction of each idea of a batch. current is false when a newer concept review exists (a rework or a swap
 * after the direction): then the direction step is not done. Without withPlans each draft's plan is left out, to keep the
 * answer small.
 */
export async function directionsGet(env: Env, batchId: string, withPlans = false) {
  const rows = await env.DB.prepare(
    `SELECT d.idea_id, d.version, d.body, d.prompt_version, d.created_at,
       d.rowid > COALESCE((SELECT MAX(rowid) FROM batch_records WHERE batch_id = d.batch_id AND kind = 'concept_review'), 0) AS current
     FROM batch_records d
     WHERE d.batch_id = ? AND d.kind = 'direction' AND d.idea_id IS NOT NULL
       AND d.version = (SELECT MAX(version) FROM batch_records WHERE batch_id = d.batch_id AND kind = 'direction' AND idea_id = d.idea_id)
     LIMIT 60`,
  ).bind(batchId).all<{ idea_id: string; version: number; body: string; prompt_version: string; created_at: string; current: number }>();
  const out = new Map<string, Record<string, unknown> & { current: boolean }>();
  for (const r of rows.results) {
    const body = JSON.parse(r.body) as Direction & { drafts: (Omit<Draft, "plan"> & { plan?: unknown })[] };
    // The plan goes back as the text of a plan file: the session writes it to disk for reprint, or sends it back as it is.
    const drafts = body.drafts.map(({ plan, ...d }) => (withPlans ? { ...d, plan: JSON.stringify(plan) } : d));
    out.set(r.idea_id, { version: r.version, promptVersion: r.prompt_version, savedAt: r.created_at, current: r.current === 1, ...body, drafts });
  }
  return out;
}
