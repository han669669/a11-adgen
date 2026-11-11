import type { Env } from "./env";
import { mediaUrl } from "./fal";
import { InputError } from "./schema";

/**
 * The owner's draft picks for one batch, with where each one stands on the way to the pack:
 * every final made for the picked idea (newest first), whether the newest composed final is a repaired picture
 * (final_attach, for example after scripts/box_print.py), and which pack versions used each final.
 * It answers "which final goes in the pack" without reading the whole batch, and shows what step is next.
 */
export async function picksGet(env: Env, batchId: string) {
  const batch = await env.DB.prepare("SELECT id, label, status FROM batches WHERE id = ?").bind(batchId).first<{ id: string; label: string; status: string }>();
  if (!batch) throw new InputError(`No batch ${batchId}.`);
  const picks =
    (
      await env.DB.prepare(
        `SELECT p.render_key, p.idea_id, p.note, p.by_owner, p.final_render_id, p.created_at, i.n, i.format, i.headline,
                (SELECT rank FROM draft_ranks d WHERE d.render_key = p.render_key) AS critic_rank
           FROM picks p JOIN ideas i ON i.id = p.idea_id AND i.batch_id = p.batch_id
          WHERE p.batch_id = ? ORDER BY i.n`,
      )
        .bind(batchId)
        .all<{ render_key: string; idea_id: string; note: string | null; by_owner: number; final_render_id: string | null; created_at: string; n: number; format: string; headline: string; critic_rank: number | null }>()
    ).results ?? [];
  const finals =
    (
      await env.DB.prepare("SELECT id, idea, status, composed_key, created_at FROM renders WHERE batch = ? AND kind = 'final' ORDER BY created_at DESC, id DESC")
        .bind(batchId)
        .all<{ id: string; idea: string; status: string; composed_key: string | null; created_at: string }>()
    ).results ?? [];
  const packs =
    (await env.DB.prepare("SELECT version, revoked_at, content FROM packs WHERE batch_id = ? ORDER BY version").bind(batchId).all<{ version: number; revoked_at: string | null; content: string }>()).results ?? [];
  // Which pack versions show each composed picture, and the Meta text of each version (the pack prompt reuses the approved copy word for word).
  type PackAdCopy = { name?: string; stage?: string; imageKey?: string; primaryTexts?: string[]; headlines?: string[]; description?: string; cta?: string; why?: string };
  const usedIn = new Map<string, number[]>();
  const copyOf = new Map<number, { launchPlan?: string; ads: Omit<PackAdCopy, "imageKey">[] }>();
  for (const p of packs) {
    let c: { ads?: PackAdCopy[]; launchPlan?: string } | null;
    try {
      c = JSON.parse(p.content) as typeof c;
    } catch {
      continue;
    }
    if (!c || typeof c !== "object") continue;
    const ads = Array.isArray(c.ads) ? c.ads : [];
    for (const a of ads) if (a.imageKey) usedIn.set(a.imageKey, [...(usedIn.get(a.imageKey) ?? []), p.version]);
    copyOf.set(p.version, { launchPlan: c.launchPlan, ads: ads.map(({ imageKey: _, ...x }) => x) });
  }

  const out = [];
  for (const p of picks) {
    const mine = finals.filter((f) => f.idea === p.idea_id);
    const list = [];
    for (const f of mine) {
      const composed = f.composed_key?.startsWith("renders/") ? f.composed_key : null;
      // final_attach marks the picture it saves; a compose_final picture has no mark.
      const repaired = composed ? Boolean((await env.MEDIA.head(composed))?.customMetadata?.repairedFrom) : false;
      list.push({
        renderId: f.id,
        status: f.status,
        createdAt: f.created_at,
        // The final's own image (the key upload_link takes for a repair): the composed key without its "-c..." part.
        imageKey: composed ? composed.replace(/-c\d*\.jpg$/, ".jpg") : null,
        composedKey: composed,
        composedUrl: composed ? mediaUrl(env, composed) : null,
        repaired,
        inPacks: composed ? (usedIn.get(composed) ?? []) : [],
      });
    }
    const newest = list.find((f) => f.status === "done" && f.composedKey);
    const latest = newest?.composedKey
      ? { renderId: newest.renderId, imageKey: newest.imageKey!, composedKey: newest.composedKey, composedUrl: newest.composedUrl!, repaired: newest.repaired }
      : null;
    const next = !list.length
      ? "final_render"
      : list.every((f) => f.status === "failed")
        ? "render_submit kind 'final' (every final of this idea failed; final_render refuses an idea that already has a final)"
        : !list.some((f) => f.status === "done")
          ? "render_status (the final is not done)"
          : !latest
            ? "compose_final"
            : "check the final; for a boxed product whose chosen final has repaired false, run scripts/box_print.py, upload_link (key = its imageKey) and curl; then pack_publish";
    out.push({
      ideaId: p.idea_id,
      idea: p.n,
      stage: p.format,
      headline: p.headline,
      draftKey: p.render_key,
      criticRank: p.critic_rank,
      byOwner: p.by_owner === 1,
      ownerNote: p.note,
      pickedAt: p.created_at,
      firstFinalId: /^(pending|accepted):/.test(p.final_render_id ?? "") ? null : p.final_render_id,
      finals: list,
      latest,
      next,
    });
  }
  return {
    batch: { id: batch.id, label: batch.label, status: batch.status },
    picks: out,
    packs: packs.map((p) => ({ version: p.version, revoked: p.revoked_at !== null, copy: copyOf.get(p.version) ?? null })),
    note: "packs[].copy is each version's Meta text and launch plan: reuse the copy the owner approved word for word. latest is the newest done and composed final of each picked idea. The owner may have approved an older one: follow his words. repaired true (on each final) means final_attach took in a picture fixed outside the Worker. imageKey is the key upload_link takes for a repair.",
  };
}
