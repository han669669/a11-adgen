import { describe, expect, it } from "vitest";
import * as batch from "../worker/batch";
import { TOOLS } from "../worker/mcp";
import { validate } from "../worker/schema";
import { addRender, approved, boardReady, direction, draftCheck, E3, rankAll, renderId, run } from "./helpers/engine3";

/** a11-engine v3 Phase 3: draft and final checks, eligible drafts, the rank and the board gate (design pack §3.6, tests 3.6 to 3.9). */

const saveCheck = (env: any, ideaId: string, check: unknown, kind = "draft_check") => run(env, "checks_save", { batchId: E3, ideaId, kind, check, promptVersion: "0.2.16" });
const ideaOf = (b: any, id: string) => b.ideas.find((x: { id: string }) => x.id === id);
const finalCheck = (rid: string, over: Record<string, unknown> = {}) => ({
  renderId: rid,
  finalPoints: {
    conceptQuality: "pass", productTruth: "pass", brandIdentity: "pass", copyAccuracy: "pass",
    foodAuthenticity: "na", composition: "pass", visualCraft: "pass", renderChecklist: "pass",
  },
  items: [{ code: "D1", found: false }, { code: "F6", found: false }],
  checkedAt: ["full", "phone"],
  logoCentred: true,
  copyMatchesApproved: true,
  reason: "The pouch is exact, the words match, the logo sits centred.",
  ...over,
});

