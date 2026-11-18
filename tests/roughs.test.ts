import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import * as batch from "../worker/batch";
import * as fal from "../worker/fal";
import { E3, addRender, run, select, withConcepts } from "./helpers/engine3";

/** Engine 3 roughs (owner, 18-11-2026, decision D3 = A; docs/engine-3-overhaul.md C7 and B8). */

const sql = (name: string) => readFileSync(new URL(`../migrations/${name}`, import.meta.url), "utf8");

describe("roughs", () => {
  it("cost a draft and use the draft size", () => {
    expect(fal.estimate("rough", 1, 1)).toBe(fal.estimate("draft", 1, 1));
    expect(fal.SIZES.rough).toEqual(fal.SIZES.draft);
  });

  it("are for any concept of an engine 3 batch, with no copy approval, and at most 2 for each concept and 8 for each batch", async () => {
    const { env, raw, ideas, e2 } = await withConcepts();
    // Not picked, no approved words: a rough is still allowed.
    await expect(batch.roughCheck(env, E3, ideas[9]!.id)).resolves.toBeUndefined();
    await expect(batch.roughCheck(env, E3, "55555555-5555-4555-8555-555555555555")).rejects.toThrow("A rough belongs to a concept of its batch");
    await expect(batch.roughCheck(env, e2, ideas[0]!.id)).rejects.toThrow("No idea");

    addRender(raw, "r1", ideas[0]!.id, "rough");
    addRender(raw, "r2", ideas[0]!.id, "rough");
    await expect(batch.roughCheck(env, E3, ideas[0]!.id)).rejects.toThrow("This concept has 2 roughs");
    raw.prepare("UPDATE renders SET status = 'failed' WHERE id = 'r2'").run(); // a failed render does not count
    await expect(batch.roughCheck(env, E3, ideas[0]!.id)).resolves.toBeUndefined();
    for (let i = 1; i <= 7; i++) addRender(raw, `s${i}`, ideas[i]!.id, "rough");
    await expect(batch.roughCheck(env, E3, ideas[9]!.id)).rejects.toThrow("This batch has 8 roughs");
  });

  it("are refused for an engine 2 batch", async () => {
    const { env, raw, e2 } = await withConcepts();
    raw.prepare("INSERT INTO ideas (id, batch_id, n, format, insight, visual, headline, created_at) VALUES ('x2', ?, 1, 'tof', 'i', 'v', 'h', 'now')").run(e2);
    await expect(batch.roughCheck(env, e2, "x2")).rejects.toThrow("engine 3 batches only");
  });

  it("are refused before fal is paid when migration 0017 is not live", async () => {
    const { env, raw, ideas } = await withConcepts();
    raw.exec(sql("rollback/0017_roughs.down.sql"));
    await expect(batch.roughCheck(env, E3, ideas[0]!.id)).rejects.toThrow("Roughs need migration 0017_roughs");
  });

  it("show under the idea's roughs, never as drafts, and do not freeze the picks", async () => {
    const { env, raw, ideas } = await withConcepts();
    await run(env, "ideas_pick", select(ideas));
    addRender(raw, "rr", ideas[0]!.id, "rough");
    const got = await run(env, "batch_get", { id: E3 });
    const pick = got.ideas.find((i: { id: string }) => i.id === ideas[0]!.id);
    expect(pick.roughs).toEqual([{ key: "renders/rr/0.jpg", url: "https://w/m/renders/rr/0.jpg" }]);
    expect(pick.drafts).toEqual([]);
    expect(got.nextStep).toBe("copy_review");
    // The owner chooses other concepts after seeing the roughs: the picks are not frozen by a rough.
    const swap = await run(env, "ideas_pick", { ...select(ideas), ids: [ideas[0]!.id, ideas[3]!.id, ideas[9]!.id],
      roles: [{ ideaId: ideas[0]!.id, role: "tof" }, { ideaId: ideas[3]!.id, role: "tof" }, { ideaId: ideas[9]!.id, role: "bof" }],
      review: undefined, ownerSwap: "the bottle one, I like its rough" });
    expect(swap.picked).toContain(ideas[9]!.id);
    // A draft still freezes them.
    addRender(raw, "dd", ideas[0]!.id, "draft");
    await expect(run(env, "ideas_pick", { ...select(ideas), review: undefined, ownerSwap: "back to the first 3" })).rejects.toThrow("picks and roles are frozen");
  });

  it("are not a final or a draft picture for a verdict", async () => {
    const { env, raw, ideas } = await withConcepts();
    addRender(raw, "rr", ideas[0]!.id, "rough");
    await expect(
      batch.batchUpdate(env, { id: E3, ownerVerdicts: [{ stage: "final", mark: "approve", key: "renders/rr/0.jpg", ownerSaid: "yes" }] }),
    ).rejects.toThrow("is a rough, not a final picture");
    // Nor a draft: a draft verdict on a rough would withdraw a pass (or count as a draft) for the wrong picture.
    await expect(
      batch.batchUpdate(env, { id: E3, ownerVerdicts: [{ stage: "draft", mark: "fix", ideaId: ideas[0]!.id, key: "renders/rr/0.jpg", ownerSaid: "too dark" }] }),
    ).rejects.toThrow("is a rough, not a draft picture");
  });
});

describe("0017_roughs", () => {
  it("keeps every render row, its order and both indexes, takes 'rough', and rolls back", () => {
    const db = new DatabaseSync(":memory:");
    db.exec("PRAGMA foreign_keys = ON");
    const before = (n: string) => n.endsWith(".sql") && n < "0017";
    for (const f of readdirSync(new URL("../migrations/", import.meta.url)).filter(before).sort()) db.exec(sql(f));
    const add = db.prepare(
      `INSERT INTO renders (id, batch, idea, kind, status, prompt, refs, width, height, quality, num_images, image_keys, usd_est, created_at, updated_at, composed_key)
       VALUES (?, 'b', 'i', ?, 'done', 'p', '[]', 1024, 1280, 'low', 1, '[]', 0.02, 't', 't', ?)`,
    );
    add.run("z", "final", "renders/z/1-c.jpg");
    add.run("a", "draft", null);
    expect(() => add.run("r", "rough", null)).toThrow();
    const rows = () => db.prepare("SELECT * FROM renders ORDER BY rowid").all();
    const old = rows();
    db.exec("BEGIN");
    db.exec(sql("0017_roughs.sql"));
    db.exec("COMMIT");
    expect(rows()).toEqual(old);
    expect((db.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'renders' ORDER BY name").all() as { name: string }[]).map((r) => r.name))
      .toEqual(expect.arrayContaining(["renders_batch", "renders_idea"]));
    add.run("r", "rough", null);
    db.exec(sql("rollback/0017_roughs.down.sql"));
    expect(rows()).toEqual(old);
    expect(() => add.run("r2", "rough", null)).toThrow();
  });
});
