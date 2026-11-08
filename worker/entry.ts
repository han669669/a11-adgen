import OAuthProvider from "@cloudflare/workers-oauth-provider";
import app, { tokenOk } from "./index";
import { handleMcp } from "./mcp";
import { AuthError, reserveRegistration } from "./auth";
import { MCP_SCOPE, boundRegistration, handleAuthorize, stillAllowed } from "./oauth";
import type { Env } from "./env";
import { fontResponse } from "./font";
import { iconResponse } from "./icon";

/**
 * Worker entry. OAuth 2.1 for /mcp (owner, 07-11-2026): the owner signs in with the web app account, approves each authorization request,
 * and the app gets a short token (1 hour) plus a refresh token (30 days). Clients register themselves (RFC 7591).
 * The Phase 0 bearer token still works (resolveExternalToken), so scripts and the deploy path do not break.
 * Everything that is not /mcp, /authorize or OAuth plumbing goes to the app in index.ts unchanged.
 */
const mcpHandler = {
  async fetch(request: Request, env: Env, context: ExecutionContext): Promise<Response> {
    // The provider adds props (what completeAuthorization stored, or the bearer fallback) and auth (the verified token) to the context.
    const ctx = context as ExecutionContext & { props?: { email?: string; static?: boolean }; auth?: { scope?: string[] } };
    const props = ctx.props ?? {};
    if (!props.static) {
      // A token from the login: the email must still be on the allow-list, and the grant must carry the scope.
      if (!stillAllowed(env, props.email) || !(ctx.auth?.scope ?? []).includes(MCP_SCOPE)) return new Response("Forbidden", { status: 403 });
    }
    return handleMcp(request, env);
  },
};

const defaultHandler = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const path = new URL(request.url).pathname;
    const icon = request.method === "GET" || request.method === "HEAD" ? (iconResponse(path) ?? fontResponse(path)) : null;
    if (icon) return request.method === "HEAD" ? new Response(null, { status: icon.status, headers: icon.headers }) : icon;
    if (path === "/authorize" || path === "/authorize/signin") return handleAuthorize(request, env);
    return app.fetch(request, env);
  },
};

/** One provider per public origin (PUBLIC_BASE_URL), so the live Worker and the preview Worker each name their own resource. */
const providers = new Map<string, OAuthProvider<Env>>();

function providerFor(env: Env): OAuthProvider<Env> {
  const origin = new URL(env.PUBLIC_BASE_URL).origin;
  let p = providers.get(origin);
  if (!p) {
    const resource = `${origin}/mcp`;
    p = new OAuthProvider<Env>({
      apiRoute: "/mcp",
      apiHandler: mcpHandler,
      defaultHandler,
      authorizeEndpoint: "/authorize",
      tokenEndpoint: "/oauth/token",
      clientRegistrationEndpoint: "/oauth/register",
      scopesSupported: [MCP_SCOPE],
      requiredScopes: [MCP_SCOPE],
      accessTokenTTL: 3600,
      refreshTokenTTL: 30 * 86400,
      resourceMetadata: { resource, authorization_servers: [origin], resource_name: "a11 ad generator" },
      // The Phase 0 bearer token (only its SHA-256 is on the Worker) stays valid for scripts and the plugin's fallback.
      resolveExternalToken: async ({ token, request, env: e }) => {
        if (!(await tokenOk(new Request(request.url, { headers: { Authorization: `Bearer ${token}` } }), e.MCP_TOKEN_SHA256))) return null;
        return { props: { static: true }, audience: resource };
      },
    });
    providers.set(origin, p);
  }
  return p;
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    // Open client registration: keep the body small and the rate low, so nobody can fill the KV with client records.
    if (request.method === "POST" && new URL(request.url).pathname === "/oauth/register") {
      const bounded = await boundRegistration(request);
      if (bounded instanceof Response) return bounded;
      request = bounded;
      try {
        await reserveRegistration(env);
      } catch (e) {
        if (!(e instanceof AuthError)) throw e;
        return Response.json({ error: "temporarily_unavailable", error_description: e.message }, { status: 429, headers: { "retry-after": "3600", "cache-control": "no-store" } });
      }
    }
    return providerFor(env).fetch(request, env, ctx);
  },
} satisfies ExportedHandler<Env>;
