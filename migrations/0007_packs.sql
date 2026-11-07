-- Phase 3: the weekly pack for a client (docs/blueprint.md section 5). One row per published version of a batch's pack.
-- The client link holds a random token. Only its SHA-256 is stored, so a database read cannot rebuild a link.
CREATE TABLE packs (
  id TEXT PRIMARY KEY,
  batch_id TEXT NOT NULL REFERENCES batches(id),
  version INTEGER NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  content TEXT NOT NULL,          -- JSON: ads (name, image key, Meta text, why), launch plan, fact check
  created_at TEXT NOT NULL,
  revoked_at TEXT,
  UNIQUE (batch_id, version)
);
