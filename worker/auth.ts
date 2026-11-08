import type { Env } from "./env";

/**
 * Email + password accounts for the web app. Only emails in ALLOWED_EMAILS can sign up or sign in.
 * Passwords: PBKDF2-SHA256 (Web Crypto). Sessions: a random token in an HttpOnly cookie; D1 keeps only its SHA-256.
 */
export const PBKDF2_ITERATIONS = 100_000; // the Workers maximum for PBKDF2
export const MIN_PASSWORD = 12;
export const MAX_PASSWORD = 200;
const SESSION_DAYS = 30;
const COOKIE = "a11s";
const MAX_FAILURES = 5;
const FAILURE_WINDOW = "-15 minutes";

export class AuthError extends Error {
  constructor(
    message: string,
    readonly status = 401,
  ) {
    super(message);
  }
}

const b64 = (b: ArrayBuffer | Uint8Array) => Buffer.from(b instanceof Uint8Array ? b : new Uint8Array(b)).toString("base64");
const b64url = (b: Uint8Array) => Buffer.from(b).toString("base64url");
const unb64 = (s: string) => new Uint8Array(Buffer.from(s, "base64"));

export function allowed(env: Env, email: string): boolean {
  const list = (env.ALLOWED_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  return list.includes(email);
}

async function derive(password: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations }, key, 256));
}

