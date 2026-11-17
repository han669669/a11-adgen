import { describe, expect, it } from "vitest";
import { TOOLS } from "../worker/mcp";
import { validate } from "../worker/schema";
import { E3, run, select, withConcepts, type Idea } from "./helpers/engine3";

/** a11-engine v3 Phase 3: the art direction of a picked concept (design pack §3.3, §3.4, §3.7, tests 3.1 to 3.5). */

const PLAN = { size: [1024, 1280], bg: "#EEE8DF", shapes: [{ rect: [0, 0.7, 1, 1], fill: "#F6F5F2" }], products: [{ cx: 0.5, base: 0.82, height: 0.42, side: "up", rot: -0.6 }] };
const axes = (tag: string) => ({
  composition: `${tag} composition`, productPosition: `${tag} position`, scale: `${tag} scale`, camera: `${tag} camera`,
  light: `${tag} light`, environment: "a plain lit counter", negativeSpace: `${tag} space`, staging: `${tag} staging`,
});
const draft = (n: number, over: Record<string, unknown> = {}) => ({
  n,
  question: `Question ${n}: is the idea clearer when the pouch is ${["empty", "tipped", "closed"][n - 1]}?`,
  axes: axes(`d${n}`),
  plan: JSON.stringify({ ...PLAN, products: [{ ...PLAN.products[0], cx: 0.3 + n * 0.1 }] }),
  prompt: `A photograph of an empty pouch on a counter at night, draft ${n}.`,
  ...over,
});
const direction = (over: Record<string, unknown> = {}, shared: Record<string, unknown> = {}) => ({
  why: "The empty pouch is the proof that it does not last. A calm counter at night makes the empty pack the only story.",
  mechanism: { type: "product_obsession", productionRisk: "low" },
  shared: {
    backdrop: "A warm grey wall.", light: "One soft lamp from the left.", colour: "Kit cream, a muted red accent.", supportingObjects: [],
    hierarchy: "The empty pouch, then the headline, then the logo. Back products recede.",
    type: { headlineFont: "Museo Sans Rounded", weight: "800", case: "sentence", reason: "A brand font that is not the logo's font." },
    logo: { placement: "top centre", note: "Optically centred. Ignore the TM mark." },
    recipe: "concept",
    ...shared,
  },
  drafts: [draft(1), draft(2), draft(3)],
  diversity: { pairs: { "1-2": ["composition", "scale", "camera"], "1-3": ["camera", "light", "staging"], "2-3": ["scale", "negativeSpace", "productPosition"] } },
  elementCount: 3,
  ...over,
});

/** An engine 3 batch with 3 picks (ideas 0, 3 and 6) whose words the owner approved. */
async function approved() {
  const s = await withConcepts();
  await run(s.env, "ideas_pick", select(s.ideas));
  s.raw.prepare(`UPDATE ideas SET copy = json_set(copy, '$.ownerApproved', json('{"headline":"h","subline":"s"}')) WHERE batch_id = ? AND picked = 1`).run(E3);
  return s;
}
const save = (env: any, ideaId: string, d: unknown = direction()) => run(env, "direction_save", { batchId: E3, ideaId, direction: d, promptVersion: "0.2.15" });
const records = (raw: any) =>
  raw.prepare("SELECT idea_id, version, author, prompt_version FROM batch_records WHERE batch_id = ? AND kind = 'direction' ORDER BY rowid").all(E3) as Record<string, unknown>[];
const ideaOf = (b: any, i: Idea) => b.ideas.find((x: { id: string }) => x.id === i.id);

