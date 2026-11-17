-- a11-engine v3: the one database change for Phases 1 to 4 (docs/a11-engine-v3-fable-design-pack.md §0.2).
-- Additive: no row is changed, no table is rebuilt. Every batch that exists gets engine 2 and keeps its old pick rule.
-- Rollback: a new migration that drops the triggers of part A and creates the two triggers of 0004_funnel.sql again.
-- The new columns and tables then stay; they do no harm.

-- C. The engine of a batch. Every batch that exists is engine 2. batch_create writes 3 only when engine 3 is live.
-- It comes first: the triggers of part A read it.
ALTER TABLE batches ADD COLUMN engine INTEGER NOT NULL DEFAULT 2 CHECK (engine IN (2, 3));
-- The engine is fixed when the batch is made: a change would leave picks that break the other engine's limit.
CREATE TRIGGER batches_engine_fixed BEFORE UPDATE OF engine ON batches
WHEN NEW.engine IS NOT OLD.engine
BEGIN
  SELECT RAISE(ABORT, 'batches: the engine of a batch is fixed when it is made');
END;

-- B. The concept of an idea (territory, mechanism and the other concept fields), as JSON. Old ideas have '{}'.
ALTER TABLE ideas ADD COLUMN concept TEXT NOT NULL DEFAULT '{}';

-- F. The fact check. NULL: not checked (every row that exists). 1: the quote is in the stored source. 0: it is not.
ALTER TABLE facts ADD COLUMN verified INTEGER CHECK (verified IS NULL OR verified IN (0, 1));

-- A. The pick limit. Engine 3: 3 picked ideas for each batch, any stage. Engine 2: 1 for each stage, as before.
-- An old-format batch (hook, anatomy, usvsthem, offer) keeps its old limit of 1 for each format.
DROP TRIGGER ideas_pick_limit_insert;
DROP TRIGGER ideas_pick_limit_update;

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

CREATE TRIGGER ideas_pick_old_format_insert BEFORE INSERT ON ideas
WHEN NEW.picked = 1 AND NEW.format NOT IN ('tof', 'mof', 'bof')
  AND (SELECT COUNT(*) FROM ideas WHERE batch_id = NEW.batch_id AND format = NEW.format AND picked = 1) >= 1
BEGIN
  SELECT RAISE(ABORT, 'Pick limit: 1 idea per stage per batch.');
END;

CREATE TRIGGER ideas_pick_old_format_update BEFORE UPDATE OF picked, format, batch_id ON ideas
WHEN NEW.picked = 1 AND NEW.format NOT IN ('tof', 'mof', 'bof')
  AND (SELECT COUNT(*) FROM ideas WHERE batch_id = NEW.batch_id AND format = NEW.format AND picked = 1 AND id != NEW.id) >= 1
BEGIN
  SELECT RAISE(ABORT, 'Pick limit: 1 idea per stage per batch.');
END;

-- D. The research sources of a batch: each page that a search or a contents read returned, with its text,
-- so the quote of a fact or an insight can be checked against what was read.
CREATE TABLE research_sources (
  id TEXT PRIMARY KEY NOT NULL,
  batch_id TEXT NOT NULL REFERENCES batches(id),
  url TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  published_date TEXT,
  retrieved_at TEXT NOT NULL,
  via TEXT NOT NULL CHECK (via IN ('search', 'contents')),
  query TEXT NOT NULL DEFAULT '',
  text TEXT NOT NULL DEFAULT ''
);
CREATE UNIQUE INDEX research_sources_once ON research_sources (batch_id, url, via);

-- E. Batch records: the brief, territories, concept reviews, directions, checks and rank stamps. Only added, never changed or deleted:
-- a new version is a new row.
CREATE TABLE batch_records (
  id TEXT PRIMARY KEY NOT NULL,
  batch_id TEXT NOT NULL REFERENCES batches(id),
  kind TEXT NOT NULL CHECK (kind IN ('brief', 'territories', 'concept_review', 'direction', 'draft_check', 'final_check', 'rank_context')),
  idea_id TEXT,                           -- the idea, when the record is about one idea (it must be an idea of batch_id)
  version INTEGER NOT NULL CHECK (version >= 1),
  body TEXT NOT NULL,                     -- JSON
  author TEXT NOT NULL CHECK (author IN ('main', 'writer', 'critic', 'art-director', 'owner', 'server')),
  prompt_version TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  FOREIGN KEY (idea_id, batch_id) REFERENCES ideas(id, batch_id)   -- the same composite key as picks, draft_ranks and verdicts
);
CREATE UNIQUE INDEX batch_records_version ON batch_records (batch_id, kind, IFNULL(idea_id, ''), version);
CREATE INDEX batch_records_read ON batch_records (batch_id, kind, created_at);
CREATE TRIGGER batch_records_no_update BEFORE UPDATE ON batch_records
BEGIN
  SELECT RAISE(ABORT, 'batch_records: rows are only added, never changed');
END;
CREATE TRIGGER batch_records_no_delete BEFORE DELETE ON batch_records
BEGIN
  SELECT RAISE(ABORT, 'batch_records: rows are only added, never changed');
END;

-- G. Critic calibration runs (Phase 4).
CREATE TABLE calibration_runs (
  id TEXT PRIMARY KEY NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('triplet_replay', 'final_replay', 'concept_stability')),
  as_of TEXT NOT NULL,
  split TEXT NOT NULL CHECK (split IN ('tuning', 'holdout', 'all')),
  canon_log_id TEXT,
  prompt_version TEXT NOT NULL DEFAULT '',
  n INTEGER NOT NULL CHECK (n >= 0),
  result TEXT NOT NULL,                   -- JSON
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);
CREATE INDEX calibration_runs_kind ON calibration_runs (kind, created_at);