export async function hashPassword(password: string, iterations = PBKDF2_ITERATIONS): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return `pbkdf2-sha256$${iterations}$${b64(salt)}$${b64(await derive(password, salt, iterations))}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [alg, iter, salt, hash] = stored.split("$");
  if (alg !== "pbkdf2-sha256" || !iter || !salt || !hash) return false;
  const got = await derive(password, unb64(salt), Number(iter));
  const want = unb64(hash);
  if (got.length !== want.length) return false;
  let diff = 0;
  for (let i = 0; i < got.length; i++) diff |= got[i]! ^ want[i]!;
  return diff === 0;
}

async function sha256(s: string): Promise<string> {
  return b64(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)));
}

function cleanEmail(email: unknown): string {
  if (typeof email !== "string" || !/^[^\s@]{1,64}@[^\s@]{1,190}$/.test(email.trim())) throw new AuthError("Enter a valid email.", 400);
  return email.trim().toLowerCase();
}

async function newSession(env: Env, email: string): Promise<string> {
  const token = b64url(crypto.getRandomValues(new Uint8Array(32)));
  const now = new Date();
  const expires = new Date(now.getTime() + SESSION_DAYS * 86_400_000);
  await env.DB.prepare("INSERT INTO sessions (token_hash, email, expires_at, created_at) VALUES (?, ?, ?, ?)")
    .bind(await sha256(token), email, expires.toISOString(), now.toISOString())
    .run();
  return `${COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_DAYS * 86_400}`;
}

/**
 * Sign-up needs an allow-listed email AND the one-time set-up code (only its SHA-256 is on the Worker,
 * SIGNUP_CODE_SHA256). So knowing a listed address is not enough to take the account first.
 * One error for every refusal, so the endpoint does not reveal who is on the list.
 */
export async function signup(env: Env, body: { email?: unknown; password?: unknown; code?: unknown }): Promise<string> {
  const email = cleanEmail(body.email);
  if (typeof body.password !== "string" || body.password.length < MIN_PASSWORD || body.password.length > MAX_PASSWORD) {
    throw new AuthError(`Use a password of ${MIN_PASSWORD} to ${MAX_PASSWORD} characters.`, 400);
  }
  const refused = new AuthError("Sign-up refused. Check the email and the set-up code.", 403);
  const want = (env.SIGNUP_CODE_SHA256 ?? "").toLowerCase();
  if (want.length !== 64 || typeof body.code !== "string" || !body.code) throw refused;
  // Every sign-up try counts against one shared limit, so the code cannot be guessed by brute force.
  const attemptId = await reserveAttempt(env, SIGNUP_KEY);
  const got = Buffer.from(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(body.code.trim()))).toString("hex");
  let diff = 0;
  for (let i = 0; i < 64; i++) diff |= got.charCodeAt(i) ^ want.charCodeAt(i);
  if (diff !== 0 || !allowed(env, email)) throw refused;
  const exists = await env.DB.prepare("SELECT email FROM users WHERE email = ?").bind(email).first();
  if (exists) throw refused;
  await env.DB.prepare("DELETE FROM login_failures WHERE id = ?").bind(attemptId).run();
  try {
    await env.DB.prepare("INSERT INTO users (email, pw_hash, created_at) VALUES (?, ?, ?)")
      .bind(email, await hashPassword(body.password), new Date().toISOString())
      .run();
  } catch (e) {
    // Two sign-ups for one email at once: the second one hits the primary key.
    if (String((e as Error)?.message ?? e).includes("UNIQUE")) throw refused;
    throw e;
  }
  return newSession(env, email);
}

export async function login(env: Env, body: { email?: unknown; password?: unknown }): Promise<string> {
  const email = cleanEmail(body.email);
  const bad = new AuthError("Wrong email or password.");
  if (!allowed(env, email)) throw bad;
  if (typeof body.password !== "string" || body.password.length > MAX_PASSWORD) throw bad;
  const attemptId = await reserveAttempt(env, email);
  const user = await env.DB.prepare("SELECT pw_hash FROM users WHERE email = ?").bind(email).first<{ pw_hash: string }>();
  if (!user || !(await verifyPassword(body.password, user.pw_hash))) throw bad;
  // Success: drop this attempt, old failures and expired sessions (keeps both tables small).
  await env.DB.batch([
    env.DB.prepare("DELETE FROM login_failures WHERE id = ? OR at < strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-1 day')").bind(attemptId),
    env.DB.prepare("DELETE FROM sessions WHERE expires_at < ?").bind(new Date().toISOString()),
  ]);
  return newSession(env, email);
}

/** login_failures key for sign-up tries (not an email, so it never matches a real account). */
const SIGNUP_KEY = "~signup";

/**
 * Reserve one try in login_failures, but only while fewer than `max` are active in the window (default MAX_FAILURES in FAILURE_WINDOW).
 * `window` is a SQLite time modifier and must be a constant from this file, never user input.
 * One statement, so parallel tries cannot pass the limit, and a locked-out caller writes nothing.
 * The caller deletes the row when the try succeeds.
 */
async function reserveAttempt(env: Env, key: string, max = MAX_FAILURES, window = FAILURE_WINDOW, message = "Too many tries. Wait 15 minutes."): Promise<number> {
  const res = await env.DB.prepare(
    `INSERT INTO login_failures (email, at)
     SELECT ?, ? WHERE (SELECT COUNT(*) FROM login_failures WHERE email = ? AND at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '${window}')) < ?`,
  )
    .bind(key, new Date().toISOString(), key, max)
    .run();
  if (res.meta.changes !== 1) throw new AuthError(message, 429);
  return Number(res.meta.last_row_id);
}

/** login_failures key for client registrations at /oauth/register (not an email). */
const REGISTER_KEY = "~register";
export const REGISTER_MAX_PER_HOUR = 20;

/**
 * Client registration is open by design, so it is rate limited for the whole Worker: at most REGISTER_MAX_PER_HOUR an hour.
 * A bot can use the limit up and block new app registrations for an hour. Existing connectors, refresh tokens and the bearer token are not affected.
 * Throws AuthError 429 over the limit. Rows older than a day are removed.
 */
export async function reserveRegistration(env: Env): Promise<void> {
  await env.DB.prepare("DELETE FROM login_failures WHERE email = ? AND at < strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-1 day')").bind(REGISTER_KEY).run();
  await reserveAttempt(env, REGISTER_KEY, REGISTER_MAX_PER_HOUR, "-1 hour", "Too many registrations. Try again later.");
}

function tokenFrom(request: Request): string | null {
  const m = (request.headers.get("cookie") ?? "").match(new RegExp(`(?:^|;\\s*)${COOKIE}=([A-Za-z0-9_-]{20,})`));
  return m?.[1] ?? null;
}

/** The signed-in email, or null. An email removed from the allow-list loses access at once. */
export async function currentUser(env: Env, request: Request): Promise<string | null> {
  const token = tokenFrom(request);
  if (!token) return null;
  const row = await env.DB.prepare("SELECT email FROM sessions WHERE token_hash = ? AND expires_at > ?")
    .bind(await sha256(token), new Date().toISOString())
    .first<{ email: string }>();
  return row && allowed(env, row.email) ? row.email : null;
}

export async function logout(env: Env, request: Request): Promise<string> {
  const token = tokenFrom(request);
  if (token) await env.DB.prepare("DELETE FROM sessions WHERE token_hash = ?").bind(await sha256(token)).run();
  return `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}
