import type { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as batch from "../worker/batch";
import { brandSave } from "../worker/brand";
import type { Env } from "../worker/env";
import { TOOLS } from "../worker/mcp";
import { PROMPTS } from "../worker/prompts";
import { validate } from "../worker/schema";
import { fakeD1 } from "./helpers/d1";

afterEach(() => vi.unstubAllGlobals());

const TOF = "a11_W45_wongi_b01_tof_c01_v1";
const BOF = "a11_W45_wongi_b01_bof_c02_v1";

async function makeEnv() {
  const IMAGES = { input: () => ({ transform: () => IMAGES.input(), output: async () => ({ response: () => new Response("png-bytes") }) }) };
  const env = { DB: fakeD1(), MEDIA: { put: async () => {}, delete: async () => {} }, IMAGES, PUBLIC_BASE_URL: "https://w" } as unknown as Env;
  const raw = (env.DB as unknown as { raw: DatabaseSync }).raw;
  vi.stubGlobal("fetch", async (u: string) => ({ url: u, ok: true, status: 200, headers: new Headers({ "content-type": "image/png" }), body: new Response(new Uint8Array(4)).body }));
  for (const [slug, name] of [["won-gi", "WonGi"], ["other-co", "Other Co"]] as const)
    await brandSave(env, { slug, name, kit: { logoUrl: "https://b.example/logo.png", palette: [{ hex: "#F26A21", role: "logo" }], voice: "Warm and short." } });
  const subject = await batch.subjectSave(env, { brandSlug: "won-gi", kind: "product", title: "Pop Barley", url: "https://b.example/p" });
  const b = await batch.batchCreate(env, { brandSlug: "won-gi", subjectId: subject.id, label: "W45" });
  // A published pack holds the ad names in its content (see packPublish).
  raw.prepare("INSERT INTO packs (id, batch_id, version, token_hash, title, content, created_at) VALUES ('p1', ?, 1, 'h', 't', ?, 'n')")
    .run(b.id, JSON.stringify({ brand: "WonGi", ads: [{ name: TOF }, { name: BOF }] }));
  return { env, raw };
}
const run = async (env: Env, name: string, args: unknown) => {
  const t = TOOLS.find((x) => x.name === name)!;
  const c = (await t.run(env, validate(t.inputSchema, args))).content[0]!;
  return JSON.parse(c.type === "text" ? c.text : "{}");
};
const save = (env: Env, rows: unknown[], reportDate = "2026-11-06") => run(env, "results_save", { brand: "won-gi", reportDate, source: "client screenshot", rows });

describe("results ledger", () => {
  it("judges each ad against the baseline, and lists the winners", async () => {
    const { env } = await makeEnv();
    await run(env, "baseline_save", { brand: "won-gi", ctrPct: 1.2, source: "client screenshot, 30 days" });
    await save(env, [
      { adName: TOF, impressions: 5000, clicks: 100, spendSgd: 40 }, // 2.00 percent
      { adName: BOF, impressions: 4000, clicks: 20 }, // 0.50 percent
    ]);
    const g = await run(env, "results_get", { brand: "won-gi" });
    expect(g.baseline.ctrPct).toBe(1.2);
    expect(g.winners).toEqual([TOF]);
    expect(g.belowBaseline).toEqual([BOF]);
    expect(g.ads.find((a: { adName: string }) => a.adName === TOF)).toMatchObject({ stage: "tof", idea: 1, version: 1, ctrPct: 2, verdict: "winner", vsBaselinePct: 0.8, spendSgd: 40 });
  });

  it("says too early under the impression floor, and no baseline when none is saved", async () => {
    const { env } = await makeEnv();
    await save(env, [{ adName: TOF, impressions: 400, clicks: 40 }]);
    expect((await run(env, "results_get", { brand: "won-gi" })).ads[0].verdict).toBe("no baseline");
    await run(env, "baseline_save", { brand: "won-gi", ctrPct: 1, source: "screenshot" });
    const g = await run(env, "results_get", { brand: "won-gi" });
    expect(g.ads[0].verdict).toBe("too early");
    expect(g.winners).toEqual([]);
    expect((await run(env, "results_get", { brand: "won-gi", minImpressions: 300 })).ads[0].verdict).toBe("winner");
  });

  it("keeps the newest baseline and the latest report per ad", async () => {
    const { env } = await makeEnv();
    await run(env, "baseline_save", { brand: "won-gi", ctrPct: 3, source: "old" });
    await run(env, "baseline_save", { brand: "won-gi", ctrPct: 1, source: "new" });
    await save(env, [{ adName: TOF, impressions: 1000, clicks: 50 }], "2026-11-03");
    await save(env, [{ adName: TOF, impressions: 3000, clicks: 90 }], "2026-11-06");
    const g = await run(env, "results_get", { brand: "won-gi" });
    expect(g.baseline).toMatchObject({ ctrPct: 1, source: "new" });
    expect(g.ads).toHaveLength(1);
    expect(g.ads[0]).toMatchObject({ reportDate: "2026-11-06", impressions: 3000, verdict: "winner" });
  });

  it("replaces a row when the same ad and date are saved again", async () => {
    const { env, raw } = await makeEnv();
    await save(env, [{ adName: TOF, impressions: 1000, clicks: 10 }]);
    await save(env, [{ adName: TOF, impressions: 1000, clicks: 12 }]);
    expect(raw.prepare("SELECT clicks FROM results").all()).toEqual([{ clicks: 12 }]);
  });

  it("saves nothing when one row is bad", async () => {
    const { env, raw } = await makeEnv();
    const bad = (row: unknown, re: RegExp) => expect(save(env, [{ adName: TOF, impressions: 1000, clicks: 10 }, row])).rejects.toThrow(re);
    await bad({ adName: "a11_W45_wongi_b01_mof_c03_v1", impressions: 10, clicks: 1 }, /not in any published pack/);
    await bad({ adName: "a11_W45_otherco_b01_tof_c01_v1", impressions: 10, clicks: 1 }, /not an ad of won-gi/);
    await bad({ adName: BOF, impressions: 10, clicks: 11 }, /more than impressions/);
    await bad({ adName: TOF, impressions: 10, clicks: 1 }, /twice/);
    await expect(save(env, [{ adName: TOF, impressions: 10, clicks: 1 }], "2999-01-01")).rejects.toThrow(/future/);
    await expect(save(env, [{ adName: TOF, impressions: 10, clicks: 1 }], "2026-02-31")).rejects.toThrow(/real date/);
    await expect(save(env, [{ adName: TOF, impressions: 10, clicks: 1 }], "2026-13-45")).rejects.toThrow(/real date/);
    expect((raw.prepare("SELECT COUNT(*) AS n FROM results").get() as { n: number }).n).toBe(0);
  });

  it("refuses bad input at the schema, and an unknown brand", async () => {
    const { env } = await makeEnv();
    const t = TOOLS.find((x) => x.name === "results_save")!;
    expect(() => validate(t.inputSchema, { brand: "won-gi", reportDate: "6 Nov", source: "s", rows: [{ adName: TOF, impressions: 1, clicks: 1 }] })).toThrow();
    expect(() => validate(t.inputSchema, { brand: "won-gi", reportDate: "2026-11-06", source: "s", rows: [{ adName: "my ad", impressions: 1, clicks: 1 }] })).toThrow();
    expect(() => validate(t.inputSchema, { brand: "won-gi", reportDate: "2026-11-06", source: "s", rows: [{ adName: TOF, impressions: 1.5, clicks: 1 }] })).toThrow();
    expect(() => validate(TOOLS.find((x) => x.name === "baseline_save")!.inputSchema, { brand: "won-gi", ctrPct: 0, source: "s" })).toThrow();
    expect(() => validate(TOOLS.find((x) => x.name === "baseline_save")!.inputSchema, { brand: "won-gi", ctrPct: "1.2", source: "s" })).toThrow();
    await expect(run(env, "results_get", { brand: "nope-co" })).rejects.toThrow(/No brand/);
  });

  it("has a results prompt that points to the three tools", () => {
    const p = PROMPTS.find((x) => x.name === "results")!;
    const text = p.text({ brand: "won-gi", reportDate: "2026-11-06" });
    for (const w of ["baseline_save", "results_save", "results_get", "30/50/20", "Never send"]) expect(text).toContain(w);
  });
});
