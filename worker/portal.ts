import type { Env } from "./env";
import { COMMENT_MAX, commentAdd } from "./comments";
import { FILES_PER_SEND, SEND_MAX_BYTES, UPLOAD_MAX_BYTES, uploadAdd } from "./uploads";
import { FONT_PATH } from "./font";
import { packByToken, type PackContent } from "./pack";

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

const STAGE: Record<string, string> = { tof: "Top of funnel", mof: "Middle of funnel", bof: "Bottom of funnel" };
const PAGE_CSP = "default-src 'none'; img-src 'self'; font-src 'self'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'";

/** The one script on the pack page. It only helps the file form: the list of chosen files, a check before sending, remove, drop and a "sending" state. Without it the form still works. It is allowed by its hash, never by 'unsafe-inline'. */
const MB = (n: number) => `${n / 1_000_000}`;
export const UPLOAD_JS = `(function(){
var f=document.getElementById("up-form"),i=document.getElementById("up-file"),l=document.getElementById("up-list"),b=document.getElementById("up-send"),z=document.getElementById("up-drop"),m=document.getElementById("up-msg");
if(!f||!i||!l||!b||!z||!m||!window.DataTransfer)return;
var FILE=${UPLOAD_MAX_BYTES},TOT=${SEND_MAX_BYTES},N=${FILES_PER_SEND},TYPE=/\\.(png|jpe?g|webp|csv|xlsx)$/i,files=[];
function mb(n){return n>=1e6?(n/1e6).toFixed(1)+" MB":Math.max(1,Math.round(n/1e3))+" KB"}
function why(x,k){if(x.size===0)return "Empty file";if(x.size>FILE)return "Too big, over ${MB(UPLOAD_MAX_BYTES)} MB";if(!TYPE.test(x.name))return "Not a supported type";if(k>=N)return "Only "+N+" files at a time";return ""}
function sync(){var d=new DataTransfer();files.forEach(function(x){d.items.add(x)});i.files=d.files}
function draw(){
l.textContent="";var total=0,bad=0;
files.forEach(function(x,k){total+=x.size;var w=why(x,k);if(w)bad++;var li=document.createElement("li");if(w)li.className="bad";
var s=document.createElement("span");s.textContent=x.name+" ("+mb(x.size)+")"+(w?": "+w:"");li.appendChild(s);
var r=document.createElement("button");r.type="button";r.textContent="Remove";r.setAttribute("aria-label","Remove "+x.name);r.onclick=function(){files.splice(k,1);sync();draw()};li.appendChild(r);l.appendChild(li)});
var over=total>TOT;
m.textContent=!files.length?"":bad?"Remove the files marked above, then send.":over?"That is "+mb(total)+". Please send up to ${MB(SEND_MAX_BYTES)} MB at a time.":files.length+" file"+(files.length>1?"s":"")+", "+mb(total)+" in all.";
m.className=bad||over?"bad":"muted";
b.disabled=!files.length||bad>0||over}
function key(x){return x.name+"|"+x.size+"|"+x.lastModified}
function add(list){var seen={};files.forEach(function(x){seen[key(x)]=1});for(var k=0;k<list.length;k++){var x=list[k];if(!seen[key(x)]){seen[key(x)]=1;files.push(x)}}sync();draw()}
i.addEventListener("change",function(){add(i.files)});
["dragenter","dragover"].forEach(function(t){z.addEventListener(t,function(e){e.preventDefault();z.classList.add("on")})});
["dragleave","drop"].forEach(function(t){z.addEventListener(t,function(e){e.preventDefault();z.classList.remove("on")})});
z.addEventListener("drop",function(e){if(e.dataTransfer&&e.dataTransfer.files)add(e.dataTransfer.files)});
f.addEventListener("submit",function(){b.disabled=true;b.textContent="Sending. Please keep this page open."});
window.addEventListener("pageshow",function(){files=[];i.value="";b.textContent="Send files";draw()});
draw();
})();`;
const pageCsp = (scriptHash: string) => PAGE_CSP.replace("style-src", `script-src '${scriptHash}'; style-src`);
let uploadJsHash: Promise<string> | undefined;
/** The CSP hash source of UPLOAD_JS: 'sha256-<base64>'. */
export const uploadScriptHash = () =>
  (uploadJsHash ??= crypto.subtle.digest("SHA-256", new TextEncoder().encode(UPLOAD_JS)).then((d) => `sha256-${btoa(String.fromCharCode(...new Uint8Array(d)))}`));
