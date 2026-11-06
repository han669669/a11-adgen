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

/** Board check of one render: poll fal; when a final is done, draw the kit's real logo once (D2: no extra step). */
async function refresh(env: Env, id: string) {
  const status = await fal.check(env, id);
  if (!("images" in status) || status.kind !== "final" || status.status !== "done" || status.images.length === 0) return status;
  const row = await env.DB.prepare(
    `SELECT r.composed_key, b.brand_id, b.kit_version FROM renders r JOIN batches b ON b.id = r.batch WHERE r.id = ?`,
  )
    .bind(id)
    .first<{ composed_key: string | null; brand_id: string; kit_version: number }>();
  if (!row || row.composed_key) return { ...status, composed: row?.composed_key ? fal.mediaUrl(env, row.composed_key) : null };
  const kit = await latestKit(env, row.brand_id, row.kit_version);
  if (!kit) return status;
  const out = await composeFinal(env, {
    key: status.images[0]!.key,
    logoKey: kit.kit.logo.key,
    logoWidthPct: kit.kit.placement.logoWidthPct,
    logoTopPct: kit.kit.placement.logoTopPct,
    grain: "on",
    grainPct: 18,
  });
  await env.DB.prepare("UPDATE renders SET composed_key = ? WHERE id = ?").bind(out.key, id).run();
  return { ...status, composed: out.url };
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

    // The one human step (D2): save the owner's picks, then start their high finals.
    m = path.match(new RegExp(`^/api/batches/(${UUID})/render$`));
    if (m && method === "POST") {
      const b = await body(request);
      const picks = Array.isArray(b.picks) ? b.picks : [];
      if (picks.length === 0 || picks.length > 8) return fail(400, "Pick 1 to 8 drafts.");
      const clean = picks.map((p: any) => {
        if (typeof p?.key !== "string" || !DRAFT_KEY.test(p.key)) throw new AuthError("Bad draft key.", 400);
        const note = typeof p.note === "string" ? p.note.slice(0, 600) : undefined;
        return { key: p.key, note };
      });
      await batch.picksSave(env, m[1]!, clean);
      const started = await Promise.allSettled(clean.map((p: { key: string }) => batch.finalRender(env, m![1]!, p.key)));
      return json({
        results: started.map((r, i) => ({
          key: clean[i]!.key,
          ...(r.status === "fulfilled" ? { ok: true, render: r.value } : { ok: false, error: String((r.reason as Error)?.message ?? r.reason) }),
        })),
      });
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
