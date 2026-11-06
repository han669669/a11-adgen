import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "../worker/auth";
import type { Env } from "../worker/env";
import worker from "../worker/index";
import { fakeD1 } from "./helpers/d1";

const ORIGIN = "https://a11.example";
const TOKEN = "stage-token-1234";
const CODE = "set-up-code-5678";

function makeEnv() {
  const files = new Map<string, { body: string; type: string }>();
  const MEDIA = {
    get: async (k: string) => {
      const f = files.get(k);
      return f ? { body: f.body, httpMetadata: { contentType: f.type } } : null;
    },
    put: async (k: string, v: ArrayBuffer, o: { httpMetadata: { contentType: string } }) =>
      void files.set(k, { body: new TextDecoder().decode(v), type: o.httpMetadata.contentType }),
  };
  const env = {
    DB: fakeD1(),
    MEDIA,
    ALLOWED_EMAILS: "Owner@a11.example, second@a11.example",
    SPEND_CAP_USD: "5.00",
    PUBLIC_BASE_URL: ORIGIN,
    MCP_TOKEN_SHA256: createHash("sha256").update(TOKEN).digest("hex"),
    SIGNUP_CODE_SHA256: createHash("sha256").update(CODE).digest("hex"),
  } as unknown as Env;
  return { env, files };
}

const call = (env: Env, path: string, init: { method?: string; body?: unknown; cookie?: string; origin?: string | null } = {}) => {
  const headers: Record<string, string> = {};
  if (init.body !== undefined) headers["content-type"] = "application/json";
  if (init.cookie) headers.cookie = init.cookie;
  if (init.origin !== null) headers.origin = init.origin ?? ORIGIN;
  return worker.fetch(
    new Request(`${ORIGIN}${path}`, {
      method: init.method ?? (init.body !== undefined ? "POST" : "GET"),
      headers,
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    }),
    env,
  );
};
const cookieOf = (r: Response) => (r.headers.get("set-cookie") ?? "").split(";")[0]!;

describe("passwords", () => {
  it("verifies the right password only", async () => {
    const h = await hashPassword("correct horse battery", 1000);
    expect(h).toMatch(/^pbkdf2-sha256\$1000\$/);
    expect(await verifyPassword("correct horse battery", h)).toBe(true);
    expect(await verifyPassword("wrong horse battery", h)).toBe(false);
  });
});

