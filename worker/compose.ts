import type { Env } from "./env";
import { mediaUrl } from "./fal";
import { fetchHttpsImage } from "./images";
import { reserve, settle } from "./spend";

/**
 * Final compose by construction (owner mark 2026-11-07: a painted logo is never exact; painted food looks AI).
 * 1. A film-grain tile over the whole picture (photo finish, as in v1).
 * 2. The brand's real logo file, drawn in code on the plain area the model left empty.
 * The Cloudflare Images binding does the pixel work, so the Worker stays inside the Free plan's 10 ms CPU.
 */
export const GRAIN_KEY = "assets/grain.png";
export const RENDER_KEY = /^renders\/([0-9a-f-]{36})\/(\d+)\.jpg$/;

export interface ComposeInput {
  key: string;
  logoUrl?: string;
  /** R2 key of the brand kit's trimmed logo; used instead of logoUrl. */
  logoKey?: string;
  /** Logo width, percent of the picture width. */
  logoWidthPct: number;
  /** Logo top edge, percent of the picture height. */
  logoTopPct: number;
  grain: "on" | "off";
  /** Grain strength, percent opacity. */
  grainPct: number;
}

export function placement(width: number, height: number, widthPct: number, topPct: number) {
  return { logoWidth: Math.round((width * widthPct) / 100), top: Math.round((height * topPct) / 100) };
}

export async function composeFinal(env: Env, input: ComposeInput) {
  const m = RENDER_KEY.exec(input.key);
  if (!m) throw new Error("key must be a render image key (renders/<id>/<n>.jpg).");
  const [, id, n] = m;
  const row = await env.DB.prepare("SELECT width, height, kind, status FROM renders WHERE id = ?")
    .bind(id)
    .first<{ width: number; height: number; kind: string; status: string }>();
  if (!row) throw new Error(`No render with id ${id}.`);
  if (row.kind !== "final" || row.status !== "done") throw new Error(`Render ${id} is not a completed final (${row.kind}, ${row.status}).`);
  const base = await env.MEDIA.get(input.key);
  if (!base) throw new Error(`No image at ${input.key}.`);

  // The brand kit's stored (already trimmed) logo, or a logo URL fetched over HTTPS only.
  let logoBody: ReadableStream;
  if (input.logoKey) {
    const obj = await env.MEDIA.get(input.logoKey);
    if (!obj) throw new Error(`No logo at ${input.logoKey}.`);
    logoBody = obj.body;
  } else if (input.logoUrl) {
    logoBody = (await fetchHttpsImage(input.logoUrl, "Logo")).body!;
  } else {
    throw new Error("Give logoUrl or a brand with a saved kit logo.");
  }

  // Images transformations are free up to 5,000 a month on this plan; the ledger counts them at US$0.
  const spendId = await reserve(env, "images", "compose", input.key, 0);
  try {
    const { logoWidth, top } = placement(row.width, row.height, input.logoWidthPct, input.logoTopPct);
    let img = env.IMAGES.input(base.body);
    if (input.grain === "on") {
      const grain = await env.MEDIA.get(GRAIN_KEY);
      if (!grain) throw new Error(`Grain tile missing at ${GRAIN_KEY}.`);
      img = img.draw(env.IMAGES.input(grain.body), { repeat: true, opacity: input.grainPct / 100 });
    }
    // Trim the transparent border first, so width and top apply to the visible mark, not to the file's padding.
    img = img.draw(env.IMAGES.input(logoBody).transform({ trim: "border" }).transform({ width: logoWidth }), { top });
    const out = await img.output({ format: "image/jpeg", quality: 92 });
    const bytes = await out.response().arrayBuffer();
    // A new key per compose, so an approved image is never replaced.
    const outKey = `renders/${id}/${n}-c${Date.now()}${crypto.getRandomValues(new Uint32Array(1))[0]}.jpg`;
    await env.MEDIA.put(outKey, bytes, { httpMetadata: { contentType: "image/jpeg" } });
    await settle(env, spendId, true);
    return { key: outKey, url: mediaUrl(env, outKey), logoWidth, top, grain: input.grain };
  } catch (e) {
    await settle(env, spendId, false);
    throw e;
  }
}