describe("checks_save", () => {
  it("(3.6) saves a draft check that is not eligible, then the redo's check; batch_get shows the newest check of each render", async () => {
    const { env, raw, ideas } = await approved();
    const idea = ideas[0]!.id;
    addRender(raw, renderId(1, 1), idea);
    const failed = draftCheck(renderId(1, 1), {
      eligible: false,
      items: [{ code: "D3", found: true, note: "A drip on the cup." }],
      points: { ...draftCheck("x").points, defects: "fail" },
      reason: "A drip on the cup (D3).",
    });
    expect(await saveCheck(env, idea, failed)).toMatchObject({ kind: "draft_check", version: 1, eligible: false });
    addRender(raw, renderId(1, 2), idea, "draft", "2026-11-17T07:05:00.000Z");
    expect(await saveCheck(env, idea, draftCheck(renderId(1, 2), { attempt: 2 }))).toMatchObject({ version: 2, eligible: true });
    // A second look at the first render: the newest check of that render counts.
    await saveCheck(env, idea, { ...failed, reason: "A drip on the cup (D3), seen again at full size." });
    const b = await run(env, "batch_get", { id: E3 });
    const drafts = ideaOf(b, idea).drafts;
    expect(drafts.map((d: any) => [d.eligible, d.check.attempt, d.check.version, d.current])).toEqual([[false, 1, 3, true], [true, 2, 2, true]]);
    expect(drafts[0].check.reason).toBe("A drip on the cup (D3), seen again at full size.");
    // The other two picks have no direction yet (the drafts-done rule is tested with the board gate below).
    expect(b.nextStep).toBe("direction");
  });

  it("refuses a draft marked eligible with a D item found or a failed point, and the wrong fields for the kind", async () => {
    const { env, raw, ideas } = await approved();
    const idea = ideas[0]!.id;
    addRender(raw, renderId(1, 1), idea);
    await expect(saveCheck(env, idea, draftCheck(renderId(1, 1), { items: [{ code: "D7", found: true }] }))).rejects.toThrow("A draft with D7 is not eligible");
    await expect(saveCheck(env, idea, draftCheck(renderId(1, 1), { points: { ...draftCheck("x").points, scale: "fail" } }))).rejects.toThrow("scale fail is not eligible");
    // An F fault found is the art director's judgement: two of them reject an ad, one does not.
    expect(await saveCheck(env, idea, draftCheck(renderId(1, 1), { items: [{ code: "F2", found: true, note: "A spare spoon." }] }))).toMatchObject({ eligible: true });
    await expect(saveCheck(env, idea, draftCheck(renderId(1, 1), { logoCentred: true }))).rejects.toThrow("draft_check does not take logoCentred");
    const { attempt: _a, ...noAttempt } = draftCheck(renderId(1, 1));
    await expect(saveCheck(env, idea, noAttempt)).rejects.toThrow("draft_check needs attempt");
    await expect(saveCheck(env, idea, draftCheck(renderId(1, 1), { items: [{ code: "D3", found: false }, { code: "D3", found: false }] }))).rejects.toThrow("names a code twice");
    const schema = TOOLS.find((t) => t.name === "checks_save")!.inputSchema;
    expect(() => validate(schema, { batchId: E3, ideaId: idea, kind: "draft_check", check: draftCheck(renderId(1, 1), { items: [{ code: "D11", found: false }] }) })).toThrow("wrong format");
    expect(() => validate(schema, { batchId: E3, ideaId: idea, kind: "draft_check", check: draftCheck(renderId(1, 1), { items: [{ code: "D0", found: false }] }) })).toThrow("wrong format");
  });

  it("takes D10, pasted product light, and a draft with it found is not eligible (Allies engine 3 test, 20-11-2026)", async () => {
    const { env, raw, ideas } = await approved();
    const idea = ideas[0]!.id;
    addRender(raw, renderId(1, 1), idea);
    const schema = TOOLS.find((t) => t.name === "checks_save")!.inputSchema;
    const pasted = { code: "D10", found: true, note: "The bottle keeps the packshot's studio highlight band; the scene light comes from the left." };
    expect(() => validate(schema, { batchId: E3, ideaId: idea, kind: "draft_check", check: draftCheck(renderId(1, 1), { items: [pasted] }) })).not.toThrow();
    await expect(saveCheck(env, idea, draftCheck(renderId(1, 1), { items: [pasted] }))).rejects.toThrow("A draft with D10 is not eligible");
    expect(await saveCheck(env, idea, draftCheck(renderId(1, 1), { eligible: false, items: [pasted], reason: "Pasted product light (D10)." }))).toMatchObject({ eligible: false });
    // All 10 D items and 8 F items fit in one check.
    const all = [...Array.from({ length: 10 }, (_, i) => `D${i + 1}`), ...Array.from({ length: 8 }, (_, i) => `F${i + 1}`)].map((code) => ({ code, found: false }));
    expect(await saveCheck(env, idea, draftCheck(renderId(1, 1), { items: all }))).toMatchObject({ eligible: true });
  });

  it("(3.7) refuses a render of another idea, a final for a draft check, a render with no image yet, and an idea that is not picked", async () => {
    const { env, raw, ideas } = await approved();
    addRender(raw, renderId(2, 1), ideas[3]!.id);
    await expect(saveCheck(env, ideas[0]!.id, draftCheck(renderId(2, 1)))).rejects.toThrow("is not a draft render of idea");
    addRender(raw, renderId(1, 9), ideas[0]!.id, "final");
    await expect(saveCheck(env, ideas[0]!.id, draftCheck(renderId(1, 9)))).rejects.toThrow("is not a draft render of idea");
    raw.prepare("UPDATE renders SET image_keys = NULL, status = 'queued' WHERE id = ?").run(renderId(2, 1));
    await expect(saveCheck(env, ideas[3]!.id, draftCheck(renderId(2, 1)))).rejects.toThrow("has no image yet");
    await expect(saveCheck(env, ideas[1]!.id, draftCheck(renderId(2, 1)))).rejects.toThrow("is not picked");
    const e2 = (raw.prepare("SELECT id FROM batches WHERE engine = 2").get() as { id: string }).id;
    await expect(run(env, "checks_save", { batchId: e2, ideaId: ideas[0]!.id, kind: "draft_check", check: draftCheck(renderId(1, 1)) })).rejects.toThrow("engine 3 batch only");
  });

  it("(3.8) the board gate: refused with 2 eligible drafts and no failed redo; passes after the failed redo, and with 3 eligible", async () => {
    const { env, raw, picks } = await boardReady({ rank: false });
    const idea = picks[0]!.id;
    // The third draft of pick 1 is not eligible, first try.
    const fault = { eligible: false, items: [{ code: "D4", found: true, note: "The pouch floats." }], points: { ...draftCheck("x").points, physics: "fail" }, reason: "The pouch floats (D4)." };
    await saveCheck(env, idea, draftCheck(renderId(1, 3), fault));
    expect((await run(env, "batch_get", { id: E3 })).nextStep).toBe("drafts");
    await expect(batch.batchUpdate(env, { id: E3, status: "board" })).rejects.toThrow("nextStep is 'drafts'");
    // The redo fails too: the owner sees 2 eligible drafts with the reason, and the gate passes.
    addRender(raw, renderId(1, 4), idea, "draft", "2026-11-17T07:10:00.000Z");
    await saveCheck(env, idea, draftCheck(renderId(1, 4), { ...fault, attempt: 2 }));
    expect((await run(env, "batch_get", { id: E3 })).nextStep).toBe("draft_rank");
    // The critic ranks the eligible drafts before the board.
    await expect(batch.batchUpdate(env, { id: E3, status: "board" })).rejects.toThrow("nextStep is 'draft_rank'");
    expect(await rankAll(env)).toEqual({ ranked: 8 });
    await expect(batch.batchUpdate(env, { id: E3, status: "board" })).resolves.toMatchObject({ updated: ["status"] });
  });

  it("(3.8) passes the board gate with 3 eligible drafts for each of 3 picks in two roles (tof, tof, bof); refuses an unchecked draft", async () => {
    const { env, raw, picks } = await boardReady();
    expect(raw.prepare("SELECT format FROM ideas WHERE batch_id = ? AND picked = 1 ORDER BY n").all(E3)).toEqual([{ format: "tof" }, { format: "tof" }, { format: "bof" }]);
    addRender(raw, renderId(3, 4), picks[2]!.id, "draft", "2026-11-17T07:10:00.000Z");
    await expect(batch.batchUpdate(env, { id: E3, status: "board" })).rejects.toThrow("nextStep is 'drafts'");
    await saveCheck(env, picks[2]!.id, draftCheck(renderId(3, 4)));
    expect((await run(env, "batch_get", { id: E3 })).nextStep).toBe("draft_rank");
    await rankAll(env);
    await expect(batch.batchUpdate(env, { id: E3, status: "board" })).resolves.toMatchObject({ updated: ["status"] });
  });

  it("(3.9) drafts_rank refuses a draft that is not eligible; the critic view shows the eligible current drafts only, without checks", async () => {
    const { env, picks } = await boardReady({ rank: false });
    const idea = picks[0]!.id;
    await saveCheck(env, idea, draftCheck(renderId(1, 2), { eligible: false, reason: "The light is flat: the judgement of the art director." }));
    const critic = await run(env, "batch_get", { id: E3, view: "critic" });
    const keys = critic.ideas.find((i: { id: string }) => i.id === idea).drafts.map((d: { key: string }) => d.key);
    expect(keys).toEqual([`renders/${renderId(1, 1)}/0.jpg`, `renders/${renderId(1, 3)}/0.jpg`]);
    expect(JSON.stringify(critic)).not.toMatch(/"check"|"eligible"|The light is flat/);
    await expect(run(env, "drafts_rank", { batchId: E3, ranks: [{ key: `renders/${renderId(1, 2)}/0.jpg`, rank: 1, reason: "The pouch reads first." }] })).rejects.toThrow("is not an eligible current draft");
    expect(await run(env, "drafts_rank", { batchId: E3, ranks: keys.map((key: string, n: number) => ({ key, rank: n + 1, reason: "The pouch reads first." })) })).toEqual({ ranked: 2 });
    // ranked counts the eligible drafts only.
    expect(ideaOf(await run(env, "batch_get", { id: E3 }), idea).ranked).toBe(true);
  });

  it("final_check: ready only with no failed point, the approved words and a centred logo; nextStep finals until each final is ready", async () => {
    const { env, raw, picks } = await boardReady();
    raw.prepare("UPDATE batches SET status = 'finals' WHERE id = ?").run(E3);
    for (const [p, idea] of picks.entries()) {
      raw.prepare("INSERT INTO picks (render_key, batch_id, idea_id, note, by_owner, created_at) VALUES (?, ?, ?, 'his words', 1, 'now')").run(`renders/${renderId(p + 1, 1)}/0.jpg`, E3, idea.id);
      addRender(raw, renderId(p + 1, 9), idea.id, "final");
      await run(env, "drafts_rank", { batchId: E3, ranks: [1, 2, 3].map((n) => ({ key: `renders/${renderId(p + 1, n)}/0.jpg`, rank: n, reason: "The pouch reads first." })) });
    }
    expect((await run(env, "batch_get", { id: E3 })).nextStep).toBe("finals");
    await expect(saveCheck(env, picks[0]!.id, finalCheck(renderId(1, 9), { finalPoints: { ...finalCheck("x").finalPoints, visualCraft: "fail" } }), "final_check")).rejects.toThrow("Give a note for each failed point: visualCraft");
    await expect(saveCheck(env, picks[0]!.id, finalCheck(renderId(1, 9), { checkedAt: ["full", "full"] }), "final_check")).rejects.toThrow("checkedAt full and phone");
    await expect(saveCheck(env, picks[0]!.id, finalCheck(renderId(1, 9), { eligible: true }), "final_check")).rejects.toThrow("final_check does not take eligible");
    await expect(saveCheck(env, picks[0]!.id, finalCheck(renderId(1, 1)), "final_check")).rejects.toThrow("is not a final render of idea");
    expect(await saveCheck(env, picks[0]!.id, finalCheck(renderId(1, 9), { copyMatchesApproved: false }), "final_check")).toMatchObject({ ready: false });
    for (const [p, idea] of picks.entries()) await saveCheck(env, idea.id, finalCheck(renderId(p + 1, 9), p === 0 ? { logoCentred: false } : {}), "final_check");
    let b = await run(env, "batch_get", { id: E3 });
    expect(ideaOf(b, picks[0]!.id).finals[0]).toMatchObject({ ready: false, check: { logoCentred: false, version: 2 } });
    expect(b.nextStep).toBe("finals");
    expect(await saveCheck(env, picks[0]!.id, finalCheck(renderId(1, 9)), "final_check")).toMatchObject({ version: 3, ready: true });
    b = await run(env, "batch_get", { id: E3 });
    expect(b.nextStep).toBe("done");
  });

  it("the render-checklist rule: two F items make a draft not eligible and a final not ready; a final needs every point to pass (food may be na)", async () => {
    const { env, raw, picks } = await boardReady();
    const idea = picks[0]!.id;
    const twoF = { items: [{ code: "F2", found: true, note: "Flat light." }, { code: "F8", found: true, note: "Same camera." }] };
    await expect(saveCheck(env, idea, draftCheck(renderId(1, 1), twoF))).rejects.toThrow("F2, F8 is not eligible");
    expect(await saveCheck(env, idea, draftCheck(renderId(1, 1), { items: [twoF.items[0]] }))).toMatchObject({ eligible: true });
    addRender(raw, renderId(1, 9), idea, "final");
    expect(await saveCheck(env, idea, finalCheck(renderId(1, 9), twoF), "final_check")).toMatchObject({ ready: false });
    expect(await saveCheck(env, idea, finalCheck(renderId(1, 9), { items: [{ code: "D1", found: true, note: "A stray mark." }] }), "final_check")).toMatchObject({ ready: false });
    expect(await saveCheck(env, idea, finalCheck(renderId(1, 9), { finalPoints: { ...finalCheck("x").finalPoints, visualCraft: "na" } }), "final_check")).toMatchObject({ ready: false });
    expect(await saveCheck(env, idea, finalCheck(renderId(1, 9)), "final_check")).toMatchObject({ ready: true });
    // Both kinds need the checklist items: the ready and eligible rules read them.
    await expect(saveCheck(env, idea, finalCheck(renderId(1, 9), { items: undefined }), "final_check")).rejects.toThrow("final_check needs items");
    await expect(saveCheck(env, idea, draftCheck(renderId(1, 1), { items: undefined }))).rejects.toThrow("draft_check needs items");
  });

  it("0 or 1 eligible drafts after the redos: nextStep direction; a new direction starts a new round, and the old drafts no longer count", async () => {
    const { env, raw, picks } = await boardReady({ rank: false });
    const idea = picks[0]!.id;
    const bad = (rid: string, attempt: number) => draftCheck(rid, { eligible: false, attempt, reason: "The pouch is too small to read." });
    await saveCheck(env, idea, bad(renderId(1, 2), 1));
    await saveCheck(env, idea, bad(renderId(1, 3), 1));
    for (const n of [5, 6]) {
      addRender(raw, renderId(1, n), idea, "draft", "2026-11-17T07:10:00.000Z");
      await saveCheck(env, idea, bad(renderId(1, n), 2));
    }
    expect((await run(env, "batch_get", { id: E3 })).nextStep).toBe("direction");
    // The one lower-risk direction: a new round.
    await run(env, "direction_save", { batchId: E3, ideaId: idea, direction: direction() });
    let b = await run(env, "batch_get", { id: E3 });
    expect(ideaOf(b, idea).drafts.map((d: { current: boolean }) => d.current)).toEqual([false, false, false, false, false]);
    expect(b.nextStep).toBe("drafts");
    await expect(run(env, "drafts_rank", { batchId: E3, ranks: [{ key: `renders/${renderId(1, 1)}/0.jpg`, rank: 1, reason: "The pouch reads first." }] })).rejects.toThrow("is not an eligible current draft");
    // The new round: 3 first tries fail, then the 3 redos fail too. 0 eligible stays at drafts (the main session tells the owner) ...
    for (const n of [7, 8, 9]) {
      addRender(raw, renderId(1, n), idea, "draft", "2026-11-17T07:20:00.000Z");
      await saveCheck(env, idea, bad(renderId(1, n), 1));
    }
    expect((await run(env, "batch_get", { id: E3 })).nextStep).toBe("drafts");
    const redos = ["a", "b", "c"].map((x) => `1${x}000000-0000-4000-8000-000000000000`);
    for (const rid of redos) {
      addRender(raw, rid, idea, "draft", "2026-11-17T07:30:00.000Z");
      await saveCheck(env, idea, bad(rid, 2));
    }
    expect((await run(env, "batch_get", { id: E3 })).nextStep).toBe("drafts");
    // ... and 1 eligible redo after the new round is done: the owner sees it with the reason.
    await saveCheck(env, idea, draftCheck(redos[0]!, { attempt: 2 }));
    b = await run(env, "batch_get", { id: E3 });
    expect(b.nextStep).toBe("draft_rank");
    expect((await run(env, "batch_get", { id: E3, view: "critic" })).ideas.find((i: { id: string }) => i.id === idea).drafts).toHaveLength(1);
    await rankAll(env);
    expect((await run(env, "batch_get", { id: E3 })).nextStep).toBe("board");
  });

  it("an engine 2 batch shows no check fields and keeps its board gate and rank as today", async () => {
    const { env, raw, e2 } = await approved();
    const b = await run(env, "batch_get", { id: e2 });
    expect(b).not.toHaveProperty("nextStep");
    expect(JSON.stringify(b)).not.toMatch(/"eligible"|"check"|"ready"/);
    expect(raw.prepare("SELECT COUNT(*) AS c FROM batch_records WHERE batch_id = ? AND kind IN ('draft_check', 'final_check')").get(e2)).toEqual({ c: 0 });
  });
});

