import { readFileSync } from "node:fs";
import type { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as batch from "../worker/batch";
import type { Env } from "../worker/env";
import * as fal from "../worker/fal";
import { houseRules } from "../worker/houserules";
import { TOOLS } from "../worker/mcp";
import { promptGet } from "../worker/prompts";
import { run } from "./helpers/engine3";
import { fakeD1 } from "./helpers/d1";

/** Engine v1: wild concepts, one low draft each and a high final of each chosen draft, no words, only the kit logo (owner 23-11-2026; house rules WI). */

const sql = (name: string) => readFileSync(new URL(`../migrations/${name}`, import.meta.url), "utf8");

async function seeded() {
  const env = { DB: fakeD1(), SPEND_CAP_USD: "5.00", PUBLIC_BASE_URL: "https://w", FAL_KEY: "k" } as unknown as Env;
  const raw = (env.DB as unknown as { raw: DatabaseSync }).raw;
  raw.prepare("INSERT INTO brands (id, slug, name, created_at, updated_at) VALUES ('b1', 'catfiddle', 'Cat & the Fiddle', 'now', 'now')").run();
  raw.prepare("INSERT INTO brand_kits (id, brand_id, version, kit, created_at) VALUES ('k1', 'b1', 1, '{}', 'now')").run();
  const subject = await run(env, "subject_save", { brandSlug: "catfiddle", kind: "product", title: "Fickle Feline", url: "https://example.com/p" });
  const base = { brandSlug: "catfiddle", subjectId: subject.id as string, label: "W48 wild" };
  return { env, raw, base };
}

/** An engine 1 batch with 8 wild concepts (all tof: a wild ad has no funnel step of its own). */
async function withConcepts() {
  const s = await seeded();
  const b = await run(s.env, "batch_create", { ...s.base, engine: 1, ownerStart: "go wild, engine v1" });
  const saved = await run(s.env, "ideas_save", {
    batchId: b.id,
    ideas: [...Array(8)].map((_, i) => ({ format: "tof", insight: "The slice is the hero.", visual: `A giant slice on yellow, take ${i + 1}.`, headline: `Concept ${i + 1}` })),
  });
  return { ...s, id: b.id as string, ideas: saved.ideas as { id: string }[], warnings: saved.warnings as string[] };
}

const addDraft = (raw: DatabaseSync, batchId: string, rid: string, ideaId: string, at = "2026-11-23T07:00:00.000Z") =>
  raw
    .prepare(
      `INSERT INTO renders (id, batch, idea, kind, status, prompt, refs, width, height, quality, num_images, image_keys, usd_est, created_at, updated_at)
       VALUES (?, ?, ?, 'draft', 'done', 'p', '[]', 1024, 1280, 'low', 1, ?, 0.01, ?, ?)`,
    )
    .run(rid, batchId, ideaId, JSON.stringify([`renders/${rid}/0.jpg`]), at, at);

afterEach(() => vi.unstubAllGlobals());

describe("engine v1: batch_create", () => {
  it("makes engine 1 only with the owner's words, keeps them in the notes, and keeps them on a new note", async () => {
    const { env, base } = await seeded();
    await expect(run(env, "batch_create", { ...base, engine: 1 })).rejects.toThrow("An engine 1 batch needs ownerStart");
    const b = await run(env, "batch_create", { ...base, engine: 1, ownerStart: "go wild\n engine v1" });
    expect(b).toMatchObject({ engine: 1, status: "research" });
    const got = await batch.batchGet(env, b.id);
    expect(got).toMatchObject({ engine: 1, nextStep: "concepts" });
    expect(got.notes).toMatch(/^Engine 1 \(wild\) started by the owner \(.+\): "go wild engine v1"$/);
    await batch.batchUpdate(env, { id: b.id, notes: "References found." });
    expect((await batch.batchGet(env, b.id)).notes).toMatch(/^Engine 1 \(wild\) started by the owner .+\nReferences found\.$/);
  });

  it("refuses engine 1 before migration 0018 is live, and writes nothing", async () => {
    const { env, raw, base } = await seeded();
    raw.exec("BEGIN");
    raw.exec(sql("rollback/0018_engine_1.down.sql"));
    raw.exec("COMMIT");
    await expect(run(env, "batch_create", { ...base, engine: 1, ownerStart: "go" })).rejects.toThrow("need migration 0018_engine_1");
    expect(raw.prepare("SELECT COUNT(*) AS n FROM batches").get()).toEqual({ n: 0 });
    // Engines 2 and 3 still work on the old table.
    await expect(run(env, "batch_create", base)).resolves.toMatchObject({ engine: 2 });
  });
});

describe("engine v1: concepts and picks", () => {
  it("saves concepts with no copy warning and refuses the engine 3 fields", async () => {
    const { env, id, warnings } = await withConcepts();
    expect(warnings).toEqual([]);
    await expect(run(env, "ideas_save", { batchId: id, promptVersion: "0.2.32", ideas: [{ format: "tof", insight: "x x x", visual: "a slice", headline: "c" }] }))
      .rejects.toThrow("This batch is engine 1");
    expect((await batch.batchGet(env, id)).nextStep).toBe("concept_pick");
  });

  it("takes 3 picks in any mix of stages, and no more", async () => {
    const { env, id, ideas } = await withConcepts();
    await run(env, "ideas_pick", { batchId: id, ids: [ideas[0]!.id, ideas[1]!.id, ideas[2]!.id] });
    await expect(run(env, "ideas_pick", { batchId: id, ids: [ideas[3]!.id] })).rejects.toThrow("Pick limit");
    await expect(run(env, "ideas_pick", { batchId: id, ids: [ideas[3]!.id], outcome: "select" })).rejects.toThrow("This batch is engine 1");
    expect((await batch.batchGet(env, id)).nextStep).toBe("pictures");
  });
});

describe("engine v1: pictures", () => {
  it("needs a picked concept and no approved words", async () => {
    const { env, id, ideas } = await withConcepts();
    await run(env, "ideas_pick", { batchId: id, ids: [ideas[0]!.id, ideas[1]!.id, ideas[2]!.id] });
    await expect(batch.copyApprovedCheck(env, id, ideas[0]!.id)).resolves.toEqual({ engine: 1 });
    await expect(batch.copyApprovedCheck(env, id, ideas[5]!.id)).rejects.toThrow("is not picked");
  });

  it("renders one low draft for each call, with no real-size rule in the prompt", async () => {
    const { env, raw, id, ideas } = await withConcepts();
    await run(env, "ideas_pick", { batchId: id, ids: [ideas[0]!.id, ideas[1]!.id, ideas[2]!.id] });
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) =>
      Response.json({ request_id: "q1", status_url: "https://queue.fal.run/s", response_url: "https://queue.fal.run/r" }));
    vi.stubGlobal("fetch", fetchMock);
    const out = await run(env, "render_submit", {
      batch: id, idea: ideas[0]!.id, kind: "draft", numImages: 3,
      prompt: "A giant slice of Fickle Feline cheesecake on a yellow seamless, real layers, clean cut faces.",
      referenceUrls: ["https://w/m/refs/11111111-1111-4111-8111-111111111111.jpg"],
    });
    const body = JSON.parse(fetchMock.mock.calls[0]![1]!.body as string);
    expect(body).toMatchObject({ image_size: { width: 1024, height: 1280 }, quality: "low", num_images: 1 });
    expect(body.prompt).toContain(fal.RENDER_SUFFIX_WILD);
    expect(body.prompt).not.toContain("real size");
    expect(out.usdEstimate).toBe(fal.estimate("draft", 1, 1));
    expect(raw.prepare("SELECT kind, quality, width FROM renders").get()).toEqual({ kind: "draft", quality: "low", width: 1024 });
  });

  it("renders the final of a chosen draft at high quality, with no real-size rule in the prompt", async () => {
    const { env, raw, id, ideas } = await withConcepts();
    const ids = [ideas[0]!.id, ideas[1]!.id, ideas[2]!.id];
    await run(env, "ideas_pick", { batchId: id, ids });
    ids.forEach((x, i) => addDraft(raw, id, `r${i}`, x));
    await batch.ideasUpdate(env, [{ id: ids[0]!, finalPrompt: "Keep this photograph exactly; real layers, clean cut faces." }]);
    await batch.picksSave(env, id, [{ key: "renders/r0/0.jpg" }]);
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) =>
      Response.json({ request_id: "q1", status_url: "https://queue.fal.run/s", response_url: "https://queue.fal.run/r" }));
    vi.stubGlobal("fetch", fetchMock);
    await batch.finalRender(env, id, "renders/r0/0.jpg");
    const body = JSON.parse(fetchMock.mock.calls[0]![1]!.body as string);
    expect(body).toMatchObject({ image_size: { width: 1536, height: 1920 }, quality: "high", num_images: 1 });
    expect(body.prompt).toContain(fal.RENDER_SUFFIX_WILD);
    expect(body.prompt).not.toContain("real size");
  });

  it("uses the wild suffix on the finish pass of an engine 1 final (render_submit kind final)", async () => {
    const { env, id, ideas } = await withConcepts();
    await run(env, "ideas_pick", { batchId: id, ids: [ideas[0]!.id, ideas[1]!.id, ideas[2]!.id] });
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) =>
      Response.json({ request_id: "q1", status_url: "https://queue.fal.run/s", response_url: "https://queue.fal.run/r" }));
    vi.stubGlobal("fetch", fetchMock);
    await run(env, "render_submit", {
      batch: id, idea: ideas[0]!.id, kind: "final",
      prompt: "Keep this photograph exactly; match the cheesecake texture of the second reference.",
      referenceUrls: ["https://w/m/renders/f/0.jpg", "https://w/m/refs/11111111-1111-4111-8111-111111111111.jpg"],
    });
    const body = JSON.parse(fetchMock.mock.calls[0]![1]!.body as string);
    expect(body).toMatchObject({ image_size: { width: 1536, height: 1920 }, quality: "high" });
    expect(body.prompt).toContain(fal.RENDER_SUFFIX_WILD);
    expect(body.prompt).not.toContain("real size");
  });

  it("names the engine of each pick and verdict in taste_log, so engine 1 rows stay apart (WI10)", async () => {
    const { env, raw, id, ideas, base } = await withConcepts();
    const ids = [ideas[0]!.id, ideas[1]!.id, ideas[2]!.id];
    await run(env, "ideas_pick", { batchId: id, ids });
    ids.forEach((x, i) => addDraft(raw, id, `r${i}`, x));
    await batch.picksSave(env, id, [{ key: "renders/r0/0.jpg", note: "the giant slice" }]);
    await batch.batchUpdate(env, { id, ownerVerdicts: [{ ideaId: ids[1]!, stage: "draft", mark: "pass", ownerSaid: "not this one" }] });
    const other = await run(env, "batch_create", base);
    const two = await run(env, "ideas_save", { batchId: other.id, ideas: [{ format: "tof", insight: "x x x", visual: "a slice", headline: "Too slow.", copy: { subline: "Real cheesecake." } }] });
    await batch.batchUpdate(env, { id: other.id, ownerVerdicts: [{ ideaId: two.ideas[0].id, stage: "draft", mark: "pass", ownerSaid: "no" }] });
    const log = await batch.tasteLog(env);
    expect(log.picks.map((p: { engine: number }) => p.engine)).toEqual([1]);
    expect(log.verdicts.map((v: { engine: number | null; ownerSaid: string }) => [v.engine, v.ownerSaid]).sort()).toEqual([[1, "not this one"], [2, "no"]]);
  });

  it("leaves an engine 2 draft as it was", async () => {
    const { env, raw, base } = await seeded();
    const b = await run(env, "batch_create", base);
    const saved = await run(env, "ideas_save", { batchId: b.id, ideas: [{ format: "tof", insight: "x x x", visual: "a slice", headline: "Too slow.", copy: { subline: "Real cheesecake." } }] });
    const ideaId = saved.ideas[0].id;
    await run(env, "ideas_pick", { batchId: b.id, ids: [ideaId] });
    await batch.ideasUpdate(env, [{ id: ideaId, copyApproved: "ok" }]);
    const fetchMock = vi.fn(async () => Response.json({ request_id: "q1", status_url: "https://queue.fal.run/s", response_url: "https://queue.fal.run/r" }));
    vi.stubGlobal("fetch", fetchMock);
    await run(env, "render_submit", { batch: b.id, idea: ideaId, kind: "draft", prompt: "A slice on a counter, real photograph, honest light.", referenceUrls: ["https://w/m/refs/a.jpg"] });
    const body = JSON.parse((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
    expect(body).toMatchObject({ image_size: { width: 1024, height: 1280 }, quality: "low" });
    expect(body.prompt).toContain(fal.RENDER_SUFFIX);
    expect(raw.prepare("SELECT quality FROM renders").get()).toEqual({ quality: "low" });
  });
});

