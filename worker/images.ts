/** Fetch an image over HTTPS only (also after redirects), so nobody on the path can swap a brand file. */
export async function fetchHttpsImage(url: string, what: string): Promise<Response> {
  if (new URL(url).protocol !== "https:") throw new Error(`${what} URL must use HTTPS.`);
  const res = await fetch(url, { headers: { "user-agent": "Mozilla/5.0 (a11adgen)" }, signal: AbortSignal.timeout(15_000) });
  if (!res.url.startsWith("https:")) throw new Error(`${what} URL redirected to a non-HTTPS address.`);
  const type = res.headers.get("content-type") ?? "";
  if (!res.ok || !type.startsWith("image/")) throw new Error(`${what} URL did not return an image (HTTP ${res.status}, ${type || "no type"}).`);
  return res;
}

export function extFor(contentType: string): "png" | "jpg" | "webp" | "svg" {
  if (contentType.includes("png")) return "png";
  if (contentType.includes("webp")) return "webp";
  if (contentType.includes("svg")) return "svg";
  return "jpg";
}
