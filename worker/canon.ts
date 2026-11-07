import type { Env } from "./env";
import { InputError } from "./schema";

const now = () => new Date().toISOString();
const DAY = 86_400_000;
/** A rule with no new evidence for this many days is due for retirement (docs/blueprint.md section 4). */
export const STALE_DAYS = 60;

interface Rule {
  id: string;
  stage: string;
  text: string;
  status: string;
  evidence: string;
  hits: number;
  misses: number;
  created_at: string;
  last_evidence_at: string;
  retired_reason: string | null;
}

const view = (r: Rule, at = Date.now()) => {
  const evidence = JSON.parse(r.evidence) as { at: string; source: string; quote?: string }[];
  const seen = hitsTotal(r);
  return {
    id: r.id,
    stage: r.stage,
    rule: r.text,
    status: r.status,
    evidenceCount: evidence.length,
    evidence: evidence.slice(-3),
    hits: r.hits,
    misses: r.misses,
    hitRate: seen ? Math.round((r.hits / seen) * 100) / 100 : null,
    daysSinceEvidence: Math.floor((at - Date.parse(r.last_evidence_at)) / DAY),
    retireDue: r.status === "active" && at - Date.parse(r.last_evidence_at) > STALE_DAYS * DAY,
    ...(r.retired_reason ? { retiredReason: r.retired_reason } : {}),
  };
};
const hitsTotal = (r: Rule) => r.hits + r.misses;

export async function canonGet(env: Env, a: { stage?: string; includeRetired?: boolean }) {
  const rows = await env.DB.prepare(
    `SELECT * FROM canon_rules WHERE (? IS NULL OR stage IN ('all', ?)) AND (? = 1 OR status = 'active') ORDER BY status, created_at`,
  ).bind(a.stage ?? null, a.stage ?? null, a.includeRetired ? 1 : 0).all<Rule>();
  const rules = rows.results.map((r) => view(r));
  const active = await env.DB.prepare("SELECT COUNT(*) AS n FROM canon_rules WHERE status = 'active'").first<{ n: number }>();
  const log = await env.DB.prepare("SELECT rule_id, action, detail, at FROM canon_log ORDER BY id DESC LIMIT 10").all();
  return { activeRules: active?.n ?? 0, max: 40, retireDue: rules.filter((r) => r.retireDue).map((r) => r.id), rules, recentChanges: log.results };
}

export interface CanonChange {
  action: "add" | "edit" | "evidence" | "retire" | "restore";
  id?: string;
  rule?: string;
  stage?: string;
  source?: string;
  quote?: string;
  kind?: "hit" | "miss";
  reason?: string;
}

const need = (cond: unknown, msg: string) => {
  if (!cond) throw new InputError(msg);
};

/**
 * One change to the canon. Every change keeps its evidence or reason and is logged, so the owner can undo it.
 * add and edit need a source (where the taste came from: the owner's words, a pick, a result); the owner's quote is best.
 */
