import { describe, expect, it } from "vitest";
import type { Env } from "../worker/env";
import { handleMcp, TOOLS } from "../worker/mcp";
import { validate } from "../worker/schema";

const env = {} as Env;
const post = (body: unknown) =>
  handleMcp(new Request("https://x/mcp", { method: "POST", body: JSON.stringify(body) }), env);

describe("mcp handler", () => {
  it("answers initialize with a supported version", async () => {
    const r = await post({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2099-01-01" } });
    const j: any = await r.json();
    expect(j.result.protocolVersion).toBe("2025-06-18");
    expect(j.result.capabilities.tools).toBeDefined();
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
    expect(list.result.prompts.map((p: any) => p.name)).toEqual(["brand", "batch", "final", "learn", "gold-test"]);
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
  it("names only tools that exist in every prompt", async () => {
    const { PROMPTS } = await import("../worker/prompts");
    const known = new Set(TOOLS.map((t) => t.name));
    const used = new Set<string>();
    for (const p of PROMPTS) for (const m of p.text({ url: "u", slug: "s", brand: "b", batchId: "", note: "n" }).matchAll(/\b([a-z]+_[a-z_]+)\b/g)) used.add(m[1]!);
    expect(used.size).toBeGreaterThan(10);
    expect([...used].filter((n) => !known.has(n))).toEqual([]);
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
