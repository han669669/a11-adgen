import { latestKit } from "./brand";
import { RENDER_KEY } from "./compose";
import type { Env } from "./env";
import * as fal from "./fal";
import { type PastePlan, pasteKey } from "./paste";
import { type Box, checkBoxes, maskPng } from "./png";

/**
 * Food truth stage (owner, 07-11-2026: the food must look like the real product).
 * A final shows the right layout and text, but the model paints idealised food. This stage re-renders
 * only the food: a mask (white = food boxes) protects every text, label and prop, and the kit's real
 * close-up photos and packshot are the references. The kit's food description is the same words every time.
 * The mask only guides fal: it re-renders the whole picture (W46b: chips outside the mask became barley).
 * So when the result arrives, the Worker pastes only the boxes onto the original final (pasteBack):
 * outside the boxes the picture is the original.
 */
export function foodPrompt(food: string, keep: string, textures: number, packshots: number): string {
  const tex = textures === 1 ? "Image 2 is a real close-up photo of this food" : `Images 2 to ${1 + textures} are real close-up photos of this food`;
  const pack = packshots ? ` Image ${2 + textures} is the real product as sold.` : "";
  return [
    "Image 1 is a finished ad. Edit only the white area of the mask. Keep everything in the black area exactly as it is: every text, label, prop, shadow and the light.",
    `In the white area, make the food look exactly like the real product. ${tex}.${pack} The real food: ${food.trim()}`,
    "Match the real photos in shape, size, surface texture, colour and the way the pieces sit together. Keep the same amount of food in the same places, so every fill level and heap size stays the same. Keep any glass, its reflections and any label edge inside the white area.",
    keep.trim(),
    "A real photograph of real food: no idealised or repeated shapes, no painted look, no gloss that the real photos do not show.",
  ].join("\n\n");
}

export async function foodFix(env: Env, input: { key: string; boxes: Box[]; keep: string }) {
  const { id, row } = await finalRow(env, input.key, input.boxes);
  // The batch's pinned kit gives the photos. The food words may come from a later kit version (the food does not change).
  const pinned = await latestKit(env, row.brand_id, row.kit_version);
  const latest = await latestKit(env, row.brand_id);
  const food = pinned?.kit.food?.trim() || latest?.kit.food?.trim();
  if (!food) throw new Error("The brand kit has no food description. Save a kit version with kit.food (brand_save).");
  const refsOf = (role: string) => (pinned?.kit.refs ?? []).filter((r) => r.role === role).map((r) => r.url);
  const textures = refsOf("texture").slice(0, 3);
  if (textures.length === 0) throw new Error("The brand kit has no texture photo (a real close-up of the food).");
  const packshots = refsOf("packshot").slice(0, 6 - 1 - textures.length);
  return maskedEdit(env, id, row, input.key, input.boxes, foodPrompt(food, input.keep, textures.length, packshots.length), [...textures, ...packshots]);
}

/**
 * A plain masked edit of a finished final, for anything that is not the brand's food: remove an AI tell
 * (a handwritten note, a drip, a filler prop) or repair a small part. food_fix is the wrong tool for this:
 * its food words make fal paint food in the box (W46b: removing a sticky note filled the empty jar with kernels).
 * Same mask and paste-back as food_fix; the only reference is the final itself.
 */
export function regionPrompt(edit: string): string {
  return [
    "Image 1 is a finished ad. Edit only the white area of the mask. Keep everything in the black area exactly as it is: every text, label, prop, shadow and the light.",
    `The edit: ${edit.trim()}`,
    "Match the light, colour, grain and perspective of the rest of image 1, so the edit shows no edge. Add nothing that the edit does not ask for: no food, text, object or mark.",
    "A real photograph: no painted or CG look.",
  ].join("\n\n");
}

export async function regionFix(env: Env, input: { key: string; boxes: Box[]; edit: string }) {
  const { id, row } = await finalRow(env, input.key, input.boxes);
  return maskedEdit(env, id, row, input.key, input.boxes, regionPrompt(input.edit), []);
}

interface FinalRow {
  batch: string;
  idea: string;
  kind: string;
  status: string;
  width: number;
  height: number;
  image_keys: string | null;
  brand_id: string;
  kit_version: number;
}

/** The completed final behind an image key, with checks shared by food_fix and region_fix. */
async function finalRow(env: Env, key: string, boxes: Box[]): Promise<{ id: string; row: FinalRow }> {
  const m = RENDER_KEY.exec(key);
  if (!m) throw new Error("key must be a render image key (renders/<id>/<n>.jpg).");
  const id = m[1]!;
  checkBoxes(boxes);
  const row = await env.DB.prepare(
    `SELECT r.batch, r.idea, r.kind, r.status, r.width, r.height, r.image_keys, b.brand_id, b.kit_version
     FROM renders r JOIN batches b ON b.id = r.batch WHERE r.id = ?`,
  )
    .bind(id)
    .first<FinalRow>();
  if (!row) throw new Error(`No render ${id} in a batch.`);
  if (row.kind !== "final" || row.status !== "done") throw new Error(`Render ${id} is not a completed final (${row.kind}, ${row.status}).`);
  if (!(JSON.parse(row.image_keys ?? "[]") as string[]).includes(key)) throw new Error(`Render ${id} has no saved image ${key}.`);
  return { id, row };
}

/** Mask PNG + paste plan + fal edit: only the boxes of the result are kept (paste.ts). */
async function maskedEdit(env: Env, id: string, row: FinalRow, key: string, boxes: Box[], prompt: string, refs: string[]) {
  const mask = await maskPng(row.width, row.height, boxes);
  const maskKey = `renders/${id}/mask-${Date.now()}${crypto.getRandomValues(new Uint32Array(1))[0]}.png`;
  await env.MEDIA.put(maskKey, mask, { httpMetadata: { contentType: "image/png" } });
  const maskUrl = fal.mediaUrl(env, maskKey);
  // The paste plan exists before fal accepts the render, so no poll can save the result without it.
  const renderId = crypto.randomUUID();
  const plan: PastePlan = { source: key, width: row.width, height: row.height, boxes };
  await env.MEDIA.put(pasteKey(renderId), JSON.stringify(plan), { httpMetadata: { contentType: "application/json" } });
  const out = await fal.submit(env, {
    batch: row.batch,
    idea: row.idea,
    kind: "final",
    prompt,
    referenceUrls: [fal.mediaUrl(env, key), ...refs],
    numImages: 1,
    maskUrl,
    id: renderId,
  });
  return { ...out, source: key, maskUrl };
}
