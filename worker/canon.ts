import type { Env } from "./env";
import { InputError } from "./schema";

const now = () => new Date().toISOString();
const DAY = 86_400_000;
/** A rule with no new evidence for this many days is due for retirement (docs/blueprint.md section 4). */
export const STALE_DAYS = 60;

/** Canon scopes (a11-engine v3 Phase 5, migration 0016): owner taste, one brand's lessons, creative principles, performance lessons. */
export const SCOPES = ["owner", "brand", "creative", "performance"] as const;
export type Scope = (typeof SCOPES)[number];
/** Active rules for every batch (not brand rules), and for each brand (database triggers enforce both). */
export const MAX_ACTIVE = 40;
export const MAX_BRAND = 10;

interface Rule {
  id: string;
  stage: string;
  scope: Scope;
  brand_slug: string | null;
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
    scope: r.scope,
    ...(r.brand_slug ? { brandSlug: r.brand_slug } : {}),
    rule: r.text,
    status: r.status,
    evidenceCount: evidence.length,
    evidence: evidence.slice(-3),
    hits: r.hits,
    misses: r.misses,
    hitRate: seen ? Math.round((r.hits / seen) * 100) / 100 : null,
    daysSinceEvidence: Math.floor((at - Date.parse(r.last_evidence_at)) / DAY),
    retireDue: r.status === "active" && at - Date.parse(r.last_evidence_at) >= STALE_DAYS * DAY,
    ...(r.retired_reason ? { retiredReason: r.retired_reason } : {}),
  };
};
const hitsTotal = (r: Rule) => r.hits + r.misses;

const brandExists = async (env: Env, slug: string) => {
  const b = await env.DB.prepare("SELECT 1 AS ok FROM brands WHERE slug = ?").bind(slug).first();
  need(b, `No brand ${slug}.`);
};

/**
 * The canon for one job. Without scope: every rule that is not a brand rule, plus the rules of brandSlug (none without it),
 * so a brand's lessons never reach another brand's batch (specification §9.7). With scope: that scope only; scope brand
 * without brandSlug lists the rules of every brand (to review them, never for a batch).
 */
export async function canonGet(env: Env, a: { stage?: string; includeRetired?: boolean; brandSlug?: string; scope?: Scope }) {
  if (a.brandSlug) await brandExists(env, a.brandSlug);
  need(!(a.brandSlug && a.scope && a.scope !== "brand"), "brandSlug goes with scope brand, or with no scope.");
  const brand = a.brandSlug ?? null;
  // Which rules this call may see: the same filter for the rules and for the recent changes.
  const seen = a.scope
    ? `r.scope = ? AND (r.scope != 'brand' OR ? IS NULL OR r.brand_slug = ?)`
    : `(r.scope != 'brand' OR r.brand_slug = ?)`;
  const seenArgs = a.scope ? [a.scope, brand, brand] : [brand];
  const rows = await env.DB.prepare(
    `SELECT * FROM canon_rules r WHERE ${seen} AND (? IS NULL OR r.stage IN ('all', ?)) AND (? = 1 OR r.status = 'active') ORDER BY r.status, r.created_at, r.rowid`,
  ).bind(...seenArgs, a.stage ?? null, a.stage ?? null, a.includeRetired ? 1 : 0).all<Rule>();
  const rules = rows.results.map((r) => view(r));
  const active = await env.DB.prepare("SELECT COUNT(*) AS n FROM canon_rules WHERE status = 'active' AND scope != 'brand'").first<{ n: number }>();
  const mine = brand
    ? await env.DB.prepare("SELECT COUNT(*) AS n FROM canon_rules WHERE status = 'active' AND scope = 'brand' AND brand_slug = ?").bind(brand).first<{ n: number }>()
    : null;
  const log = await env.DB.prepare(
    `SELECT l.rule_id, l.action, l.detail, l.at FROM canon_log l JOIN canon_rules r ON r.id = l.rule_id WHERE ${seen} ORDER BY l.id DESC LIMIT 10`,
  ).bind(...seenArgs).all();
  return {
    activeRules: active?.n ?? 0,
    max: MAX_ACTIVE,
    ...(brand ? { brandRules: { brandSlug: brand, active: mine?.n ?? 0, max: MAX_BRAND } } : {}),
    retireDue: rules.filter((r) => r.retireDue).map((r) => r.id),
    rules,
    recentChanges: log.results,
  };
}

/**
 * The learning record of a canon change (a11-engine v3 specification §9.7): what was seen, the examples it explains
 * and the ones against it, how sure, and what it should change. The store is the rule's scope; the lesson is the rule;
 * the source is the change's source; the test result is the gold run before it, then the test action after it.
 */
