import { describe, expect, it } from "vitest";
import type { Env } from "../worker/env";
import entry from "../worker/entry";
import { fakeD1 } from "./helpers/d1";

// Plain HTTP on the public address: a script that sends a bearer token or opens a client link there must get no answer from the app.
const HOST = "a11adgen.gamingcomputing.workers.dev";
const HSTS = "max-age=31536000; includeSubDomains";
const env = { DB: fakeD1(), PUBLIC_BASE_URL: `https://${HOST}` } as unknown as Env;
const ctx = { waitUntil() {}, passThroughOnException() {} } as unknown as ExecutionContext;
const go = (url: string, init: RequestInit = {}) => entry.fetch(new Request(url, init), env, ctx);

describe("plain HTTP on the public address", () => {
  it.each(["GET", "HEAD"])("redirects %s to HTTPS, with the same path and query", async (method) => {
    const r = await go(`http://${HOST}/api/me?x=1`, { method });
    expect(r.status).toBe(301);
    expect(r.headers.get("location")).toBe(`https://${HOST}/api/me?x=1`);
  });

  it.each([
    ["POST", "/mcp"],
    ["PUT", "/admin/app/index.html"],
    ["DELETE", "/api/session"],
  ])("refuses %s %s before the app reads the request", async (method, path) => {
    const r = await go(`http://${HOST}${path}`, { method, headers: { Authorization: "Bearer not-a-real-token" }, body: method === "DELETE" ? undefined : "{}" });
    expect(r.status).toBe(403);
    expect(await r.text()).toBe("HTTPS required.");
    expect(r.headers.get("www-authenticate")).toBeNull(); // the OAuth layer did not answer
  });
});

describe("Strict-Transport-Security", () => {
  it.each(["/api/me", "/mcp", "/icon.svg", "/oauth/register"])("is on the HTTPS answer for %s", async (path) => {
    const r = await go(`https://${HOST}${path}`);
    expect(r.headers.get("strict-transport-security")).toBe(HSTS);
  });

  it("is on an answer that stops before the OAuth layer", async () => {
    const r = await go(`https://${HOST}/oauth/register`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ client_name: "x".repeat(9000) }) });
    expect(r.status).toBe(413);
    expect(r.headers.get("strict-transport-security")).toBe(HSTS);
  });

  it("keeps the status, the headers and the body of the answer", async () => {
    const r = await go(`https://${HOST}/icon.svg`);
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toBe("image/svg+xml");
    expect(await r.text()).toContain("<svg");
  });
});

describe("local development", () => {
  it.each(["http://localhost:8787", "http://127.0.0.1:8787", "http://[::1]:8787", "https://localhost:8787"])("serves %s as before, without the header", async (origin) => {
    const r = await go(`${origin}/api/me`);
    expect(r.status).toBe(401);
    expect(r.headers.get("strict-transport-security")).toBeNull();
  });
});
