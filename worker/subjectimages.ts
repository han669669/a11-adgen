import type { Env } from "./env";
import { fetchHttpsImage, MAX_IMAGE_BYTES, readCapped } from "./images";
import { IMAGE_TYPES } from "./uploads";

/** Most images a subject keeps (the same as the subject_save schema). */
export const SUBJECT_IMAGES_MAX = 6;

/**
 * Fetch a live ad's images and keep them in R2 under `subjects/<subject id>/<n>.<ext>`.
 * That key is not on the public /m/ route: only image_get reads it. The page and the pictures are the web's, so:
 * https only, a public host on every redirect hop, 8 MB cap, and the real type comes from the bytes (never from the header).
 * One bad image does not stop the others: its reason goes in `errors`.
 */
export async function storeSubjectImages(env: Env, subjectId: string, urls: string[]): Promise<{ keys: string[]; errors: string[] }> {
  const keys: string[] = [];
  const errors: string[] = [];
  // One at a time: each body is held in memory (up to 8 MB) before it is written.
  for (const [i, url] of urls.slice(0, SUBJECT_IMAGES_MAX).entries()) {
    const what = `Image ${i + 1}`;
    try {
      const res = await fetchHttpsImage(url, what);
      const bytes = await readCapped(res, what, MAX_IMAGE_BYTES);
      const kind = IMAGE_TYPES.find((t) => t.is(bytes.subarray(0, 16)));
      if (!kind) throw new Error(`${what} is not a PNG, JPEG or WebP file.`);
      const key = `subjects/${subjectId}/${i + 1}.${kind.ext}`;
      await env.MEDIA.put(key, bytes, { httpMetadata: { contentType: kind.type } });
      keys.push(key);
    } catch (e) {
      errors.push(e instanceof Error ? e.message : `${what} could not be read.`);
    }
  }
  return { keys, errors };
}
