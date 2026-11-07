import { isPublicHost } from "./urlsafety";

/** Largest brand image the Worker reads (logo or reference photo). */
export const MAX_IMAGE_BYTES = 8_000_000;

const IMAGE_REDIRECTS = 5;

/**
 * Fetch an image over HTTPS only. Redirects are followed by hand, so every hop is checked before the request goes out:
 * https, and a public host (never a loopback, private or metadata address). The old check ran after fetch had already followed a redirect.
 */
export async function fetchHttpsImage(url: string, what: string): Promise<Response> {
  let at = url;
  const signal = AbortSignal.timeout(15_000); // one bound for the whole chain, not one per hop
  let res!: Response;
  for (let hop = 0; hop <= IMAGE_REDIRECTS; hop++) {
    const u = new URL(at);
    if (u.protocol !== "https:") throw new Error(hop === 0 ? `${what} URL must use HTTPS.` : `${what} URL redirected to a non-HTTPS address.`);
    if (!isPublicHost(u.hostname)) throw new Error(`${what} URL must point at a public host.`);
    res = await fetch(at, { headers: { "user-agent": "Mozilla/5.0 (a11adgen)" }, redirect: "manual", signal });
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get("location");
      await res.body?.cancel();
      if (!loc) throw new Error(`${what} URL redirected without a location.`);
      at = new URL(loc, at).href;
      continue;
    }
    break;
  }
  if (res.status >= 300 && res.status < 400) throw new Error(`${what} URL redirected too many times.`);
  const type = contentType(res);
  if (!res.ok || !type.startsWith("image/")) throw new Error(`${what} URL did not return an image (HTTP ${res.status}, ${type || "no type"}).`);
  if (Number(res.headers.get("content-length") ?? 0) > MAX_IMAGE_BYTES) throw new Error(`${what} is larger than ${MAX_IMAGE_BYTES} bytes.`);
  return res;
}

/** The media type in lower case (media types are case-insensitive). */
export function contentType(res: Response): string {
  return (res.headers.get("content-type") ?? "").toLowerCase();
}

/** Thrown when a body is larger than the limit. A caller that only wants the size error catches this class. */
export class TooLargeError extends Error {}

/** Read a body, but stop at max bytes (default MAX_IMAGE_BYTES) even when the server sent no Content-Length. Throws TooLargeError past the limit. */
export async function readCapped(res: Pick<Response, "body" | "arrayBuffer">, what: string, max = MAX_IMAGE_BYTES): Promise<Uint8Array> {
  const reader = res.body?.getReader();
  if (!reader) return new Uint8Array(await res.arrayBuffer());
  const parts: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel();
      throw new TooLargeError(`${what} is larger than ${max} bytes.`);
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
