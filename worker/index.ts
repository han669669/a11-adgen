import type { Env } from "./env";
import { handleApi } from "./api";
import { handleMcp } from "./mcp";
import { handleComment, handlePortal, handleUpload } from "./portal";
import { FILES_PER_SEND } from "./uploads";
import { handleUploadLink, UPLOAD_PATH } from "./uploadlink";

/** A Worker bundle on the Free plan is at most 3 MB. */
const STAGE_MAX_BYTES = 3_000_000;
// A repaired final is a full-size JPEG (quality 95, with grain): it can pass 3 MB, so repairs have their own limit.
const REPAIR_MAX_BYTES = 10_000_000;

const MEDIA_KEY = /^(renders\/[0-9a-f-]{36}\/(\d+(-c\d*)?\.jpg|mask-\d+\.png)|brands\/[0-9a-f-]{36}\/(logo|ref\d)\.(png|jpg|webp)|refs\/[0-9a-f-]{36}\.(png|jpg))$/;

async function sha256Hex(s: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Phase 0 auth: the bearer token's SHA-256 must match MCP_TOKEN_SHA256. */
export async function tokenOk(request: Request, expectedHash: string | undefined): Promise<boolean> {
  if (!expectedHash || expectedHash.length !== 64) return false;
  const got = request.headers.get("Authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  if (!got) return false;
  return sameHex(await sha256Hex(got), expectedHash.toLowerCase());
}

/** Constant-time compare of two equal-length hex strings (works in Workers and in Node tests). */
function sameHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

const APP_PATH = /^(?!.*\.\.)[a-zA-Z0-9][a-zA-Z0-9._/-]{0,199}$/;
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
const typeOf = (path: string) => TYPES[path.split(".").pop() ?? ""] ?? "application/octet-stream";

async function stage(request: Request, env: Env, name: string, pattern: RegExp, prefix: string, maxBytes = STAGE_MAX_BYTES): Promise<Response> {
  if (!(await tokenOk(request, env.MCP_TOKEN_SHA256))) return new Response("Unauthorized", { status: 401 });
  if (!pattern.test(name)) return new Response("Bad name", { status: 400 });
  // Check the declared size before reading the body, so an oversized upload is never buffered.
  const declared = request.headers.get("content-length");
  if (declared === null) return new Response("Content-Length required", { status: 411 });
  if (Number(declared) > maxBytes) return new Response("Too large", { status: 413 });
  const body = await request.arrayBuffer();
  if (body.byteLength === 0) return new Response("Empty body", { status: 400 });
  if (body.byteLength > maxBytes) return new Response("Too large", { status: 413 });
  const contentType = prefix === "app/" || prefix === "refs/" || prefix === "repairs/" ? typeOf(name) : "application/javascript";
  await env.MEDIA.put(`${prefix}${name}`, body, { httpMetadata: { contentType } });
  return Response.json({ key: `${prefix}${name}`, bytes: body.byteLength });
}

/** The web app (a single-page app): a file from R2 app/, else index.html for client routes. */
async function serveApp(env: Env, pathname: string): Promise<Response> {
  const path = pathname.replace(/^\/+/, "");
  const isFile = APP_PATH.test(path) && /\.[a-z0-9]+$/.test(path);
  const obj = isFile ? await env.MEDIA.get(`app/${path}`) : await env.MEDIA.get("app/index.html");
  if (!obj) return new Response("Not found", { status: 404 });
  const immutable = path.startsWith("assets/");
  return new Response(obj.body, {
    headers: {
      "content-type": obj.httpMetadata?.contentType ?? typeOf(isFile ? path : "index.html"),
      "cache-control": immutable ? "public, max-age=31536000, immutable" : "no-cache",
      "x-content-type-options": "nosniff",
      ...(isFile && !path.endsWith(".html") ? {} : { "content-security-policy": CSP }),
    },
  });
}

const CSP =
  "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'";

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/mcp") {
      if (!(await tokenOk(request, env.MCP_TOKEN_SHA256))) return new Response("Unauthorized", { status: 401 });
      return handleMcp(request, env);
    }

    // Deploy staging: put a built bundle into R2 (deploy/<name>), so the Cloudflare connector can deploy it from there.
    if (url.pathname.startsWith("/admin/stage/") && request.method === "PUT") {
      return stage(request, env, url.pathname.slice("/admin/stage/".length), /^[a-z0-9][a-z0-9._-]{0,63}$/, "deploy/");
    }
    // Web app files: the built app goes to R2 app/<path>; the Worker serves it below.
    if (url.pathname.startsWith("/admin/app/") && request.method === "PUT") {
      return stage(request, env, url.pathname.slice("/admin/app/".length), APP_PATH, "app/");
    }

    // Reference images made outside the Worker (a product-lock skeleton, scripts/product_lock.py): saved to R2 refs/<uuid>.<jpg|png>,
    // read by fal through /m/refs/<name>.
    if (url.pathname.startsWith("/admin/ref/") && request.method === "PUT") {
      return stage(request, env, url.pathname.slice("/admin/ref/".length), /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png)$/, "refs/");
    }

    // A repaired final made outside the Worker (scripts/box_print.py): saved to R2 repairs/<uuid>.jpg, then taken into the pack with final_attach.
    if (url.pathname.startsWith("/admin/repair/") && request.method === "PUT") {
      return stage(request, env, url.pathname.slice("/admin/repair/".length), /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.jpg$/, "repairs/", REPAIR_MAX_BYTES);
    }

    // A one-time upload link from the MCP tool upload_link (a repaired final or a skeleton), so agents need no admin token.
    const upload = UPLOAD_PATH.exec(url.pathname);
    if (upload) return handleUploadLink(request, env, upload[1]!);

    if (url.pathname.startsWith("/api/")) return handleApi(request, env, url);

    // Client portal: a pack page and its pictures, behind an unguessable token (no login).
    const portal = /^\/c\/([0-9a-f]{48})(?:\/ad\/(\d{1,2})\.(jpg|png))?$/.exec(url.pathname);
    if (portal && request.method === "GET") {
      const uploaded = Number(url.searchParams.get("uploaded"));
      return handlePortal(env, portal[1]!, portal[2], portal[3], url.searchParams.get("sent") === "1", Number.isFinite(uploaded) ? Math.min(FILES_PER_SEND, Math.max(0, Math.floor(uploaded))) : 0);
    }
    const commentPost = /^\/c\/([0-9a-f]{48})\/comment$/.exec(url.pathname);
    if (commentPost && request.method === "POST") return handleComment(env, request, commentPost[1]!);
    const uploadPost = /^\/c\/([0-9a-f]{48})\/upload$/.exec(url.pathname);
    if (uploadPost && request.method === "POST") return handleUpload(env, request, uploadPost[1]!);
    if (url.pathname.startsWith("/c/")) return new Response("Not found", { status: 404 });

    // Media: unguessable keys (random UUIDs). fal reads chosen drafts from here as references.
    // GET and HEAD: fal checks a reference URL with HEAD before it downloads it.
    if (url.pathname.startsWith("/m/") && (request.method === "GET" || request.method === "HEAD")) {
      const key = url.pathname.slice(3);
      if (!MEDIA_KEY.test(key)) return new Response("Not found", { status: 404 });
      const obj = request.method === "HEAD" ? await env.MEDIA.head(key) : await env.MEDIA.get(key);
      if (!obj) return new Response("Not found", { status: 404 });
      const headers = {
        "content-type": obj.httpMetadata?.contentType ?? "image/jpeg",
        "content-length": String(obj.size),
        "cache-control": "private, max-age=3600",
      };
      const body = "body" in obj ? (obj as R2ObjectBody).body : null;
      return new Response(request.method === "HEAD" ? null : body, { headers });
    }

    if (request.method === "GET" || request.method === "HEAD") return serveApp(env, url.pathname);
    return new Response("Not found", { status: 404 });
  },
} satisfies ExportedHandler<Env>;