describe("direction_save", () => {
  it("(3.1) saves version 1 for a picked idea with approved words, then version 2; batch_get shows the newest, nextStep moves on", async () => {
    const { env, raw, ideas } = await approved();
    expect((await run(env, "batch_get", { id: E3 })).nextStep).toBe("direction");
    expect(await save(env, ideas[0]!.id)).toEqual({ batchId: E3, ideaId: ideas[0]!.id, version: 1, warnings: [] });
    expect(await save(env, ideas[0]!.id, direction({ elementCount: 4 }))).toMatchObject({ version: 2, warnings: [] });
    expect(records(raw)).toEqual([
      { idea_id: ideas[0]!.id, version: 1, author: "art-director", prompt_version: "0.2.15" },
      { idea_id: ideas[0]!.id, version: 2, author: "art-director", prompt_version: "0.2.15" },
    ]);
    let b = await run(env, "batch_get", { id: E3 });
    expect(ideaOf(b, ideas[0]!).direction).toMatchObject({ version: 2, current: true, elementCount: 4, promptVersion: "0.2.15" });
    expect(ideaOf(b, ideas[1]!).direction).toBeNull();
    expect(b.nextStep).toBe("direction");
    await save(env, ideas[3]!.id);
    await save(env, ideas[6]!.id);
    b = await run(env, "batch_get", { id: E3 });
    expect(b.nextStep).toBe("drafts");
  });

  it("(3.2) refuses an idea that is not picked, one without approved words, an idea of another batch, and an engine 2 batch", async () => {
    const { env, raw, ideas, e2 } = await approved();
    await expect(save(env, ideas[1]!.id)).rejects.toThrow("is not picked");
    raw.prepare(`UPDATE ideas SET copy = json_remove(copy, '$.ownerApproved') WHERE id = ?`).run(ideas[3]!.id);
    await expect(save(env, ideas[3]!.id)).rejects.toThrow("has not approved the words");
    await expect(save(env, "00000000-0000-4000-8000-000000000000")).rejects.toThrow("is not an idea of batch");
    await expect(run(env, "direction_save", { batchId: e2, ideaId: ideas[0]!.id, direction: direction() })).rejects.toThrow("engine 3 batch only");
    expect(records(raw)).toEqual([]);
  });

  it("(3.3) refuses 2 drafts, a draft without a question or a plan, a repeated n, and a plan that is not a layout plan", async () => {
    const { env, raw, ideas } = await approved();
    const schema = TOOLS.find((t) => t.name === "direction_save")!.inputSchema;
    const args = (d: unknown) => ({ batchId: E3, ideaId: ideas[0]!.id, direction: d });
    expect(() => validate(schema, args(direction({ drafts: [draft(1), draft(2)] })))).toThrow("needs at least 3 items");
    const { question: _q, ...noQuestion } = draft(2);
    expect(() => validate(schema, args(direction({ drafts: [draft(1), noQuestion, draft(3)] })))).toThrow("question is required");
    const { plan: _p, ...noPlan } = draft(3);
    expect(() => validate(schema, args(direction({ drafts: [draft(1), draft(2), noPlan] })))).toThrow("plan is required");
    expect(() => validate(schema, args(direction({ drafts: [draft(1), draft(2), draft(3, { question: "   " })] })))).toThrow("wrong format");
    await expect(save(env, ideas[0]!.id, direction({ drafts: [draft(1), draft(2), draft(2)] }))).rejects.toThrow("n 1, 2 and 3, once each");
    await expect(save(env, ideas[0]!.id, direction({ drafts: [draft(1), draft(2), draft(3, { plan: "products: []" })] }))).rejects.toThrow("plan is not JSON");
    await expect(save(env, ideas[0]!.id, direction({ drafts: [draft(1), draft(2), draft(3, { plan: '{"products": []}' })] }))).rejects.toThrow('non-empty "products" list');
    expect(records(raw)).toEqual([]);
  });

  it("(3.4) saves a weak set with warnings: a pair with 1 axis, no composition, camera or scale, 7 elements, a high risk with no reason", async () => {
    const { env, ideas } = await approved();
    const r = await save(env, ideas[0]!.id, direction({
      diversity: { pairs: { "1-2": ["light"], "1-3": ["light", "environment", "staging"], "2-3": ["scale", "camera", "composition", "camera"] } },
      elementCount: 7,
      mechanism: { type: "human_behaviour", productionRisk: "high", riskReason: " " },
    }));
    expect(r.version).toBe(1);
    expect(r.warnings).toEqual([
      "Drafts 1-2 differ on 1 axis(es): each pair needs 3 or more. Change one draft, or say why in the report.",
      "Drafts 1-2 do not differ in composition, camera or scale: one of them is needed.",
      "Drafts 1-3 do not differ in composition, camera or scale: one of them is needed.",
      "The scene has 7 elements: the calm rule is 5 or fewer.",
      "The staging is high risk with no riskReason: say why the concept needs it, or choose a lower risk staging.",
    ]);
  });

  it("(3.4b) refuses the house recipe without the owner's words, and saves it with them", async () => {
    const { env, ideas } = await approved();
    await expect(save(env, ideas[0]!.id, direction({}, { recipe: "house" }))).rejects.toThrow("give his exact words in shared.recipeApproval");
    await expect(save(env, ideas[0]!.id, direction({}, { recipeApproval: "ok" }))).rejects.toThrow("for recipe 'house' only");
    const r = await save(env, ideas[0]!.id, direction({}, { recipe: "house", recipeApproval: "Use the house look for this one." }));
    expect(r.version).toBe(1);
    const b = await run(env, "batch_get", { id: E3 });
    expect(ideaOf(b, ideas[0]!).direction.shared).toMatchObject({ recipe: "house", recipeApproval: "Use the house look for this one." });
  });

  it("(3.5) batch_get leaves the plans out, withPlans gives them back as saved; the critic view has no direction", async () => {
    const { env, ideas } = await approved();
    await save(env, ideas[0]!.id);
    const plain = ideaOf(await run(env, "batch_get", { id: E3 }), ideas[0]!).direction;
    expect(plain.drafts.map((d: Record<string, unknown>) => Object.keys(d).sort())).toEqual(Array(3).fill(["axes", "n", "prompt", "question"]));
    const full = ideaOf(await run(env, "batch_get", { id: E3, withPlans: true }), ideas[0]!).direction;
    // The plan round trip (test 3.10, server part): equal after parse to the plan file the session gave.
    expect(full.drafts.map((d: { plan: string }) => JSON.parse(d.plan))).toEqual([1, 2, 3].map((n) => JSON.parse(draft(n).plan)));
    // A direction read back with withPlans is saved again as it is (version 2), for example with a renderId added.
    expect(await save(env, ideas[0]!.id, full)).toMatchObject({ version: 2, warnings: [] });
    const critic = await run(env, "batch_get", { id: E3, view: "critic" });
    expect(critic.ideas.every((i: Record<string, unknown>) => !("direction" in i))).toBe(true);
    expect(JSON.stringify(critic)).not.toContain("is the idea clearer");
  });

  it("checks each renderId: a draft of this idea is saved, a render of another idea or a final is refused", async () => {
    const { env, raw, ideas } = await approved();
    const add = raw.prepare(
      `INSERT INTO renders (id, batch, idea, kind, status, prompt, refs, width, height, quality, num_images, usd_est, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'queued', 'p', '[]', 1024, 1280, 'low', 1, 0.02, 'now', 'now')`,
    );
    add.run("11111111-1111-4111-8111-111111111111", E3, ideas[0]!.id, "draft");
    add.run("22222222-2222-4222-8222-222222222222", E3, ideas[3]!.id, "draft");
    add.run("33333333-3333-4333-8333-333333333333", E3, ideas[0]!.id, "final");
    const withRender = (id: string, second = id) => direction({ drafts: [draft(1, { renderId: id }), draft(2, { renderId: second }), draft(3)] });
    await expect(save(env, ideas[0]!.id, withRender("11111111-1111-4111-8111-111111111111"))).rejects.toThrow("Two drafts name the same renderId");
    await expect(save(env, ideas[0]!.id, withRender("11111111-1111-4111-8111-111111111111", "22222222-2222-4222-8222-222222222222"))).rejects.toThrow("Not a draft render of idea");
    await expect(save(env, ideas[0]!.id, withRender("11111111-1111-4111-8111-111111111111", "33333333-3333-4333-8333-333333333333"))).rejects.toThrow("Not a draft render of idea");
    const ok = await save(env, ideas[0]!.id, direction({ drafts: [draft(1, { renderId: "11111111-1111-4111-8111-111111111111" }), draft(2), draft(3)] }));
    expect(ok.version).toBe(1);
  });

  it("a new concept review after the direction makes it stale: current false and nextStep direction again", async () => {
    const { env, raw, ideas } = await approved();
    for (const i of [0, 3, 6]) await save(env, ideas[i]!.id);
    expect((await run(env, "batch_get", { id: E3 })).nextStep).toBe("drafts");
    // The owner names reserve 1 in place of pick 6: a new review record, and new words to approve for the new pick.
    await run(env, "ideas_pick", {
      batchId: E3, outcome: "select", ids: [ideas[0]!.id, ideas[3]!.id, ideas[1]!.id],
      roles: [{ ideaId: ideas[0]!.id, role: "tof" }, { ideaId: ideas[3]!.id, role: "tof" }, { ideaId: ideas[1]!.id, role: "bof" }],
      reserves: [ideas[6]!.id, ideas[4]!.id], ownerSwap: "Use the second one instead of the gift.",
    });
    raw.prepare(`UPDATE ideas SET copy = json_set(copy, '$.ownerApproved', json('{"headline":"h","subline":"s"}')) WHERE id = ?`).run(ideas[1]!.id);
    const b = await run(env, "batch_get", { id: E3 });
    expect(ideaOf(b, ideas[0]!).direction.current).toBe(false);
    expect(b.nextStep).toBe("direction");
  });

  it("refuses the save when the idea is unpicked between the checks and the insert", async () => {
    const { env, raw, ideas } = await approved();
    const db = env.DB as any;
    const prepare = db.prepare.bind(db);
    // Unpick the idea just before the insert runs, as a rework that commits in between would.
    db.prepare = (sql: string) => {
      if (sql.includes("INSERT INTO batch_records") && sql.includes("'direction'")) raw.prepare("UPDATE ideas SET picked = 0 WHERE id = ?").run(ideas[0]!.id);
      return prepare(sql);
    };
    await expect(save(env, ideas[0]!.id)).rejects.toThrow("Nothing was saved");
    expect(records(raw)).toEqual([]);
  });
});
