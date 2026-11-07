import type { OAuthHelpers } from "@cloudflare/workers-oauth-provider";

export interface Env {
  DB: D1Database;
  /** KV for the MCP OAuth login (clients, grants, tokens as hashes). Free plan. */
  OAUTH_KV: KVNamespace;
  /** Set by the OAuth provider on the requests it passes to the app. */
  OAUTH_PROVIDER: OAuthHelpers;
  MEDIA: R2Bucket;
  IMAGES: ImagesBinding;
  /**
   * SHA-256 (hex) of the Phase 0 bearer token for /mcp. Only the hash is stored on the Worker.
   * OAuth replaces this in Phase 1.
   */
  MCP_TOKEN_SHA256: string;
  FAL_KEY: string;
  EXA_API_KEY: string;
  /** Spend cap in US$ for all paid calls in one calendar month (UTC). */
  SPEND_CAP_USD: string;
  PUBLIC_BASE_URL: string;
  /** Comma-separated emails that may sign up and sign in to the web app (Worker secret, set by the owner). */
  ALLOWED_EMAILS?: string;
  /** SHA-256 (hex) of the one-time web app set-up code. Sign-up is closed while it is not set. */
  SIGNUP_CODE_SHA256?: string;
}
