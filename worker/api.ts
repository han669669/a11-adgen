import { AuthError, currentUser, login, logout, signup } from "./auth";
import * as batch from "./batch";
import type { Env } from "./env";
import * as fal from "./fal";
import { BudgetError, totals } from "./spend";

const UUID = "[0-9a-f-]{36}";
const DRAFT_KEY = /^renders\/[0-9a-f-]{36}\/\d+\.jpg$/;
/** The longest note the owner can save on a pick. The board shows the same limit (app/src/lib/api.ts). */
const NOTE_MAX = 600;

const json = (data: unknown, status = 200, headers: Record<string, string> = {}) =>
  Response.json(data, { status, headers: { "cache-control": "no-store", ...headers } });
const fail = (status: number, error: string) => json({ error }, status);

async function body(request: Request): Promise<Record<string, any>> {
  try {
    const b = await request.json();
    return b && typeof b === "object" && !Array.isArray(b) ? (b as Record<string, any>) : {};
  } catch {
    return {};
  }
}

/** /api/* for the web app. Cookie sessions; state-changing calls must be same-origin JSON. */
export async function handleApi(request: Request, env: Env, url: URL): Promise<Response> {
  const path = url.pathname;
  const method = request.method;
  if (method === "POST") {
    const origin = request.headers.get("origin");
    if (origin !== url.origin) return fail(403, "Cross-site request refused.");
    if (!(request.headers.get("content-type") ?? "").startsWith("application/json")) return fail(415, "Send JSON.");
  }
  try {
    if (path === "/api/signup" && method === "POST") return json({ ok: true }, 200, { "set-cookie": await signup(env, await body(request)) });
    if (path === "/api/login" && method === "POST") return json({ ok: true }, 200, { "set-cookie": await login(env, await body(request)) });
    if (path === "/api/logout" && method === "POST") {
      const res = json({ ok: true });
      for (const cookie of await logout(env, request)) res.headers.append("set-cookie", cookie);
      return res;
    }

    const email = await currentUser(env, request);
    if (!email) return fail(401, "Sign in first.");
    if (path === "/api/me" && method === "GET") return json({ email });
    if (path === "/api/spend" && method === "GET") return json(await totals(env));
    if (path === "/api/batches" && method === "GET") return json(await batch.batchList(env));

    let m = path.match(new RegExp(`^/api/batches/(${UUID})$`));
    if (m && method === "GET") return json(await batch.batchGetOwner(env, m[1]!));

    // The one human step: the owner picks 1 draft per idea. This only saves the picks. Claude then runs the final
    // (house recipe, creative-playbook §7).
    m = path.match(new RegExp(`^/api/batches/(${UUID})/picks$`));
    if (m && method === "POST") {
      const b = await body(request);
      // An empty list clears the picks that have no final yet, so a missing or misnamed field must not look like one.
      if (!Array.isArray(b.picks)) return fail(400, "Send picks as a list.");
      const picks = b.picks;
      if (picks.length > 8) return fail(400, "Pick 0 to 8 drafts (none clears the picks that have no final yet).");
      const clean = picks.map((p: any) => {
        if (typeof p?.key !== "string" || !DRAFT_KEY.test(p.key)) throw new AuthError("Bad draft key.", 400);
        const note = typeof p.note === "string" ? p.note : undefined;
        if (note && note.length > NOTE_MAX) throw new AuthError(`A note can have at most ${NOTE_MAX} characters.`, 400);
        return { key: p.key, note };
      });
      return json(await batch.picksSave(env, m[1]!, clean));
    }

    m = path.match(new RegExp(`^/api/renders/(${UUID})/refresh$`));
    // The board's check of a running render. It only reads fal and saves the finished images: the logo and the picture
    // that a pack uses come from Claude's compose_final alone, so a board view never changes them (owner, 19-11-2026).
    if (m && method === "POST") return json(await fal.check(env, m[1]!));

    return fail(404, "Not found.");
  } catch (e) {
    if (e instanceof AuthError) return fail(e.status, e.message);
    if (e instanceof BudgetError) return fail(402, e.message);
    return fail(400, e instanceof Error ? e.message : String(e));
  }
}
