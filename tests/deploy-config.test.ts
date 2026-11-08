import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// wrangler.jsonc allows // comment lines. Strip them, then read it as JSON.
const config = JSON.parse(
  readFileSync(new URL("../wrangler.jsonc", import.meta.url), "utf8")
    .split("\n")
    .filter((line) => !/^\s*\/\//.test(line))
    .join("\n"),
);

describe("wrangler.jsonc keeps the live Worker safe on every deploy", () => {
  it("keeps the values that are set outside the file", () => {
    // MCP_TOKEN_SHA256 and SIGNUP_CODE_SHA256 live only on the Worker. Without keep_vars a deploy deletes them.
    expect(config.keep_vars).toBe(true);
  });

  it("stops a deploy when a paid-call secret is missing", () => {
    expect(config.secrets.required).toEqual(expect.arrayContaining(["FAL_KEY", "EXA_API_KEY"]));
  });

  it("keeps public per-version URLs off", () => {
    // A deploy turns them on when the line is missing.
    expect(config.preview_urls).toBe(false);
  });

  it("does not put a secret value or a hash in the file", () => {
    // The names may appear in comments, but never as a key or value. A 64-hex hash must not appear anywhere, comments included.
    expect(JSON.stringify(config)).not.toMatch(/MCP_TOKEN_SHA256|SIGNUP_CODE_SHA256/);
    expect(readFileSync(new URL("../wrangler.jsonc", import.meta.url), "utf8")).not.toMatch(/[0-9a-f]{64}/i);
  });
});
