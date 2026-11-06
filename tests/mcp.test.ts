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
