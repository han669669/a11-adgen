import { AuthError, currentUser, login, logout, signup } from "./auth";
import * as batch from "./batch";
import { latestKit } from "./brand";
import { composeFinal } from "./compose";
import type { Env } from "./env";
import * as fal from "./fal";
import { BudgetError, totals } from "./spend";

const UUID = "[0-9a-f-]{36}";
const DRAFT_KEY = /^renders\/[0-9a-f-]{36}\/\d+\.jpg$/;

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

/**
 * Claim the compose of one final, so two refreshes at once draw the logo only once. A claim older than
 * 2 minutes is stale (the Worker stopped mid-compose), so a later refresh takes it over.
 * Returns the claim value, or null when another refresh holds a live claim or the compose is settled.
 */
export async function claimCompose(env: Env, id: string, now = new Date()): Promise<string | null> {
  const stale = new Date(now.getTime() - 120_000).toISOString();
  const claim = `pending:${now.toISOString()}:${crypto.randomUUID()}`;
  const res = await env.DB.prepare(
    `UPDATE renders SET composed_key = ? WHERE id = ?
     AND (composed_key IS NULL OR (composed_key LIKE 'pending:%' AND composed_key < ?))`,
  )
    .bind(claim, id, `pending:${stale}`)
    .run();
  return res.meta.changes === 1 ? claim : null;
}

/** Write the compose result only while this claim still holds, so a superseded compose cannot overwrite a newer one. */
export async function settleCompose(env: Env, id: string, claim: string, value: string): Promise<boolean> {
  const res = await env.DB.prepare("UPDATE renders SET composed_key = ? WHERE id = ? AND composed_key = ?").bind(value, id, claim).run();
  return res.meta.changes === 1;
}

/** Board check of one render: poll fal; when a final is done, draw the kit's real logo once (D2: no extra step). */
async function refresh(env: Env, id: string) {
  const status = await fal.check(env, id);
  if (!("images" in status) || status.kind !== "final" || status.status !== "done" || status.images.length === 0) return status;
  const row = await env.DB.prepare(
    `SELECT r.composed_key, b.brand_id, b.kit_version FROM renders r JOIN batches b ON b.id = r.batch WHERE r.id = ?`,
  )
    .bind(id)
    .first<{ composed_key: string | null; brand_id: string; kit_version: number }>();
  if (!row) return status;
  if (row.composed_key?.startsWith("error:")) return { ...status, composed: null, composeError: row.composed_key.slice(6) };
  if (row.composed_key?.startsWith("renders/")) return { ...status, composed: fal.mediaUrl(env, row.composed_key) };
  const kit = await latestKit(env, row.brand_id, row.kit_version);
  if (!kit) return status;
  const claim = await claimCompose(env, id);
  if (!claim) return { ...status, composed: null };
  try {
    const out = await composeFinal(env, {
      key: status.images[0]!.key,
      logoKey: kit.kit.logo.key,
      logoWidthPct: kit.kit.placement.logoWidthPct,
      logoTopPct: kit.kit.placement.logoTopPct,
      grain: "on",
      grainPct: 18,
    });
    // A newer claim took over (this compose ran past the stale limit): keep its result, not ours.
    if (!(await settleCompose(env, id, claim, out.key))) {
      await env.MEDIA.delete(out.key); // nothing points to it
      return { ...status, composed: null };
    }
    return { ...status, composed: out.url };
  } catch (e) {
    // Record the failure, so the board stops polling and shows it. compose_final (MCP) on this render
    // writes its result here, which clears the error.
    const msg = (e instanceof Error ? e.message : String(e)).slice(0, 300);
    if (!(await settleCompose(env, id, claim, `error:${msg}`))) return { ...status, composed: null };
    return { ...status, composed: null, composeError: msg };
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
    if (path === "/api/logout" && method === "POST") return json({ ok: true }, 200, { "set-cookie": await logout(env, request) });

    const email = await currentUser(env, request);
    if (!email) return fail(401, "Sign in first.");
    if (path === "/api/me" && method === "GET") return json({ email });
    if (path === "/api/spend" && method === "GET") return json(await totals(env));
    if (path === "/api/batches" && method === "GET") return json(await batch.batchList(env));

    let m = path.match(new RegExp(`^/api/batches/(${UUID})$`));
    if (m && method === "GET") return json(await batch.batchGet(env, m[1]!));

    // The one human step: the owner picks 1 draft per idea. This only saves the picks. Claude then runs the final
    // (house recipe, creative-playbook §7). Note: the board's refresh still draws the logo on any finished final, so a raw
    // first final can show composed before its finish pass. Claude's compose_final of the verified key is the newest and wins.
    m = path.match(new RegExp(`^/api/batches/(${UUID})/picks$`));
    if (m && method === "POST") {
      const b = await body(request);
      // An empty list clears the picks that have no final yet, so a missing or misnamed field must not look like one.
      if (!Array.isArray(b.picks)) return fail(400, "Send picks as a list.");
      const picks = b.picks;
      if (picks.length > 8) return fail(400, "Pick 0 to 8 drafts (none clears the picks that have no final yet).");
      const clean = picks.map((p: any) => {
        if (typeof p?.key !== "string" || !DRAFT_KEY.test(p.key)) throw new AuthError("Bad draft key.", 400);
        const note = typeof p.note === "string" ? p.note.slice(0, 600) : undefined;
        return { key: p.key, note };
      });
      return json(await batch.picksSave(env, m[1]!, clean));
    }

    m = path.match(new RegExp(`^/api/renders/(${UUID})/refresh$`));
    if (m && method === "POST") return json(await refresh(env, m[1]!));

    return fail(404, "Not found.");
  } catch (e) {
    if (e instanceof AuthError) return fail(e.status, e.message);
    if (e instanceof BudgetError) return fail(402, e.message);
    return fail(400, e instanceof Error ? e.message : String(e));
  }
}
