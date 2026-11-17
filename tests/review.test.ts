import { describe, expect, it } from "vitest";
import * as batch from "../worker/batch";
import { readFileSync } from "node:fs";
import { INSTRUCTIONS, TOOLS } from "../worker/mcp";
import { PROMPTS } from "../worker/prompts";
import { adName } from "../worker/pack";
import { AD_NAME } from "../worker/results";
import { validate } from "../worker/schema";
import { E3, firstRound, idea, run, seeded } from "./helpers/engine3";

/** a11-engine v3 Phase 2: the critic's concept review and the 3 picks with roles (design pack §2.5, §2.6, tests 2.5 to 2.16). */

type Idea = { id: string; n: number };
const scores = { originality: 4, appropriateness: 5, insight: 4, headline: 4, visual: 4, productRelevance: 5, brandRecognition: 3, commercialPurpose: 4, executionPotential: 4 };
const gates = {
  falseClaim: false, stereotype: false, raceReligionInCopy: false, misrepresentsProduct: false,
  inaccurateLogo: false, headlineImageSplit: false, needsRenderDefect: false, noProductOrBrandLink: false,
};
const entry = (ideaId: string, verdict = "reject", over: Record<string, unknown> = {}) => ({
  ideaId, scores, gates, optionB: "pass", ownerGate: "pass",
  works: "The empty pouch is the proof.", doesNotWork: "The night light is generic.", original: "Nobody in the category shows an empty pack.",
  insightCredible: "Yes: two reviews say it.", worthPaying: "Yes.", verdict, ...over,
});

/** An engine 3 batch with the 10 first-round concepts (territories t1 t1 t1 t2 t2 t2 t3 t3 t4 t4). */
async function withConcepts() {
  const s = await seeded();
  const saved = await run(s.env, "ideas_save", firstRound());
  return { ...s, ideas: saved.ideas as Idea[] };
}
/** ideas 0 (t1), 3 (t2) and 6 (t3) selected; 1 and 4 reserves. */
const select = (ideas: Idea[], over: Record<string, unknown> = {}) => {
  const ids = [ideas[0]!.id, ideas[3]!.id, ideas[6]!.id];
  return {
    batchId: E3,
    outcome: "select",
    ids,
    roles: [{ ideaId: ids[0], role: "tof" }, { ideaId: ids[1], role: "tof" }, { ideaId: ids[2], role: "bof" }],
    reserves: [ideas[1]!.id, ideas[4]!.id],
    review: { concepts: ideas.map((i) => entry(i.id, ids.includes(i.id) ? "select" : "reserve")), setVariety: "Three truths: the empty pouch, the hidden pouch, the gift." },
    promptVersion: "0.2.13",
    ...over,
  };
};
const rework = (ideas: Idea[]) => ({
  batchId: E3,
  outcome: "rework",
  review: { concepts: ideas.map((i) => entry(i.id, "reject")), setReject: "Every concept is the same joke. Find a second tension in insight i2." },
});
const records = (raw: any) =>
  raw.prepare("SELECT version, author, prompt_version, body FROM batch_records WHERE batch_id = ? AND kind = 'concept_review' ORDER BY version").all(E3) as Record<string, any>[];
const pickedRows = (raw: any) => raw.prepare("SELECT id, format FROM ideas WHERE batch_id = ? AND picked = 1 ORDER BY n").all(E3) as { id: string; format: string }[];

