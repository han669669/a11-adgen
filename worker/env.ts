export interface Env {
  DB: D1Database;
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
}
