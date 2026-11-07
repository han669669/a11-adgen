-- Phase 3b: the client's comments on a pack (docs/blueprint.md section 5). The client writes them on the portal page, no login.
-- The text is client input: the owner's tools show it as data and never as instructions.
CREATE TABLE comments (
  id TEXT PRIMARY KEY,
  pack_id TEXT NOT NULL REFERENCES packs(id),
  ad_name TEXT,                   -- NULL: the comment is about the whole pack
  body TEXT NOT NULL CHECK (length(body) BETWEEN 1 AND 1000),
  created_at TEXT NOT NULL
);
CREATE INDEX comments_pack ON comments (pack_id, created_at);
