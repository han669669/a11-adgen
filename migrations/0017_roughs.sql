-- Engine 3 overhaul B8 (owner, 18-11-2026, decision D3 = A in docs/engine-3-overhaul.md §7): a cheap rough render of a
-- concept before the copy review, so the owner and the critic judge the picture, not only the words.
-- renders.kind gets the value 'rough'. SQLite cannot change a CHECK in place, so the table is built again with the same
-- columns (0001 plus composed_key from 0003), the same rows in the same order, and the same two indexes. No table refers
-- to renders, and it has no trigger.
-- Rollback: rollback/0017_roughs.down.sql.

CREATE TABLE renders_new (
  id TEXT PRIMARY KEY,
  batch TEXT NOT NULL,
  idea TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('draft', 'final', 'rough')),
  status TEXT NOT NULL,           -- 'queued' | 'done' | 'failed'
  prompt TEXT NOT NULL,
  refs TEXT NOT NULL,             -- JSON array of reference URLs
  width INTEGER NOT NULL,
  height INTEGER NOT NULL,
  quality TEXT NOT NULL,
  num_images INTEGER NOT NULL,
  fal_request_id TEXT,
  status_url TEXT,
  response_url TEXT,
  image_keys TEXT,                -- JSON array of R2 keys
  usd_est REAL NOT NULL,
  error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  composed_key TEXT
);
INSERT INTO renders_new (id, batch, idea, kind, status, prompt, refs, width, height, quality, num_images, fal_request_id,
  status_url, response_url, image_keys, usd_est, error, created_at, updated_at, composed_key)
SELECT id, batch, idea, kind, status, prompt, refs, width, height, quality, num_images, fal_request_id,
  status_url, response_url, image_keys, usd_est, error, created_at, updated_at, composed_key
FROM renders ORDER BY rowid;
DROP TABLE renders;
ALTER TABLE renders_new RENAME TO renders;
CREATE INDEX renders_batch ON renders(batch, created_at);
CREATE INDEX renders_idea ON renders(idea);
