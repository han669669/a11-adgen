import type { Env } from "./env";
import { packByToken, type PackContent } from "./pack";

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

const STAGE: Record<string, string> = { tof: "Top of funnel", mof: "Middle of funnel", bof: "Bottom of funnel" };
const PAGE_CSP = "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";
const PRIVATE = {
  "cache-control": "private, no-store",
  "referrer-policy": "no-referrer",
  "x-robots-tag": "noindex, nofollow",
  "x-content-type-options": "nosniff",
};

const CSS = `body{font:16px/1.5 system-ui,sans-serif;margin:0;background:#faf7f2;color:#2b1d14}main{max-width:960px;margin:0 auto;padding:24px 16px 64px}
h1{font-size:1.6rem;margin:0 0 4px}h2{font-size:1.15rem;margin:32px 0 8px}.muted{color:#6b5a4d}
.ad{display:grid;grid-template-columns:minmax(0,320px) minmax(0,1fr);gap:24px;margin:24px 0;padding:16px;background:#fff;border-radius:12px}
.ad img{width:100%;height:auto;border-radius:8px;display:block}.ad h3{margin:0 0 4px;font-size:1.05rem}
.tag{display:inline-block;font-size:.8rem;padding:2px 8px;border-radius:99px;background:#efe6da}
.btn{display:inline-block;margin:8px 8px 0 0;padding:8px 14px;border-radius:8px;background:#2b1d14;color:#fff;text-decoration:none;font-size:.9rem}
table{border-collapse:collapse;width:100%;font-size:.9rem}td,th{text-align:left;padding:6px 8px;border-bottom:1px solid #e6dccd;vertical-align:top}
code{font-size:.85rem;background:#efe6da;padding:1px 5px;border-radius:4px;word-break:break-all}
@media(max-width:640px){.ad{grid-template-columns:1fr}}`;

function list(items: string[]): string {
  return items.map((t, i) => `<p><b>${i + 1}.</b> ${esc(t)}</p>`).join("");
}

/** The pack page for a client. Every value is escaped: the copy can carry text that came from the web. */
export function renderPack(token: string, title: string, c: PackContent): string {
  const ads = c.ads
    .map((a, i) => {
      const base = `/c/${token}/ad/${i + 1}`;
      return `<section class="ad"><div><img src="${base}.jpg" alt="${esc(a.headline)}" loading="lazy">
<a class="btn" href="${base}.jpg" download="${esc(a.name)}.jpg">Download JPEG</a><a class="btn" href="${base}.png" download="${esc(a.name)}.png">Download PNG</a></div>
<div><h3>${esc(a.headline)}</h3><p><span class="tag">${esc(STAGE[a.stage] ?? a.stage)}</span></p>
<p>Ad name for Ads Manager: <code>${esc(a.name)}</code></p>
<p><b>Primary text</b> (the first 125 characters show)</p>${list(a.primaryTexts)}
<p><b>Headline</b></p>${list(a.headlines)}
<p><b>Description:</b> ${esc(a.description)}<br><b>Button:</b> ${esc(a.cta.replace(/_/g, " ").toLowerCase())}</p>
<p><b>Why this ad:</b> ${esc(a.why)}</p></div></section>`;
    })
    .join("");
  const facts = c.factCheck.length
    ? `<h2>Fact check</h2><p class="muted">Every number in the ad text, and the fact it comes from.</p><table><tr><th>Number</th><th>Fact</th><th>Source</th></tr>${c.factCheck
        .map((f) => `<tr><td>${esc(f.claim)}</td><td>${esc(f.fact)}<br><span class="muted">"${esc(f.quote)}"</span></td><td>${esc(f.sourceUrl)}</td></tr>`)
        .join("")}</table>`
    : "";
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>${esc(title)}</title><style>${CSS}</style></head><body><main>
<h1>${esc(title)}</h1><p class="muted">${esc(c.brand)}. ${c.ads.length} static ads, 4:5, ready to upload to Meta.</p>${ads}
<h2>Launch plan</h2><p>${esc(c.launchPlan)}</p>${c.healthNote ? `<p>${esc(c.healthNote)}</p>` : ""}${facts}
</main></body></html>`;
}

/** GET /c/<token> (the page) and /c/<token>/ad/<n>.jpg|png (the pictures). Unknown or revoked links answer 404. */
export async function handlePortal(env: Env, token: string, ad: string | undefined, ext: string | undefined): Promise<Response> {
  const pack = await packByToken(env, token);
  if (!pack) return new Response("Not found", { status: 404, headers: PRIVATE });
  if (!ad) return new Response(renderPack(token, pack.title, pack.content), { headers: { ...PRIVATE, "content-type": "text/html; charset=utf-8", "content-security-policy": PAGE_CSP } });
  const item = pack.content.ads[Number(ad) - 1];
  if (!item) return new Response("Not found", { status: 404, headers: PRIVATE });
  const obj = await env.MEDIA.get(item.imageKey);
  if (!obj) return new Response("Not found", { status: 404, headers: PRIVATE });
  if (ext === "png") {
    const out = await env.IMAGES.input(obj.body).output({ format: "image/png" });
    return new Response(out.response().body, { headers: { ...PRIVATE, "content-type": "image/png" } });
  }
  return new Response(obj.body, { headers: { ...PRIVATE, "content-type": "image/jpeg" } });
}