describe("the owner's board for engine 3 (v3 Phase 6)", () => {
  it("shows only the eligible current drafts, and picks_save refuses the others; engine 2 is unchanged", async () => {
    const { env, raw, picks, e2 } = await boardReady();
    const idea = picks[0]!.id;
    // A draft that failed its check, and a draft with no check yet.
    addRender(raw, renderId(1, 4), idea, "draft", "2026-11-17T07:10:00.000Z");
    await saveCheck(env, idea, draftCheck(renderId(1, 4), { eligible: false, items: [{ code: "D4", found: true, note: "The pouch floats." }], points: { ...draftCheck("x").points, physics: "fail" }, reason: "The pouch floats (D4)." }));
    addRender(raw, renderId(1, 5), idea, "draft", "2026-11-17T07:11:00.000Z");
    const full = ideaOf(await batch.batchGet(env, E3), idea).drafts.map((d: { key: string }) => d.key);
    expect(full).toHaveLength(5);
    const board = await batch.batchGetOwner(env, E3);
    const shown = ideaOf(board, idea).drafts.map((d: { key: string }) => d.key);
    expect(shown).toEqual([1, 2, 3].map((n) => `renders/${renderId(1, n)}/0.jpg`));
    await expect(batch.picksSave(env, E3, [{ key: `renders/${renderId(1, 4)}/0.jpg` }])).rejects.toThrow("is not an eligible current draft");
    await expect(batch.picksSave(env, E3, [{ key: `renders/${renderId(1, 5)}/0.jpg` }])).rejects.toThrow("is not an eligible current draft");
    await batch.picksSave(env, E3, [{ key: shown[1]!, note: "the second" }]);
    // A pick with a final stays on the board and stays valid after the drafts change.
    raw.prepare("UPDATE picks SET final_render_id = 'f1' WHERE render_key = ?").run(shown[1]);
    await saveCheck(env, idea, draftCheck(renderId(1, 2), { eligible: false, items: [{ code: "D4", found: true, note: "Seen again." }], points: { ...draftCheck("x").points, physics: "fail" }, reason: "Seen again (D4)." }));
    expect(ideaOf(await batch.batchGetOwner(env, E3), idea).drafts.map((d: { key: string }) => d.key)).toContain(shown[1]);
    await batch.picksSave(env, E3, [{ key: shown[1]! }]);
    // Engine 2: the board is batch_get, as before.
    expect(await batch.batchGetOwner(env, e2)).toEqual(await batch.batchGet(env, e2));
  });
});