export interface Learning {
  observation: string;
  examples: string[];
  counterexamples: string[];
  evidenceCount: number;
  confidence: "low" | "medium" | "high";
  expectedEffect: string;
  /** The gold run (gold_score runId) made before the change, when there is one. */
  goldBefore?: number;
  /** The owner's own words that make this one piece of evidence a rule for every brand. */
  ownerApproval?: string;
}

export interface CanonChange {
  action: "add" | "edit" | "evidence" | "retire" | "restore" | "test";
  id?: string;
  rule?: string;
  stage?: string;
  /** add: defaults to owner. edit: leave out to keep the rule's scope. */
  scope?: Scope;
  /** A brand rule's brand (brands.slug): with scope brand only. */
  brandSlug?: string;
  source?: string;
  quote?: string;
  kind?: "hit" | "miss";
  reason?: string;
  /** add and edit: required. retire and restore: optional. */
  learning?: Learning;
  /** test: the gold run made after the change. */
  goldAfter?: number;
  /** test: why the gold set cannot test this rule (it is text only and has no brand). */
  untestable?: string;
}

const need = (cond: unknown, msg: string) => {
  if (!cond) throw new InputError(msg);
};

/** The two limits as owner-readable errors; any other error is not changed. */
const full = (e: unknown, next: string) => {
  if (/brand canon is full/.test(String(e))) return new InputError(`This brand has ${MAX_BRAND} active rules. ${next}`);
  if (/canon is full/.test(String(e))) return new InputError(`The canon is full (${MAX_ACTIVE} active rules). ${next}`);
  return e;
};

/** The scope and brand of a rule after a change, checked: a brand rule needs a brand that exists; no other rule has one. */
async function scopeOf(env: Env, scope: Scope, brandSlug: string | null) {
  if (scope === "brand") {
    need(brandSlug, "A brand rule needs brandSlug.");
    await brandExists(env, brandSlug!);
    return { scope, brand: brandSlug };
  }
  need(!brandSlug, "Only a brand rule has brandSlug.");
  return { scope, brand: null };
}

/** The stats of a gold run by id, for the learning record (a snapshot, so the record does not depend on a later read). */
type GoldRunView = Record<string, unknown> & { runId: number; scope: string; balancedAccuracy?: number | null };
async function goldRun(env: Env, id: number): Promise<GoldRunView> {
  const r = await env.DB.prepare("SELECT id, note, n, agreed, use_agreed, use_truth, at FROM gold_runs WHERE id = ?").bind(id).first<RunRow & { id: number }>();
  need(r, `No gold run ${id}.`);
  return { runId: id, ...runStats(r!) } as GoldRunView;
}

/**
 * The learning record, checked (specification §9.7: one correction is not enough to create a global rule).
 * global: the change makes a rule that every batch reads (an add, or a brand rule moved out of its brand). Such a rule
 * needs 2 pieces of evidence or more, or the owner's own words that make it a rule.
 */