describe("ideas_pick on an engine 3 batch", () => {
  it("(2.5) selects 3 in two stages (tof, tof, bof): picks, roles and one review record; batch_get shows it, the critic view does not", async () => {
    const { env, raw, ideas } = await withConcepts();
    const r = await run(env, "ideas_pick", select(ideas));
    expect(r).toMatchObject({ outcome: "select", picked: [ideas[0]!.id, ideas[3]!.id, ideas[6]!.id], reserves: [ideas[1]!.id, ideas[4]!.id], warnings: [], version: 1 });
    expect(pickedRows(raw)).toEqual([
      { id: ideas[0]!.id, format: "tof" },
      { id: ideas[3]!.id, format: "tof" },
      { id: ideas[6]!.id, format: "bof" },
    ]);
    const [rec] = records(raw);
    expect(rec).toMatchObject({ version: 1, author: "critic", prompt_version: "0.2.13" });
    const body = JSON.parse(rec!.body);
    expect(body.review.concepts).toHaveLength(10);
    expect(body.canonLogId).toEqual(expect.any(Number));
    const got = await run(env, "batch_get", { id: E3 });
    expect(got.conceptReview).toMatchObject({ version: 1, author: "critic", outcome: "select", reworks: 0, reserves: [ideas[1]!.id, ideas[4]!.id] });
    expect(got.nextStep).toBe("copy_review");
    expect(await run(env, "batch_get", { id: E3, view: "critic" })).not.toHaveProperty("conceptReview");
    // Two tof picks are not refused by the pick-cap trigger, and the board gate takes the 3 in any mix.
    await expect(batch.batchUpdate(env, { id: E3, status: "board" })).resolves.toMatchObject({ updated: ["status"] });
  });

  it("(2.7) refuses a wrong shape, and saves nothing", async () => {
    const { env, raw, ideas } = await withConcepts();
    const sel = select(ideas);
    const bad: [Record<string, unknown>, string][] = [
      [{ ids: sel.ids.slice(0, 2), roles: sel.roles.slice(0, 2) }, "exactly 3 different idea ids; this call has 2."],
      [{ ids: [sel.ids[0], sel.ids[0], sel.ids[1]] }, "exactly 3 different idea ids; this call has 3."],
      [{ review: undefined }, "needs the review"],
      [{ outcome: undefined }, "needs outcome"],
      [{ review: { ...sel.review, concepts: sel.review.concepts.slice(1) } }, "1 have no review"],
      [{ review: { ...sel.review, concepts: [...sel.review.concepts, sel.review.concepts[0]] } }, "Review each concept once"],
      [{ review: { ...sel.review, concepts: [...sel.review.concepts, entry("55555555-5555-4555-8555-555555555555")] } }, "not in batch"],
      [{ roles: [sel.roles[0], sel.roles[1], { ideaId: ideas[9]!.id, role: "mof" }] }, "one role (tof, mof or bof), and no other id"],
      [{ reserves: [sel.ids[0]] }, "not one of the 3 selected"],
      [{ review: { concepts: sel.review.concepts } }, "needs review.setVariety"],
      [{ ownerSwap: "use the hidden pouch one", review: undefined }, "this batch has none"],
      [{ ownerSwap: "use the hidden pouch one" }, "send no review with ownerSwap"],
    ];
    for (const [over, msg] of bad) await expect(run(env, "ideas_pick", { ...sel, ...over })).rejects.toThrow(msg);
    await expect(run(env, "ideas_pick", { ...rework(ideas), ids: [ideas[0]!.id] })).rejects.toThrow("A rework picks nothing");
    await expect(run(env, "ideas_pick", { ...rework(ideas), review: { concepts: sel.review.concepts } })).rejects.toThrow("needs review.setReject");
    // The shape check: a score out of range, a missing reason.
    const schema = TOOLS.find((t) => t.name === "ideas_pick")!.inputSchema;
    const one = (over: Record<string, unknown>) => ({ ...sel, review: { ...sel.review, concepts: [entry(ideas[0]!.id, "select", over)] } });
    expect(() => validate(schema, one({ scores: { ...scores, originality: 6 } }))).toThrow("must be at most 5");
    expect(() => validate(schema, one({ works: "" }))).toThrow("too short");
    expect(() => validate(schema, { ...sel, ownerSwap: "   " })).toThrow("ownerSwap has the wrong format");
    expect(records(raw)).toHaveLength(0);
    expect(pickedRows(raw)).toHaveLength(0);
  });

  it("(2.8) a rework picks nothing, clears earlier picks and gives nextStep concepts_rework; new concepts go back to the critic", async () => {
    const { env, raw, ideas } = await withConcepts();
    await run(env, "ideas_pick", select(ideas));
    const r = await run(env, "ideas_pick", rework(ideas));
    expect(r).toMatchObject({ outcome: "rework", picked: [], version: 2 });
    expect(pickedRows(raw)).toHaveLength(0);
    let got = await run(env, "batch_get", { id: E3 });
    expect(got.conceptReview).toMatchObject({ version: 2, outcome: "rework", reworks: 1, review: { setReject: expect.stringContaining("second tension") } });
    expect(got.nextStep).toBe("concepts_rework");
    // The board needs 3 picks: a rejected set cannot reach it.
    await expect(batch.batchUpdate(env, { id: E3, status: "board" })).rejects.toThrow("exactly 3 picked ideas before status 'board' (it has 0)");
    // No wait: the idea number, not the time, says that a concept is newer than the review.
    await run(env, "ideas_save", { batchId: E3, ideas: [idea("t2"), idea("t3")] });
    got = await run(env, "batch_get", { id: E3 });
    expect(got.nextStep).toBe("concept_review");
  });

  it("(2.9) after 3 rework rounds, nextStep is owner_decision", async () => {
    const { env, ideas } = await withConcepts();
    for (let i = 0; i < 3; i++) await run(env, "ideas_pick", rework(ideas));
    const got = await run(env, "batch_get", { id: E3 });
    expect(got.conceptReview).toMatchObject({ version: 3, reworks: 3 });
    expect(got.nextStep).toBe("owner_decision");
  });

  it("(2.10) saves a selection with a true gate, one territory or a repeated mechanism, with warnings", async () => {
    const { env, raw, ideas } = await withConcepts();
    const ids = [ideas[0]!.id, ideas[1]!.id, ideas[2]!.id]; // all t1, all product_obsession
    const r = await run(env, "ideas_pick", select(ideas, {
      ids,
      roles: ids.map((ideaId) => ({ ideaId, role: "mof" })),
      reserves: [],
      review: {
        concepts: ideas.map((i) => entry(i.id, ids.includes(i.id) ? "select" : "reject", i.id === ids[0] ? { gates: { ...gates, falseClaim: true }, optionB: "fail" } : {})),
        setVariety: "None.",
      },
    }));
    expect(r.warnings).toEqual([
      `Selected idea ${ids[0]}: gate falseClaim is true; it fails option B. A selected concept passes every gate.`,
      "All 3 selected concepts are from territory t1: select from at least 2 territories.",
      `Ideas ${ids[0]} and ${ids[1]} have the same territory and the same mechanism: they are versions of one concept.`,
      `Ideas ${ids[0]} and ${ids[2]} have the same territory and the same mechanism: they are versions of one concept.`,
      `Ideas ${ids[1]} and ${ids[2]} have the same territory and the same mechanism: they are versions of one concept.`,
    ]);
    expect(pickedRows(raw).map((p) => p.format)).toEqual(["mof", "mof", "mof"]);
  });

  it("an owner swap replaces the picks: the record author is owner and keeps his words", async () => {
    const { env, raw, ideas } = await withConcepts();
    const first = select(ideas);
    await run(env, "ideas_pick", first);
    const ids = [ideas[0]!.id, ideas[4]!.id, ideas[6]!.id];
    const words = "use the hidden pouch one instead of the gift";
    const swap = { batchId: E3, outcome: "select", ids, roles: ids.map((ideaId) => ({ ideaId, role: "bof" })), reserves: [ideas[1]!.id], ownerSwap: words };
    // Only the saved picks and reserves: idea 9 was neither.
    await expect(run(env, "ideas_pick", { ...swap, ids: [ideas[0]!.id, ideas[4]!.id, ideas[9]!.id], roles: [] })).rejects.toThrow(
      `uses only the saved picks and reserves; these are neither: ${ideas[9]!.id}.`,
    );
    await expect(run(env, "ideas_pick", swap)).resolves.toMatchObject({ version: 2, picked: ids });
    expect(pickedRows(raw).map((p) => p.id)).toEqual([ideas[0]!.id, ideas[4]!.id, ideas[6]!.id]);
    const recs = records(raw);
    expect(recs.map((r) => r.author)).toEqual(["critic", "owner"]);
    // The server keeps the critic's saved review: the owner's record does not carry a new one.
    expect(JSON.parse(recs[1]!.body)).toMatchObject({ ownerSwap: words, review: JSON.parse(recs[0]!.body).review });
    await expect(run(env, "ideas_pick", { ...rework(ideas), ownerSwap: words })).rejects.toThrow("ownerSwap is for a select only");
  });

  it("sends concepts saved after a select back to the critic, until a picked idea has a draft", async () => {
    const { env, ideas } = await withConcepts();
    await run(env, "ideas_pick", select(ideas));
    await run(env, "ideas_save", { batchId: E3, ideas: [idea("t2")] });
    expect((await run(env, "batch_get", { id: E3 })).nextStep).toBe("concept_review");
  });

  it("refuses the board status when the picks change between the check and the write", async () => {
    const { env, raw, ideas } = await withConcepts();
    await run(env, "ideas_pick", select(ideas));
    const db = env.DB as unknown as { batch: (s: unknown[]) => Promise<unknown> };
    const batchFn = db.batch.bind(db);
    db.batch = async (stmts) => (raw.prepare("UPDATE ideas SET picked = 0 WHERE id = ?").run(ideas[0]!.id), batchFn(stmts));
    await expect(batch.batchUpdate(env, { id: E3, status: "board" })).rejects.toThrow("The picks changed while the status was set");
    expect((raw.prepare("SELECT status FROM batches WHERE id = ?").get(E3) as { status: string }).status).not.toBe("board");
  });

  it("(2.16) refuses any call after a picked idea has a render, also when the render comes during the call", async () => {
    const { env, raw, ideas } = await withConcepts();
    await run(env, "ideas_pick", select(ideas));
    const render = (id: string, idea: string) =>
      raw
        .prepare(
          `INSERT INTO renders (id, batch, idea, kind, status, prompt, refs, width, height, quality, num_images, usd_est, created_at, updated_at)
           VALUES (?, ?, ?, 'draft', 'queued', 'p', '[]', 1024, 1280, 'low', 1, 0.02, 'now', 'now')`,
        )
        .run(id, E3, idea);
    render("r1", ideas[0]!.id);
    await expect(run(env, "ideas_pick", rework(ideas))).rejects.toThrow("the picks and roles are frozen");
    // A render that commits between the checks and the write: the whole call is a no-op, and it is refused.
    raw.prepare("DELETE FROM renders").run();
    const db = env.DB as unknown as { batch: (s: unknown[]) => Promise<unknown> };
    const batchFn = db.batch.bind(db);
    db.batch = async (stmts) => (render("r2", ideas[3]!.id), batchFn(stmts));
    await expect(run(env, "ideas_pick", rework(ideas))).rejects.toThrow("The batch changed while you reviewed it");
    expect(records(raw)).toHaveLength(1);
    expect(pickedRows(raw)).toHaveLength(3);
  });

  it("refuses a review that a concurrent ideas save made out of date", async () => {
    const { env, raw, ideas } = await withConcepts();
    const db = env.DB as unknown as { batch: (s: unknown[]) => Promise<unknown> };
    const batchFn = db.batch.bind(db);
    db.batch = async (stmts) => {
      raw.prepare("INSERT INTO ideas (id, batch_id, n, format, insight, visual, headline, copy, picked, created_at) VALUES ('late', ?, 99, 'tof', 'x', 'x', 'x', '{}', 0, 'now')").run(E3);
      return batchFn(stmts);
    };
    await expect(run(env, "ideas_pick", select(ideas))).rejects.toThrow("The batch changed while you reviewed it");
    expect(records(raw)).toHaveLength(0);
    expect(pickedRows(raw)).toHaveLength(0);
  });
});