/** A picture made outside the Worker (scripts/box_print.py), saved by an upload_link PUT or by PUT /admin/repair/<uuid>.jpg. */
export const REPAIR_KEY = /^repairs\/[0-9a-f-]{36}\.jpg$/;

/** Width and height from the first frame header of a JPEG, or null when the bytes are not a JPEG. */
export function jpegSize(b: Uint8Array): { width: number; height: number } | null {
  if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8) return null;
  let i = 2;
  while (i + 9 < b.length) {
    if (b[i] !== 0xff) return null;
    const m = b[i + 1]!;
    if (m === 0xff) {
      i += 1; // a fill byte
      continue;
    }
    if (m === 0xd8 || m === 0x01 || (m >= 0xd0 && m <= 0xd7)) {
      i += 2; // a marker with no length
      continue;
    }
    if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return { height: (b[i + 5]! << 8) | b[i + 6]!, width: (b[i + 7]! << 8) | b[i + 8]! };
    i += 2 + ((b[i + 2]! << 8) | b[i + 3]!);
  }
  return null;
}

/** A complete JPEG ends with the end-of-image marker FF D9 (zero padding after it is allowed). */
export function hasJpegEnd(b: Uint8Array): boolean {
  let n = b.length;
  while (n > 2 && b[n - 1] === 0) n--;
  return n >= 2 && b[n - 2] === 0xff && b[n - 1] === 0xd9;
}

/**
 * Take a repaired picture into the pack path. The picture must be a JPEG of the same size as the final it repairs.
 * It is saved under a new key (the same shape as a compose key), so the original and every earlier compose stay.
 */
export async function finalAttach(env: Env, input: { key: string; upload: string }) {
  const m = RENDER_KEY.exec(input.key);
  if (!m) throw new Error("key must be a render image key (renders/<id>/<n>.jpg).");
  if (!REPAIR_KEY.test(input.upload)) throw new Error("upload must be a repair key (repairs/<uuid>.jpg), saved with an upload_link PUT or PUT /admin/repair/<uuid>.jpg.");
  const [, id, n] = m;
  const row = await env.DB.prepare("SELECT width, height, kind, status, composed_key FROM renders WHERE id = ?")
    .bind(id)
    .first<{ width: number; height: number; kind: string; status: string; composed_key: string | null }>();
  if (!row) throw new Error(`No render with id ${id}.`);
  if (row.kind !== "final" || row.status !== "done") throw new Error(`Render ${id} is not a completed final (${row.kind}, ${row.status}).`);
  // The repair is of the composed picture (logo and grain in). A final that was never composed has nothing to repair.
  if (!row.composed_key?.startsWith("renders/")) throw new Error(`Render ${id} is not composed yet: run compose_final first, repair its composed picture, then final_attach.`);
  const obj = await env.MEDIA.get(input.upload);
  if (!obj) throw new Error(`No image at ${input.upload}.`);
  const bytes = await obj.arrayBuffer();
  const view = new Uint8Array(bytes);
  const size = jpegSize(view);
  if (!size) throw new Error(`${input.upload} is not a JPEG.`);
  if (!hasJpegEnd(view)) throw new Error(`${input.upload} is cut short: a complete JPEG ends with the end marker. Upload the whole file again.`);
  if (size.width !== row.width || size.height !== row.height) {
    throw new Error(`${input.upload} is ${size.width}x${size.height}, but the final is ${row.width}x${row.height}. Repair the picture at its own size.`);
  }
  const outKey = `renders/${id}/${n}-c${Date.now()}${crypto.getRandomValues(new Uint32Array(1))[0]}.jpg`;
  // The mark tells picks_get that this composed picture is a repair, not a plain compose.
  await env.MEDIA.put(outKey, bytes, { httpMetadata: { contentType: "image/jpeg" }, customMetadata: { repairedFrom: input.upload } });
  return { key: outKey, url: mediaUrl(env, outKey), width: size.width, height: size.height };
}
