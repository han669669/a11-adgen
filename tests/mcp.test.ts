import { describe, expect, it } from "vitest";
import type { Env } from "../worker/env";
import { handleMcp, TOOLS } from "../worker/mcp";
import { validate } from "../worker/schema";

const env = { PUBLIC_BASE_URL: "https://x.example" } as Env;
const post = (body: unknown) =>
  handleMcp(new Request("https://x/mcp", { method: "POST", body: JSON.stringify(body) }), env);

describe("mcp handler", () => {
  it("answers initialize with a supported version", async () => {
    const r = await post({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2099-01-01" } });
    const j: any = await r.json();
    expect(j.result.protocolVersion).toBe("2025-11-25");
    expect(j.result.capabilities.tools).toBeDefined();
  });
  it("gives the connector icons only on protocol 2025-11-25", async () => {
    const ask = async (v: string) =>
      ((await (await post({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: v } })).json()) as any).result;
    const next = await ask("2025-11-25");
    expect(next.serverInfo.icons.map((i: any) => i.src)).toEqual(["https://x.example/icon.png", "https://x.example/icon.svg"]);
    const old = await ask("2025-06-18");
    expect(old.protocolVersion).toBe("2025-06-18");
    expect(old.serverInfo.icons).toBeUndefined();
  });
  it("returns 202 for a notification", async () => {
    const r = await post({ jsonrpc: "2.0", method: "notifications/initialized" });
    expect(r.status).toBe(202);
  });
  it("lists every tool", async () => {
    const j: any = await (await post({ jsonrpc: "2.0", id: 2, method: "tools/list" })).json();
    expect(j.result.tools.map((t: any) => t.name)).toEqual(TOOLS.map((t) => t.name));
  });
  it("refuses bad input as a tool error, not a crash", async () => {
    const j: any = await (await post({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "render_status", arguments: { id: "x" } } })).json();
    expect(j.result.isError).toBe(true);
    expect(j.result.content[0].text).toMatch(/Bad input/);
  });
  it("never answers or runs a tool for a notification", async () => {
    // No id: a paid tool must not run. env has no DB, so running it would throw.
    const r = await post({ jsonrpc: "2.0", method: "tools/call", params: { name: "spend_get", arguments: {} } });
    expect(r.status).toBe(202);
  });
  it("lists the prompts and returns one with its arguments filled in", async () => {
    const list: any = await (await post({ jsonrpc: "2.0", id: 4, method: "prompts/list" })).json();
    expect(list.result.prompts.map((p: any) => p.name)).toEqual(["brand", "batch", "redesign", "final", "pack", "learn", "results", "gold-test"]);
    const got: any = await (await post({ jsonrpc: "2.0", id: 5, method: "prompts/get", params: { name: "final", arguments: { batchId: "abc-123" } } })).json();
    expect(got.result.messages[0].content.text).toContain("Batch abc-123");
    expect(got.result.messages[0].role).toBe("user");
  });
  it("refuses an unknown prompt, a missing argument and a non-text argument as invalid params", async () => {
    for (const params of [{ name: "nope" }, { name: "final", arguments: {} }, { name: "final", arguments: { batchId: 5 } }]) {
      const j: any = await (await post({ jsonrpc: "2.0", id: 6, method: "prompts/get", params })).json();
      expect(j.error.code).toBe(-32602);
    }
  });
  it("starts a new batch only with a product and a label, and says how to save the subject", async () => {
    const get = async (args: unknown) => (await (await post({ jsonrpc: "2.0", id: 7, method: "prompts/get", params: { name: "batch", arguments: args } })).json()) as any;
    expect((await get({ brand: "wongi" })).error.message).toMatch(/needs productUrl, productTitle and label/);
    const ok = await get({ brand: "wongi", productUrl: "https://b.example/p", productTitle: "Pop Barley", label: "W47" });
    const text: string = ok.result.messages[0].content.text;
    expect(text).toMatch(/subject_save \(brandSlug wongi, kind 'product', title 'Pop Barley', url https:\/\/b\.example\/p\), then batch_create/);
    expect(text.indexOf("ideas_update")).toBeGreaterThan(0);
    expect(text.indexOf("finalPrompt")).toBeLessThan(text.indexOf("status 'board'"));
    const resume = await get({ brand: "wongi", batchId: "11111111-1111-1111-1111-111111111111" });
    expect(resume.result.messages[0].content.text).toContain("Resume batch 11111111");
  });
  it("handles an owner who passes on all 3 drafts before it makes any final", async () => {
    const j: any = await (await post({ jsonrpc: "2.0", id: 8, method: "prompts/get", params: { name: "final", arguments: { batchId: "abc" } } })).json();
    const text: string = j.result.messages[0].content.text;
    expect(text.indexOf("passed on all 3 drafts")).toBeLessThan(text.indexOf("picks_save"));
    expect(text).toContain("batch_update notes");
    expect(text).toContain("when food shows");
  });
  it("runs the gold test inline, in the full set, and never asks to run another prompt", async () => {
    const { PROMPTS } = await import("../worker/prompts");
    for (const name of ["learn", "gold-test"]) {
      const p = PROMPTS.find((x) => x.name === name)!;
      const text = p.text({ note: "before X" });
      expect(text).toContain("gold_get with limit 500");
      expect(text).toContain("ONE gold_score");
      expect(text).not.toMatch(/run \/mcp__a11__/);
    }
    const j: any = await (await post({ jsonrpc: "2.0", id: 9, method: "prompts/get", params: { name: "gold-test", arguments: { note: "x".repeat(201) } } })).json();
    expect(j.error.message).toMatch(/too long \(at most 200/);
  });
  it("names only tools that exist in every prompt", async () => {
    const { PROMPTS } = await import("../worker/prompts");
    const known = new Set(TOOLS.map((t) => t.name));
    const used = new Set<string>();
    for (const p of PROMPTS) for (const m of p.text({ url: "u", slug: "s", brand: "b", batchId: "", productUrl: "https://b.example/p", productTitle: "P", label: "W1", note: "n", adImageUrls: "https://a.example/1.png", title: "T" }).matchAll(/\b([a-z]+_[a-z_]+)\b/g)) used.add(m[1]!);
    expect(used.size).toBeGreaterThan(10);
    // Script names in the repo (scripts/<name>.py) are not tools.
    const scripts = new Set(["box_print"]);
    expect([...used].filter((n) => !known.has(n) && !scripts.has(n))).toEqual([]);
  });
  it("names only tools that exist in the plugin's subagents", async () => {
    const { readdirSync, readFileSync } = await import("node:fs");
    const dir = new URL("../plugin/agents/", import.meta.url);
    const known = new Set(TOOLS.map((t) => t.name));
    const files = readdirSync(dir).filter((f) => f.endsWith(".md"));
    expect(files.sort()).toEqual(["art-director.md", "critic.md", "writer.md"]);
    for (const f of files) {
      const names = [...readFileSync(new URL(f, dir), "utf8").matchAll(/mcp__a11__([a-z_]+)/g)].map((m) => m[1]!);
      expect(names.length).toBeGreaterThan(0);
      expect(names.filter((n) => !known.has(n))).toEqual([]);
    }
    // Every tool a subagent is told to call is in its tools line.
    const text = (f: string) => readFileSync(new URL(f, dir), "utf8");
    const toolsLine = (f: string) => text(f).match(/^tools: (.*)$/m)![1]!;
    for (const [f, tool] of [["critic.md", "drafts_rank"], ["critic.md", "taste_log"], ["critic.md", "gold_score"], ["writer.md", "batch_get"], ["art-director.md", "brand_get"]]) {
      expect(text(f!)).toContain(tool!);
      expect(toolsLine(f!)).toContain(`mcp__a11__${tool}`);
    }
  });
  it("prompt_get returns the same text as prompts/get, and refuses a missing argument", async () => {
    const call = async (args: unknown) =>
      ((await (await post({ jsonrpc: "2.0", id: 20, method: "tools/call", params: { name: "prompt_get", arguments: args } })).json()) as any).result;
    const viaPrompt: any = await (await post({ jsonrpc: "2.0", id: 21, method: "prompts/get", params: { name: "pack", arguments: { batchId: "b1" } } })).json();
    const viaTool = await call({ name: "pack", arguments: { batchId: "b1" } });
    expect(viaTool.isError).toBeUndefined();
    expect(viaTool.content[0].text).toBe(viaPrompt.result.messages[0].content.text);
    expect((await call({ name: "learn" })).content[0].text).toContain("canon_update");
    const missing = await call({ name: "final", arguments: {} });
    expect(missing.isError).toBe(true);
    expect(missing.content[0].text).toMatch(/Missing argument: batchId/);
    expect((await call({ name: "nope" })).isError).toBe(true);
  });
  it("has one plugin short command per prompt, and each runs its prompt through prompt_get", async () => {
    const { readdirSync, readFileSync } = await import("node:fs");
    const { PROMPTS } = await import("../worker/prompts");
    const dir = new URL("../plugin/commands/", import.meta.url);
    const files = readdirSync(dir).filter((f) => f.endsWith(".md"));
    expect(files.map((f) => f.replace(/\.md$/, "")).sort()).toEqual(PROMPTS.map((p) => p.name).sort());
    for (const p of PROMPTS) {
      const text = readFileSync(new URL(`${p.name}.md`, dir), "utf8");
      expect(text).toMatch(/^---\ndescription: ".+"\n/);
      expect(text).toContain(`\`prompt_get\` with name \`${p.name}\``);
      for (const a of p.arguments) expect(text).toContain(`- ${a.name}`);
    }
    // The prompts point the owner to the short commands, never to the /mcp__ names.
    for (const p of PROMPTS) expect(p.text({ url: "u", slug: "s", brand: "b", batchId: "", productUrl: "https://b.example/p", productTitle: "P", label: "W1", note: "n", adImageUrls: "https://a.example/1.png", title: "T" })).not.toContain("/mcp__");
  });
  it("refuses GET", async () => {
    const r = await handleMcp(new Request("https://x/mcp"), env);
    expect(r.status).toBe(405);
  });
});

describe("validate", () => {
  const schema = TOOLS.find((t) => t.name === "render_submit")!.inputSchema;
  const ok = { batch: "b", idea: "i", kind: "draft", prompt: "x".repeat(40), referenceUrls: ["https://a.b/c.png"] };
  it("fills defaults", () => expect(validate(schema, ok).numImages).toBe(3));
  it("rejects an unknown kind", () => expect(() => validate(schema, { ...ok, kind: "huge" })).toThrow());
  it("rejects a non-URL reference", () => expect(() => validate(schema, { ...ok, referenceUrls: ["file:///etc/passwd"] })).toThrow());
  it("rejects unknown arguments", () => expect(() => validate(schema, { ...ok, extra: 1 })).toThrow());
  it("rejects inherited names as arguments", () => expect(() => validate(schema, { ...ok, toString: "x" })).toThrow());
});
