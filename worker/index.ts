import type { Env } from "./env";
import { handleMcp } from "./mcp";

/** A Worker bundle on the Free plan is at most 3 MB. */
const STAGE_MAX_BYTES = 3_000_000;

const MEDIA_KEY = /^renders\/[0-9a-f-]{36}\/\d+(-c)?\.jpg$/;

async function sha256Hex(s: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Phase 0 auth: the bearer token's SHA-256 must match MCP_TOKEN_SHA256. */
async function tokenOk(request: Request, expectedHash: string | undefined): Promise<boolean> {
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

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/mcp") {
      if (!(await tokenOk(request, env.MCP_TOKEN_SHA256))) return new Response("Unauthorized", { status: 401 });
      return handleMcp(request, env);
    }

    // Deploy staging: put a built bundle into R2 (deploy/<name>), so the Cloudflare connector can deploy it from there.
    if (url.pathname.startsWith("/admin/stage/") && request.method === "PUT") {
      if (!(await tokenOk(request, env.MCP_TOKEN_SHA256))) return new Response("Unauthorized", { status: 401 });
      const name = url.pathname.slice("/admin/stage/".length);
      if (!/^[a-z0-9][a-z0-9._-]{0,63}$/.test(name)) return new Response("Bad name", { status: 400 });
      const body = await request.arrayBuffer();
      if (body.byteLength === 0 || body.byteLength > STAGE_MAX_BYTES) return new Response("Bad size", { status: 413 });
      await env.MEDIA.put(`deploy/${name}`, body, { httpMetadata: { contentType: "application/javascript" } });
      return Response.json({ key: `deploy/${name}`, bytes: body.byteLength });
    }

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

    if (url.pathname === "/") return new Response("a11adgen: Phase 0 spike. The web app comes in Phase 1.\n");
    return new Response("Not found", { status: 404 });
  },
} satisfies ExportedHandler<Env>;
