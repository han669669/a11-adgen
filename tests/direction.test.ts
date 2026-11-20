import { describe, expect, it } from "vitest";
import { TOOLS } from "../worker/mcp";
import { validate } from "../worker/schema";
import { approved, direction, draft, E3, PLAN, run, select, type Idea } from "./helpers/engine3";

/** a11-engine v3 Phase 3: the art direction of a picked concept (design pack §3.3, §3.4, §3.7, tests 3.1 to 3.5). */

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

  it("(3.3) refuses 2 drafts, a draft without a question or with neither a plan nor a rough, a repeated n, and a plan that is not a layout plan", async () => {
    const { env, raw, ideas } = await approved();
    const schema = TOOLS.find((t) => t.name === "direction_save")!.inputSchema;
    const args = (d: unknown) => ({ batchId: E3, ideaId: ideas[0]!.id, direction: d });
    expect(() => validate(schema, args(direction({ drafts: [draft(1), draft(2)] })))).toThrow("needs at least 3 items");
    const { question: _q, ...noQuestion } = draft(2);
    expect(() => validate(schema, args(direction({ drafts: [draft(1), noQuestion, draft(3)] })))).toThrow("question is required");
    const { plan: _p, ...noPlan } = draft(3);
    await expect(save(env, ideas[0]!.id, direction({ drafts: [draft(1), draft(2), noPlan] }))).rejects.toThrow("give a layout plan, fromRough");
    expect(() => validate(schema, args(direction({ drafts: [draft(1), draft(2), draft(3, { question: "   " })] })))).toThrow("wrong format");
    await expect(save(env, ideas[0]!.id, direction({ drafts: [draft(1), draft(2), draft(2)] }))).rejects.toThrow("n 1, 2 and 3, once each");
    await expect(save(env, ideas[0]!.id, direction({ drafts: [draft(1), draft(2), draft(3, { plan: "products: []" })] }))).rejects.toThrow("plan is not JSON");
    await expect(save(env, ideas[0]!.id, direction({ drafts: [draft(1), draft(2), draft(3, { plan: '{"products": []}' })] }))).rejects.toThrow('non-empty "products" list');
    // The other checks of load_plan in scripts/product_lock.py, so reprint can read the plan later.
    const badPlan = (over: Record<string, unknown>) => direction({ drafts: [draft(1), draft(2), draft(3, { plan: JSON.stringify({ ...PLAN, ...over }) })] });
    const product = PLAN.products[0]!;
    await expect(save(env, ideas[0]!.id, badPlan({ size: [1024.5, 1280] }))).rejects.toThrow('"size" must be [W, H]');
    await expect(save(env, ideas[0]!.id, badPlan({ products: [{ ...product, side: "flat" }] }))).rejects.toThrow("side must be one of up, L, R");
    await expect(save(env, ideas[0]!.id, badPlan({ products: [{ ...product, height: 0 }] }))).rejects.toThrow("height must be above 0");
    await expect(save(env, ideas[0]!.id, badPlan({ products: [{ cx: 0.5, base: 0.8 }] }))).rejects.toThrow("must be numbers");
    await expect(save(env, ideas[0]!.id, badPlan({ shapes: [{ rect: [0.5, 0, 0.2, 1] }] }))).rejects.toThrow("shape 1: rect");
    await expect(save(env, ideas[0]!.id, badPlan({ bg: "beige" }))).rejects.toThrow('"bg" must be a colour');
    // side and rot may be left out, as load_plan gives them defaults; a colour may be three numbers.
    const { side: _s, rot: _r, ...bare } = product;
    expect(await save(env, ideas[0]!.id, badPlan({ products: [bare], bg: "233, 228, 220" }))).toMatchObject({ version: 1 });
    await expect(save(env, ideas[0]!.id, badPlan({ products: [bare], bg: "233, 228, 220" }))).resolves.toMatchObject({ version: 2 });
    expect(records(raw).length).toBe(2);
  });

  it("refuses a direction when the words changed after the owner approved them", async () => {
    const { env, raw, ideas } = await approved();
    expect(await save(env, ideas[0]!.id)).toMatchObject({ version: 1 });
    raw.prepare("UPDATE ideas SET headline = 'A new headline.' WHERE id = ?").run(ideas[0]!.id);
    await expect(save(env, ideas[0]!.id)).rejects.toThrow("changed after the owner approved them");
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

  it("a draft may edit the idea's finished rough in place of a plan; another idea's rough, a draft or an unfinished rough is refused", async () => {
    const { env, raw, ideas } = await approved();
    const add = raw.prepare(
      `INSERT INTO renders (id, batch, idea, kind, status, prompt, refs, width, height, quality, num_images, usd_est, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'p', '[]', 1024, 1280, 'low', 1, 0.02, 'now', 'now')`,
    );
    const R = "44444444-4444-4444-8444-444444444444";
    add.run(R, E3, ideas[0]!.id, "rough", "done");
    add.run("55555555-5555-4555-8555-555555555555", E3, ideas[3]!.id, "rough", "done");
    add.run("66666666-6666-4666-8666-666666666666", E3, ideas[0]!.id, "rough", "queued");
    add.run("77777777-7777-4777-8777-777777777777", E3, ideas[0]!.id, "draft", "done");
    const fromRough = (id: string) => {
      const { plan: _p, ...d } = draft(1);
      return { ...d, fromRough: id };
    };
    for (const id of ["55555555-5555-4555-8555-555555555555", "66666666-6666-4666-8666-666666666666", "77777777-7777-4777-8777-777777777777"])
      await expect(save(env, ideas[0]!.id, direction({ drafts: [fromRough(id), draft(2), draft(3)] }))).rejects.toThrow("Not a finished rough of idea");
    // One draft from the rough and two from plans: the rubric still applies to the set.
    expect(await save(env, ideas[0]!.id, direction({ drafts: [fromRough(R), draft(2), draft(3)] }))).toMatchObject({ version: 1, warnings: [] });
    // All 3 from the rough, with a pair that differs on 1 axis: no diversity warning (they stay close to the rough on purpose).
    const all = [1, 2, 3].map((n) => ({ ...fromRough(R), n }));
    const close = direction({ drafts: all, diversity: { pairs: { "1-2": ["light"], "1-3": ["light"], "2-3": ["light"] } } });
    expect(await save(env, ideas[0]!.id, close)).toMatchObject({ version: 2, warnings: [] });
    // batch_get withPlans gives no plan for a draft that has none.
    const b = await run(env, "batch_get", { id: E3, withPlans: true });
    const d = ideaOf(b, ideas[0]!).direction.drafts;
    expect(d.map((x: { fromRough?: string; plan?: string }) => [x.fromRough, x.plan])).toEqual([[R, undefined], [R, undefined], [R, undefined]]);
  });

  it("a draft may take the brand's product photo as a reference only (productRef), for a glossy product (Allies engine 3 test, 20-11-2026)", async () => {
    const { env, ideas } = await approved();
    const schema = TOOLS.find((t) => t.name === "direction_save")!.inputSchema;
    const REF = "https://a11adgen.gamingcomputing.workers.dev/m/brands/e22dfef5-bc42-4ed8-ab75-8e5643e3e2ab/ref2.jpg";
    const fromRef = (n: number, ref = REF) => {
      const { plan: _p, ...d } = draft(n);
      return { ...d, productRef: ref };
    };
    expect(() => validate(schema, { batchId: E3, ideaId: ideas[0]!.id, direction: direction({ drafts: [fromRef(1, "http://example.com/a.jpg"), draft(2), draft(3)] }) })).toThrow("wrong format");
    const all = direction({ drafts: [fromRef(1), fromRef(2), fromRef(3)] });
    expect(() => validate(schema, { batchId: E3, ideaId: ideas[0]!.id, direction: all })).not.toThrow();
    expect(await save(env, ideas[0]!.id, all)).toMatchObject({ version: 1 });
    const b = await run(env, "batch_get", { id: E3, withPlans: true });
    const d = ideaOf(b, ideas[0]!).direction.drafts;
    expect(d.map((x: { productRef?: string; plan?: string }) => [x.productRef, x.plan])).toEqual([[REF, undefined], [REF, undefined], [REF, undefined]]);
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
    raw.prepare(`UPDATE ideas SET copy = json_set(copy, '$.ownerApproved', json_object('headline', headline, 'subline', json_extract(copy, '$.subline'))) WHERE id = ?`).run(ideas[1]!.id);
    const b = await run(env, "batch_get", { id: E3 });
    expect(ideaOf(b, ideas[0]!).direction.current).toBe(false);
    // The unpicked concept (6) keeps its record, but batch_get shows no direction on it.
    expect(ideaOf(b, ideas[6]!).direction).toBeNull();
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
