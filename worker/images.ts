/** Largest brand image the Worker reads (logo or reference photo). */
export const MAX_IMAGE_BYTES = 8_000_000;

/** Fetch an image over HTTPS only (also after redirects), so nobody on the path can swap a brand file. */
export async function fetchHttpsImage(url: string, what: string): Promise<Response> {
  if (new URL(url).protocol !== "https:") throw new Error(`${what} URL must use HTTPS.`);
  const res = await fetch(url, { headers: { "user-agent": "Mozilla/5.0 (a11adgen)" }, signal: AbortSignal.timeout(15_000) });
  if (!res.url.startsWith("https:")) throw new Error(`${what} URL redirected to a non-HTTPS address.`);
  const type = contentType(res);
  if (!res.ok || !type.startsWith("image/")) throw new Error(`${what} URL did not return an image (HTTP ${res.status}, ${type || "no type"}).`);
  if (Number(res.headers.get("content-length") ?? 0) > MAX_IMAGE_BYTES) throw new Error(`${what} is larger than ${MAX_IMAGE_BYTES} bytes.`);
  return res;
}

/** The media type in lower case (media types are case-insensitive). */
export function contentType(res: Response): string {
  return (res.headers.get("content-type") ?? "").toLowerCase();
}

/** Read a body, but stop at MAX_IMAGE_BYTES even when the server sent no Content-Length. */
export async function readCapped(res: Response, what: string): Promise<Uint8Array> {
  const reader = res.body?.getReader();
  if (!reader) return new Uint8Array(await res.arrayBuffer());
  const parts: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_IMAGE_BYTES) {
      await reader.cancel();
      throw new Error(`${what} is larger than ${MAX_IMAGE_BYTES} bytes.`);
    }
    parts.push(value);
  }
  const out = new Uint8Array(size);
  let at = 0;
  for (const part of parts) (out.set(part, at), (at += part.byteLength));
  return out;
}

/** File suffix for a stored raster image. SVG is refused before this point. */
export function extFor(type: string): "png" | "jpg" | "webp" {
  if (type.includes("png")) return "png";
  if (type.includes("webp")) return "webp";
  return "jpg";
}
