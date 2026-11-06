export interface Env {
  DB: D1Database;
  MEDIA: R2Bucket;
  /**
   * SHA-256 (hex) of the Phase 0 bearer token for /mcp. Only the hash is stored on the Worker.
   * OAuth replaces this in Phase 1.
   */
  MCP_TOKEN_SHA256: string;
  FAL_KEY: string;
  EXA_API_KEY: string;
  /** Total spend cap in US$ for all paid calls (Phase 0: all time). */
  SPEND_CAP_USD: string;
  PUBLIC_BASE_URL: string;
}
