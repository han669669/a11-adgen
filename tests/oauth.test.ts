import { createHash, randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { hashPassword } from "../worker/auth";
import type { Env } from "../worker/env";
import entry from "../worker/entry";
import { REGISTER_MAX_PER_HOUR } from "../worker/auth";
import { REGISTRATION_MAX_BYTES, safeNext } from "../worker/oauth";
import { fakeD1 } from "./helpers/d1";

const ORIGIN = "https://a11adgen.gamingcomputing.workers.dev";
const RESOURCE = `${ORIGIN}/mcp`;
const BEARER = "static-bearer-1234";
const EMAIL = "owner@a11.example";
const PASSWORD = "correct horse battery staple";
const REDIRECT = "https://client.example/callback";

/** A small in-memory KV, enough for the OAuth library. */
function fakeKV(): KVNamespace {
  const m = new Map<string, string>();
  return {
    get: async (k: string, o?: unknown) => {
      const v = m.get(k);
      if (v === undefined) return null;
      const type = typeof o === "string" ? o : (o as { type?: string } | undefined)?.type;
      return type === "json" ? JSON.parse(v) : v;
    },
    put: async (k: string, v: string) => void m.set(k, v),
    delete: async (k: string) => void m.delete(k),
    list: async (o?: { prefix?: string }) => ({ keys: [...m.keys()].filter((k) => k.startsWith(o?.prefix ?? "")).map((name) => ({ name })), list_complete: true, cursor: "" }),
  } as unknown as KVNamespace;
}

async function makeEnv() {
  const env = {
    DB: fakeD1(),
    OAUTH_KV: fakeKV(),
    MCP_TOKEN_SHA256: createHash("sha256").update(BEARER).digest("hex"),
    ALLOWED_EMAILS: EMAIL,
    PUBLIC_BASE_URL: ORIGIN,
    SPEND_CAP_USD: "5",
  } as unknown as Env;
  await env.DB.prepare("INSERT INTO users (email, pw_hash, created_at) VALUES (?, ?, ?)").bind(EMAIL, await hashPassword(PASSWORD), new Date().toISOString()).run();
  return env;
}

const ctx = { waitUntil() {}, passThroughOnException() {} } as unknown as ExecutionContext;
const go = (env: Env, path: string, init: RequestInit = {}) => entry.fetch(new Request(`${ORIGIN}${path}`, init), env, ctx);
const mcp = (env: Env, auth?: string) =>
  go(env, "/mcp", { method: "POST", headers: { "content-type": "application/json", ...(auth ? { Authorization: auth } : {}) }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }) });
const form = (o: Record<string, string>) => new URLSearchParams(o).toString();
const FORM = { "content-type": "application/x-www-form-urlencoded" };
const cookiesOf = (r: Response) => r.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");

async function register(env: Env, name = "Test App") {
  const r = await go(env, "/oauth/register", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ client_name: name, redirect_uris: [REDIRECT], token_endpoint_auth_method: "none", grant_types: ["authorization_code", "refresh_token"], response_types: ["code"] }),
  });
  expect(r.status).toBe(201);
  return ((await r.json()) as { client_id: string }).client_id;
}

const pkce = () => {
  const verifier = randomBytes(32).toString("base64url");
  return { verifier, challenge: createHash("sha256").update(verifier).digest("base64url") };
};
const authorizeUrl = (clientId: string, challenge: string, state = "st4te") =>
  `/authorize?${form({ response_type: "code", client_id: clientId, redirect_uri: REDIRECT, scope: "a11", state, code_challenge: challenge, code_challenge_method: "S256", resource: RESOURCE })}`;

async function signIn(env: Env, next: string) {
  const r = await go(env, "/authorize/signin", { method: "POST", headers: FORM, body: form({ email: EMAIL, password: PASSWORD, next }) });
  expect(r.status).toBe(303);
  expect(r.headers.get("location")).toBe(next);
  return cookiesOf(r);
}

