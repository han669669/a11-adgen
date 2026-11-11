import type { Env } from "./env";
import { pasteBack } from "./paste";
import { PRICE, reserve, settle } from "./spend";

/** A batch needs about 20 renders; submit refuses more than this, so batch_get never cuts the list. */
export const MAX_BATCH_RENDERS = 150;

export const FAL_MODEL = "openai/gpt-image-2.5/sunburst/edit";
const QUEUE = "https://queue.fal.run";

/** 4:5 sizes. Both sides are multiples of 16, as fal needs. */
export const SIZES = {
  draft: { width: 1024, height: 1280, quality: "low" },
  final: { width: 1536, height: 1920, quality: "high" },
} as const;

/** Code adds this once to every render prompt (hard check 4: no painted CTA). */
export const RENDER_SUFFIX =
  "Format: a 4:5 portrait static ad. Do not paint a button, a call to action, a URL or a price that the brief does not give. Keep every text and the logo well inside the frame. " +
  // Owner's v1 picture notes (docs/render-checklist.md D1, D3, D4, F1): true for every ad, so set once here.
  "No readable text except the quoted strings and the product's own label: no handwriting, notes, cards or printed paper on props. " +
  "Every object keeps its real size next to the product and either rests on a surface with a contact shadow or is held in a hand; nothing floats. " +
  "No drip, spill or stain on the product or a prop.";

export type Kind = keyof typeof SIZES;

export function estimate(kind: Kind, numImages: number, numRefs: number): number {
  const perImage = kind === "draft" ? PRICE.falDraftImage : PRICE.falFinalImage;
  return Number((perImage * numImages + PRICE.falReference * numRefs + PRICE.falPrompt).toFixed(4));
}

function auth(env: Env) {
  if (!env.FAL_KEY) throw new Error("FAL_KEY is not set on the Worker.");
  return { Authorization: `Key ${env.FAL_KEY}` };
}

export interface SubmitInput {
  batch: string;
  idea: string;
  kind: Kind;
  prompt: string;
  referenceUrls: string[];
  numImages: number;
  /** Mask PNG URL: white = edit, black = keep (the food truth stage). */
  maskUrl?: string;
  /** Render id chosen by the caller, so it can store data for the render before fal accepts it (food_fix paste plan). */
  id?: string;
}

/** fal took the job (it is billed) but the render row was not saved. The caller must not start the job again. */
export class AcceptedError extends Error {
  constructor(message: string, readonly renderId: string) {
    super(message);
  }
}