describe("ideas_pick on an engine 2 batch", () => {
  it("(2.15) works as today and refuses the engine 3 fields", async () => {
    const { env, e2 } = await seeded();
    const saved = await run(env, "ideas_save", {
      batchId: e2,
      ideas: [
        { format: "tof", insight: "Bought for breakfast.", visual: "A pouch.", headline: "Gone." },
        { format: "tof", insight: "Bought for breakfast.", visual: "A pouch.", headline: "Gone again." },
      ],
    });
    const [a, b] = saved as Idea[];
    await expect(run(env, "ideas_pick", { batchId: e2, ids: [a!.id], outcome: "select" })).rejects.toThrow("for an engine 3 batch only");
    await expect(run(env, "ideas_pick", { batchId: e2, ids: [] })).rejects.toThrow("Name 1 to 3 ideas to pick.");
    await expect(run(env, "ideas_pick", { batchId: e2 })).rejects.toThrow("Name 1 to 3 ideas to pick.");
    await expect(run(env, "ideas_pick", { batchId: e2, ids: [a!.id] })).resolves.toEqual({ batchId: e2, picked: [a!.id] });
    await expect(run(env, "ideas_pick", { batchId: e2, ids: [b!.id] })).rejects.toThrow("Pick limit");
    expect((await run(env, "batch_get", { id: e2 })).conceptReview).toBeNull();
  });
});

