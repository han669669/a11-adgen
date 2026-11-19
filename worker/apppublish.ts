import manifest from "../dist/app-manifest.json";
import { toBase64 } from "./b64";
import type { Env } from "./env";
import { InputError } from "./schema";

/**
 * Web app publish: the MCP tool app_publish and PUT /up/app/<token>/<path>. An agent puts the built web app into R2 app/
 * with no admin token. The Worker takes only the files of the build of its own commit: the deploy builds the web app
 * (wrangler.jsonc build.command) and puts the SHA-256 of each file into the bundle (dist/app-manifest.json). A body with
 * another SHA-256 is refused, so a caller cannot put other JavaScript on the site: only a merged build can go live.
 * The link is 24 random bytes for all files of one publish; only its SHA-256 is kept (R2, 15 minutes), and a new link replaces it.
 */
const APP_MANIFEST: Record<string, string> = manifest;
export const APP_PUBLISH_PATH = /^\/up\/app\/([0-9a-f]{48})\/(.+)$/;
/** Same limit as PUT /admin/app. */
const APP_MAX_BYTES = 3_000_000;
const LINK_TTL_SECONDS = 900;
const INDEX = "index.html";
// app-publish/ is private: no route serves it.
const LINK_KEY = "app-publish/link.json";
const PREVIOUS_KEY = "app-publish/previous-index.html";

const TYPES: Record<string, string> = {
  html: "text/html; charset=utf-8",
  js: "text/javascript; charset=utf-8",
  css: "text/css; charset=utf-8",
  svg: "image/svg+xml",
  png: "image/png",
  jpg: "image/jpeg",
  ico: "image/x-icon",
  woff2: "font/woff2",
  json: "application/json",
};
export const typeOf = (path: string) => TYPES[path.split(".").pop() ?? ""] ?? "application/octet-stream";

const sha256 = (data: ArrayBuffer | ArrayBufferView) => crypto.subtle.digest("SHA-256", data);
/** The form of the build list: "sha256-<base64>". */
const sri = (digest: ArrayBuffer) => `sha256-${toBase64(digest)}`;
const tokenHash = async (token: string) => sri(await sha256(new TextEncoder().encode(token)));
/** Workers Logs keep each publish step. Never the link. */
const log = (action: string, detail: Record<string, unknown> = {}) => console.log(JSON.stringify({ event: "app_publish", action, ...detail }));

/** True when R2 holds this file of the build. R2 checked the SHA-256 when the file was saved (put with sha256). */
async function isLive(env: Env, path: string): Promise<boolean> {
  const saved = (await env.MEDIA.head(`app/${path}`))?.checksums.sha256;
  return saved !== undefined && sri(saved) === APP_MANIFEST[path];
}

/** The files of the build, index.html last: the page goes live only after the files it names. */
const buildFiles = () => [...Object.keys(APP_MANIFEST).filter((p) => p !== INDEX).sort(), INDEX];

export async function appPublish(env: Env, a: { rollback?: boolean } = {}) {
  if (a.rollback) return rollback(env);
  const files = await Promise.all(buildFiles().map(async (path) => ({ path, sha256: APP_MANIFEST[path], live: await isLive(env, path) })));
  if (files.every((f) => f.live)) return { live: true, files, note: "The live web app is the build of the commit this Worker runs. Nothing to upload." };

  const token = [...crypto.getRandomValues(new Uint8Array(24))].map((x) => x.toString(16).padStart(2, "0")).join("");
  await env.MEDIA.put(LINK_KEY, JSON.stringify({ hash: await tokenHash(token), expiresAt: Date.now() + LINK_TTL_SECONDS * 1000 }));
  const base = `${new URL(env.PUBLIC_BASE_URL).origin}/up/app/${token}`;
  const missing = files.filter((f) => !f.live).map((f) => f.path);
  log("link", { missing });
  return {
    live: false,
    files,
    expiresInSeconds: LINK_TTL_SECONDS,
    curl: missing.map((path) => `curl -fsS -T 'dist/app/${path}' '${base}/${path}'`),
    then: "On a clean checkout of main at the commit this Worker runs: npm ci && npm run build:app. Then run the curl lines from the repo root, in this order (index.html is last and makes the build live). Then call app_publish again: live must be true.",
    note: "The link works for 15 minutes, only for these files, and a new app_publish call replaces it. Do not post it anywhere. A 422 answer, or a file that is not in dist/app, means your checkout is not the commit this Worker runs: pull main, or wait for the deploy.",
  };
}