/** The whole flow up to the code. Returns the access and refresh tokens. */
async function fullLogin(env: Env) {
  const clientId = await register(env);
  const { verifier, challenge } = pkce();
  const url = authorizeUrl(clientId, challenge);
  const session = await signIn(env, url);
  const page = await go(env, url, { headers: { cookie: session } });
  expect(page.status).toBe(200);
  const html = await page.text();
  const handle = /name="handle" value="([^"]+)"/.exec(html)![1]!;
  const consentCookies = cookiesOf(page);
  const approved = await go(env, "/authorize", { method: "POST", headers: { ...FORM, cookie: `${session}; ${consentCookies}` }, body: form({ handle, decision: "approve" }) });
  expect(approved.status).toBe(302);
  const loc = new URL(approved.headers.get("location")!);
  expect(loc.origin + loc.pathname).toBe(REDIRECT);
  expect(loc.searchParams.get("state")).toBe("st4te");
  const code = loc.searchParams.get("code")!;
  const tok = await go(env, "/oauth/token", {
    method: "POST",
    headers: FORM,
    body: form({ grant_type: "authorization_code", code, redirect_uri: REDIRECT, client_id: clientId, code_verifier: verifier, resource: RESOURCE }),
  });
  expect(tok.status).toBe(200);
  const body = (await tok.json()) as { access_token: string; refresh_token: string; scope?: string };
  return { ...body, clientId, session };
}

