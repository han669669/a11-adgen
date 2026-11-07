import type { Env } from "./env";
import { mediaUrl } from "./fal";
import { contentType, extFor, fetchHttpsImage, readCapped } from "./images";

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
  /** The real food in words, written once from the texture photos (shape, surface, colour, how pieces sit). */
  food?: string;
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
  /** Absent in kits saved before 07-11-2026. */
  food?: string;
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
 * Order: fetch and check every file first; store them in R2 under a new kit id; then write the brand and the kit row
 * in one D1 transaction, with the version taken inside it (so two saves cannot get the same version).
 * When the D1 write fails, the stored files are deleted, so a failed save leaves nothing behind.
 * The logo is trimmed (transparent border removed), so placement numbers apply to the visible mark.
 */
export async function brandSave(env: Env, input: { slug: string; name: string; siteUrl?: string; kit: KitInput; note?: string }) {
  const logoRes = await fetchHttpsImage(input.kit.logoUrl, "Logo");
  // Cloudflare Images does not draw SVG files into a picture, so the kit needs raster files.
  if (contentType(logoRes).includes("svg")) throw new Error("Logo must be a PNG or WebP file, not SVG.");
  const logoBytes = await readCapped(logoRes, "Logo");
  const refFiles: { bytes: Uint8Array; type: string; ref: KitRefInput }[] = [];
  for (const [i, ref] of (input.kit.refs ?? []).entries()) {
    const res = await fetchHttpsImage(ref.url, `Reference ${i + 1}`);
    const type = contentType(res);
    if (type.includes("svg")) throw new Error(`Reference ${i + 1} must be a PNG, JPEG or WebP file, not SVG.`);
    refFiles.push({ bytes: await readCapped(res, `Reference ${i + 1}`), type, ref });
  }
  const trimmed = await env.IMAGES.input(new Blob([logoBytes]).stream()).transform({ trim: "border" }).output({ format: "image/png" });
  const trimmedBytes = await trimmed.response().arrayBuffer();

  const kitId = crypto.randomUUID();
  const base = `brands/${kitId}`;
  const logoKey = `${base}/logo.png`;
  const puts: { key: string; bytes: ArrayBuffer | Uint8Array; type: string }[] = [{ key: logoKey, bytes: trimmedBytes, type: "image/png" }];
  const refs: Kit["refs"] = refFiles.map((f, i) => {
    const key = `${base}/ref${i + 1}.${extFor(f.type)}`;
    puts.push({ key, bytes: f.bytes, type: f.type });
    return { key, url: mediaUrl(env, key), sourceUrl: f.ref.url, label: f.ref.label, role: f.ref.role };
  });
  const kit: Kit = {
    logo: { key: logoKey, url: mediaUrl(env, logoKey), sourceUrl: input.kit.logoUrl },
    palette: input.kit.palette,
    fonts: input.kit.fonts ?? [],
    voice: input.kit.voice,
    neverSay: input.kit.neverSay ?? [],
    refs,
    placement: { logoWidthPct: input.kit.logoWidthPct ?? 28, logoTopPct: input.kit.logoTopPct ?? 3 },
    notes: input.kit.notes ?? "",
    food: input.kit.food ?? "",
  };

  for (const f of puts) await env.MEDIA.put(f.key, f.bytes, { httpMetadata: { contentType: f.type } });
  const now = new Date().toISOString();
  try {
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO brands (id, slug, name, site_url, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT (slug) DO UPDATE SET name = excluded.name, site_url = COALESCE(excluded.site_url, brands.site_url), updated_at = excluded.updated_at`,
      ).bind(crypto.randomUUID(), input.slug, input.name, input.siteUrl ?? null, now, now),
      env.DB.prepare(
        `INSERT INTO brand_kits (id, brand_id, version, kit, note, created_at)
         SELECT ?, b.id, (SELECT COALESCE(MAX(k.version), 0) + 1 FROM brand_kits k WHERE k.brand_id = b.id), ?, ?, ?
         FROM brands b WHERE b.slug = ?`,
      ).bind(kitId, JSON.stringify(kit), input.note ?? null, now, input.slug),
    ]);
  } catch (e) {
    await Promise.allSettled(puts.map((f) => env.MEDIA.delete(f.key)));
    throw e;
  }
  const row = await env.DB.prepare("SELECT k.brand_id, k.version FROM brand_kits k WHERE k.id = ?").bind(kitId).first<{ brand_id: string; version: number }>();
  return { brandId: row!.brand_id, slug: input.slug, version: row!.version, kit };
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