export async function canonUpdate(env: Env, c: CanonChange) {
  const at = now();
  const log = (id: string, action: string, detail: unknown) =>
    env.DB.prepare("INSERT INTO canon_log (rule_id, action, detail, at) VALUES (?, ?, ?, ?)").bind(id, action, JSON.stringify(detail), at);
  if (c.action === "add") {
    need(c.rule && c.source, "add needs rule and source.");
    const id = crypto.randomUUID().slice(0, 8);
    const evidence = JSON.stringify([{ at, source: c.source, ...(c.quote ? { quote: c.quote } : {}) }]);
    try {
      await env.DB.batch([
        env.DB.prepare(
          `INSERT INTO canon_rules (id, stage, text, evidence, created_at, updated_at, last_evidence_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        ).bind(id, c.stage ?? "all", c.rule, evidence, at, at, at),
        log(id, "add", { rule: c.rule, source: c.source }),
      ]);
    } catch (e) {
      if (/canon is full/.test(String(e))) throw new InputError("The canon is full (40 active rules). Retire a rule that has no recent evidence first.");
      throw e;
    }
    return { id, added: true };
  }
  need(c.id, `${c.action} needs id.`);
  const r = await env.DB.prepare("SELECT * FROM canon_rules WHERE id = ?").bind(c.id).first<Rule>();
  need(r, "No such rule.");
  if (c.action === "edit") {
    need(c.rule && c.source, "edit needs rule and source.");
    const evidence = [...JSON.parse(r!.evidence), { at, source: c.source, ...(c.quote ? { quote: c.quote } : {}) }];
    await env.DB.batch([
      env.DB.prepare("UPDATE canon_rules SET text = ?, stage = ?, evidence = ?, updated_at = ?, last_evidence_at = ? WHERE id = ?").bind(
        c.rule, c.stage ?? r!.stage, JSON.stringify(evidence), at, at, c.id,
      ),
      log(c.id!, "edit", { from: r!.text, to: c.rule, source: c.source }),
    ]);
    return { id: c.id, edited: true };
  }
  if (c.action === "evidence") {
    need(c.kind && c.source, "evidence needs kind (hit or miss) and source.");
    need(r!.status === "active", "A retired rule takes no evidence. Restore it first.");
    const evidence = [...JSON.parse(r!.evidence), { at, source: c.source, ...(c.quote ? { quote: c.quote } : {}), kind: c.kind }];
    await env.DB.batch([
      env.DB.prepare(
        `UPDATE canon_rules SET evidence = ?, hits = hits + ?, misses = misses + ?, updated_at = ?, last_evidence_at = ? WHERE id = ?`,
      ).bind(JSON.stringify(evidence), c.kind === "hit" ? 1 : 0, c.kind === "miss" ? 1 : 0, at, at, c.id),
      log(c.id!, "evidence", { kind: c.kind, source: c.source }),
    ]);
    return { id: c.id, recorded: c.kind };
  }
  if (c.action === "retire") {
    need(c.reason, "retire needs reason.");
    need(r!.status === "active", "That rule is already retired.");
    await env.DB.batch([
      env.DB.prepare("UPDATE canon_rules SET status = 'retired', retired_at = ?, retired_reason = ?, updated_at = ? WHERE id = ?").bind(at, c.reason, at, c.id),
      log(c.id!, "retire", { reason: c.reason }),
    ]);
    return { id: c.id, retired: true };
  }
  need(c.reason, "restore needs reason.");
  need(r!.status === "retired", "That rule is already active.");
  try {
    await env.DB.batch([
      env.DB.prepare("UPDATE canon_rules SET status = 'active', retired_at = NULL, retired_reason = NULL, last_evidence_at = ?, updated_at = ? WHERE id = ?").bind(at, at, c.id),
      log(c.id!, "restore", { reason: c.reason }),
    ]);
  } catch (e) {
    if (/canon is full/.test(String(e))) throw new InputError("The canon is full (40 active rules). Retire another rule first.");
    throw e;
  }
  return { id: c.id, restored: true };
}

// Swipe file -------------------------------------------------------------

export interface SwipeIn {
  title: string;
  why: string;
  source: string;
  stage: string;
  brandSlug?: string;
  sourceUrl?: string;
  imageKey?: string;
}

export async function swipeAdd(env: Env, s: SwipeIn) {
  const id = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO swipe (id, brand_slug, stage, title, why, source, source_url, image_key, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(id, s.brandSlug ?? null, s.stage, s.title, s.why, s.source, s.sourceUrl ?? null, s.imageKey ?? null, now()).run();
  return { id };
}

/** Top examples per brand and stage (newest first). A brand's own examples come before examples from other brands. */
export async function swipeSearch(env: Env, a: { brandSlug?: string; stage?: string; perGroup?: number }) {
  const rows = await env.DB.prepare(
    `SELECT id, brand_slug, stage, title, why, source, source_url, image_key, created_at FROM swipe
     WHERE (? IS NULL OR stage = ?) AND (? IS NULL OR brand_slug = ? OR brand_slug IS NULL) ORDER BY created_at DESC LIMIT 200`,
  ).bind(a.stage ?? null, a.stage ?? null, a.brandSlug ?? null, a.brandSlug ?? null).all<Record<string, string | null>>();
  const per = a.perGroup ?? 3;
  const seen = new Map<string, number>();
  const out = rows.results.filter((r) => {
    const k = `${r.brand_slug}|${r.stage}`;
    const n = seen.get(k) ?? 0;
    seen.set(k, n + 1);
    return n < per;
  });
  return { examples: out };
}

// Gold set ---------------------------------------------------------------

export interface GoldIn {
  label: string;
  mark: "use" | "pass";
  stage?: string;
  headline?: string;
  imageKey?: string;
  note?: string;
  source?: string;
}

export async function goldImport(env: Env, items: GoldIn[]) {
  const at = now();
  await env.DB.batch(
    items.map((g) =>
      env.DB.prepare(
        `INSERT INTO gold_items (id, label, stage, headline, image_key, mark, note, source, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(crypto.randomUUID(), g.label, g.stage ?? null, g.headline ?? null, g.imageKey ?? null, g.mark, g.note ?? null, g.source ?? "v1", at),
    ),
  );
  const n = await env.DB.prepare("SELECT COUNT(*) AS n FROM gold_items").first<{ n: number }>();
  return { imported: items.length, goldItems: n?.n ?? 0 };
}

/** The gold items WITHOUT the owner's marks, so the critic judges them blind. Same order every time, so runs compare. */
export async function goldGet(env: Env, a: { limit?: number; offset?: number }) {
  const rows = await env.DB.prepare(
    "SELECT id, label, stage, headline, image_key FROM gold_items ORDER BY id LIMIT ? OFFSET ?",
  ).bind(a.limit ?? 30, a.offset ?? 0).all<Record<string, string | null>>();
  const total = await env.DB.prepare("SELECT COUNT(*) AS n FROM gold_items").first<{ n: number }>();
  return { total: total?.n ?? 0, items: rows.results };
}

/** Compare the critic's use/pass answers with the owner's marks. Saves the run so before and after a change can be compared. */
export async function goldScore(env: Env, a: { note: string; answers: { id: string; mark: "use" | "pass" }[] }) {
  const ids = a.answers.map((x) => x.id);
  if (new Set(ids).size !== ids.length) throw new InputError("Each gold item may be answered once.");
  const marks = await env.DB.prepare("SELECT id, mark FROM gold_items WHERE id IN (SELECT value FROM json_each(?))")
    .bind(JSON.stringify(ids)).all<{ id: string; mark: string }>();
  const truth = new Map(marks.results.map((m) => [m.id, m.mark]));
  const unknown = ids.filter((id) => !truth.has(id));
  if (unknown.length) throw new InputError(`Not gold items: ${unknown.slice(0, 3).join(", ")}.`);
  const agreed = a.answers.filter((x) => truth.get(x.id) === x.mark).length;
  const r = await env.DB.prepare("INSERT INTO gold_runs (note, n, agreed, at) VALUES (?, ?, ?, ?)").bind(a.note, a.answers.length, agreed, now()).run();
  const previous = await env.DB.prepare("SELECT note, n, agreed, at FROM gold_runs WHERE id < ? ORDER BY id DESC LIMIT 1").bind(r.meta.last_row_id).first<{ note: string; n: number; agreed: number; at: string }>();
  return {
    n: a.answers.length,
    agreed,
    agreement: Math.round((agreed / a.answers.length) * 1000) / 1000,
    previous: previous ? { note: previous.note, n: previous.n, agreement: Math.round((previous.agreed / previous.n) * 1000) / 1000, at: previous.at } : null,
  };
}

export async function goldRuns(env: Env) {
  const rows = await env.DB.prepare("SELECT note, n, agreed, at FROM gold_runs ORDER BY id DESC LIMIT 20").all<{ note: string; n: number; agreed: number; at: string }>();
  return { runs: rows.results.map((r) => ({ note: r.note, n: r.n, agreement: Math.round((r.agreed / r.n) * 1000) / 1000, at: r.at })) };
}
