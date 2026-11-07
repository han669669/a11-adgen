import type { Env } from "./env";
import { packByToken, type PackContent } from "./pack";

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

const STAGE: Record<string, [string, string]> = {
  tof: ["Top of funnel", "For people who have not met the brand yet."],
  mof: ["Middle of funnel", "For people who know the brand and are choosing."],
  bof: ["Bottom of funnel", "For people who are ready to buy."],
};
const PAGE_CSP = "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";
const PRIVATE = {
  "cache-control": "private, no-store",
  "referrer-policy": "no-referrer",
  "x-robots-tag": "noindex, nofollow",
  "x-content-type-options": "nosniff",
};

const CSS = `*{box-sizing:border-box}html{scroll-behavior:smooth}body{font:16px/1.6 system-ui,-apple-system,"Segoe UI",sans-serif;margin:0;background:#faf7f2;color:#2b1d14}body:has(.lb:target){overflow:hidden}
main{max-width:960px;margin:0 auto;padding:32px 16px 72px}
h1{font-size:2rem;line-height:1.2;margin:0 0 8px}h2{font-size:1.3rem;margin:48px 0 8px}h3{margin:0 0 4px;font-size:1.2rem;line-height:1.3}
.muted{color:#6b5a4d}.lead{font-size:1.1rem;max-width:60ch}
.steps{padding-left:1.2em;margin:8px 0}.steps li{margin:4px 0}
.ad{display:grid;grid-template-columns:minmax(0,320px) minmax(0,1fr);gap:24px;margin:24px 0;padding:20px;background:#fff;border-radius:14px;box-shadow:0 1px 3px rgba(43,29,20,.08);scroll-margin-top:16px}
.ad img{width:100%;height:auto;border-radius:8px;display:block}
.pic{display:block;position:relative;cursor:zoom-in;border-radius:8px;overflow:hidden}.pic img{transition:transform .25s}.pic:hover img{transform:scale(1.02)}
.pic span{position:absolute;right:8px;bottom:8px;padding:3px 10px;border-radius:99px;background:rgba(43,29,20,.75);color:#fff;font-size:.8rem}
.tag{display:inline-block;font-size:.8rem;padding:2px 10px;border-radius:99px;background:#efe6da}
.btn{display:inline-block;margin:8px 8px 0 0;padding:9px 16px;border-radius:8px;background:#2b1d14;color:#fff;text-decoration:none;font-size:.9rem}
.opt{margin:6px 0;padding:10px 12px;border-radius:8px;background:#faf7f2}.opt b{display:block;font-size:.75rem;letter-spacing:.04em;text-transform:uppercase;color:#6b5a4d}
.label{margin:18px 0 4px;font-weight:600}.label small{font-weight:400;color:#6b5a4d}
.plan p{margin:0 0 20px;font-size:1.05rem;max-width:60ch}
.glance a{color:inherit}
table{border-collapse:collapse;width:100%;font-size:.9rem;background:#fff;border-radius:8px}td,th{text-align:left;padding:8px 10px;border-bottom:1px solid #e6dccd;vertical-align:top}
code{font-size:.85rem;background:#efe6da;padding:1px 5px;border-radius:4px;word-break:break-all}
.lb{display:none;position:fixed;inset:0;z-index:10;background:rgba(20,12,7,.97);align-items:center;justify-content:center;animation:fade .2s}
.lb:target{display:flex}.lb .bg{position:absolute;inset:0;cursor:zoom-out}
.lb img{position:relative;max-width:100vw;max-height:100vh;max-height:100dvh;width:auto;height:auto;object-fit:contain;box-shadow:0 8px 40px rgba(0,0,0,.5)}
.lb .x,.lb .nav,.lb .dl{position:absolute;z-index:1;color:#fff;text-decoration:none;background:rgba(255,255,255,.14);backdrop-filter:blur(6px);border-radius:99px;line-height:1}
.lb .x{top:12px;right:12px;width:44px;height:44px;display:flex;align-items:center;justify-content:center;font-size:1.6rem}
.lb .nav{top:50%;width:44px;height:44px;margin-top:-22px;display:flex;align-items:center;justify-content:center;font-size:1.6rem}
.lb .prev{left:12px}.lb .next{right:12px}
.lb .dl{bottom:16px;left:50%;transform:translateX(-50%);padding:11px 18px;font-size:.9rem}
.lb .x:hover,.lb .nav:hover,.lb .dl:hover{background:rgba(255,255,255,.28)}
.foot{margin-top:56px;font-size:.9rem}
@keyframes fade{from{opacity:0}to{opacity:1}}
@media(max-width:640px){.ad{grid-template-columns:1fr;padding:16px}h1{font-size:1.6rem}.lb .nav{top:auto;bottom:16px;margin:0}.lb .dl{bottom:72px}}
@media(prefers-reduced-motion:reduce){html{scroll-behavior:auto}.lb{animation:none}.pic img{transition:none}}`;

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Options the client can pick from: "Option A", "Option B". */
function options(items: string[]): string {
  return items.map((t, i) => `<div class="opt"><b>Option ${String.fromCharCode(65 + i)}</b>${esc(t)}</div>`).join("");
}