/** Put back the page that the last publish replaced. The files it names must still be in R2. */
async function rollback(env: Env) {
  const previous = await env.MEDIA.get(PREVIOUS_KEY);
  if (!previous) throw new InputError("No earlier page is kept: app_publish has not replaced a page yet.");
  const page = await previous.arrayBuffer();
  const assets = [...new TextDecoder().decode(page).matchAll(/(?:src|href)="\/(assets\/[A-Za-z0-9._-]+)"/g)].map((m) => m[1]!);
  const gone = (await Promise.all(assets.map(async (path) => ((await env.MEDIA.head(`app/${path}`)) ? null : path)))).filter((path) => path !== null);
  if (gone.length) throw new InputError(`The earlier page names files that are not in R2: ${gone.join(", ")}. Nothing was changed.`);
  await env.MEDIA.put(`app/${INDEX}`, page, { httpMetadata: { contentType: typeOf(INDEX) } });
  log("rollback", { assets });
  return {
    rolledBack: true,
    assets,
    note: "The page that was live before the last publish is live again. An open browser tab keeps its app until a reload. Tell the owner. To put the build of main live again, call app_publish with no arguments.",
  };
}

const refuse = (status: number, error: string) => Response.json({ error }, { status });

/** PUT /up/app/<token>/<path>: save one file of the build this Worker runs. */
export async function handleAppPublish(request: Request, env: Env, token: string, path: string): Promise<Response> {
  if (request.method !== "PUT") return new Response("Method not allowed", { status: 405, headers: { allow: "PUT" } });
  if (!Object.hasOwn(APP_MANIFEST, path)) return refuse(404, `${path} is not a file of the build this Worker runs. Pull main, or wait for the deploy, and build again.`);
  const link = await (await env.MEDIA.get(LINK_KEY))?.json<{ hash: string; expiresAt: number }>();
  // Only hashes are compared, so the timing shows nothing about the link.
  if (!link || link.expiresAt <= Date.now() || link.hash !== (await tokenHash(token))) return refuse(404, "This publish link is not valid or has expired. Ask app_publish for a new one.");
  // Check the declared size before reading the body, so an oversized upload is never buffered.
  const declared = request.headers.get("content-length");
  if (declared === null) return refuse(411, "Content-Length required");
  if (Number(declared) > APP_MAX_BYTES) return refuse(413, `Too large: at most ${APP_MAX_BYTES} bytes.`);
  const body = await request.arrayBuffer();
  if (body.byteLength === 0) return refuse(400, "Empty body");
  if (body.byteLength > APP_MAX_BYTES) return refuse(413, `Too large: at most ${APP_MAX_BYTES} bytes.`);
  const digest = await sha256(body);
  if (sri(digest) !== APP_MANIFEST[path]) {
    log("refused", { path, bytes: body.byteLength });
    return refuse(422, `This is not the ${path} of the build this Worker runs (another SHA-256). Build from a clean checkout of main at the deployed commit: npm ci && npm run build:app.`);
  }
  if (path === INDEX) {
    const missing = (await Promise.all(buildFiles().map(async (p) => (p === INDEX || (await isLive(env, p)) ? null : p)))).filter((p) => p !== null);
    if (missing.length) return refuse(409, `Upload these files first, then index.html: ${missing.join(", ")}.`);
    // R2 keeps no old versions: keep the page that this one replaces, for app_publish rollback.
    const previous = await (await env.MEDIA.get(`app/${INDEX}`))?.arrayBuffer();
    if (previous && sri(await sha256(previous)) !== APP_MANIFEST[INDEX]) await env.MEDIA.put(PREVIOUS_KEY, previous);
  }
  await env.MEDIA.put(`app/${path}`, body, { httpMetadata: { contentType: typeOf(path) }, sha256: digest });
  log("file", { path, bytes: body.byteLength });
  return Response.json({ key: `app/${path}`, bytes: body.byteLength, sha256: APP_MANIFEST[path], live: path === INDEX });
}
