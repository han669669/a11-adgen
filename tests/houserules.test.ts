import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { Env } from "../worker/env";
import { CHECK_SCHEMA } from "../worker/checks";
import { copyWarnings, wordCount } from "../worker/copycheck";
import { CHECK_CODES, HOUSE_RULES, houseRules, RULE_ROLES, RULES_GATED, RULES_VERSION, rulesGate } from "../worker/houserules";
import { handleMcp, INSTRUCTIONS, TOOLS } from "../worker/mcp";
import { PROMPTS } from "../worker/prompts";
import { seeded } from "./helpers/engine3";

/** The owner's house rules reach every MCP client (rules_get), not only plugin sessions (issue 144: Cursor loads no plugin agent files). */

const call = (env: Env, name: string, args: unknown) =>
  handleMcp(
    new Request("https://x/mcp", { method: "POST", body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }) }),
    env,
    { client: "test" },
  ).then(async (r) => ((await r.json()) as any).result as { isError?: boolean; content: { text: string }[] });

describe("house rules", () => {
  it("has every section, a stable version and the same version for each role", () => {
    for (const k of ["OW", "CO", "CP", "TY", "PR", "LI", "FO", "ST", "RE", "CH"]) expect(HOUSE_RULES).toContain(`## ${k}. `);
    expect(RULES_VERSION).toMatch(/^[0-9a-f]{8}$/);
    for (const role of RULE_ROLES) expect(houseRules(role).rulesVersion).toBe(RULES_VERSION);
    expect(houseRules().rules).toBe(HOUSE_RULES);
  });
  it("gives each role its sections, and the defect list to every role", () => {
    const writer = houseRules("writer").rules;
    expect(writer).toContain("## CP. Copy");
    expect(writer).toContain("## FO. Food");
    expect(writer).not.toContain("## TY. ");
    expect(writer).not.toContain("## RE. ");
    expect(writer).toContain("- D2: ");
    expect(houseRules("art-director").rules).toContain("## TY. Type, logo and breathing space");
    expect(houseRules("art-director").rules).not.toContain("## CP. Copy");
  });
  it("keeps the defect codes equal in the rules, checks_save and the render checklist", () => {
    const codes = CHECK_CODES.map(([c]) => c);
    expect(codes).toEqual([...Array.from({ length: 11 }, (_, i) => `D${i + 1}`), ...Array.from({ length: 8 }, (_, i) => `F${i + 1}`)]);
    const pattern = new RegExp((CHECK_SCHEMA.properties.items as any).items.properties.code.pattern);
    for (const c of codes) expect(pattern.test(c)).toBe(true);
    for (const c of ["D0", "D12", "F0", "F9"]) expect(pattern.test(c)).toBe(false);
    const checklist = readFileSync(new URL("../docs/render-checklist.md", import.meta.url), "utf8");
    for (const c of codes) expect(checklist).toContain(`| ${c} | **`);
  });
  it("is named first in the server instructions, the prompts and every plugin agent", () => {
    expect(INSTRUCTIONS.startsWith("FIRST, before any creative step: call rules_get")).toBe(true);
    for (const p of PROMPTS) expect(p.text({ brand: "b", batchId: "x", url: "https://e.example", slug: "b", note: "n", reportDate: "2026-11-21", adImageUrls: "https://e.example/a.png", title: "t", label: "W47" })).toContain("First call rules_get");
    for (const a of ["writer", "critic", "art-director"]) {
      const md = readFileSync(new URL(`../plugin/agents/${a}.md`, import.meta.url), "utf8");
      expect(md).toMatch(/^tools: .*mcp__a11__rules_get/m);
      expect(md).toContain(`\`rules_get\` with role \`${a}\``);
    }
  });
});

describe("the rulesVersion gate", () => {
  it("adds rulesVersion to each gated tool and to no other", () => {
    for (const t of TOOLS) expect("rulesVersion" in t.inputSchema.properties).toBe(RULES_GATED.has(t.name));
    for (const t of TOOLS) expect(t.inputSchema.required?.includes("rulesVersion") ?? false).toBe(RULES_GATED.has(t.name));
    expect([...RULES_GATED].every((n) => TOOLS.some((t) => t.name === n))).toBe(true);
  });
  it("says what to do when the version is missing or old", () => {
    expect(rulesGate("render_submit", {})).toMatch(/needs rulesVersion\. Call rules_get first/);
    expect(rulesGate("render_submit", { rulesVersion: "00000000" })).toMatch(/house rules changed since you read them/);
    expect(rulesGate("render_submit", { rulesVersion: RULES_VERSION })).toBeNull();
    expect(rulesGate("batch_get", {})).toBeNull();
  });
  it("refuses a gated call through the MCP handler, then runs it with the version from rules_get", async () => {
    const { env, e2 } = await seeded();
    const ideas = [{ format: "tof", insight: "Bought for breakfast.", visual: "A pouch.", headline: "Gone." }];
    const refused = await call(env, "ideas_save", { batchId: e2, ideas });
    expect(refused.isError).toBe(true);
    expect(refused.content[0]!.text).toContain("Call rules_get first");
    const rules = JSON.parse((await call(env, "rules_get", { role: "writer" })).content[0]!.text);
    expect(rules).toMatchObject({ rulesVersion: RULES_VERSION, role: "writer" });
    const ok = await call(env, "ideas_save", { batchId: e2, ideas, rulesVersion: rules.rulesVersion });
    expect(ok.isError).toBeUndefined();
    expect(JSON.parse(ok.content[0]!.text)).toMatchObject({ ideas: [{ headline: "Gone." }], warnings: [] });
  });
});

describe("copy warnings", () => {
  const at = new Date("2026-11-21T02:00:00Z");
  it("counts words, not marks", () => {
    expect(wordCount("10 flavours for S$58.90.")).toBe(4);
    expect(wordCount("Under S$6 a slice - so worth it.")).toBe(7);
  });
  it("warns over the copy guide, never on lines inside it", () => {
    const ok = { format: "mof", headline: "Can't pick a flavour?", copy: { subline: "Good thing you get all 10." } };
    expect(copyWarnings([ok], at)).toEqual([]);
    const long = { format: "mof", headline: "Remember queueing for this? The one that started it all.", copy: { subline: "still good, still original, still IRVINS." } };
    expect(copyWarnings([long], at)).toEqual([expect.stringContaining("ideas[0]: the headline has 10 words")]);
    const total = { format: "mof", headline: "Why your favorite café switched to OATSIDE.", copy: { subline: "Because it keeps your coffee pure and creamy." } };
    expect(copyWarnings([total], at)).toEqual([expect.stringContaining("15 words together")]);
  });
  it("warns on a price on a top-of-funnel line and on a past year", () => {
    expect(copyWarnings([{ format: "tof", headline: "10 flavours for S$58.90.", copy: { subline: "Free delivery." } }], at)).toEqual([expect.stringContaining("names a price or an offer")]);
    expect(copyWarnings([{ format: "bof", headline: "10 flavours for S$58.90.", copy: {} }], at)).toEqual([]);
    expect(copyWarnings([{ format: "mof", headline: "Winner of the 2024 awards.", copy: { subline: "Still the best in 2026." } }], at)).toEqual([expect.stringContaining("name 2024; an old year")]);
  });
});
