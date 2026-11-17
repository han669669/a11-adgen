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
  });

  it("makes a new subject for another page, a variant query, another brand, a brand subject, images or notes", async () => {
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
  });
});
