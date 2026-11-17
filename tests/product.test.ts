import type { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import type { Env } from "../worker/env";
import { TOOLS } from "../worker/mcp";
import { validate } from "../worker/schema";
import { fakeD1 } from "./helpers/d1";

/** a11-engine v3 Phase 5 (unit 8): a product is a lasting entity, so its facts carry over from batch to batch. */

function makeEnv() {
  const env = { DB: fakeD1(), SPEND_CAP_USD: "5.00", PUBLIC_BASE_URL: "https://w" } as unknown as Env;
  const raw = (env.DB as unknown as { raw: DatabaseSync }).raw;
  raw.prepare("INSERT INTO brands (id, slug, name, created_at, updated_at) VALUES ('b1', 'pasar', 'Pasar Pantry', 'now', 'now'), ('b2', 'other', 'Other', 'now', 'now')").run();
  raw.prepare("INSERT INTO brand_kits (id, brand_id, version, kit, created_at) VALUES ('k1', 'b1', 1, '{}', 'now')").run();
  return { env, raw };
}
const run = async (env: Env, name: string, args: unknown) => {
  const t = TOOLS.find((x) => x.name === name)!;
  const c = (await t.run(env, validate(t.inputSchema, args))).content[0]!;
  return JSON.parse(c.type === "text" ? c.text : "{}");
};
const product = (url: string, extra: Record<string, unknown> = {}, brandSlug = "pasar") => ({ brandSlug, kind: "product", title: "Gula Melaka Granola", url, ...extra });

describe("subject_save: a lasting product (unit 8)", () => {
  it("returns the earlier subject of the same product page of the brand, with its facts", async () => {
    const { env, raw } = makeEnv();
    const first = await run(env, "subject_save", product("https://Shop.example.com/p/granola/"));
    expect(first.reused).toBe(false);
    await run(env, "facts_save", { subjectId: first.id, facts: [{ label: "pack size", value: "300 g", quote: "300 g pouch", sourceUrl: "https://shop.example.com/p/granola" }] });
    // The host's case, a trailing slash and a fragment do not make another product.
    const again = await run(env, "subject_save", { ...product("https://shop.example.com/p/granola#reviews"), title: "Granola" });
    expect(again).toMatchObject({ id: first.id, reused: true, facts: 1, title: "Gula Melaka Granola" });
    expect(raw.prepare("SELECT COUNT(*) AS n FROM subjects").get()).toEqual({ n: 1 });
    // A batch of the reused subject sees the earlier facts.
    const b = await run(env, "batch_create", { brandSlug: "pasar", subjectId: again.id, label: "W48" });
    expect((await run(env, "batch_get", { id: b.id })).facts.map((f: { value: string }) => f.value)).toEqual(["300 g"]);
    // A long-lived product: the list shows the newest 200 facts, oldest first.
    const add = raw.prepare("INSERT INTO facts (subject_id, label, value, quote, source_url, created_at) VALUES (?, 'l', ?, 'q', 'https://shop.example.com/p/granola', 'now')");
    for (let i = 1; i <= 204; i++) add.run(first.id, `v${i}`);
    const facts = (await run(env, "batch_get", { id: b.id })).facts.map((f: { value: string }) => f.value);
    expect([facts.length, facts[0], facts[199]]).toEqual([200, "v5", "v204"]);
  });

  it("makes a new subject for another page, a variant query, another brand, a brand subject or notes, and never reuses a subject with notes", async () => {
    const { env, raw } = makeEnv();
    const first = await run(env, "subject_save", product("https://shop.example.com/p/granola"));
    for (const args of [
      product("https://shop.example.com/p/muesli"),
      product("https://shop.example.com/p/granola?variant=2"),
      product("https://shop.example.com/p/granola", {}, "other"),
      { brandSlug: "pasar", kind: "brand", title: "Pasar Pantry", url: "https://shop.example.com/p/granola" },
      product("https://shop.example.com/p/granola", { notes: "the 500 g pouch" }),
    ]) {
      const r = await run(env, "subject_save", args);
      expect(r.reused).toBe(false);
      expect(r.id).not.toBe(first.id);
    }
    expect(raw.prepare("SELECT COUNT(*) AS n FROM subjects").get()).toEqual({ n: 6 });
    // The subject with notes is newer than the plain one, but only the plain one is reused.
    expect((await run(env, "subject_save", product("https://shop.example.com/p/granola"))).id).toBe(first.id);
    // A subject that asked for images is not plain, even when every image failed to download.
    raw.prepare("UPDATE subjects SET data = json_set(data, '$.imageUrls', json('[\"https://x.example/a.png\"]')) WHERE id = ?").run(first.id);
    expect((await run(env, "subject_save", product("https://shop.example.com/p/granola"))).reused).toBe(false);
    raw.prepare("UPDATE subjects SET data = json_set(data, '$.imageUrls', json('[]'), '$.notes', 'old note') WHERE id = ?").run(first.id);
    expect((await run(env, "subject_save", product("https://shop.example.com/p/granola"))).id).not.toBe(first.id);
  });
});