const PRIVATE = {
  "cache-control": "private, no-store",
  "referrer-policy": "no-referrer",
  "x-robots-tag": "noindex, nofollow",
  "x-content-type-options": "nosniff",
};

// The page has no script (CSP). The enlarged view is CSS only: a link to #view-N shows the box (:target), and the slides sit in a
// horizontal scroll-snap row, so a touch swipe moves between ads and the arrows do the same with a mouse.
const CSS = `@font-face{font-family:"Plus Jakarta Sans";src:url(${FONT_PATH}) format("woff2");font-weight:200 800;font-display:swap}
*{box-sizing:border-box}html{scroll-behavior:smooth}
body{font:16px/1.6 "Plus Jakarta Sans",system-ui,sans-serif;margin:0;background:#faf7f2;color:#2b1d14}body:has(.slide:target){overflow:hidden}
main{max-width:1000px;margin:0 auto;padding:20px 16px 64px}
.top{margin:0 0 4px;font-size:.9rem;font-weight:400;line-height:1.6}.lead{font-size:1.1rem;max-width:60ch;margin-top:48px}.top span,.muted{color:#6b5a4d}
h2{font-size:1.3rem;margin:48px 0 8px}h3{margin:0 0 4px;font-size:1.15rem;line-height:1.3}
.ad{display:grid;grid-template-columns:minmax(0,380px) minmax(0,1fr);gap:28px;margin:16px 0;padding:16px;background:#fff;border-radius:12px;scroll-margin-top:12px}
.pic{display:block;position:relative;cursor:zoom-in;border-radius:8px;overflow:hidden}.pic img{width:100%;height:auto;display:block}
.zoom{position:absolute;right:10px;bottom:10px;width:34px;height:34px;border-radius:99px;background:rgba(255,255,255,.92);display:flex;align-items:center;justify-content:center}
.tag{display:inline-block;font-size:.8rem;padding:2px 10px;border-radius:99px;background:#efe6da}
.btn{display:inline-block;margin:10px 8px 0 0;padding:9px 16px;border-radius:8px;background:#2b1d14;color:#fff;text-decoration:none;font-size:.9rem;font-weight:600}
.label{margin:18px 0 4px;font-weight:700}.label small{font-weight:400;color:#6b5a4d}
.ad p:not(.label){margin:0 0 6px}
code{font:inherit;font-weight:600;background:#efe6da;padding:1px 6px;border-radius:4px;word-break:break-all}
.plan{margin:12px 0 0;padding-left:1.3em;max-width:60ch}.plan li{margin:0 0 18px;padding-left:4px;font-size:1.05rem}
.steps{padding-left:1.4em;margin:8px 0}.steps li{margin:4px 0}
.facts{list-style:none;margin:12px 0 0;padding:0;display:grid;gap:10px}.facts li{background:#fff;border:1px solid #e6dccd;border-radius:10px;padding:12px 14px;font-size:.95rem;overflow-wrap:anywhere}
.facts .n{display:inline-block;margin-bottom:6px;padding:1px 10px;border-radius:6px;background:#efe6da;font-size:1.15rem;font-weight:700}
.facts .what{margin:0 0 4px}.facts .what b{font-weight:700}.facts .q{margin:0 0 6px;font-size:.9rem}.facts .src{display:block;font-size:.85rem;overflow-wrap:anywhere}
.cm{margin-top:12px;display:grid;gap:10px;max-width:60ch}.cm select,.cm textarea{font:inherit;padding:10px;border:1px solid #e6dccd;border-radius:8px;background:#fff;color:inherit;width:100%}.cm textarea{min-height:120px}.cm button{font:inherit;justify-self:start;padding:9px 16px;border:0;border-radius:8px;background:#2b1d14;color:#fff;font-weight:600;cursor:pointer}.cm input[type=file]{font:inherit;padding:8px;border:1px solid #e6dccd;border-radius:8px;background:#fff;width:100%}.ok{background:#e8f1e4;border-radius:8px;padding:10px 14px;max-width:60ch}
.drop{border:2px dashed #e6dccd;border-radius:10px;padding:12px;background:#fffdf9}.drop.on{border-color:#2b1d14;background:#f6efe5}.drop p{margin:6px 0 0;font-size:.85rem}.ups{list-style:none;margin:0;padding:0;display:grid;gap:6px}.ups li{display:flex;gap:10px;align-items:center;justify-content:space-between;background:#fff;border:1px solid #e6dccd;border-radius:8px;padding:8px 12px;font-size:.92rem;overflow-wrap:anywhere}.ups li.bad,#up-msg.bad{color:#9b2c1d}.ups li.bad{border-color:#9b2c1d}.cm .ups button{background:transparent;color:inherit;border:1px solid currentColor;padding:4px 10px;font-size:.85rem;min-height:40px;flex:none}.cm button:disabled{opacity:.5;cursor:not-allowed}
a{color:inherit}
.foot{margin-top:48px;font-size:.85rem}
.lb{display:none;position:fixed;inset:0;z-index:10;background:#140c07;animation:fade .2s}.lb:has(.slide:target){display:block}
.track{display:flex;height:100%;overflow-x:auto;overflow-y:hidden;overscroll-behavior:contain;scroll-snap-type:x mandatory;scroll-behavior:smooth;scrollbar-width:none}.track::-webkit-scrollbar{display:none}
.slide{position:relative;flex:0 0 100%;height:100%;scroll-snap-align:center;scroll-snap-stop:always;outline:none}
.slide .bg{position:absolute;inset:0;cursor:zoom-out}
.slide img{position:absolute;inset:0;width:100%;height:100%;object-fit:contain;pointer-events:none}
.slide .x,.slide .nav,.slide .dl,.slide .count{position:absolute;z-index:1;color:#fff;text-decoration:none;background:rgba(20,12,7,.62);border-radius:99px;line-height:1}
.slide .x{top:12px;right:12px;width:44px;height:44px;display:flex;align-items:center;justify-content:center;font-size:1.6rem}
.slide .count{top:20px;left:16px;padding:6px 12px;font-size:.85rem;font-weight:600}
.slide .nav{display:none;top:50%;width:48px;height:48px;margin-top:-24px;align-items:center;justify-content:center;font-size:1.8rem}
.slide .prev{left:16px}.slide .next{right:16px}
.slide .dl{bottom:16px;left:50%;transform:translateX(-50%);padding:11px 18px;font-size:.9rem;font-weight:600;white-space:nowrap}
@media(hover:hover) and (pointer:fine){.slide .nav{display:flex}.slide .x:hover,.slide .nav:hover,.slide .dl:hover{background:rgba(20,12,7,.85)}}
@keyframes fade{from{opacity:0}to{opacity:1}}
@media(max-width:700px){.ad{grid-template-columns:1fr;gap:16px;padding:12px}}
@media(prefers-reduced-motion:reduce){html,.track{scroll-behavior:auto}.lb{animation:none}}`;

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Choices the client can pick from: "A.", "B.". */
function options(items: string[]): string {
  return items.map((t, i) => `<p><b>${String.fromCharCode(65 + i)}.</b> ${esc(t)}</p>`).join("");
}

