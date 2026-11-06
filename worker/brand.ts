import type { Env } from "./env";
import { mediaUrl } from "./fal";
import { extFor, fetchHttpsImage } from "./images";

export const SLUG = "^[a-z0-9][a-z0-9-]{1,40}$";

export interface KitRefInput {
  url: string;
  label: string;
  /** packshot = the real product; texture = a real close-up for food texture; style = a past ad or mood. */
  role: "packshot" | "texture" | "style";
}

export interface KitInput {
  logoUrl: string;
  palette: { hex: string; role: string }[];
  fonts?: string[];
  voice: string;
  neverSay?: string[];
  refs?: KitRefInput[];
  logoWidthPct?: number;
  logoTopPct?: number;
  notes?: string;
}

export interface Kit {
  logo: { key: string; url: string; sourceUrl: string };
  palette: { hex: string; role: string }[];
  fonts: string[];
  voice: string;
  neverSay: string[];
  refs: { key: string; url: string; sourceUrl: string; label: string; role: string }[];
  placement: { logoWidthPct: number; logoTopPct: number };
  notes: string;
}

interface BrandRow {
  id: string;
  slug: string;
  name: string;
  site_url: string | null;
}

export async function brandBySlug(env: Env, slug: string): Promise<BrandRow> {
  const row = await env.DB.prepare("SELECT id, slug, name, site_url FROM brands WHERE slug = ?").bind(slug).first<BrandRow>();
  if (!row) throw new Error(`No brand with slug ${slug}.`);
  return row;
}

export async function latestKit(env: Env, brandId: string, version?: number) {
  const row = version
    ? await env.DB.prepare("SELECT version, kit, note, created_at FROM brand_kits WHERE brand_id = ? AND version = ?")
        .bind(brandId, version)
        .first<{ version: number; kit: string; note: string | null; created_at: string }>()
    : await env.DB.prepare("SELECT version, kit, note, created_at FROM brand_kits WHERE brand_id = ? ORDER BY version DESC LIMIT 1")
        .bind(brandId)
        .first<{ version: number; kit: string; note: string | null; created_at: string }>();
  if (!row) return null;
  return { version: row.version, note: row.note, createdAt: row.created_at, kit: JSON.parse(row.kit) as Kit };
}

/**
 * Save a brand (created on first save) and a new kit version.
 * The logo is trimmed (transparent border removed) and stored in R2, so placement numbers apply to the visible mark.
 * Reference photos are copied to R2, so a later site change does not break old batches.
 */
export async function brandSave(env: Env, input: { slug: string; name: string; siteUrl?: string; kit: KitInput; note?: string }) {
  const now = new Date().toISOString();
  await env.DB.prepare(
    `INSERT INTO brands (id, slug, name, site_url, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT (slug) DO UPDATE SET name = excluded.name, site_url = COALESCE(excluded.site_url, brands.site_url), updated_at = excluded.updated_at`,
  )
    .bind(crypto.randomUUID(), input.slug, input.name, input.siteUrl ?? null, now, now)
    .run();
  const brand = await brandBySlug(env, input.slug);
  const prev = await latestKit(env, brand.id);
  const version = (prev?.version ?? 0) + 1;
  const base = `brands/${brand.id}/v${version}`;

  const logoRes = await fetchHttpsImage(input.kit.logoUrl, "Logo");
  // Cloudflare Images does not draw SVG files into a picture, so the kit needs a raster logo.
  if ((logoRes.headers.get("content-type") ?? "").includes("svg")) throw new Error("Logo must be a PNG or WebP file, not SVG.");
  const trimmed = await env.IMAGES.input(logoRes.body!).transform({ trim: "border" }).output({ format: "image/png" });
  const logoKey = `${base}-logo.png`;
  await env.MEDIA.put(logoKey, await trimmed.response().arrayBuffer(), { httpMetadata: { contentType: "image/png" } });

  const refs: Kit["refs"] = [];
  for (const [i, ref] of (input.kit.refs ?? []).entries()) {
    const res = await fetchHttpsImage(ref.url, `Reference ${i + 1}`);
    const type = res.headers.get("content-type") ?? "image/jpeg";
    const key = `${base}-ref${i + 1}.${extFor(type)}`;
    await env.MEDIA.put(key, await res.arrayBuffer(), { httpMetadata: { contentType: type } });
    refs.push({ key, url: mediaUrl(env, key), sourceUrl: ref.url, label: ref.label, role: ref.role });
  }

  const kit: Kit = {
    logo: { key: logoKey, url: mediaUrl(env, logoKey), sourceUrl: input.kit.logoUrl },
    palette: input.kit.palette,
    fonts: input.kit.fonts ?? [],
    voice: input.kit.voice,
    neverSay: input.kit.neverSay ?? [],
    refs,
    placement: { logoWidthPct: input.kit.logoWidthPct ?? 28, logoTopPct: input.kit.logoTopPct ?? 3 },
    notes: input.kit.notes ?? "",
  };
  await env.DB.prepare("INSERT INTO brand_kits (id, brand_id, version, kit, note, created_at) VALUES (?, ?, ?, ?, ?, ?)")
    .bind(crypto.randomUUID(), brand.id, version, JSON.stringify(kit), input.note ?? null, now)
    .run();
  return { brandId: brand.id, slug: brand.slug, version, kit };
}

export async function brandGet(env: Env, slug: string, version?: number) {
  const brand = await brandBySlug(env, slug);
  const kit = await latestKit(env, brand.id, version);
  return { brand: { id: brand.id, slug: brand.slug, name: brand.name, siteUrl: brand.site_url }, kit };
}

export async function brandList(env: Env) {
  const rows = await env.DB.prepare(
    `SELECT b.slug, b.name, b.site_url AS siteUrl, (SELECT MAX(version) FROM brand_kits k WHERE k.brand_id = b.id) AS kitVersion
     FROM brands b ORDER BY b.updated_at DESC LIMIT 100`,
  ).all();
  return rows.results;
}
