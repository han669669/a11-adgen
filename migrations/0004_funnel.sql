-- Formats become funnel stages (owner, 2026-11-06): tof, mof, bof. Old batches keep their old format names.
-- Picks per batch: 2 tof, 1 mof, 1 bof (4 ads a week). Old formats: 1 each, as before.
-- SQLite cannot change a CHECK in place, so the table is rebuilt (D1 pattern: defer foreign keys).
PRAGMA defer_foreign_keys = on;

CREATE TABLE ideas_new (
  id TEXT PRIMARY KEY,
  batch_id TEXT NOT NULL REFERENCES batches(id),
  n INTEGER NOT NULL,
  format TEXT NOT NULL CHECK (format IN ('tof', 'mof', 'bof', 'hook', 'anatomy', 'usvsthem', 'offer')),
  insight TEXT NOT NULL,
  source_url TEXT,
  visual TEXT NOT NULL,
  headline TEXT NOT NULL,
  copy TEXT NOT NULL DEFAULT '{}',
  picked INTEGER NOT NULL DEFAULT 0,
  final_prompt TEXT,
  final_refs TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  UNIQUE (batch_id, n),
  UNIQUE (id, batch_id)
);
INSERT INTO ideas_new (id, batch_id, n, format, insight, source_url, visual, headline, copy, picked, final_prompt, final_refs, created_at)
  SELECT id, batch_id, n, format, insight, source_url, visual, headline, copy, picked, final_prompt, final_refs, created_at FROM ideas;
DROP TABLE ideas;
ALTER TABLE ideas_new RENAME TO ideas;
CREATE INDEX ideas_batch ON ideas(batch_id);

CREATE TRIGGER ideas_pick_limit_insert BEFORE INSERT ON ideas
WHEN NEW.picked = 1 AND (SELECT COUNT(*) FROM ideas WHERE batch_id = NEW.batch_id AND format = NEW.format AND picked = 1)
  >= (CASE NEW.format WHEN 'tof' THEN 2 ELSE 1 END)
BEGIN
  SELECT RAISE(ABORT, 'Pick limit: 2 tof, 1 mof and 1 bof per batch.');
END;

CREATE TRIGGER ideas_pick_limit_update BEFORE UPDATE OF picked, format ON ideas
WHEN NEW.picked = 1 AND (SELECT COUNT(*) FROM ideas WHERE batch_id = NEW.batch_id AND format = NEW.format AND picked = 1 AND id != NEW.id)
  >= (CASE NEW.format WHEN 'tof' THEN 2 ELSE 1 END)
BEGIN
  SELECT RAISE(ABORT, 'Pick limit: 2 tof, 1 mof and 1 bof per batch.');
END;

PRAGMA defer_foreign_keys = off;
