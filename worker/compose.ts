import type { Env } from "./env";
import { mediaUrl } from "./fal";
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
  logoUrl: string;
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

  // HTTPS only, also after redirects (brand CDNs often redirect), so nobody on the path can swap the logo.
  if (new URL(input.logoUrl).protocol !== "https:") throw new Error("Logo URL must use HTTPS.");
  const logo = await fetch(input.logoUrl, { headers: { "user-agent": "Mozilla/5.0 (a11adgen)" }, signal: AbortSignal.timeout(15_000) });
  if (!logo.url.startsWith("https:")) throw new Error("Logo URL redirected to a non-HTTPS address.");
  const type = logo.headers.get("content-type") ?? "";
  if (!logo.ok || !type.startsWith("image/")) throw new Error(`Logo URL did not return an image (HTTP ${logo.status}, ${type || "no type"}).`);

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
    img = img.draw(env.IMAGES.input(logo.body!).transform({ trim: "border" }).transform({ width: logoWidth }), { top });
    const out = await img.output({ format: "image/jpeg", quality: 92 });
    const bytes = await out.response().arrayBuffer();
    const outKey = `renders/${id}/${n}-c.jpg`;
    await env.MEDIA.put(outKey, bytes, { httpMetadata: { contentType: "image/jpeg" } });
    await settle(env, spendId, true);
    return { key: outKey, url: mediaUrl(env, outKey), logoWidth, top, grain: input.grain };
  } catch (e) {
    await settle(env, spendId, false);
    throw e;
  }
}
