import { AuthorizationError, CimdFetchError, type ConsentDescription } from "@cloudflare/workers-oauth-provider";
import { AuthError, allowed, currentUser, login } from "./auth";
import type { Env } from "./env";

/**
 * The /authorize page of the MCP OAuth login. The library checks the client, the redirect URI and PKCE.
 * This file signs the owner in (the same email + password account as the web app) and asks for consent.
 * Every string that came from the client is escaped. The page cannot be framed.
 */
export const MCP_SCOPE = "a11";

const escapeHtml = (v: string) => v.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

const PAGE_HEADERS = {
  "content-type": "text/html; charset=utf-8",
  "cache-control": "no-store",
  "x-frame-options": "DENY",
  "x-content-type-options": "nosniff",
  "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'",
};

const STYLE = `<style>body{font:16px/1.5 system-ui,sans-serif;max-width:30rem;margin:3rem auto;padding:0 1rem}label{display:block;margin:.8rem 0 .2rem}input{width:100%;padding:.5rem;font:inherit;box-sizing:border-box}button{font:inherit;padding:.5rem 1rem;margin:1rem .5rem 0 0}.warn{background:#fff3cd;padding:.6rem;border-radius:4px}.err{color:#b00020}</style>`;

function page(body: string, status = 200, extra?: Headers): Response {
  const headers = new Headers(extra);
  for (const [k, v] of Object.entries(PAGE_HEADERS)) headers.set(k, v);
  return new Response(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>a11 sign-in</title>${STYLE}${body}`, { status, headers });
}

/** Where to go after sign-in: only back to /authorize with its own query. Anything else becomes /authorize. */
export function safeNext(next: unknown): string {
  return typeof next === "string" && /^\/authorize\?[\x21-\x7e]{1,8000}$/.test(next) ? next : "/authorize";
}

function signInPage(next: string, message?: string, status = 401): Response {
  return page(
    `<h1>Sign in to a11</h1>${message ? `<p class="err">${escapeHtml(message)}</p>` : ""}
<p>An app asks to use your a11 account. Sign in first.</p>
<form method="post" action="/authorize/signin">
<input type="hidden" name="next" value="${escapeHtml(next)}">
<label>Email<input name="email" type="email" autocomplete="username" required></label>
<label>Password<input name="password" type="password" autocomplete="current-password" required></label>
<button type="submit">Sign in</button>
</form>`,
    message ? status : 200,
  );
}

function consentPage(d: ConsentDescription, handle: string, email: string): string {
  const origin = d.clientDomain
    ? `Published by <strong>${escapeHtml(d.clientDomain)}</strong>.`
    : "This app registered itself. Its name is not verified.";
  return `<h1>Allow ${escapeHtml(d.clientName)}?</h1>
<p>You are signed in as <strong>${escapeHtml(email)}</strong>.</p>
<p>${origin}</p>
<p>Access will be sent to <strong>${escapeHtml(d.redirectHost)}</strong>.</p>
${d.redirectIsLoopback ? `<p class="warn"><strong>This sends access to an app on your own computer.</strong> Continue only if you just started signing in from that app.</p>` : ""}
<p>It can read and change everything in your a11 workspace: brands, batches, renders and spend (up to the monthly cap). It cannot see your password. To cut off all a11 access for your account later, remove your email from the allow-list.</p>
<form method="post">
<input type="hidden" name="handle" value="${escapeHtml(handle)}">
<button name="decision" value="approve" type="submit">Allow</button>
<button name="decision" value="deny" type="submit">Deny</button>
</form>`;
}

function renderError(error: unknown): Response | null {
  if (error instanceof AuthorizationError && error.redirectTo) return new Response(null, { status: 302, headers: { Location: error.redirectTo, "cache-control": "no-store" } });
  if (error instanceof AuthorizationError) return page(`<h1>Cannot continue</h1><p>${escapeHtml(error.description)}</p><p>Start again from the app.</p>`, 400);
  if (error instanceof CimdFetchError) return page("<h1>Cannot continue</h1><p>This app could not be verified. Start again from the app.</p>", 400);
  return null;
}

export async function handleAuthorize(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);

  if (url.pathname === "/authorize/signin") {
    if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });
    const form = await request.formData().catch(() => null);
    const next = safeNext(form?.get("next"));
    try {
      const cookie = await login(env, { email: form?.get("email"), password: form?.get("password") });
      return new Response(null, { status: 303, headers: { Location: next, "Set-Cookie": cookie, "cache-control": "no-store" } });
    } catch (e) {
      if (e instanceof AuthError) return signInPage(next, e.message, e.status);
      throw e;
    }
  }

  if (url.pathname !== "/authorize") return new Response("Not found", { status: 404 });

  const email = await currentUser(env, request);
  if (request.method === "GET") {
    try {
      // Parse first: a bad client or redirect URI must never reach a sign-in form that redirects back.
      const authRequest = await env.OAUTH_PROVIDER.parseAuthRequest(request);
      if (!email) return signInPage(url.pathname + url.search);
      const details = await env.OAUTH_PROVIDER.describeConsent(authRequest);
      const consent = await env.OAUTH_PROVIDER.beginConsent(authRequest);
      return page(consentPage(details, consent.handle, email), 200, consent.headers);
    } catch (e) {
      const r = renderError(e);
      if (r) return r;
      throw e;
    }
  }

  if (request.method === "POST") {
    if (!email) return page("<h1>Signed out</h1><p>Start again from the app.</p>", 401);
    const form = await request.formData().catch(() => null);
    const handle = String(form?.get("handle") ?? "");
    try {
      if (form?.get("decision") !== "approve") {
        const denied = await env.OAUTH_PROVIDER.denyConsent(request, handle);
        denied.headers.set("Location", denied.redirectTo);
        return new Response(null, { status: 302, headers: denied.headers });
      }
      // The grant is for this one scope, whatever the app asked for.
      const approved = await env.OAUTH_PROVIDER.approveConsent(request, handle, { scope: [MCP_SCOPE] });
      const { redirectTo } = await env.OAUTH_PROVIDER.completeAuthorization({
        request: approved.request,
        userId: email,
        metadata: { email },
        scope: [MCP_SCOPE],
        props: { email },
      });
      approved.headers.set("Location", redirectTo);
      approved.headers.set("cache-control", "no-store");
      return new Response(null, { status: 302, headers: approved.headers });
    } catch (e) {
      const r = renderError(e);
      if (r) return r;
      throw e;
    }
  }
  return new Response("Method not allowed", { status: 405 });
}

/** Re-check the allow-list on every call: an email removed from ALLOWED_EMAILS loses MCP access at once. */
export const stillAllowed = (env: Env, email: unknown) => typeof email === "string" && allowed(env, email.toLowerCase());

/** Client self-registration (RFC 7591) is open by design, so its body is small and bounded: a real client sends well under 1 KB. */
export const REGISTRATION_MAX_BYTES = 8192;

/** Read the registration body up to the limit. Returns a rebuilt request, or a 413 if the body is larger. Nothing past the limit is kept. */
export async function boundRegistration(request: Request): Promise<Request | Response> {
  const tooBig = () => Response.json({ error: "invalid_client_metadata", error_description: "Registration body too large" }, { status: 413, headers: { "cache-control": "no-store" } });
  if (Number(request.headers.get("content-length") ?? 0) > REGISTRATION_MAX_BYTES) return tooBig();
  const chunks: Uint8Array[] = [];
  let size = 0;
  const reader = request.body?.getReader();
  while (reader) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > REGISTRATION_MAX_BYTES) {
      await reader.cancel();
      return tooBig();
    }
    chunks.push(value);
  }
  const body = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) {
    body.set(c, at);
    at += c.byteLength;
  }
  return new Request(request.url, { method: request.method, headers: request.headers, body });
}
