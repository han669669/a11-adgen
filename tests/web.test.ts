import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "../worker/auth";
import type { Env } from "../worker/env";
import worker from "../worker/index";
import { picksGet } from "../worker/picks";
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

const call = (env: Env, path: string, init: { method?: string; body?: unknown; cookie?: string; origin?: string | null; ip?: string } = {}) => {
  const headers: Record<string, string> = {};
  if (init.ip) headers["cf-connecting-ip"] = init.ip;
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

  it("saves picks only from a list: a missing field is refused, an empty list clears", async () => {
    const { env } = makeEnv();
    const cookie = cookieOf(await call(env, "/api/signup", { body: signupBody }));
    const path = "/api/batches/11111111-1111-1111-1111-111111111111/picks";
    const bad = await call(env, path, { body: { pick: [] }, cookie });
    expect(bad.status).toBe(400);
    expect(await bad.json()).toEqual({ error: "Send picks as a list." });
    expect((await call(env, path, { body: { picks: [] }, cookie })).status).toBe(200);
  });

  it("refuses an over-long pick note with a 400 and keeps a note at the limit whole", async () => {
    const { env } = makeEnv();
    const B = "bbbbbbbb-0000-4000-8000-000000000001";
    const R = "dddddddd-0000-4000-8000-000000000003";
    const key = `renders/${R}/1.jpg`;
    const raw = (env.DB as unknown as { raw: DatabaseSync }).raw;
    raw.exec(`
      INSERT INTO brands (id, slug, name, created_at, updated_at) VALUES ('br', 'cat', 'Cat', 't', 't');
      INSERT INTO subjects (id, brand_id, kind, title, created_at) VALUES ('su', 'br', 'product', 'Cake', 't');
      INSERT INTO batches (id, brand_id, subject_id, kit_version, label, status, created_at, updated_at) VALUES ('${B}', 'br', 'su', 1, 'W47', 'drafts', 't', 't');
      INSERT INTO ideas (id, batch_id, n, format, insight, visual, headline, created_at) VALUES ('i1', '${B}', 1, 'tof', 'in', 'v', 'h', 't');
      INSERT INTO renders (id, batch, idea, kind, status, prompt, refs, width, height, quality, num_images, usd_est, image_keys, created_at, updated_at)
        VALUES ('${R}', '${B}', 'i1', 'draft', 'done', 'p', '[]', 1024, 1280, 'low', 1, 0.01, '["${key}"]', 't', 't');
    `);
    const cookie = cookieOf(await call(env, "/api/signup", { body: signupBody }));
    const path = `/api/batches/${B}/picks`;
    const saved = () => raw.prepare("SELECT note FROM picks WHERE render_key = ?").get(key) as { note: string } | undefined;

    const long = await call(env, path, { body: { picks: [{ key, note: "x".repeat(601) }] }, cookie });
    expect(long.status).toBe(400);
    expect(await long.json()).toEqual({ error: "A note can have at most 600 characters." });
    expect(saved()).toBeUndefined();

    expect((await call(env, path, { body: { picks: [{ key, note: "y".repeat(600) }] }, cookie })).status).toBe(200);
    expect(saved()?.note).toBe("y".repeat(600));
  });

  it("refuses a second sign-up for the same email", async () => {
    const { env } = makeEnv();
    await call(env, "/api/signup", { body: signupBody });
    expect((await call(env, "/api/signup", { body: signupBody })).status).toBe(403);
  });

  it("gives two sign-ups at once for one email one account and one 403", async () => {
    const { env } = makeEnv();
    const [a, b] = await Promise.all([call(env, "/api/signup", { body: signupBody }), call(env, "/api/signup", { body: signupBody })]);
    expect([a.status, b.status].sort()).toEqual([200, 403]);
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

  it("does not lock a caller out for the wrong passwords of another address", async () => {
    const { env } = makeEnv();
    await call(env, "/api/signup", { body: signupBody });
    const wrong = { ...good, password: "wrong password!!" };
    for (let i = 0; i < 5; i++) expect((await call(env, "/api/login", { body: wrong, ip: "203.0.113.7" })).status).toBe(401);
    expect((await call(env, "/api/login", { body: good, ip: "203.0.113.7" })).status).toBe(429);
    expect((await call(env, "/api/login", { body: good, ip: "198.51.100.20" })).status).toBe(200);
  });

  it("counts one IPv6 /64 as one caller", async () => {
    const { env } = makeEnv();
    await call(env, "/api/signup", { body: signupBody });
    const wrong = { ...good, password: "wrong password!!" };
    for (let i = 0; i < 5; i++) expect((await call(env, "/api/login", { body: wrong, ip: `2001:db8:0:1::${i + 1}` })).status).toBe(401);
    expect((await call(env, "/api/login", { body: good, ip: "2001:0db8:0000:0001:aaaa:bbbb:cccc:dddd" })).status).toBe(429);
    expect((await call(env, "/api/login", { body: good, ip: "2001:db8:0:2::1" })).status).toBe(200);
  });

  it("still limits wrong passwords for one email from many addresses", async () => {
    const { env } = makeEnv();
    await call(env, "/api/signup", { body: signupBody });
    const wrong = { ...good, password: "wrong password!!" };
    for (let i = 0; i < 20; i++) expect((await call(env, "/api/login", { body: wrong, ip: `203.0.113.${i + 1}` })).status).toBe(401);
    expect((await call(env, "/api/login", { body: wrong, ip: "203.0.113.200" })).status).toBe(429);
    // The limit is per email: the other account is not locked.
    expect((await call(env, "/api/login", { body: { ...good, email: "second@a11.example" }, ip: "203.0.113.200" })).status).toBe(401);
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

  it("needs a session for batches and for saving picks", async () => {
    const { env } = makeEnv();
    expect((await call(env, "/api/batches")).status).toBe(401);
    expect((await call(env, "/api/batches/11111111-1111-1111-1111-111111111111/picks", { body: { picks: [] } })).status).toBe(401);
  });
});

describe("media route", () => {
  const KEY = "brands/11111111-2222-4333-8444-555555555555/ref1.jpg";
  const mediaEnv = () => {
    const { env } = makeEnv();
    // A stored object whose metadata says it is a page.
    const obj = { body: "<html>", size: 6, httpMetadata: { contentType: "text/html" } };
    Object.assign(env.MEDIA, { get: async (k: string) => (k === KEY ? obj : null), head: async (k: string) => (k === KEY ? obj : null) });
    return env;
  };
  it("serves a picture type from the key, with nosniff and a locked CSP", async () => {
    const r = await call(mediaEnv(), `/m/${KEY}`);
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toBe("image/jpeg");
    expect(r.headers.get("content-length")).toBe("6");
    expect(r.headers.get("x-content-type-options")).toBe("nosniff");
    expect(r.headers.get("content-security-policy")).toBe("default-src 'none'; sandbox");
    const png = "brands/11111111-2222-4333-8444-555555555555/logo.png";
    const env = mediaEnv();
    Object.assign(env.MEDIA, { get: async () => ({ body: "x", size: 1, httpMetadata: { contentType: "text/html" } }) });
    expect((await call(env, `/m/${png}`)).headers.get("content-type")).toBe("image/png");
    expect((await call(env, "/m/brands/11111111-2222-4333-8444-555555555555/ref2.webp")).headers.get("content-type")).toBe("image/webp");
  });
  it("answers HEAD with the same headers and no body (fal checks a reference with HEAD)", async () => {
    const r = await call(mediaEnv(), `/m/${KEY}`, { method: "HEAD" });
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toBe("image/jpeg");
    expect(r.headers.get("content-length")).toBe("6");
    expect(r.headers.get("cache-control")).toBe("private, max-age=3600");
    expect(r.headers.get("x-content-type-options")).toBe("nosniff");
    expect(r.headers.get("content-security-policy")).toBe("default-src 'none'; sandbox");
    expect(await r.text()).toBe("");
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

describe("board check of a final", () => {
  const B = "aaaaaaaa-0000-4000-8000-000000000001";
  const FINAL = "bbbbbbbb-0000-4000-8000-000000000002";
  const DRAFT = "renders/cccccccc-0000-4000-8000-000000000003/1.jpg";

  it("does not draw the logo on a finished final or change the next step of its pick", async () => {
    const { env, files } = makeEnv();
    const kit = { logo: { key: "brands/br/logo.png" }, placement: { logoWidthPct: 28, logoTopPct: 3 } };
    (env.DB as unknown as { raw: DatabaseSync }).raw.exec(`
      INSERT INTO brands (id, slug, name, created_at, updated_at) VALUES ('br', 'cat', 'Cat', 't', 't');
      INSERT INTO brand_kits (id, brand_id, version, kit, created_at) VALUES ('k1', 'br', 1, '${JSON.stringify(kit)}', 't');
      INSERT INTO subjects (id, brand_id, kind, title, created_at) VALUES ('su', 'br', 'product', 'Cake', 't');
      INSERT INTO batches (id, brand_id, subject_id, kit_version, label, status, created_at, updated_at) VALUES ('${B}', 'br', 'su', 1, 'W47', 'finals', 't', 't');
      INSERT INTO ideas (id, batch_id, n, format, insight, visual, headline, created_at) VALUES ('i1', '${B}', 1, 'tof', 'in', 'v', 'H', 't');
      INSERT INTO picks (render_key, batch_id, idea_id, final_render_id, created_at, by_owner) VALUES ('${DRAFT}', '${B}', 'i1', '${FINAL}', 't', 1);
      INSERT INTO renders (id, batch, idea, kind, status, prompt, refs, width, height, quality, num_images, image_keys, usd_est, created_at, updated_at)
        VALUES ('${FINAL}', '${B}', 'i1', 'final', 'done', 'p', '[]', 1536, 1920, 'high', 1, '["renders/${FINAL}/1.jpg"]', 0.07, 't', 't');
    `);
    // Everything a compose needs is there, so only the board's own rule keeps the final as it is.
    for (const k of [`renders/${FINAL}/1.jpg`, kit.logo.key, "assets/grain.png"]) files.set(k, { body: k, type: "image/png" });
    const before = [...files.keys()];
    let drawn = 0;
    const picture = () => {
      drawn++;
      const self = { transform: () => self, draw: () => self, output: async () => ({ response: () => new Response("jpeg") }) };
      return self;
    };
    (env as unknown as { IMAGES: unknown }).IMAGES = { input: picture };
    const cookie = cookieOf(await call(env, "/api/signup", { body: { email: "owner@a11.example", password: "a long enough password", code: CODE } }));

    const r = await call(env, `/api/renders/${FINAL}/refresh`, { body: {}, cookie });
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ id: FINAL, kind: "final", status: "done", images: [{ key: `renders/${FINAL}/1.jpg` }] });

    expect(drawn).toBe(0);
    expect([...files.keys()]).toEqual(before);
    const row = (env.DB as unknown as { raw: DatabaseSync }).raw.prepare("SELECT composed_key FROM renders WHERE id = ?").get(FINAL);
    expect(row).toEqual({ composed_key: null });
    const final = (await ((await call(env, `/api/batches/${B}`, { cookie })).json() as Promise<{ ideas: { finals: unknown[] }[] }>)).ideas[0]!.finals[0];
    expect(final).toMatchObject({ status: "done", composed: null, composeError: null });
    // Claude's step is still the compose: the board did not make a picture that a pack can use.
    expect((await picksGet(env, B)).picks[0]).toMatchObject({ latest: null, next: "compose_final" });
  });
});
