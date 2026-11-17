import { describe, expect, it } from "vitest";
import * as batch from "../worker/batch";
import { TOOLS } from "../worker/mcp";
import { validate } from "../worker/schema";
import { run, seeded } from "./helpers/engine3";

/** a11-engine v3 Phase 7 (kickoff unit 10): engine 3 starts only on the owner's own words, batch by batch. */
describe("controlled rollout: batch_create engine 3", () => {
  const create = async (over: Record<string, unknown> = {}) => {
    const s = await seeded({ brief: false });
    return { ...s, r: await run(s.env, "batch_create", { brandSlug: "pasar", subjectId: s.subjectId, label: "W48 e3", ...over }) };
  };

  it("makes engine 2 by default, and engine 3 only with the owner's words, kept in the notes", async () => {
    const { env, r: two } = await create();
    expect(two).toMatchObject({ engine: 2 });
    expect(await batch.batchGet(env, two.id)).toMatchObject({ engine: 2, notes: null });
    const { env: env3, r: three } = await create({ engine: 3, ownerStart: "yes, run\n engine 3 on this one" });
    expect(three).toMatchObject({ engine: 3, status: "research" });
    const b = await batch.batchGet(env3, three.id);
    expect(b).toMatchObject({ engine: 3, nextStep: "brief" });
    expect(b.notes).toMatch(/^Engine 3 started by the owner \(.+\): "yes, run engine 3 on this one"$/);
    // The critic never sees the owner's words.
    expect(await run(env3, "batch_get", { id: three.id, view: "critic" })).not.toHaveProperty("notes");
  });

  it("refuses engine 3 without his words, his words without engine 3, and any other engine", async () => {
    const s = await seeded({ brief: false });
    const base = { brandSlug: "pasar", subjectId: s.subjectId, label: "W48" };
    await expect(run(s.env, "batch_create", { ...base, engine: 3 })).rejects.toThrow("needs ownerStart");
    await expect(run(s.env, "batch_create", { ...base, engine: 3, ownerStart: "   " })).rejects.toThrow("needs ownerStart");
    await expect(run(s.env, "batch_create", { ...base, ownerStart: "go" })).rejects.toThrow("ownerStart goes with engine 3 only");
    const t = TOOLS.find((x) => x.name === "batch_create")!;
    expect(() => validate(t.inputSchema, { ...base, engine: 4, ownerStart: "go" })).toThrow();
  });

  it("keeps the owner's start line when the notes change later", async () => {
    const { env, r } = await create({ engine: 3, ownerStart: "go engine 3" });
    const line = (await batch.batchGet(env, r.id)).notes as string;
    await batch.batchUpdate(env, { id: r.id, notes: "Research done." });
    expect((await batch.batchGet(env, r.id)).notes).toBe(`${line}\nResearch done.`);
    // A note that already starts with the line is kept as it is.
    await batch.batchUpdate(env, { id: r.id, notes: `${line}\nDrafts next.` });
    expect((await batch.batchGet(env, r.id)).notes).toBe(`${line}\nDrafts next.`);
    // An engine 2 batch's notes are replaced, as before.
    const { env: env2, r: two } = await create();
    await batch.batchUpdate(env2, { id: two.id, notes: "a" });
    await batch.batchUpdate(env2, { id: two.id, notes: "b" });
    expect((await batch.batchGet(env2, two.id)).notes).toBe("b");
  });
});