/** One sentence per line, with space between. A new line in the text also starts a new line. */
export function sentences(text: string): string[] {
  return text
    .split(/\n+/)
    .flatMap((line) => line.split(/(?<=[.!?]["'”’)\]]?)\s+(?=[A-Z"'(\d])/))
    .map((x) => x.trim())
    .filter(Boolean);
}

const link = (url: string) => (/^https?:\/\//i.test(url) ? `<a href="${esc(url)}" rel="noopener noreferrer" target="_blank">${esc(url.replace(/^https?:\/\/(www\.)?/i, ""))}</a>` : esc(url));

/** The pack page for a client. Every value is escaped: the copy can carry text that came from the web. */
export function renderPack(token: string, title: string, c: PackContent): string {
  const version = /\bv(\d+)$/.exec(title)?.[1];
  const n = c.ads.length;
  const glance = c.ads
    .map((a, i) => `<tr><td>${i + 1}</td><td>${esc((STAGE[a.stage] ?? [a.stage])[0]!)}</td><td><a href="#ad-${i + 1}">${esc(a.headline)}</a></td></tr>`)
    .join("");
  const ads = c.ads
    .map((a, i) => {
      const base = `/c/${token}/ad/${i + 1}`;
      const [stage, who] = STAGE[a.stage] ?? [a.stage, ""];
      return `<section class="ad" id="ad-${i + 1}"><div><a class="pic" href="#view-${i + 1}" aria-label="Enlarge ad ${i + 1}"><img src="${base}.jpg" alt="${esc(a.headline)}" loading="lazy"><span>Tap to enlarge</span></a>
<a class="btn" href="${base}.jpg" download="${esc(a.name)}.jpg">Download JPEG</a><a class="btn" href="${base}.png" download="${esc(a.name)}.png">Download PNG</a></div>
<div><p class="muted" style="margin:0">Ad ${i + 1} of ${n}</p><h3>${esc(a.headline)}</h3><p style="margin:4px 0 0"><span class="tag">${esc(stage)}</span> <span class="muted">${esc(who)}</span></p>
<p class="label">Text above the picture <small>Pick one. The first 125 characters show before "See more".</small></p>${options(a.primaryTexts)}
<p class="label">Headline <small>Pick one.</small></p>${options(a.headlines)}
<p class="label">Description and button</p><div class="opt"><b>Description</b>${esc(a.description)}</div><div class="opt"><b>Button</b>${esc(cap(a.cta.replace(/_/g, " ").toLowerCase()))}</div>
<p class="label">Ad name <small>Paste it into Ads Manager exactly. It lets us match your results to this ad.</small></p><p style="margin:0"><code>${esc(a.name)}</code></p>
<p class="label">Why we made this ad</p><p style="margin:0">${esc(a.why)}</p></div></section>`;
    })
    .join("");
  const boxes = c.ads
    .map((a, i) => {
      const base = `/c/${token}/ad/${i + 1}`;
      const prev = i > 0 ? `<a class="nav prev" href="#view-${i}" aria-label="Previous ad">&#8249;</a>` : "";
      const next = i < n - 1 ? `<a class="nav next" href="#view-${i + 2}" aria-label="Next ad">&#8250;</a>` : "";
      return `<div class="lb" id="view-${i + 1}" role="dialog" aria-modal="true" aria-label="Ad ${i + 1} full size" tabindex="-1"><a class="x" href="#ad-${i + 1}" aria-label="Close">&times;</a><a class="bg" href="#ad-${i + 1}" aria-label="Close" tabindex="-1"></a><img src="${base}.jpg" alt="${esc(a.headline)}" loading="lazy">${prev}${next}<a class="dl" href="${base}.jpg" download="${esc(a.name)}.jpg">Download JPEG</a></div>`;
    })
    .join("");
  const facts = c.factCheck.length
    ? `<h2>Fact check</h2><p class="muted">We checked every number in the ad text against the product page. Nothing here is guessed.</p><table><tr><th>Number in the ad</th><th>What it is</th><th>Where it comes from</th></tr>${c.factCheck
        .map((f) => `<tr><td>${esc(f.claim)}</td><td>${esc(f.fact)}<br><span class="muted">"${esc(f.quote)}"</span></td><td>${link(f.sourceUrl)}</td></tr>`)
        .join("")}</table>`
    : "";
  const heading = `${c.brand}: ad pack`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>${esc(heading)}${version ? ` v${version}` : ""}</title><style>${CSS}</style></head><body><main>
<h1>${esc(heading)}</h1><p class="muted">${version ? `Version ${esc(version)}. ` : ""}${n} static ${n === 1 ? "ad" : "ads"}, 4:5, ready to upload to Meta.</p>
<p class="lead">Your ads are ready. Each one has the picture, the words to paste into Meta, and the reason we made it. Tap any picture to see it full size.</p>
<ol class="steps"><li>Download the picture.</li><li>Paste the text into Meta Ads Manager.</li><li>Copy the ad name exactly.</li><li>Follow the launch plan at the bottom.</li></ol>
<table class="glance"><tr><th>Ad</th><th>Stage</th><th>Headline</th></tr>${glance}</table>${ads}
<h2>Launch plan</h2><p class="muted">What to do after you upload.</p><div class="plan">${sentences(c.launchPlan).map((x) => `<p>${esc(x)}</p>`).join("")}</div>${c.healthNote ? `<p>${esc(c.healthNote)}</p>` : ""}${facts}
<p class="foot muted">This page is private. Only people with this link can see it.</p>${boxes}
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