async function learningOf(env: Env, l: Learning | undefined, global: boolean, action: string) {
  need(l, `${action} needs learning: the observation, examples, counterexamples, evidenceCount, confidence and expectedEffect.`);
  need(!global || l!.evidenceCount >= 2 || l!.ownerApproval, "One piece of evidence is not enough for a rule that every brand reads: make it a brand rule, wait for more evidence, or give the owner's own words that approve it (learning.ownerApproval).");
  need(l!.evidenceCount >= l!.examples.length, "evidenceCount must count every example.");
  return { ...l!, ...(l!.goldBefore !== undefined ? { goldBefore: await goldRun(env, l!.goldBefore) } : {}) };
}

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
    const s = await scopeOf(env, c.scope ?? "owner", c.brandSlug ?? null);
    const learning = await learningOf(env, c.learning, s.scope !== "brand", "add");
    const id = crypto.randomUUID().slice(0, 8);
    const evidence = JSON.stringify([{ at, source: c.source, ...(c.quote ? { quote: c.quote } : {}) }]);
    try {
      await env.DB.batch([
        env.DB.prepare(
          `INSERT INTO canon_rules (id, stage, scope, brand_slug, text, evidence, created_at, updated_at, last_evidence_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).bind(id, c.stage ?? "all", s.scope, s.brand, c.rule, evidence, at, at, at),
        log(id, "add", { rule: c.rule, source: c.source, scope: s.scope, ...(s.brand ? { brandSlug: s.brand } : {}), learning }),
      ]);
    } catch (e) {
      throw full(e, "Retire a rule that has no recent evidence first.");
    }
    return { id, added: true, scope: s.scope, ...(s.brand ? { brandSlug: s.brand } : {}) };
  }
  need(c.id, `${c.action} needs id.`);
  const r = await env.DB.prepare("SELECT * FROM canon_rules WHERE id = ?").bind(c.id).first<Rule>();
  need(r, "No such rule.");
  if (c.action === "edit") {
    need(c.rule && c.source, "edit needs rule and source.");
    need(r!.status === "active", "A retired rule cannot be edited. Restore it first.");
    // A scope other than brand drops the brand; a brand rule keeps its brand unless brandSlug names another.
    const scope = c.scope ?? r!.scope;
    const s = await scopeOf(env, scope, c.brandSlug ?? (scope === "brand" ? r!.brand_slug : null));
    const moved = s.scope !== r!.scope || s.brand !== r!.brand_slug;
    const learning = await learningOf(env, c.learning, r!.scope === "brand" && s.scope !== "brand", "edit");
    // An edit is not evidence: it does not refresh the 60-day clock. The source is kept in the log.
    try {
      await env.DB.batch([
        env.DB.prepare("UPDATE canon_rules SET text = ?, stage = ?, scope = ?, brand_slug = ?, updated_at = ? WHERE id = ?").bind(c.rule, c.stage ?? r!.stage, s.scope, s.brand, at, c.id),
        log(c.id!, "edit", {
          from: r!.text,
          to: c.rule,
          source: c.source,
          ...(c.quote ? { quote: c.quote } : {}),
          ...(moved ? { fromScope: r!.scope, toScope: s.scope, ...(r!.brand_slug ? { fromBrand: r!.brand_slug } : {}), ...(s.brand ? { toBrand: s.brand } : {}) } : {}),
          learning,
        }),
      ]);
    } catch (e) {
      throw full(e, "Retire a rule of that scope first.");
    }
    return { id: c.id, edited: true, scope: s.scope, ...(s.brand ? { brandSlug: s.brand } : {}) };
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
      log(c.id!, "retire", { reason: c.reason, ...(c.learning ? { learning: await learningOf(env, c.learning, false, "retire") } : {}) }),
    ]);
    return { id: c.id, retired: true };
  }
  if (c.action === "test") {
    // The test result of the newest change of this rule (specification §9.7 item 10, §9.8): the gold run after it,
    // compared with the run before it, or why the text gold set cannot test it.
    need(c.goldAfter !== undefined || c.untestable, "test needs goldAfter (the gold run after the change) or untestable (why the gold set cannot test this rule).");
    const last = await env.DB.prepare("SELECT action, detail, at FROM canon_log WHERE rule_id = ? AND action IN ('add', 'edit', 'retire', 'restore') ORDER BY id DESC LIMIT 1")
      .bind(c.id).first<{ action: string; detail: string; at: string }>();
    need(last, "That rule has no change to test.");
    const before = (JSON.parse(last!.detail) as { learning?: { goldBefore?: GoldRunView } }).learning?.goldBefore;
    const after = c.goldAfter !== undefined ? await goldRun(env, c.goldAfter) : undefined;
    // A run from before the change cannot test it.
    need(!after || String(after.at) > last!.at, "goldAfter must be a run made after the change.");
    need(!(after && before) || after.runId > before.runId, "goldAfter must be a run made after the run before the change.");
    need(!(after && before) || after.scope === before.scope, "goldAfter must have the same scope (all or in_scope) as the run before the change.");
    const delta = after?.balancedAccuracy != null && before?.balancedAccuracy != null ? Math.round((after.balancedAccuracy - before.balancedAccuracy) * 1000) / 1000 : null;
    // The gate of docs/blueprint.md: a fall of 0.04 or more in balanced accuracy undoes the change; a smaller move is noise.
    const result = after ? (delta === null ? "no_baseline" : delta <= -0.04 ? "fell" : "held") : "untestable";
    await log(c.id!, "test", { of: last!.action, ...(after ? { goldAfter: after } : {}), ...(before ? { goldBefore: before.runId } : {}), delta, result, ...(c.untestable ? { untestable: c.untestable } : {}) }).run();
    return { id: c.id, tested: last!.action, result, delta };
  }
  need(c.reason, "restore needs reason.");
  need(r!.status === "retired", "That rule is already active.");
  const learning = c.learning ? await learningOf(env, c.learning, false, "restore") : undefined;
  try {
    await env.DB.batch([
      env.DB.prepare("UPDATE canon_rules SET status = 'active', retired_at = NULL, retired_reason = NULL, updated_at = ? WHERE id = ?").bind(at, c.id),
      log(c.id!, "restore", { reason: c.reason, ...(learning ? { learning } : {}) }),
    ]);
  } catch (e) {
    throw full(e, "Retire another rule first.");
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
  // Only the filters that were asked for are in the query, so each shape can use an index (swipe_stage, swipe_lookup).
  const where: string[] = [];
  const args: (string | null)[] = [];
  if (a.stage) (where.push("stage = ?"), args.push(a.stage));
  if (a.brandSlug) (where.push("(brand_slug = ? OR brand_slug IS NULL)"), args.push(a.brandSlug));
  const order = a.brandSlug ? "CASE WHEN brand_slug = ? THEN 0 ELSE 1 END, created_at DESC, rowid DESC" : "created_at DESC, rowid DESC";
  if (a.brandSlug) args.push(a.brandSlug);
  const rows = await env.DB.prepare(
    `SELECT id, brand_slug, stage, title, why, source, source_url, image_key, created_at FROM swipe
     ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY ${order} LIMIT 200`,
  ).bind(...args).all<Record<string, string | null>>();
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
  const done = await env.DB.batch(
    items.map((g) =>
      env.DB.prepare(
        `INSERT OR IGNORE INTO gold_items (id, label, stage, headline, image_key, mark, note, source, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(crypto.randomUUID(), g.label, g.stage ?? null, g.headline ?? null, g.imageKey ?? null, g.mark, g.note ?? null, g.source ?? "v1", at),
    ),
  );
  const n = await env.DB.prepare("SELECT COUNT(*) AS n FROM gold_items").first<{ n: number }>();
  const added = done.reduce((sum, r) => sum + ((r as { meta?: { changes?: number } }).meta?.changes ?? 0), 0);
  // A label seen before (same source) is skipped, so a retried import adds nothing twice.
  return { imported: added, skippedAsKnown: items.length - added, goldItems: n?.n ?? 0 };
}

/**
 * The gold set's scopes (design pack §4.5 rule 7, OD 4.3, the owner's choice of 17-11-2026): "all" is the full set; "in_scope"
 * leaves out the v1 ads of products outside the product scope (packaged F&B and wellness products, the owner's decision of 17-11-2026 SGT):
 * a dress, a pan and a chair. The scope is a second score beside the full score, never in place of it.
 */
export type GoldScope = "all" | "in_scope";
const OUT_OF_SCOPE = ["v1 Poplin Trapeze Dress %", "v1 Ceramic Nonstick Always Pan %", "v1 ErgoTune Joobie %"];
const scopeWhere = (scope: GoldScope = "all") =>
  scope === "in_scope" ? { sql: `WHERE ${OUT_OF_SCOPE.map(() => "label NOT LIKE ?").join(" AND ")}`, binds: OUT_OF_SCOPE } : { sql: "", binds: [] as string[] };
/** The run's note carries its scope, so a run compares only with an earlier run of the same scope. */
const SCOPE_TAG = "[in_scope] ";

/** The gold items WITHOUT the owner's marks, so the critic judges them blind. Same order every time, so runs compare. */
export async function goldGet(env: Env, a: { limit?: number; offset?: number; scope?: GoldScope }) {
  const w = scopeWhere(a.scope);
  const rows = await env.DB.prepare(
    `SELECT id, label, stage, headline, image_key FROM gold_items ${w.sql} ORDER BY id LIMIT ? OFFSET ?`,
  ).bind(...w.binds, a.limit ?? 30, a.offset ?? 0).all<Record<string, string | null>>();
  const total = await env.DB.prepare(`SELECT COUNT(*) AS n FROM gold_items ${w.sql}`).bind(...w.binds).first<{ n: number }>();
  return { scope: a.scope ?? "all", total: total?.n ?? 0, items: rows.results };
}

/** Compare the critic's use/pass answers with the owner's marks. Saves the run so before and after a change can be compared. */
const r3 = (x: number) => Math.round(x * 1000) / 1000;

interface RunRow {
  note: string;
  n: number;
  agreed: number;
  use_agreed: number | null;
  use_truth: number | null;
  at: string;
}

/**
 * The numbers for one run. Most gold marks are "pass", so raw agreement alone flatters a judge who passes everything:
 * baseline is the agreement of answering the owner's more common mark for every item, and balancedAccuracy is the mean of
 * the share of his "use" marks found and the share of his "pass" marks found (0.5 = no better than a constant answer).
 * A change must not lower balancedAccuracy. Runs saved before migration 0008 have no use counts, so they show agreement only.
 */
function runStats(r: RunRow) {
  const inScope = r.note.startsWith(SCOPE_TAG);
  const out: Record<string, unknown> = {
    scope: inScope ? "in_scope" : "all",
    note: inScope ? r.note.slice(SCOPE_TAG.length) : r.note,
    n: r.n,
    agreed: r.agreed,
    agreement: r3(r.agreed / r.n),
    at: r.at,
  };
  if (r.use_agreed !== null && r.use_truth !== null) {
    const passTruth = r.n - r.use_truth;
    const passAgreed = r.agreed - r.use_agreed;
    const useRecall = r.use_truth ? r.use_agreed / r.use_truth : null;
    const passRecall = passTruth ? passAgreed / passTruth : null;
    out.baseline = r3(Math.max(r.use_truth, passTruth) / r.n);
    out.useRecall = useRecall === null ? null : r3(useRecall);
    out.passRecall = passRecall === null ? null : r3(passRecall);
    out.balancedAccuracy = useRecall !== null && passRecall !== null ? r3((useRecall + passRecall) / 2) : null;
  }
  return out;
}

/** Compare the critic's use/pass answers with the owner's marks. Saves the run so before and after a change can be compared. */
export async function goldScore(env: Env, a: { note: string; answers: { id: string; mark: "use" | "pass" }[]; scope?: GoldScope }) {
  const w = scopeWhere(a.scope);
  const ids = a.answers.map((x) => x.id);
  if (new Set(ids).size !== ids.length) throw new InputError("Each gold item may be answered once.");
  const marks = await env.DB.prepare(`SELECT id, mark FROM gold_items ${w.sql ? `${w.sql} AND` : "WHERE"} id IN (SELECT value FROM json_each(?))`)
    .bind(...w.binds, JSON.stringify(ids)).all<{ id: string; mark: string }>();
  const truth = new Map(marks.results.map((m) => [m.id, m.mark]));
  const unknown = ids.filter((id) => !truth.has(id));
  if (unknown.length) throw new InputError(`Not gold items${a.scope === "in_scope" ? " of the in_scope set" : ""}: ${unknown.slice(0, 3).join(", ")}.`);
  // A run must cover the whole set of its scope, or the guard could pass on an easy subset. Ids are unique and all known, so equal counts mean full cover.
  const total = (await env.DB.prepare(`SELECT COUNT(*) AS n FROM gold_items ${w.sql}`).bind(...w.binds).first<{ n: number }>())?.n ?? 0;
  if (ids.length !== total) throw new InputError(`Answer every gold item of the scope: the set has ${total} and you sent ${ids.length}.`);
  if (a.note.startsWith(SCOPE_TAG)) throw new InputError(`The note may not start with ${SCOPE_TAG.trim()}: the server adds that tag for the in_scope score.`);
  const note = a.scope === "in_scope" ? `${SCOPE_TAG}${a.note}` : a.note;
  const agreed = a.answers.filter((x) => truth.get(x.id) === x.mark).length;
  const useAgreed = a.answers.filter((x) => x.mark === "use" && truth.get(x.id) === "use").length;
  const useTruth = a.answers.filter((x) => truth.get(x.id) === "use").length;
  const at = now();
  const r = await env.DB.prepare("INSERT INTO gold_runs (note, n, agreed, use_agreed, use_truth, at) VALUES (?, ?, ?, ?, ?, ?)")
    .bind(note, a.answers.length, agreed, useAgreed, useTruth, at).run();
  // The run before it, of the same scope.
  const previous = await env.DB.prepare(
    `SELECT note, n, agreed, use_agreed, use_truth, at FROM gold_runs WHERE id < ? AND (substr(note, 1, ${SCOPE_TAG.length}) = ?) = ? ORDER BY id DESC LIMIT 1`,
  ).bind(r.meta.last_row_id, SCOPE_TAG, a.scope === "in_scope" ? 1 : 0).first<RunRow>();
  const { note: _n, at: _a, ...run } = runStats({ note, n: a.answers.length, agreed, use_agreed: useAgreed, use_truth: useTruth, at });
  return { runId: r.meta.last_row_id, ...run, previous: previous ? runStats(previous) : null };
}

export async function goldRuns(env: Env) {
  const rows = await env.DB.prepare("SELECT id, note, n, agreed, use_agreed, use_truth, at FROM gold_runs ORDER BY id DESC LIMIT 20").all<RunRow & { id: number }>();
  return { runs: rows.results.map((r) => ({ runId: r.id, ...runStats(r) }) as GoldRunView) };
}
