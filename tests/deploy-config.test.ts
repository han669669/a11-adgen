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
  it("keeps the plain values that are set outside the file", () => {
    // Without keep_vars a deploy deletes a value the owner set in the dashboard.
    expect(config.keep_vars).toBe(true);
  });

  it("stops a deploy when a paid-call secret or the admin token hash is missing", () => {
    expect(config.secrets.required).toEqual(expect.arrayContaining(["FAL_KEY", "EXA_API_KEY", "MCP_TOKEN_SHA256"]));
  });

  it("keeps no invocation logs, because they keep the pack-link token from the URL path", () => {
    expect(config.observability).toEqual({ enabled: true, logs: { invocation_logs: false } });
  });

  it("keeps public per-version URLs off", () => {
    // A deploy turns them on when the line is missing.
    expect(config.preview_urls).toBe(false);
  });

  it("does not put a secret value or a hash in the file", () => {
    // The names may appear in comments and in secrets.required, never as a var. A 64-hex hash must not appear anywhere, comments included.
    expect(Object.keys(config.vars)).not.toEqual(expect.arrayContaining(["MCP_TOKEN_SHA256"]));
    expect(JSON.stringify({ ...config, secrets: undefined })).not.toMatch(/MCP_TOKEN_SHA256|SIGNUP_CODE_SHA256/);
    expect(readFileSync(new URL("../wrangler.jsonc", import.meta.url), "utf8")).not.toMatch(/[0-9a-f]{64}/i);
  });
});
