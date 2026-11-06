-- Phase 0: spend ledger and render jobs.
CREATE TABLE spend (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT NOT NULL,
  service TEXT NOT NULL,          -- 'fal' | 'exa'
  kind TEXT NOT NULL,             -- 'draft' | 'final' | 'search' | 'contents'
  ref TEXT,                       -- render id or query
  usd_est REAL NOT NULL,
  status TEXT NOT NULL DEFAULT 'reserved'  -- 'reserved' | 'spent' | 'released'
);
CREATE INDEX spend_at ON spend(at);

CREATE TABLE renders (
  id TEXT PRIMARY KEY,
  batch TEXT NOT NULL,
  idea TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('draft', 'final')),
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
  updated_at TEXT NOT NULL
);
CREATE INDEX renders_batch ON renders(batch, created_at);
