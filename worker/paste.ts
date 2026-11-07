import type { Env } from "./env";
import { type Box, boxPixels } from "./png";

/** Paste-back for the food truth stage (food.ts): fal ignores parts of the mask, so the Worker keeps the original pixels outside the boxes. */
export interface PastePlan {
  source: string;
  width: number;
  height: number;
  boxes: Box[];
}

export const pasteKey = (renderId: string) => `renders/${renderId}/paste.json`;

/**
 * For a food_fix render: draw only the boxes of the new image onto the original final.
 * Returns the merged JPEG, or null when the render is not a food fix (no paste plan) or the sizes differ.
 */
export async function pasteBack(env: Env, renderId: string, fixed: ArrayBuffer): Promise<ArrayBuffer | null> {
  const planObj = await env.MEDIA.get(pasteKey(renderId));
  if (!planObj) return null;
  const plan = JSON.parse(await new Response(planObj.body).text()) as PastePlan;
  const info = await env.IMAGES.info(new Blob([fixed]).stream());
  if (!("width" in info) || info.width !== plan.width || info.height !== plan.height) return null;
  const source = await env.MEDIA.get(plan.source);
  if (!source) return null;
  let img = env.IMAGES.input(source.body);
  for (const b of plan.boxes) {
    const { x0, x1, y0, y1 } = boxPixels(plan.width, plan.height, b);
    const crop = env.IMAGES.input(new Blob([fixed]).stream()).transform({ trim: { top: y0, left: x0, width: x1 - x0, height: y1 - y0 } });
    img = img.draw(crop, { top: y0, left: x0 });
  }
  const out = await img.output({ format: "image/jpeg", quality: 95 });
  return out.response().arrayBuffer();
}