describe("MCP OAuth login", () => {
  it("answers an unauthenticated /mcp call with a challenge that points at the resource metadata", async () => {
    const r = await mcp(await makeEnv());
    expect(r.status).toBe(401);
    expect(r.headers.get("www-authenticate")).toContain("resource_metadata=");
  });

  it("still accepts the Phase 0 bearer token and refuses a wrong one", async () => {
    const env = await makeEnv();
    expect((await mcp(env, `Bearer ${BEARER}`)).status).toBe(200);
    expect((await mcp(env, "Bearer wrong")).status).toBe(401);
  });

  it("publishes discovery documents and lets a client register itself", async () => {
    const env = await makeEnv();
    const meta = await go(env, "/.well-known/oauth-authorization-server");
    expect(meta.status).toBe(200);
    const m = (await meta.json()) as { registration_endpoint: string; code_challenge_methods_supported: string[] };
    expect(m.registration_endpoint).toBe(`${ORIGIN}/oauth/register`);
    expect(m.code_challenge_methods_supported).toContain("S256");
    expect((await go(env, "/.well-known/oauth-protected-resource/mcp")).status).toBe(200);
    expect(await register(env)).toMatch(/\S/);
  });

  it("shows a sign-in form to a signed-out browser and refuses a wrong password", async () => {
    const env = await makeEnv();
    const { challenge } = pkce();
    const url = authorizeUrl(await register(env), challenge);
    const page = await go(env, url);
    expect(page.status).toBe(200);
    expect(await page.text()).toContain('action="/authorize/signin"');
    expect(page.headers.get("x-frame-options")).toBe("DENY");
    const bad = await go(env, "/authorize/signin", { method: "POST", headers: FORM, body: form({ email: EMAIL, password: "wrong wrong wrong", next: url }) });
    expect(bad.status).toBe(401);
  });

  it("reports a sign-in lock-out as 429, not as a wrong password", async () => {
    const env = await makeEnv();
    const bad = () => go(env, "/authorize/signin", { method: "POST", headers: FORM, body: form({ email: EMAIL, password: "wrong wrong wrong", next: "/authorize" }) });
    for (let i = 0; i < 5; i++) await bad();
    expect((await bad()).status).toBe(429);
  });

  it("does not sign in an email that is not on the allow-list", async () => {
    const env = await makeEnv();
    env.ALLOWED_EMAILS = "someone-else@a11.example";
    const r = await go(env, "/authorize/signin", { method: "POST", headers: FORM, body: form({ email: EMAIL, password: PASSWORD, next: "/authorize" }) });
    expect(r.status).toBe(401);
  });

  it("escapes the app's name on the consent page", async () => {
    const env = await makeEnv();
    const clientId = await register(env, `<script>alert(1)</script>"x`);
    const { challenge } = pkce();
    const url = authorizeUrl(clientId, challenge);
    const html = await (await go(env, url, { headers: { cookie: await signIn(env, url) } })).text();
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&#60;script&#62;");
    expect(html).toContain("client.example");
  });

  it("runs the whole flow: sign in, consent, code, token, then /mcp works", async () => {
    const env = await makeEnv();
    const { access_token, refresh_token } = await fullLogin(env);
    expect(refresh_token).toMatch(/\S/);
    const r = await mcp(env, `Bearer ${access_token}`);
    expect(r.status).toBe(200);
    expect(((await r.json()) as { result: { tools: unknown[] } }).result.tools.length).toBeGreaterThan(10);
  });

  it("stops a token the moment the email leaves the allow-list", async () => {
    const env = await makeEnv();
    const { access_token } = await fullLogin(env);
    env.ALLOWED_EMAILS = "someone-else@a11.example";
    expect((await mcp(env, `Bearer ${access_token}`)).status).toBe(403);
  });

  it("refuses a wrong PKCE verifier", async () => {
    const env = await makeEnv();
    const clientId = await register(env);
    const { challenge } = pkce();
    const url = authorizeUrl(clientId, challenge);
    const session = await signIn(env, url);
    const page = await go(env, url, { headers: { cookie: session } });
    const handle = /name="handle" value="([^"]+)"/.exec(await page.text())![1]!;
    const approved = await go(env, "/authorize", { method: "POST", headers: { ...FORM, cookie: `${session}; ${cookiesOf(page)}` }, body: form({ handle, decision: "approve" }) });
    const code = new URL(approved.headers.get("location")!).searchParams.get("code")!;
    const bad = await go(env, "/oauth/token", { method: "POST", headers: FORM, body: form({ grant_type: "authorization_code", code, redirect_uri: REDIRECT, client_id: clientId, code_verifier: "x".repeat(50), resource: RESOURCE }) });
    expect(bad.status).toBe(400);
  });

  it("refuses a code that was already used", async () => {
    const env = await makeEnv();
    const clientId = await register(env);
    const { verifier, challenge } = pkce();
    const url = authorizeUrl(clientId, challenge);
    const session = await signIn(env, url);
    const page = await go(env, url, { headers: { cookie: session } });
    const handle = /name="handle" value="([^"]+)"/.exec(await page.text())![1]!;
    const approved = await go(env, "/authorize", { method: "POST", headers: { ...FORM, cookie: `${session}; ${cookiesOf(page)}` }, body: form({ handle, decision: "approve" }) });
    const code = new URL(approved.headers.get("location")!).searchParams.get("code")!;
    const redeem = () => go(env, "/oauth/token", { method: "POST", headers: FORM, body: form({ grant_type: "authorization_code", code, redirect_uri: REDIRECT, client_id: clientId, code_verifier: verifier, resource: RESOURCE }) });
    expect((await redeem()).status).toBe(200);
    expect((await redeem()).status).toBe(400);
  });

  it("refreshes a token, states the lifetime, and refuses a made-up refresh token", async () => {
    const env = await makeEnv();
    const first = await fullLogin(env);
    const refresh = (token: string) => go(env, "/oauth/token", { method: "POST", headers: FORM, body: form({ grant_type: "refresh_token", refresh_token: token, client_id: first.clientId }) });
    const r = await refresh(first.refresh_token);
    expect(r.status).toBe(200);
    const next = (await r.json()) as { access_token: string; expires_in: number };
    expect(next.expires_in).toBeGreaterThan(0);
    expect(next.expires_in).toBeLessThanOrEqual(3600);
    expect((await mcp(env, `Bearer ${next.access_token}`)).status).toBe(200);
    expect((await refresh("not-a-real-refresh-token")).status).toBe(400);
  });

  it("sends the client access_denied when the owner clicks Deny", async () => {
    const env = await makeEnv();
    const clientId = await register(env);
    const { challenge } = pkce();
    const url = authorizeUrl(clientId, challenge);
    const session = await signIn(env, url);
    const page = await go(env, url, { headers: { cookie: session } });
    const handle = /name="handle" value="([^"]+)"/.exec(await page.text())![1]!;
    const denied = await go(env, "/authorize", { method: "POST", headers: { ...FORM, cookie: `${session}; ${cookiesOf(page)}` }, body: form({ handle, decision: "deny" }) });
    expect(denied.status).toBe(302);
    expect(new URL(denied.headers.get("location")!).searchParams.get("error")).toBe("access_denied");
  });

  it("refuses the consent POST when signed out", async () => {
    const env = await makeEnv();
    const r = await go(env, "/authorize", { method: "POST", headers: FORM, body: form({ handle: "x", decision: "approve" }) });
    expect(r.status).toBe(401);
  });

  it("never redirects to an unregistered redirect URI", async () => {
    const env = await makeEnv();
    const clientId = await register(env);
    const { challenge } = pkce();
    const url = authorizeUrl(clientId, challenge).replace(encodeURIComponent(REDIRECT), encodeURIComponent("https://evil.example/cb"));
    const r = await go(env, url, { headers: { cookie: await signIn(env, "/authorize") } });
    expect(r.status).toBe(400);
    expect(r.headers.get("location")).toBeNull();
  });
});

