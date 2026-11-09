-- One-time upload links (MCP tool upload_link, PUT /up/<token>). Only the SHA-256 of the token is kept.
-- D1 is strongly consistent, so DELETE ... RETURNING claims a link once, even when two PUTs arrive together (KV get + delete could not).
CREATE TABLE upload_links (
  hash TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('repair', 'ref')),
  key TEXT,
  name TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
