import type { DatabaseSync } from "node:sqlite";
import { readdirSync, readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Env } from "../worker/env";
import { TOOLS } from "../worker/mcp";
import { validate } from "../worker/schema";
import { fakeD1 } from "./helpers/d1";

/** Tools that no other test file named (found 09-11-2026), each run through its schema and run(), as tools/call does. */

afterEach(() => vi.unstubAllGlobals());

function makeEnv() {
  const env = { DB: fakeD1(), SPEND_CAP_USD: "5.00", PUBLIC_BASE_URL: "https://w", EXA_API_KEY: "k" } as unknown as Env;
  const raw = (env.DB as unknown as { raw: DatabaseSync }).raw;
  raw.prepare("INSERT INTO brands (id, slug, name, created_at, updated_at) VALUES ('b1', 'wongi', 'WonGi', 'now', 'now')").run();
  raw.prepare("INSERT INTO brand_kits (id, brand_id, version, kit, created_at) VALUES ('k1', 'b1', 1, '{}', 'now')").run();
  return { env, raw };
}
const run = async (env: Env, name: string, args: unknown) => {
  const t = TOOLS.find((x) => x.name === name)!;
  const c = (await t.run(env, validate(t.inputSchema, args))).content[0]!;
  return JSON.parse(c.type === "text" ? c.text : "{}");
};

describe("tools without a test elsewhere", () => {
  it("brand_list lists the saved brand", async () => {
    const { env } = makeEnv();
    expect(JSON.stringify(await run(env, "brand_list", {}))).toContain("wongi");
  });

  it("facts_save adds facts to a subject, and batch_list lists the batch made from it", async () => {
    const { env } = makeEnv();
    const s = await run(env, "subject_save", { brandSlug: "wongi", kind: "brand", title: "WonGi" });
    const subjectId = s.id ?? s.subjectId;
    expect(subjectId).toMatch(/^[0-9a-f-]{36}$/);
    const facts = await run(env, "facts_save", {
      subjectId,
      facts: [{ label: "pack size", value: "150 g", quote: "Net weight 150 g", sourceUrl: "https://b.example/p" }],
    });
    expect(JSON.stringify(facts)).toContain("150 g");
    const b = await run(env, "batch_create", { brandSlug: "wongi", subjectId, label: "W48" });
    const list = await run(env, "batch_list", { brandSlug: "wongi" });
    expect(JSON.stringify(list)).toContain(b.id);
    expect(JSON.stringify(await run(env, "batch_list", {}))).toContain("W48");
  });

  it("swipe_search finds a swipe added for the stage", async () => {
    const { env } = makeEnv();
    await run(env, "swipe_add", { title: "Cup drip close-up", why: "Shows the product in use, fast to read.", source: "owner pick", stage: "tof" });
    expect(JSON.stringify(await run(env, "swipe_search", { stage: "tof" }))).toContain("Cup drip close-up");
  });

  it("gold_import adds items and skips known ones", async () => {
    const { env } = makeEnv();
    const items = [{ label: "B41 ad 1", mark: "use" }, { label: "B44 ad 2", mark: "pass" }];
    const first = await run(env, "gold_import", { items });
    expect(first.imported).toBe(2);
    const again = await run(env, "gold_import", { items });
    expect(again.imported).toBe(0);
    expect(again.goldItems).toBe(2);
  });

  it("gold_runs lists no runs on a new database", async () => {
    const { env } = makeEnv();
    expect((await run(env, "gold_runs", {})).runs).toEqual([]);
  });

  it("pack_revoke refuses a bad id and a pack that does not exist", async () => {
    const { env } = makeEnv();
    await expect(run(env, "pack_revoke", { packId: "nope" })).rejects.toThrow();
    await expect(run(env, "pack_revoke", { packId: "11111111-1111-1111-1111-111111111111" })).rejects.toThrow();
  });

  it("exa_search and exa_contents call Exa, record the spend, and mark the results untrusted", async () => {
    const { env, raw } = makeEnv();
    const calls: { url: string; body: any }[] = [];
    vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
      calls.push({ url, body: JSON.parse(String(init.body)) });
      const results = url.endsWith("/search")
        ? [{ title: "Reddit thread", url: "https://r.example/t", highlights: ["too sweet"] }]
        : [{ url: "https://r.example/t", title: "Reddit thread", text: "Page text" }];
      return new Response(JSON.stringify({ results }), { status: 200, headers: { "content-type": "application/json" } });
    });
    const s = await run(env, "exa_search", { query: "barley tea singapore" });
    expect(s.note).toBeTruthy();
    expect(s.results[0]).toMatchObject({ url: "https://r.example/t", highlights: ["too sweet"] });
    expect(calls[0]!.url).toBe("https://api.exa.ai/search");
    expect(calls[0]!.body.numResults).toBe(8);
    const c = await run(env, "exa_contents", { urls: ["https://r.example/t"] });
    expect(c.pages[0]).toMatchObject({ text: "Page text" });
    expect(calls[1]!.body.text.maxCharacters).toBe(6000);
    const spent = raw.prepare("SELECT kind, status FROM spend WHERE service = 'exa' ORDER BY at").all() as { kind: string; status: string }[];
    expect(spent.map((r) => [r.kind, r.status])).toEqual([["search", "spent"], ["contents", "spent"]]);
  });

  it("exa_search gives back the reserved spend when Exa fails", async () => {
    const { env, raw } = makeEnv();
    vi.stubGlobal("fetch", async () => new Response("down", { status: 503 }));
    await expect(run(env, "exa_search", { query: "barley tea" })).rejects.toThrow(/HTTP 503/);
    const rows = raw.prepare("SELECT status FROM spend WHERE service = 'exa'").all() as { status: string }[];
    expect(rows.map((r) => r.status)).toEqual(["released"]);
  });

  it.each([
    ["times out", async () => Promise.reject(new DOMException("The operation timed out.", "TimeoutError"))],
    ["sends an answer that cannot be read", async () => new Response("<html>", { status: 200 })],
  ])("exa_search keeps the spend when Exa %s (Exa may still bill the call)", async (_what, fetchStub) => {
    const { env, raw } = makeEnv();
    vi.stubGlobal("fetch", fetchStub);
    await expect(run(env, "exa_search", { query: "barley tea" })).rejects.toThrow();
    expect(raw.prepare("SELECT status FROM spend WHERE service = 'exa'").all()).toEqual([{ status: "spent" }]);
    vi.stubGlobal("fetch", fetchStub);
    await expect(run(env, "exa_contents", { urls: ["https://r.example/t"] })).rejects.toThrow();
    expect(raw.prepare("SELECT status FROM spend WHERE service = 'exa' AND kind = 'contents'").all()).toEqual([{ status: "spent" }]);
  });
});

describe("tool coverage", () => {
  it("names every MCP tool in at least one test file", () => {
    const dir = new URL("./", import.meta.url);
    const text = readdirSync(dir)
      .filter((f) => f.endsWith(".test.ts"))
      .map((f) => readFileSync(new URL(f, dir), "utf8"))
      .join("\n");
    const missing = TOOLS.map((t) => t.name).filter((n) => !new RegExp(`["'\`]${n}["'\`]`).test(text));
    expect(missing).toEqual([]);
  });
});
