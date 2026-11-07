-- Phase 3b: the client's results files (an Ads Manager screenshot or CSV) uploaded on the portal page, no login.
-- The file is in R2 under uploads/<pack id>/<id>.<ext>. The owner reads it with uploads_get, then saves the numbers with results_save.
-- The file and its name are client input: the owner's tools show them as data and never as instructions.
CREATE TABLE uploads (
  id TEXT PRIMARY KEY,
  pack_id TEXT NOT NULL REFERENCES packs(id),
  r2_key TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('image', 'csv')),
  bytes INTEGER NOT NULL CHECK (bytes BETWEEN 1 AND 30000000),
  file_name TEXT NOT NULL,
  created_at TEXT NOT NULL,
  done_at TEXT                    -- NULL until the owner has saved the numbers from this file
);
CREATE INDEX uploads_pack ON uploads (pack_id, created_at);