export async function submit(env: Env, input: SubmitInput) {
  const size = SIZES[input.kind];
  const id = input.id ?? crypto.randomUUID();
  const usd = estimate(input.kind, input.numImages, input.referenceUrls.length);
  const prompt = `${input.prompt.trim()}\n\n${RENDER_SUFFIX}`;
  const count = await env.DB.prepare("SELECT COUNT(*) AS n FROM renders WHERE batch = ?").bind(input.batch).first<{ n: number }>();
  if ((count?.n ?? 0) >= MAX_BATCH_RENDERS) throw new Error(`Batch ${input.batch} has ${MAX_BATCH_RENDERS} renders, the limit. Start a new batch.`);
  const spendId = await reserve(env, "fal", input.kind, id, usd);
  const now = new Date().toISOString();
  let accepted = false; // once fal accepts, the render is billed: never release its reservation
  try {
    const res = await fetch(`${QUEUE}/${FAL_MODEL}`, {
      method: "POST",
      headers: { ...auth(env), "content-type": "application/json" },
      body: JSON.stringify({
        prompt,
        image_urls: input.referenceUrls,
        ...(input.maskUrl ? { mask_url: input.maskUrl } : {}),
        image_size: { width: size.width, height: size.height },
        quality: size.quality,
        num_images: input.numImages,
        output_format: "jpeg",
        output_compression: 90,
      }),
      signal: AbortSignal.timeout(25_000),
    });
    if (!res.ok) throw new Error(`fal submit failed: HTTP ${res.status} ${(await res.text()).slice(0, 300)}`);
    const q = (await res.json()) as { request_id: string; status_url: string; response_url: string };
    accepted = true;
    await settle(env, spendId, true);
    const insert = () =>
      env.DB.prepare(
        `INSERT INTO renders (id, batch, idea, kind, status, prompt, refs, width, height, quality, num_images,
          fal_request_id, status_url, response_url, usd_est, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'queued', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
        .bind(id, input.batch, input.idea, input.kind, prompt, JSON.stringify(input.referenceUrls),
          size.width, size.height, size.quality, input.numImages,
          q.request_id, q.status_url, q.response_url, usd, now, now)
        .run();
    try {
      await insert();
    } catch {
      // The job is billed. Try the row once more; then tell the caller that it must not submit again.
      try {
        await insert();
      } catch (e) {
        throw new AcceptedError(
          `fal accepted render ${id} (request ${q.request_id}) but the row was not saved: ${(e as Error).message}. Do not submit again; tell the owner.`,
          id,
        );
      }
    }
    return { id, usdEstimate: usd, status: "queued" as const };
  } catch (e) {
    if (!accepted) await settle(env, spendId, false);
    throw e;
  }
}

interface RenderRow {
  id: string;
  status: string;
  status_url: string;
  response_url: string;
  image_keys: string | null;
  error: string | null;
  kind: string;
  usd_est: number;
}

function read(env: Env, id: string) {
  return env.DB.prepare(
    "SELECT id, status, status_url, response_url, image_keys, error, kind, usd_est FROM renders WHERE id = ?",
  ).bind(id).first<RenderRow>();
}

/** Check a render. When fal is done, copy the images to R2 once and return their keys. */
export async function check(env: Env, id: string) {
  const row = await read(env, id);
  if (!row) throw new Error(`No render with id ${id}.`);
  if (row.status !== "queued") return view(env, row);

  // Network errors and HTTP 5xx/429 are transient: the row stays queued and the next poll tries again.
  const st = await fetch(row.status_url, { headers: auth(env), signal: AbortSignal.timeout(15_000) });
  if (!st.ok && st.status !== 202) {
    if (transient(st.status)) return { id, status: "queued", note: `fal status HTTP ${st.status}; poll again.` };
    return fail(env, row, `fal status failed: HTTP ${st.status} ${(await st.text()).slice(0, 300)}`);
  }
  const s = (await st.json()) as { status: string };
  if (s.status !== "COMPLETED") return { id, status: "queued", falStatus: s.status };

  const out = await fetch(row.response_url, { headers: auth(env), signal: AbortSignal.timeout(15_000) });
  if (!out.ok) {
    if (transient(out.status)) return { id, status: "queued", note: `fal result HTTP ${out.status}; poll again.` };
    return fail(env, row, `fal result failed: HTTP ${out.status} ${(await out.text()).slice(0, 300)}`);
  }
  const data = (await out.json()) as { images?: { url: string; content_type?: string }[] };
  const images = data.images ?? [];
  const keys: string[] = [];
  for (const [i, img] of images.entries()) {
    const file = await fetch(img.url, { signal: AbortSignal.timeout(15_000) });
    if (!file.ok) {
      // A temporary error from the image host: stay queued, the next poll downloads again (R2 puts repeat safely).
      if (transient(file.status)) return { id, status: "queued", note: `image download HTTP ${file.status}; poll again.` };
      continue;
    }
    const key = `renders/${id}/${i + 1}.jpg`;
    const raw = await file.arrayBuffer();
    // A food_fix result keeps the original outside its boxes (paste.ts). When the paste fails, the render fails:
    // the raw fal image is never saved in its place.
    let merged: ArrayBuffer | null = null;
    if (row.kind === "final") {
      try {
        merged = await pasteBack(env, id, raw);
      } catch (e) {
        return fail(env, row, `paste-back failed: ${(e as Error).message}`);
      }
    }
    await env.MEDIA.put(key, merged ?? raw, {
      httpMetadata: { contentType: merged ? "image/jpeg" : (img.content_type ?? "image/jpeg") },
    });
    keys.push(key);
  }
  // A short download is a failure (cubic, PR #1); the saved keys stay listed, so the images remain usable.
  const status = keys.length > 0 && keys.length === images.length ? "done" : "failed";
  const error =
    images.length === 0 ? "fal returned no images" : keys.length === images.length ? null : `saved ${keys.length} of ${images.length} images`;
  // Only a queued row takes the result: a late poll must not overwrite what another poll finished.
  const res = await env.DB.prepare("UPDATE renders SET status = ?, image_keys = ?, error = ?, updated_at = ? WHERE id = ? AND status = 'queued'")
    .bind(status, JSON.stringify(keys), error, new Date().toISOString(), id)
    .run();
  if (res.meta.changes !== 1) return view(env, (await read(env, id)) ?? row);
  return view(env, { ...row, status, error, image_keys: JSON.stringify(keys) });
}

export function transient(httpStatus: number): boolean {
  return httpStatus === 429 || httpStatus >= 500;
}

async function fail(env: Env, row: RenderRow, error: string) {
  const res = await env.DB.prepare("UPDATE renders SET status = 'failed', error = ?, updated_at = ? WHERE id = ? AND status = 'queued'")
    .bind(error, new Date().toISOString(), row.id)
    .run();
  // Another poll finished the render first: give its state, never a false failure.
  if (res.meta.changes !== 1) return view(env, (await read(env, row.id)) ?? row);
  return view(env, { ...row, status: "failed", error });
}

function view(env: Env, row: RenderRow) {
  const keys: string[] = row.image_keys ? JSON.parse(row.image_keys) : [];
  return {
    id: row.id,
    kind: row.kind,
    status: row.status,
    usdEstimate: row.usd_est,
    error: row.error,
    images: keys.map((key) => ({ key, url: mediaUrl(env, key) })),
  };
}

export function mediaUrl(env: Env, key: string): string {
  return `${env.PUBLIC_BASE_URL.replace(/\/$/, "")}/m/${key}`;
}