describe("web app accounts", () => {
  const good = { email: "owner@a11.example", password: "a long enough password" };
  const signupBody = { ...good, code: CODE };

  it("refuses an email that is not on the allow-list, with the same error as a wrong code", async () => {
    const { env } = makeEnv();
    const notListed = await call(env, "/api/signup", { body: { ...signupBody, email: "stranger@a11.example" } });
    const wrongCode = await call(env, "/api/signup", { body: { ...signupBody, code: "guess" } });
    expect(notListed.status).toBe(403);
    expect(wrongCode.status).toBe(403);
    expect(await notListed.json()).toEqual(await wrongCode.json());
  });

  it("refuses sign-up without the set-up code, or when no code is configured", async () => {
    const { env } = makeEnv();
    expect((await call(env, "/api/signup", { body: good })).status).toBe(403);
    (env as { SIGNUP_CODE_SHA256?: string }).SIGNUP_CODE_SHA256 = undefined;
    expect((await call(env, "/api/signup", { body: signupBody })).status).toBe(403);
  });

  it("limits sign-up tries, so the set-up code cannot be guessed", async () => {
    const { env } = makeEnv();
    for (let i = 0; i < 5; i++) expect((await call(env, "/api/signup", { body: { ...signupBody, code: `guess-${i}` } })).status).toBe(403);
    expect((await call(env, "/api/signup", { body: signupBody })).status).toBe(429);
  });

  it("refuses a short password", async () => {
    const { env } = makeEnv();
    expect((await call(env, "/api/signup", { body: { ...signupBody, password: "short" } })).status).toBe(400);
  });

  it("signs up, reads /api/me with the cookie, and signs out", async () => {
    const { env } = makeEnv();
    const r = await call(env, "/api/signup", { body: { ...signupBody, email: "OWNER@a11.example" } });
    expect(r.status).toBe(200);
    expect(r.headers.get("set-cookie")).toMatch(/HttpOnly; Secure; SameSite=Lax/);
    const cookie = cookieOf(r);
    expect(await (await call(env, "/api/me", { cookie })).json()).toEqual({ email: "owner@a11.example" });
    await call(env, "/api/logout", { body: {}, cookie });
    expect((await call(env, "/api/me", { cookie })).status).toBe(401);
  });

  it("refuses a second sign-up for the same email", async () => {
    const { env } = makeEnv();
    await call(env, "/api/signup", { body: signupBody });
    expect((await call(env, "/api/signup", { body: signupBody })).status).toBe(403);
  });

  it("locks sign-in after 5 wrong passwords, also when they arrive at once", async () => {
    const { env } = makeEnv();
    await call(env, "/api/signup", { body: signupBody });
    const tries = await Promise.all(
      Array.from({ length: 7 }, () => call(env, "/api/login", { body: { ...good, password: "wrong password!!" } })),
    );
    // At most 5 tries reach the password check; the rest are refused by the lock-out.
    expect(tries.filter((r) => r.status === 401).length).toBeLessThanOrEqual(5);
    expect(tries.filter((r) => r.status === 429).length).toBeGreaterThanOrEqual(2);
    expect((await call(env, "/api/login", { body: good })).status).toBe(429);
  });

  it("clears its own attempt on a good sign-in", async () => {
    const { env } = makeEnv();
    await call(env, "/api/signup", { body: signupBody });
    for (let i = 0; i < 6; i++) expect((await call(env, "/api/login", { body: good })).status).toBe(200);
  });

  it("refuses an over-long password before hashing it", async () => {
    const { env } = makeEnv();
    await call(env, "/api/signup", { body: signupBody });
    expect((await call(env, "/api/login", { body: { ...good, password: "x".repeat(201) } })).status).toBe(401);
  });

  it("drops access when the email leaves the allow-list", async () => {
    const { env } = makeEnv();
    const cookie = cookieOf(await call(env, "/api/signup", { body: signupBody }));
    (env as { ALLOWED_EMAILS: string }).ALLOWED_EMAILS = "second@a11.example";
    expect((await call(env, "/api/me", { cookie })).status).toBe(401);
  });

  it("refuses a cross-site POST and a non-JSON POST", async () => {
    const { env } = makeEnv();
    expect((await call(env, "/api/login", { body: good, origin: "https://evil.example" })).status).toBe(403);
    expect((await call(env, "/api/login", { body: good, origin: null })).status).toBe(403);
    const r = await worker.fetch(new Request(`${ORIGIN}/api/login`, { method: "POST", headers: { origin: ORIGIN }, body: "email=x" }), env);
    expect(r.status).toBe(415);
  });

  it("needs a session for batches and for the render step", async () => {
    const { env } = makeEnv();
    expect((await call(env, "/api/batches")).status).toBe(401);
    expect((await call(env, "/api/batches/11111111-1111-1111-1111-111111111111/render", { body: { picks: [] } })).status).toBe(401);
  });
});

describe("web app files", () => {
  const put = (env: Env, path: string, body: string, token = TOKEN) =>
    worker.fetch(
      new Request(`${ORIGIN}/admin/app/${path}`, {
        method: "PUT",
        headers: { Authorization: `Bearer ${token}`, "Content-Length": String(body.length) },
        body,
      }),
      env,
    );

  it("stages files with the token only, and refuses path tricks", async () => {
    const { env } = makeEnv();
    expect((await put(env, "index.html", "<html>", "nope")).status).toBe(401);
    // The URL parser removes "..", so such a path never reaches the staging route.
    expect((await put(env, "assets/../../x.js", "x")).status).toBe(404);
    expect((await put(env, "x%20y.js", "x")).status).toBe(400);
    expect((await put(env, "index.html", "<html>")).status).toBe(200);
  });

  it("serves a file, falls back to index.html for app routes, and sets the CSP on the page", async () => {
    const { env } = makeEnv();
    await put(env, "index.html", "<html>app</html>");
    await put(env, "assets/index-abc.js", "console.log(1)");
    const js = await call(env, "/assets/index-abc.js");
    expect(js.headers.get("content-type")).toMatch(/text\/javascript/);
    expect(js.headers.get("cache-control")).toMatch(/immutable/);
    const page = await call(env, "/");
    expect(await page.text()).toBe("<html>app</html>");
    expect(page.headers.get("content-security-policy")).toMatch(/frame-ancestors 'none'/);
    expect((await call(env, "/assets/missing.js")).status).toBe(404);
    expect((await call(env, "/index.html")).headers.get("content-security-policy")).toMatch(/frame-ancestors 'none'/);
  });
});
