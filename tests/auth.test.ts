import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { Env } from "../worker/env";
import worker from "../worker/index";

const TOKEN = "test-token-1234";
const env = { MCP_TOKEN_SHA256: createHash("sha256").update(TOKEN).digest("hex") } as Env;
const list = (auth?: string) =>
  worker.fetch(
    new Request("https://x/mcp", {
      method: "POST",
      headers: auth ? { Authorization: auth } : {},
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    }),
    env,
  );

describe("/mcp bearer gate", () => {
  it("refuses a missing token", async () => expect((await list()).status).toBe(401));
  it("refuses a wrong token", async () => expect((await list("Bearer nope")).status).toBe(401));
  it("accepts the right token", async () => expect((await list(`Bearer ${TOKEN}`)).status).toBe(200));
  it("refuses everything when the hash is not set", async () => {
    const r = await worker.fetch(new Request("https://x/mcp", { method: "POST", headers: { Authorization: `Bearer ${TOKEN}` } }), {} as Env);
    expect(r.status).toBe(401);
  });
});