describe("safeNext", () => {
  it("allows only a return to /authorize with its own query", () => {
    expect(safeNext("/authorize?client_id=1&state=a")).toBe("/authorize?client_id=1&state=a");
    const long = `/authorize?x=${"a".repeat(5000)}`;
    expect(safeNext(long)).toBe(long);
    for (const bad of ["https://evil.example", "//evil.example", "/api/me", "/authorize", "/authorize?\nx", "/authorize?a b", undefined, 5]) expect(safeNext(bad)).toBe("/authorize");
  });
});

describe("client registration size limit", () => {
  const post = (env: Env, body: string, headers: Record<string, string> = {}) =>
    go(env, "/oauth/register", { method: "POST", headers: { "content-type": "application/json", ...headers }, body });
  const meta = (name: string) => JSON.stringify({ client_name: name, redirect_uris: [REDIRECT], token_endpoint_auth_method: "none" });

  it("refuses a registration body over the limit and stores nothing", async () => {
    const env = await makeEnv();
    const r = await post(env, meta("x".repeat(REGISTRATION_MAX_BYTES + 1)));
    expect(r.status).toBe(413);
    expect(((await r.json()) as { error: string }).error).toBe("invalid_client_metadata");
    expect((await env.OAUTH_KV.list({ prefix: "client:" })).keys).toHaveLength(0);
  });

  it("refuses a declared size over the limit", async () => {
    const env = await makeEnv();
    const r = await post(env, meta("a"), { "content-length": String(REGISTRATION_MAX_BYTES + 1) });
    expect(r.status).toBe(413);
  });

  it("limits registrations per hour for the whole Worker, and stores nothing past the limit", async () => {
    const env = await makeEnv();
    for (let i = 0; i < REGISTER_MAX_PER_HOUR; i++) expect((await post(env, meta(`App ${i}`))).status).toBe(201);
    const r = await post(env, meta("One too many"));
    expect(r.status).toBe(429);
    expect(r.headers.get("retry-after")).toBe("3600");
    expect((await env.OAUTH_KV.list({ prefix: "client:" })).keys).toHaveLength(REGISTER_MAX_PER_HOUR);
  });

  it("does not spend a registration slot on a refused oversize body", async () => {
    const env = await makeEnv();
    for (let i = 0; i < 5; i++) expect((await post(env, meta("x".repeat(REGISTRATION_MAX_BYTES + 1)))).status).toBe(413);
    for (let i = 0; i < REGISTER_MAX_PER_HOUR; i++) expect((await post(env, meta(`App ${i}`))).status).toBe(201);
  });

  it("still registers a normal client", async () => {
    const env = await makeEnv();
    const r = await post(env, meta("Claude"));
    expect(r.status).toBe(201);
    expect((await env.OAUTH_KV.list({ prefix: "client:" })).keys).toHaveLength(1);
  });
});
