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
  // Which pack versions show each composed picture.
  const usedIn = new Map<string, number[]>();
  for (const p of packs) {
    let ads: { imageKey?: string }[] = [];
    try {
      ads = (JSON.parse(p.content) as { ads?: { imageKey?: string }[] }).ads ?? [];
    } catch {
      continue;
    }
    for (const a of ads) if (a.imageKey) usedIn.set(a.imageKey, [...(usedIn.get(a.imageKey) ?? []), p.version]);
  }

  const out = [];
  for (const p of picks) {
    const mine = finals.filter((f) => f.idea === p.idea_id);
    const list = mine.map((f) => {
      const composed = f.composed_key?.startsWith("renders/") ? f.composed_key : null;
      return {
        renderId: f.id,
        status: f.status,
        createdAt: f.created_at,
        composedKey: composed,
        composedUrl: composed ? mediaUrl(env, composed) : null,
        inPacks: composed ? (usedIn.get(composed) ?? []) : [],
      };
    });
    const newest = list.find((f) => f.status === "done" && f.composedKey);
    let latest: { renderId: string; composedKey: string; composedUrl: string; repaired: boolean } | null = null;
    if (newest?.composedKey) {
      // final_attach marks the picture it saves; a compose_final picture has no mark.
      const head = await env.MEDIA.head(newest.composedKey);
      latest = { renderId: newest.renderId, composedKey: newest.composedKey, composedUrl: newest.composedUrl!, repaired: Boolean(head?.customMetadata?.repairedFrom) };
    }
    const next = !list.length
      ? "final_render"
      : !list.some((f) => f.status === "done")
        ? "render_status (the final is not done)"
        : !latest
          ? "compose_final"
          : "check the final; for a boxed product run scripts/box_print.py, upload_link and curl until repaired is true; then pack_publish";
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
      firstFinalId: p.final_render_id?.startsWith("pending:") ? null : p.final_render_id,
      finals: list,
      latest,
      next,
    });
  }
  return {
    batch: { id: batch.id, label: batch.label, status: batch.status },
    picks: out,
    packs: packs.map((p) => ({ version: p.version, revoked: p.revoked_at !== null })),
    note: "latest is the newest done and composed final of each picked idea. The owner may have approved an older one: follow his words. repaired true means final_attach took in a picture fixed outside the Worker.",
  };
}