describe("ad names with two picks of one role", () => {
  it("(2.12) gives two different names that the results pattern reads", () => {
    const one = adName(48, "pasar", 3, "tof", 2, 1);
    const two = adName(48, "pasar", 3, "tof", 5, 1);
    expect(one).not.toBe(two);
    expect([AD_NAME.exec(one)?.[5], AD_NAME.exec(two)?.[5]]).toEqual(["02", "05"]);
  });
});

describe("the words of the pick rule (design pack §2.11, risk R5)", () => {
  it("scopes one pick for each stage to engine 2, and gives engine 3 its concept review", () => {
    const tool = (n: string) => TOOLS.find((t) => t.name === n)!.description;
    const stageRule = /1 tof, 1 mof,? (and )?1 bof/g;
    for (const m of INSTRUCTIONS.matchAll(stageRule)) expect(INSTRUCTIONS.slice(m.index! - 10, m.index)).toContain("engine 2");
    expect(tool("ideas_pick")).toMatch(/^The critic's pick\. Engine 2: .*1 tof, 1 mof, 1 bof.* Engine 3 /);
    expect(INSTRUCTIONS).toContain("outcome select (3 ideas, each with a role, any mix of stages");
    const text = PROMPTS.find((p) => p.name === "batch")!.text({ brand: "pasar", batchId: E3 });
    const e3 = text.slice(text.indexOf("(engine 3) CONCEPTS"), text.indexOf("(every other batch)"));
    expect(e3).toContain("concepts_rework");
    expect(e3).toContain("owner_decision");
    expect(e3).not.toMatch(stageRule);
    const critic = readFileSync("plugin/agents/critic.md", "utf8");
    const review = critic.slice(critic.indexOf("**Review the concepts (engine 3).**"), critic.indexOf("**Rank drafts blind.**"));
    expect(review).toContain("Two concepts can have one role.");
    expect(review).not.toMatch(stageRule);
  });
});