describe("engine v1: board and next step", () => {
  it("reaches the board only with 3 picks, each with a picture and its final prompt", async () => {
    const { env, raw, id, ideas } = await withConcepts();
    const [a, b, c] = [ideas[0]!.id, ideas[1]!.id, ideas[2]!.id];
    await run(env, "ideas_pick", { batchId: id, ids: [a, b] });
    await expect(batch.batchUpdate(env, { id, status: "board" })).rejects.toThrow("nextStep is 'concept_pick'");
    await run(env, "ideas_pick", { batchId: id, ids: [c] });
    addDraft(raw, id, "r1", a);
    addDraft(raw, id, "r2", b);
    await expect(batch.batchUpdate(env, { id, status: "board" })).rejects.toThrow("nextStep is 'pictures'");
    addDraft(raw, id, "r3", c);
    // Raw drafts with no final prompt: a resumed session finishes them (the logo, finalPrompt) before the board.
    expect((await batch.batchGet(env, id)).nextStep).toBe("pictures");
    await expect(batch.batchUpdate(env, { id, status: "board" })).rejects.toThrow("nextStep is 'pictures'");
    await batch.ideasUpdate(env, [a, b, c].map((x) => ({ id: x, finalPrompt: "Keep this photograph exactly." })));
    expect((await batch.batchGet(env, id)).nextStep).toBe("board");
    await batch.batchUpdate(env, { id, status: "board" });
    expect((await batch.batchGet(env, id)).nextStep).toBe("owner_pick");
    await batch.picksSave(env, id, [{ key: "renders/r1/0.jpg" }, { key: "renders/r2/0.jpg" }, { key: "renders/r3/0.jpg" }]);
    expect((await batch.batchGet(env, id)).nextStep).toBe("finals");
  });

  it("asks for a new picture after the owner passes on one", async () => {
    const { env, raw, id, ideas } = await withConcepts();
    const ids = [ideas[0]!.id, ideas[1]!.id, ideas[2]!.id];
    await run(env, "ideas_pick", { batchId: id, ids });
    ids.forEach((x, i) => addDraft(raw, id, `r${i}`, x));
    await batch.batchUpdate(env, { id, ownerVerdicts: [{ stage: "draft", mark: "pass", ideaId: ids[0]!, ownerSaid: "cat head looks fake" }] });
    expect((await batch.batchGet(env, id)).nextStep).toBe("pictures");
  });

  it("nextStepV1 walks the steps in order", () => {
    const i = (id: string, picked: boolean, hasPicture = false, finals: { status: string }[] = []) => ({ id, picked, hasPicture, finalPrompt: "p", finals });
    const none = new Set<string>();
    expect(batch.nextStepV1("research", [], none)).toBe("concepts");
    expect(batch.nextStepV1("ideas", [i("a", true), i("b", false)], none)).toBe("concept_pick");
    expect(batch.nextStepV1("ideas", [i("a", true, true), i("b", true), i("c", true, true)], none)).toBe("pictures");
    const three = [i("a", true, true), i("b", true, true), i("c", true, true)];
    expect(batch.nextStepV1("drafts", three.map((x, n) => ({ ...x, finalPrompt: n === 1 ? null : "p" })), none)).toBe("pictures");
    expect(batch.nextStepV1("drafts", three, none)).toBe("board");
    expect(batch.nextStepV1("board", three, new Set(["a", "b"]))).toBe("owner_pick");
    expect(batch.nextStepV1("finals", three, new Set(["a", "b", "c"]))).toBe("finals");
    const done = three.map((x) => ({ ...x, finals: [{ status: "done" }] }));
    expect(batch.nextStepV1("finals", done, new Set(["a", "b", "c"]))).toBe("finish");
    expect(batch.nextStepV1("done", done, new Set(["a", "b", "c"]))).toBe("done");
  });
});

