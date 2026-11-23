-- Engine v1 (wild concepts, owner 23-11-2026): batches.engine takes the value 1. Engine v1 makes 3 wild concepts with
-- one picture each, no words and only the kit logo (worker/houserules.ts section E1).
-- SQLite cannot change a CHECK in place, so the table is built again (the 0004 pattern: defer the foreign keys until the
-- end of the transaction). Same columns (0002 plus engine from 0015), the same rows in the same order, the same two
-- indexes and the same trigger. Six tables refer to batches(id) by name, so they point at the new table after the rename.
-- Two triggers on ideas read batches (the pick limits of 0015). SQLite refuses to rename a table while a trigger names a
-- table that does not exist ("error in trigger ...: no such table: main.batches"), so they are dropped first and made again
-- after the rename with the same text.
-- Rollback: rollback/0018_engine_1.down.sql.
PRAGMA defer_foreign_keys = on;

DROP TRIGGER ideas_pick_cap_insert;
DROP TRIGGER ideas_pick_cap_update;

CREATE TABLE batches_new (
  id TEXT PRIMARY KEY,
  brand_id TEXT NOT NULL REFERENCES brands(id),
  subject_id TEXT NOT NULL REFERENCES subjects(id),
  kit_version INTEGER NOT NULL,
  label TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('research', 'ideas', 'drafts', 'board', 'finals', 'done')),
  insights TEXT NOT NULL DEFAULT '[]', -- JSON array of buyer truths with sources
  notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  engine INTEGER NOT NULL DEFAULT 2 CHECK (engine IN (1, 2, 3))
);
INSERT INTO batches_new (id, brand_id, subject_id, kit_version, label, status, insights, notes, created_at, updated_at, engine)
  SELECT id, brand_id, subject_id, kit_version, label, status, insights, notes, created_at, updated_at, engine FROM batches ORDER BY rowid;
DROP TABLE batches;
ALTER TABLE batches_new RENAME TO batches;
CREATE INDEX batches_brand ON batches(brand_id, created_at);
CREATE INDEX batches_created ON batches(created_at);
-- The engine is fixed when the batch is made: a change would leave picks that break the other engine's limit.
CREATE TRIGGER batches_engine_fixed BEFORE UPDATE OF engine ON batches
WHEN NEW.engine IS NOT OLD.engine
BEGIN
  SELECT RAISE(ABORT, 'batches: the engine of a batch is fixed when it is made');
END;

-- The pick limits, as in 0015: 3 picked ideas for each batch; 1 for each stage for an engine 2 batch. Engine 1 and engine 3
-- take 3 in any mix of stages.
CREATE TRIGGER ideas_pick_cap_insert BEFORE INSERT ON ideas
WHEN NEW.picked = 1 AND NEW.format IN ('tof', 'mof', 'bof') AND (
  (SELECT COUNT(*) FROM ideas WHERE batch_id = NEW.batch_id AND picked = 1 AND format IN ('tof', 'mof', 'bof')) >= 3
  OR (COALESCE((SELECT engine FROM batches WHERE id = NEW.batch_id), 2) = 2
      AND (SELECT COUNT(*) FROM ideas WHERE batch_id = NEW.batch_id AND picked = 1 AND format = NEW.format) >= 1))
BEGIN
  SELECT RAISE(ABORT, 'Pick limit: 3 ideas per batch; 1 per stage for an engine 2 batch.');
END;

CREATE TRIGGER ideas_pick_cap_update BEFORE UPDATE OF picked, format, batch_id ON ideas
WHEN NEW.picked = 1 AND NEW.format IN ('tof', 'mof', 'bof') AND (
  (SELECT COUNT(*) FROM ideas WHERE batch_id = NEW.batch_id AND picked = 1 AND id != NEW.id AND format IN ('tof', 'mof', 'bof')) >= 3
  OR (COALESCE((SELECT engine FROM batches WHERE id = NEW.batch_id), 2) = 2
      AND (SELECT COUNT(*) FROM ideas WHERE batch_id = NEW.batch_id AND picked = 1 AND id != NEW.id AND format = NEW.format) >= 1))
BEGIN
  SELECT RAISE(ABORT, 'Pick limit: 3 ideas per batch; 1 per stage for an engine 2 batch.');
END;

PRAGMA defer_foreign_keys = off;
