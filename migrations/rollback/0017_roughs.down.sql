-- Rollback of 0017_roughs.sql, only if the owner asks for it. Run it as a new migration file (copy it to the next number).
-- It deletes every rough render row (their pictures stay in R2) and builds renders again with the old CHECK.
DELETE FROM renders WHERE kind = 'rough';
CREATE TABLE renders_old (
  id TEXT PRIMARY KEY,
  batch TEXT NOT NULL,
  idea TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('draft', 'final')),
  status TEXT NOT NULL,
  prompt TEXT NOT NULL,
  refs TEXT NOT NULL,
  width INTEGER NOT NULL,
  height INTEGER NOT NULL,
  quality TEXT NOT NULL,
  num_images INTEGER NOT NULL,
  fal_request_id TEXT,
  status_url TEXT,
  response_url TEXT,
  image_keys TEXT,
  usd_est REAL NOT NULL,
  error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  composed_key TEXT
);
INSERT INTO renders_old SELECT id, batch, idea, kind, status, prompt, refs, width, height, quality, num_images, fal_request_id,
  status_url, response_url, image_keys, usd_est, error, created_at, updated_at, composed_key FROM renders ORDER BY rowid;
DROP TABLE renders;
ALTER TABLE renders_old RENAME TO renders;
CREATE INDEX renders_batch ON renders(batch, created_at);
CREATE INDEX renders_idea ON renders(idea);