describe("engine v1: rules and the wild prompt", () => {
  it("gives every role the WI section, with the rules that are off and the logo rule", () => {
    for (const role of ["writer", "critic", "art-director", "main"] as const) {
      const rules = houseRules(role).rules;
      expect(rules).toContain("## WI. Engine v1 (wild concepts)");
      expect(rules).toContain("ST1 (the calm rule)");
      expect(rules).toContain("\"old v1\"");
    }
  });

  it("starts an engine 1 batch with the owner's words, low drafts and the logo only", () => {
    const out = promptGet("wild", { brand: "catfiddle", productUrl: "https://b.example/p", productTitle: "Fickle Feline", label: "W48" });
    if (typeof out === "string") throw new Error(out);
    const text = out.messages[0]!.content.text;
    expect(text).toContain("First call rules_get");
    expect(text).toContain("engine 1, ownerStart: the owner's exact words");
    expect(text).toContain("render_submit kind 'draft' with numImages 1");
    expect(text).toContain("--logo-top <kit logoTopPct / 100> and no --headline");
    expect(text).not.toContain("copyApproved");
    expect(promptGet("wild", { brand: "catfiddle" })).toBe("A new batch needs productUrl, productTitle and label. To resume, give batchId.");
  });

  it("checks the kit's logo top before batch_create, ends the finals at 'done', and keeps engine 1 out of the canon", () => {
    const text = (name: string, args: Record<string, string>) => {
      const out = promptGet(name, args);
      if (typeof out === "string") throw new Error(out);
      return out.messages[0]!.content.text;
    };
    const wild = text("wild", { brand: "catfiddle", productUrl: "https://b.example/p", productTitle: "Fickle Feline", label: "W48" });
    expect(wild.indexOf("logoTopPct is under 4")).toBeGreaterThan(-1);
    expect(wild.indexOf("logoTopPct is under 4")).toBeLessThan(wild.indexOf("batch_create (brandSlug"));
    expect(wild).toContain("logo.sourceUrl and refs[].sourceUrl, never its /m/brands/ url");
    expect(text("final", { batchId: "11111111-1111-4111-8111-111111111111" })).toContain("batch_update status 'done' (batch_get nextStep 'finish'");
    expect(text("learn", {})).toContain("An engine 1 row (taste_log engine 1: wild concepts) teaches engine 1 only");
  });

  it("puts the batch c1a43bcc lessons on the pictures only: a light-touch final, edges at full size, real angles", () => {
    const rules = houseRules("main").rules;
    expect(rules).toContain("Craft checks on the pictures only, never limits on the concepts");
    expect(rules).toContain("never makes the food more perfect than the draft");
    expect(rules).toContain("stepped or pixelated lines");
    expect(rules).toContain("camera angles that the brand's real photos show");
    expect(rules).toContain("A note for the critic, not a gate for the writer");
    expect(rules).toContain("finalRefs stay empty and the final prompt never asks the model to redraw the food");
    const out = promptGet("final", { batchId: "11111111-1111-4111-8111-111111111111" });
    if (typeof out === "string") throw new Error(out);
    expect(out.messages[0]!.content.text).toContain("a light touch that keeps the draft's photograph");
    expect(out.messages[0]!.content.text).toContain("engine 1: no finish pass and no food redraw, WI7");
    expect(rules).toContain("FO3 (the high final keeps the draft instead: WI7)");
    const wild = promptGet("wild", { brand: "catfiddle", productUrl: "https://b.example/p", productTitle: "Fickle Feline", label: "W48" });
    if (typeof wild === "string") throw new Error(wild);
    expect(wild.messages[0]!.content.text).toContain("save each skeleton's plan in the batch notes with the draft's renderId");
    const desc = (n: string) => TOOLS.find((x) => x.name === n)!.description;
    expect(desc("final_render")).toContain("an engine 1 final never gets it (house rule WI7");
    expect(desc("food_fix")).toContain("engine 1 has no finish pass");
  });

  it("locks the real food pixels first, with a hole for the extras, and refuses an angle that no real photo shows (owner, 25-11-2026)", () => {
    const rules = houseRules("main").rules;
    expect(rules).toContain("the real food pixels come first (owner, 25-11-2026). Do not ask the model to draw the food");
    expect(rules).toContain("The model keeps every locked food pixel and invents only the extras and the light");
    expect(rules).toContain("When a real photo at that angle exists, lock it");
    expect(rules).toContain("the lock leaves a hole: the plan's holes keep those pixels as backdrop");
    expect(rules).toContain("When no real photo shows the food at that angle, render nothing: change the food's angle (the extras can stay) or wait for a new real photo from the owner");
    expect(rules).toContain("Never guess a top, a back or a cut face from a front packshot");
    expect(rules).toContain("from its food lock (WI4)");
    expect(rules).not.toContain("when the model drifts from it");
    for (const role of ["writer", "critic", "art-director"] as const) expect(houseRules(role).rules).toContain("the real food pixels come first");
    const out = promptGet("wild", { brand: "catfiddle", productUrl: "https://b.example/p", productTitle: "Fickle Feline", label: "W48" });
    if (typeof out === "string") throw new Error(out);
    const wild = out.messages[0]!.content.text;
    expect(wild).toContain("scour the brand's site, its one-piece (1pc) stills, its lifestyle pages, its public social posts, retailer listings and public photos of buyers");
    expect(wild).toContain("the ANGLE SHEET: which angles have a real photo");
    expect(wild).toContain("its food shows only at an angle of the angle sheet");
    expect(wild).toContain("stop that draft and render nothing");
    expect(wild).toContain("This skeleton, with the lock and its holes, is the only reference of the draft");
    expect(wild).toContain("keep every food pixel of the reference exactly, and do not redraw or reshape the food");
    expect(wild).toContain("never swap the whole packshot over the extras");
    expect(wild).toContain("a food plan is never reprinted: when a flat printed pack shows in the same picture, also keep a pack-only plan");
    const resume = promptGet("wild", { brand: "catfiddle", productUrl: "https://b.example/p", productTitle: "Fickle Feline", label: "W48", batchId: "11111111-1111-4111-8111-111111111111" });
    if (typeof resume === "string") throw new Error(resume);
    expect(resume.messages[0]!.content.text).toContain("When the batch notes have no ANGLE SHEET yet (step 1), do step 1 first");
    expect(resume.messages[0]!.content.text).toContain("Keep the facts that batch_get already shows, and facts_save only new ones");
    expect(wild).not.toContain("the brand's real photos as the references (the food at an angle");
    const finish = wild.indexOf("Run scripts/photo_finish.py on each, then set the kit logo with scripts/headline.py --logo");
    expect(finish).toBeGreaterThan(wild.indexOf("This skeleton, with the lock and its holes"));
    expect(wild.slice(finish, finish + 300)).toContain("and no --headline");
    const desc = (n: string) => TOOLS.find((x) => x.name === n)!.description;
    expect(desc("render_submit")).toContain("when food shows, the only reference is the food lock skeleton");
    expect(desc("render_submit")).toContain("a concept with no food has the brand's real product photos as the references (D10)");
    expect(desc("render_submit")).not.toContain("the brand's real product and food photos are the references");
  });
});
