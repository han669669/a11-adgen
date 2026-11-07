// The brand's own logo from the home page HTML. Pure module.
// Ported from ai-ad-generator `convex/lib/logoHtml.ts`, where each rule was added after a real brand failed
// (Love, Bonito, Allies of Skin, ErgoTune, Our Place, Bacha, Prefer, IRVINS, Gryphon Tea).
// Difference: an inline SVG is only detected here, never stored. brand_extract reports it, and the owner supplies the file.

export type HeaderLogo = { kind: "img"; url: string } | { kind: "svg" };

/** Largest inline SVG looked at (a wordmark is a few KB; a 200 KB SVG is an illustration). */
const SVG_MAX_CHARS = 200_000;
/** How much of the page counts as the header when the page has no <header> element. */
const HEAD_CHARS = 250_000;

const attr = (tag: string, name: string): string | undefined => {
  const m = tag.match(new RegExp(`\\s${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, "i"));
  return m ? (m[2] ?? m[3] ?? m[4] ?? "").trim() : undefined;
};

const decode = (s: string) => s.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">");

/** True when a link points at the site's home page: "/", the origin, or a locale root such as "/sg" or "/en-us/". */
function isHomeLink(href: string | undefined, pageUrl: string): boolean {
  // A link with a fragment ("#", "/en/#") is an in-page button (a menu, a cart, a country picker), not a home link.
  // Rendered HTML writes href="#" as an absolute URL ("https://bachacoffee.com/en/#"), so the test is on the whole href.
  if (href === undefined || /#|^\s*$|^\s*javascript:/i.test(href)) return false;
  try {
    const page = new URL(pageUrl);
    const u = new URL(decode(href), page);
    if (u.host !== page.host) return false;
    const path = u.pathname.replace(/\/+$/, "");
    return path === "" || /^\/[a-z]{2}(?:[-_][a-z]{2})?$/i.test(path);
  } catch {
    return false;
  }
}

/** The element at `start` up to its matching close tag (nested tags of the same name counted), or "" when it does not close. */
function balanced(html: string, start: number, name: string): string {
  const re = new RegExp(`<(/?)${name}\\b[^>]*?(/?)>`, "gi");
  re.lastIndex = start;
  let depth = 0;
  for (let m = re.exec(html); m; m = re.exec(html)) {
    if (m[1]) depth--;
    else if (!m[2]) depth++;
    if (depth === 0) return html.slice(start, m.index + m[0].length);
    if (m.index - start > SVG_MAX_CHARS) return "";
  }
  return "";
}

/** True when an inline SVG draws something of its own: it has a shape, and no <use> that points at a symbol outside it (an icon sprite). */
function drawsItself(svg: string): boolean {
  if (!svg || svg.length > SVG_MAX_CHARS) return false;
  for (const m of svg.matchAll(/<use\b[^>]*(?:xlink:)?href\s*=\s*["']#([^"']+)["']/gi)) {
    const id = m[1]!.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (!new RegExp(`\\sid\\s*=\\s*["']${id}["']`).test(svg)) return false;
  }
  return /<(path|polygon|rect|circle|ellipse|text|g|use|polyline)\b/i.test(svg);
}

/** True when an SVG names itself a logo in its class, id, label, test id or <title>. */
const svgNamesLogo = (svg: string) => {
  const open = svg.match(/^<svg\b[^>]*>/i)?.[0] ?? "";
  const title = svg.match(/<title\b[^>]*>([^<]*)</i)?.[1] ?? "";
  return /logo|brand|wordmark/.test(["class", "id", "aria-label", "data-testid"].map((a) => attr(open, a) ?? "").join(" ").concat(" ", title).toLowerCase());
};

/** UI icon names that are never a brand logo, as they appear in icon classes, ids and labels. */
const UI_ICON = /(^|[^a-z])(icon|lucide|check(mark)?|cart|bag|basket|search|menu|hamburger|close|arrow|chevron|caret|account|user|heart|wishlist|plus|minus|globe|flag)([^a-z]|$)/;
/** Largest viewBox side (in user units) of an unlabelled SVG that counts as an icon: icon sets draw on 24 units or less. */
const ICON_MAX_UNITS = 24;

/** True when an inline SVG is a UI icon: its own class, id or label names an icon and not a logo, or it has no logo label and an icon-sized viewBox. */
export function isUiIconSvg(svg: string): boolean {
  const open = svg.match(/^<svg\b[^>]*>/i)?.[0] ?? "";
  const label = ["class", "id", "aria-label", "data-testid"].map((a) => attr(open, a) ?? "").join(" ").toLowerCase();
  if (svgNamesLogo(svg)) return false;
  if (UI_ICON.test(label)) return true;
  const vb = (attr(open, "viewBox") ?? attr(open, "viewbox") ?? "").split(/[\s,]+/).map(Number);
  return vb.length === 4 && vb[2]! > 0 && vb[3]! > 0 && vb[2]! <= ICON_MAX_UNITS && vb[3]! <= ICON_MAX_UNITS;
}

/** The path of an image URL, decoded and lower case: its folders and file ("…/country-flag-images/united-states.svg"). */
const imagePath = (url: string) => {
  try {
    const p = new URL(url).pathname;
    try {
      return decodeURIComponent(p).toLowerCase();
    } catch {
      return p.toLowerCase();
    }
  } catch {
    return "";
  }
};

/** True when a header <img> is a UI icon: its class, id, alt or label, or a folder or file name of its path, names an icon. A name with "logo", "brand" or "wordmark" is never an icon. */
export function isUiIconImg(img: string, url: string): boolean {
  const label = ["class", "id", "alt", "aria-label"].map((a) => attr(img, a) ?? "").join(" ").toLowerCase();
  const path = imagePath(url);
  if (/logo|brand|wordmark/.test(`${label} ${path}`)) return false;
  return UI_ICON.test(label) || UI_ICON.test(path);
}

/** Most words a label (alt, aria-label, title) may have besides the brand name and still name the logo ("Our Place logo"). */
const BRAND_LABEL_EXTRA_WORDS = 3;

/**
 * A logo container: a link to the home page, a tag whose class, id, label, alt, title or test id names a logo, or a tag that names the brand.
 * A class, id or test id may hold the brand anywhere ("ourplace-logo"); an alt, aria-label or title names the brand only when it is short,
 * because a product photo's alt text often names the brand.
 */
function isLogoTag(tag: string, pageUrl: string, brand: string): boolean {
  const name = tag.match(/^<([a-z0-9-]+)/i)?.[1]?.toLowerCase() ?? "";
  if (name === "a" && isHomeLink(attr(tag, "href"), pageUrl)) return true;
  const label = ["class", "id", "aria-label", "alt", "title", "data-testid"].map((a) => attr(tag, a) ?? "").join(" ").toLowerCase();
  if (/(^|[^a-z])logo/.test(label)) return true;
  const brandWords = brand.toLowerCase().match(/[a-z0-9]+/g) ?? [];
  const b = brandWords.join("");
  if (b.length < 3) return false;
  const names = (v: string) => v.toLowerCase().replace(/[^a-z0-9]+/g, "").includes(b);
  if (["class", "id", "data-testid"].some((a) => names(attr(tag, a) ?? ""))) return true;
  return ["aria-label", "alt", "title"].some((a) => {
    const v = attr(tag, a) ?? "";
    return names(v) && (v.match(/[a-z0-9]+/gi) ?? []).length <= brandWords.length + BRAND_LABEL_EXTRA_WORDS;
  });
}

/**
 * The logos in the page header, best first (at most 2): the first inline SVG or image inside a logo container.
 * The header is every <header> element of the page; when they hold none, the start of the page.
 */
export function headerLogos(html: string, pageUrl: string, brand: string): HeaderLogo[] {
  const headers = [...html.matchAll(/<header\b[\s\S]*?<\/header\s*>/gi)].map((m) => m[0]);
  const inHeaders = headers.length ? logosIn(headers.join("\n"), pageUrl, brand) : [];
  return inHeaders.length ? inHeaders : logosIn(html.slice(0, HEAD_CHARS), pageUrl, brand);
}

function logosIn(region: string, pageUrl: string, brand: string): HeaderLogo[] {
  const out: HeaderLogo[] = [];
  const seen = new Set<string>();
  for (const m of region.matchAll(/<(a|div|span|figure|picture|svg|img|h1|p)\b[^>]*>/gi)) {
    if (out.length >= 2) break;
    const tag = m[0];
    if (!isLogoTag(tag, pageUrl, brand)) continue;
    const at = m.index ?? 0;
    const name = m[1]!.toLowerCase();
    // The logo itself, or the first SVG or image inside the container element (never past its close tag).
    const scope = name === "img" ? tag : name === "svg" ? balanced(region, at, "svg") : balanced(region, at, name).slice(0, 8_000);
    const svgAt = scope.search(/<svg\b/i);
    const imgAt = scope.search(/<img\b/i);
    if (svgAt >= 0 && (imgAt < 0 || svgAt < imgAt)) {
      const first = balanced(region, at + svgAt, "svg");
      // A box (not a link) with several SVGs is a picture made of parts: one unnamed part is not the logo (IRVINS mascot).
      if (name !== "a" && name !== "svg" && (scope.match(/<svg\b/gi) ?? []).length >= 2 && !svgNamesLogo(first)) continue;
      if (drawsItself(first) && !isUiIconSvg(first) && !seen.has(first)) {
        seen.add(first);
        out.push({ kind: "svg" });
      }
    } else if (imgAt >= 0) {
      const img = scope.slice(imgAt).match(/^<img\b[^>]*>/i)?.[0] ?? "";
      // A lazy-loaded logo has a data: placeholder in src and the real file in data-src or srcset.
      const src = [attr(img, "src"), attr(img, "data-src"), (attr(img, "srcset") ?? "").split(/\s+/)[0], (attr(img, "data-srcset") ?? "").split(/\s+/)[0]].find((x) => !!x && !x.startsWith("data:"));
      if (!src) continue;
      try {
        const url = new URL(decode(src), pageUrl).toString();
        if (/^https?:/.test(url) && !/\.ico(\?|$)/i.test(url) && !isUiIconImg(img, url) && !seen.has(url)) seen.add(url), out.push({ kind: "img", url });
      } catch {
        continue;
      }
    }
  }
  return out;
}

const jsonLdBlocks = (html: string): unknown[] =>
  [...html.matchAll(/<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script\s*>/gi)].flatMap((m) => {
    try {
      const v: unknown = JSON.parse(m[1]!);
      const list = Array.isArray(v) ? v : [v];
      return list.flatMap((x) => (x && typeof x === "object" && Array.isArray((x as { "@graph"?: unknown })["@graph"]) ? (x as { "@graph": unknown[] })["@graph"] : [x]));
    } catch {
      return [];
    }
  });

type Org = { name?: string; logo?: string };
function organization(html: string): Org {
  for (const b of jsonLdBlocks(html)) {
    if (!b || typeof b !== "object") continue;
    const o = b as Record<string, unknown>;
    const types = ([] as unknown[]).concat(o["@type"] ?? []);
    if (!types.some((t) => t === "Organization" || t === "Brand" || t === "Store" || t === "OnlineStore")) continue;
    const logo = o.logo && typeof o.logo === "object" ? (o.logo as { url?: unknown }).url : o.logo;
    return { name: typeof o.name === "string" ? o.name.trim() : undefined, logo: typeof logo === "string" ? logo : undefined };
  }
  return {};
}

/** The site's own brand name: og:site_name, else the JSON-LD Organization name, else the start of the title. "" when none. */
export function siteName(html: string): string {
  const og = html.match(/<meta\b[^>]*property\s*=\s*["']og:site_name["'][^>]*>/i)?.[0];
  const ogName = og ? decode(attr(og, "content") ?? "") : "";
  const title = decode(html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "");
  const candidates = [ogName, organization(html).name ?? "", title.split(/\s[|\-–—]\s|\s?[|–—]\s?/)[0] ?? ""];
  // A bracketed store or region note is not part of the name ("ALLIES [North America]").
  return candidates.map((c) => c.replace(/\s*[[(][^\])]*[\])]\s*/g, " ").replace(/\s+/g, " ").trim()).find((c) => c.length >= 2 && c.length <= 60) ?? "";
}

/** The JSON-LD Organization logo URL, resolved against the page; undefined when there is none. */
export function organizationLogo(html: string, pageUrl: string): string | undefined {
  const logo = organization(html).logo;
  if (!logo) return undefined;
  try {
    const u = new URL(logo, pageUrl).toString();
    return /^https?:/.test(u) ? u : undefined;
  } catch {
    return undefined;
  }
}

/** One key per image file: a CDN lists the same logo at many sizes (`?width=500`, `?width=600`). */
export const fileKey = (url: string) => {
  try {
    const u = new URL(url);
    return `${u.host}${u.pathname}`.toLowerCase();
  } catch {
    return url;
  }
};
