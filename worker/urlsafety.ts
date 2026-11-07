/**
 * Server-side fetches of a URL that someone else supplied (a page, a stylesheet, a logo) go to public hosts only.
 * Ported from ai-ad-generator `convex/lib/urlSafety.ts` (isPublicHost), without its DNS lookup:
 * a Worker's fetch runs on Cloudflare's edge and cannot reach a private network, so the name check is a second fence, not the only one.
 * Not caught: a public name that points at a private address (the edge refuses it).
 */
export function isPublicHost(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
  if (!h || (!h.includes(".") && !h.includes(":"))) return false; // "localhost", single labels
  if (/(^|\.)(localhost|local|internal|intranet|lan|home|corp|localdomain)$/.test(h)) return false;
  const v4 = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    if (a === 0 || a === 10 || a === 127 || a >= 224) return false;
    if (a === 169 && b === 254) return false;
    if (a === 172 && b >= 16 && b <= 31) return false;
    if (a === 192 && b === 168) return false;
    if (a === 100 && b >= 64 && b <= 127) return false;
    return true;
  }
  if (h.includes(":")) {
    // IPv6 literal: loopback, unspecified, unique-local (fc00::/7), link-local (fe80::/10), site-local (fec0::/10), IPv4-mapped.
    if (h === "::1" || h === "::" || /^f[cd]/.test(h) || /^fe[89a-f]/.test(h) || h.startsWith("::ffff:")) return false;
    return true;
  }
  return true;
}

/** True for an https URL on a public host. */
export function isPublicHttpsUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === "https:" && isPublicHost(u.hostname);
  } catch {
    return false;
  }
}