/** One sentence per line. A new line in the text also starts a new line. */
export function sentences(text: string): string[] {
  return text
    .split(/\n+/)
    .flatMap((line) => line.split(/(?<=[.!?]["'”’)\]]?)\s+(?=[A-Z"'(\d])/))
    .map((x) => x.trim())
    .filter(Boolean);
}

const link = (url: string) => (/^https?:\/\//i.test(url) ? `<a href="${esc(url)}" rel="noopener noreferrer" target="_blank">${esc(url.replace(/^https?:\/\/(www\.)?/i, ""))}</a>` : esc(url));

const ZOOM = `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="#2b1d14" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9.5 2H14v4.5M6.5 14H2V9.5M14 2L9 7M2 14l5-5"/></svg>`;

/** The pack page for a client. Every value is escaped: the copy can carry text that came from the web. */
export function renderPack(token: string, title: string, c: PackContent, sent = false, uploaded = 0): string {
  const version = /\bv(\d+)$/.exec(title)?.[1];
  const n = c.ads.length;
  const ads = c.ads
    .map((a, i) => {
      const base = `/c/${token}/ad/${i + 1}`;
      return `<section class="ad" id="ad-${i + 1}"><div><a class="pic" href="#view-${i + 1}" aria-label="Enlarge ad ${i + 1}"><img src="${base}.jpg" alt="${esc(a.headline)}"${i === 0 ? "" : ' loading="lazy"'}><span class="zoom">${ZOOM}</span></a>
<a class="btn" href="${base}.jpg" download="${esc(a.name)}.jpg">Download JPEG</a><a class="btn" href="${base}.png" download="${esc(a.name)}.png">Download PNG</a></div>
<div><h3>${esc(a.headline)}</h3><p><span class="tag">${esc(STAGE[a.stage] ?? a.stage)}</span></p>
<p class="label">Ad name <small>Paste it into Ads Manager exactly. It lets us match your results to this ad.</small></p><p><code>${esc(a.name)}</code></p>
<p class="label">Text above the picture <small>Pick one. The first 125 characters show before "See more".</small></p>${options(a.primaryTexts)}
<p class="label">Headline <small>Pick one.</small></p>${options(a.headlines)}
<p class="label">Description and button</p><p>${esc(a.description)}</p><p>Button: ${esc(cap(a.cta.replace(/_/g, " ").toLowerCase()))}</p>
<p class="label">Why we made this ad</p><p>${esc(a.why)}</p></div></section>`;
    })
    .join("");
  const slides = c.ads
    .map((a, i) => {
      const base = `/c/${token}/ad/${i + 1}`;
      const prev = i > 0 ? `<a class="nav prev" href="#view-${i}" aria-label="Previous ad">&#8249;</a>` : "";
      const next = i < n - 1 ? `<a class="nav next" href="#view-${i + 2}" aria-label="Next ad">&#8250;</a>` : "";
      return `<div class="slide" id="view-${i + 1}" role="dialog" aria-modal="true" aria-label="Ad ${i + 1} of ${n}, full size" tabindex="-1"><a class="bg" href="#ad-${i + 1}" aria-label="Close" tabindex="-1"></a><img src="${base}.jpg" alt="${esc(a.headline)}" loading="lazy"><a class="x" href="#ad-${i + 1}" aria-label="Close">&times;</a>${n > 1 ? `<span class="count">${i + 1} / ${n}</span>` : ""}${prev}${next}<a class="dl" href="${base}.jpg" download="${esc(a.name)}.jpg">Download JPEG</a></div>`;
    })
    .join("");
  // One card per number, not a table: a table is too narrow on a phone and breaks the numbers.
  // The stored fact reads "label: value"; show the label as a bold lead-in.
  const factLine = (fact: string) => {
    const m = /^([^:]{1,80}):\s+(.+)$/s.exec(fact);
    return m ? `<b>${esc(m[1]![0]!.toUpperCase() + m[1]!.slice(1))}:</b> ${esc(m[2]!)}` : esc(fact);
  };
  const facts = c.factCheck.length
    ? `<h2>Fact check</h2><p class="muted">We checked every number in the ad text against the product page. Nothing here is guessed.</p><ul class="facts">${c.factCheck
        .map((f) => `<li><span class="n">${esc(f.claim)}</span><p class="what">${factLine(f.fact)}</p><p class="q muted">"${esc(f.quote)}"</p><span class="src">${link(f.sourceUrl)}</span></li>`)
        .join("")}</ul>`
    : "";
  const heading = `${c.brand}: ad pack`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>${esc(heading)}${version ? ` v${version}` : ""}</title><link rel="preload" href="${FONT_PATH}" as="font" type="font/woff2" crossorigin><style>${CSS}</style></head><body><main>
<h1 class="top"><b>${esc(c.brand)}</b>${version ? ` <span>Version ${esc(version)}</span>` : ""}</h1>${ads}
<p class="lead">Your ads are ready. Each one has the picture, the words to paste into Meta, and the reason we made it. Tap any picture to see it full size.</p>
<ol class="steps"><li>Download the picture.</li><li>Paste the text into Meta Ads Manager.</li><li>Copy the ad name exactly.</li><li>Follow the launch plan below.</li></ol>
<h2 style="margin-top:32px">Launch plan</h2><ul class="plan">${sentences(c.launchPlan).map((x) => `<li>${esc(x)}</li>`).join("")}</ul>${c.healthNote ? `<p>${esc(c.healthNote)}</p>` : ""}${facts}
<h2 id="comments">Tell us what you think</h2>${sent ? '<p class="ok">Thank you. We got your comment.</p>' : ""}<form class="cm" method="post" action="/c/${token}/comment"><label for="cm-ad">About</label><select id="cm-ad" name="ad"><option value="">The whole pack</option>${c.ads.map((a, i) => `<option value="${i + 1}">Ad ${i + 1}: ${esc(a.headline)}</option>`).join("")}</select><label for="cm-body">Your comment</label><textarea id="cm-body" name="body" required maxlength="${COMMENT_MAX}"></textarea><button type="submit">Send comment</button></form>
<h2 id="results">Send us your results</h2><p class="muted">After your ads run, send what Meta Ads Manager shows: screenshots (PNG, JPG or WebP), a CSV file or an Excel file (.xlsx). It shows each ad name with its impressions and clicks. You can choose many files at once.</p><p class="muted">Using Google Sheets? Open the sheet, then File, Download, Microsoft Excel (.xlsx).</p><p class="muted">Up to ${FILES_PER_SEND} files at a time. Each file under ${MB(UPLOAD_MAX_BYTES)} MB. ${MB(SEND_MAX_BYTES)} MB in all.</p>${uploaded ? `<p class="ok">Thank you. We got ${uploaded === 1 ? "your file" : `${uploaded} files`}.</p>` : ""}<form class="cm" id="up-form" method="post" enctype="multipart/form-data" action="/c/${token}/upload"><label for="up-file">Your files</label><div class="drop" id="up-drop"><input id="up-file" type="file" name="file" multiple required accept="image/png,image/jpeg,image/webp,.csv,text/csv,.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"><p class="muted">On a computer, you can also drop files here.</p></div><ul class="ups" id="up-list" aria-live="polite"></ul><p id="up-msg" class="muted" aria-live="polite"></p><button type="submit" id="up-send">Send files</button></form><script>${UPLOAD_JS}</script>
<p class="foot muted">This page is private. Only people with this link can see it.</p><div class="lb" aria-label="Ads, full size"><div class="track">${slides}</div></div>
</main></body></html>`;
}

/** GET /c/<token> (the page) and /c/<token>/ad/<n>.jpg|png (the pictures). Unknown or revoked links answer 404. */
export async function handlePortal(env: Env, token: string, ad: string | undefined, ext: string | undefined, sent = false, uploaded = 0): Promise<Response> {
  const pack = await packByToken(env, token);
  if (!pack) return new Response("Not found", { status: 404, headers: PRIVATE });
  if (!ad) return new Response(renderPack(token, pack.title, pack.content, sent, uploaded), { headers: { ...PRIVATE, "content-type": "text/html; charset=utf-8", "content-security-policy": pageCsp(await uploadScriptHash()) } });
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

/** POST /c/<token>/comment: save the client's comment, then go back to the page. */
export async function handleComment(env: Env, request: Request, token: string): Promise<Response> {
  const r = await commentAdd(env, request, token);
  if (r.ok) return new Response(null, { status: 303, headers: { ...PRIVATE, location: `/c/${token}?sent=1#comments` } });
  const page = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>Comment not sent</title></head><body style="font:16px/1.6 system-ui,sans-serif;margin:24px"><p>${esc(r.message)}</p>${r.status === 404 ? "" : `<p><a href="/c/${token}#comments">Go back</a></p>`}</body></html>`;
  return new Response(page, { status: r.status, headers: { ...PRIVATE, "content-type": "text/html; charset=utf-8", "content-security-policy": PAGE_CSP } });
}

/** POST /c/<token>/upload: save the client's files. All saved: back to the page. Otherwise a short page says which file was not saved and why. */
export async function handleUpload(env: Env, request: Request, token: string): Promise<Response> {
  const r = await uploadAdd(env, request, token);
  const files = r.files ?? [];
  const saved = files.filter((f) => f.ok).length;
  if (r.ok && saved === files.length) return new Response(null, { status: 303, headers: { ...PRIVATE, location: `/c/${token}?uploaded=${saved}#results` } });
  const lead = r.ok ? `We saved ${saved} of ${files.length} files. You can send the others again.` : r.message;
  const list = files.length > 1 ? `<ul>${files.map((f) => `<li>${f.ok ? "Saved" : "Not saved"}: ${esc(f.name)}${f.ok ? "" : `. ${esc(f.message)}`}</li>`).join("")}</ul>` : "";
  const page = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>${r.ok ? "Some files not sent" : "File not sent"}</title></head><body style="font:16px/1.6 system-ui,sans-serif;margin:24px"><p>${esc(lead)}</p>${list}${r.ok || r.status !== 404 ? `<p><a href="/c/${token}#results">Go back</a></p>` : ""}</body></html>`;
  return new Response(page, { status: r.ok ? 200 : r.status, headers: { ...PRIVATE, "content-type": "text/html; charset=utf-8", "content-security-policy": PAGE_CSP } });
}
