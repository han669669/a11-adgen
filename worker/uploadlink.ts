import type { Env } from "./env";
import { finalAttach } from "./compose";
import { mediaUrl } from "./fal";
import { InputError } from "./schema";

/**
 * One-time upload links, made by the MCP tool upload_link. The agent saves a file made outside the Worker
 * (a repaired final from scripts/box_print.py, or a product-lock skeleton from scripts/product_lock.py) with one PUT,
 * so the pipeline runs through the a11 MCP alone and never needs the admin token.
 * The link is 24 random bytes; only its SHA-256 is kept (D1 table upload_links, 15 minutes). It works once: the first PUT claims it
 * with one DELETE ... RETURNING, which D1 runs atomically, so two PUTs at the same time cannot both pass.
 */
export const UPLOAD_TTL_SECONDS = 900;
export const UPLOAD_PATH = /^\/up\/([0-9a-f]{48})$/;
/** A repaired final is a full-size JPEG (quality 95, with grain): it can pass 3 MB. Same limit as PUT /admin/repair. */
const REPAIR_MAX_BYTES = 10_000_000;
/** A skeleton is at most 2048 px on a side; fal reads it as a reference. Same limit as PUT /admin/ref. */
const REF_MAX_BYTES = 3_000_000;
const RENDER_KEY = /^renders\/([0-9a-f-]{36})\/(\d+)\.jpg$/;

interface Pending {
  kind: "repair" | "ref";
  /** repair: the final's render image key. */
  key?: string;
  /** The R2 name the file gets: <uuid>.jpg or <uuid>.png. */
  name: string;
}

const hex = (b: ArrayBuffer | Uint8Array) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");
const tokenHash = async (token: string) => hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token)));

export async function createUploadLink(env: Env, a: { kind: "repair" | "ref"; key?: string; ext?: "jpg" | "png" }) {
  let pending: Pending;
  if (a.kind === "repair") {
    const m = a.key ? RENDER_KEY.exec(a.key) : null;
    if (!m) throw new InputError("A repair link needs key: the final's render image key (renders/<id>/<n>.jpg).");
    const row = await env.DB.prepare("SELECT kind, status, composed_key FROM renders WHERE id = ?").bind(m[1]).first<{ kind: string; status: string; composed_key: string | null }>();
    if (!row) throw new InputError(`No render with id ${m[1]}.`);
    if (row.kind !== "final" || row.status !== "done") throw new InputError(`Render ${m[1]} is not a completed final (${row.kind}, ${row.status}).`);
    if (!row.composed_key?.startsWith("renders/")) throw new InputError(`Render ${m[1]} is not composed yet: run compose_final first, repair its composed picture, then ask for the link.`);
    pending = { kind: "repair", key: a.key, name: `${crypto.randomUUID()}.jpg` };
  } else {
    if (a.key) throw new InputError("A ref link takes no key.");
    pending = { kind: "ref", name: `${crypto.randomUUID()}.${a.ext ?? "png"}` };
  }
  const token = hex(crypto.getRandomValues(new Uint8Array(24)));
  const now = Date.now();
  await env.DB.batch([
    env.DB.prepare("DELETE FROM upload_links WHERE expires_at <= ?").bind(now),
    env.DB.prepare("INSERT INTO upload_links (hash, kind, key, name, expires_at) VALUES (?, ?, ?, ?, ?)").bind(
      await tokenHash(token),
      pending.kind,
      pending.key ?? null,
      pending.name,
      now + UPLOAD_TTL_SECONDS * 1000,
    ),
  ]);
  const url = `${new URL(env.PUBLIC_BASE_URL).origin}/up/${token}`;
  const type = pending.name.endsWith(".png") ? "image/png" : "image/jpeg";
  return {
    uploadUrl: url,
    method: "PUT",
    expiresInSeconds: UPLOAD_TTL_SECONDS,
    curl: `curl -fsS -T <file> -H 'content-type: ${type}' '${url}'`,
    then:
      pending.kind === "repair"
        ? "The PUT saves the picture and takes it into the pack path (final_attach), in one step. Its answer is the new composed key. Check it with picks_get (repaired: true) and image_get."
        : `The PUT saves the file as refs/${pending.name}. Its answer has the url to pass to render_submit as a reference.`,
    note: "The link works once and only for 15 minutes. Do not post it anywhere: it is a write key for one file.",
  };
}

const isJpeg = (b: Uint8Array) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const isPng = (b: Uint8Array) => b.length > 8 && PNG_SIGNATURE.every((x, i) => b[i] === x);

/** PUT /up/<token>: save the one file the link was made for. */
export async function handleUploadLink(request: Request, env: Env, token: string): Promise<Response> {
  if (request.method !== "PUT") return new Response("Method not allowed", { status: 405, headers: { allow: "PUT" } });
  // One use: the link is claimed (deleted) before the body is read, in one atomic statement, so a second PUT (or a replay) cannot write again.
  const row = await env.DB.prepare("DELETE FROM upload_links WHERE hash = ? RETURNING kind, key, name, expires_at")
    .bind(await tokenHash(token))
    .first<{ kind: Pending["kind"]; key: string | null; name: string; expires_at: number }>();
  if (!row || row.expires_at <= Date.now())
    return Response.json({ error: "This upload link is not valid, was used already, or has expired. Ask upload_link for a new one." }, { status: 404 });
  const pending: Pending = { kind: row.kind, key: row.key ?? undefined, name: row.name };
  const max = pending.kind === "repair" ? REPAIR_MAX_BYTES : REF_MAX_BYTES;
  // Check the declared size before reading the body, so an oversized upload is never buffered.
  const declared = request.headers.get("content-length");
  if (declared === null) return Response.json({ error: "Content-Length required" }, { status: 411 });
  if (Number(declared) > max) return Response.json({ error: `Too large: at most ${max} bytes.` }, { status: 413 });
  const body = new Uint8Array(await request.arrayBuffer());
  if (body.byteLength === 0) return Response.json({ error: "Empty body" }, { status: 400 });
  if (body.byteLength > max) return Response.json({ error: `Too large: at most ${max} bytes.` }, { status: 413 });
  const png = pending.name.endsWith(".png");
  if (png ? !isPng(body) : !isJpeg(body)) return Response.json({ error: `The file is not a ${png ? "PNG" : "JPEG"}.` }, { status: 415 });

  if (pending.kind === "ref") {
    const key = `refs/${pending.name}`;
    await env.MEDIA.put(key, body, { httpMetadata: { contentType: png ? "image/png" : "image/jpeg" } });
    return Response.json({ key, url: mediaUrl(env, key), bytes: body.byteLength });
  }
  const upload = `repairs/${pending.name}`;
  await env.MEDIA.put(upload, body, { httpMetadata: { contentType: "image/jpeg" } });
  try {
    const out = await finalAttach(env, { key: pending.key!, upload });
    await env.DB.prepare("UPDATE renders SET composed_key = ? WHERE id = ?").bind(out.key, pending.key!.split("/")[1]).run();
    return Response.json({ ...out, upload, attached: true });
  } catch (e) {
    // The file stays in repairs/ (final_attach can take it later); the render is unchanged.
    return Response.json({ error: e instanceof Error ? e.message : String(e), upload, attached: false }, { status: 422 });
  }
}
