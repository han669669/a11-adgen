-- Phase 1: brands, kit versions, subjects, facts, batches, ideas, draft ranks, picks.
-- Renders keep using renders.batch and renders.idea; for Phase 1 batches they hold the batch id and the idea id.

CREATE TABLE brands (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  site_url TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- A kit is never changed in place: each save is a new version.
CREATE TABLE brand_kits (
  id TEXT PRIMARY KEY,
  brand_id TEXT NOT NULL REFERENCES brands(id),
  version INTEGER NOT NULL,
  kit TEXT NOT NULL,              -- JSON: logo, palette, fonts, voice, neverSay, refs, placement
  note TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (brand_id, version)
);

CREATE TABLE subjects (
  id TEXT PRIMARY KEY,
  brand_id TEXT NOT NULL REFERENCES brands(id),
  kind TEXT NOT NULL CHECK (kind IN ('product', 'brand', 'redesign')),
  title TEXT NOT NULL,
  url TEXT,
  data TEXT NOT NULL DEFAULT '{}', -- JSON: image refs, redesign source
  created_at TEXT NOT NULL
);
CREATE INDEX subjects_brand ON subjects(brand_id, created_at);

-- Each fact keeps its source URL and the exact quote (AGENTS.md §8).
CREATE TABLE facts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  subject_id TEXT NOT NULL REFERENCES subjects(id),
  label TEXT NOT NULL,
  value TEXT NOT NULL,
  quote TEXT NOT NULL,
  source_url TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX facts_subject ON facts(subject_id);

CREATE TABLE batches (
  id TEXT PRIMARY KEY,
  brand_id TEXT NOT NULL REFERENCES brands(id),
  subject_id TEXT NOT NULL REFERENCES subjects(id),
  kit_version INTEGER NOT NULL,
  label TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('research', 'ideas', 'drafts', 'board', 'finals', 'done')),
  insights TEXT NOT NULL DEFAULT '[]', -- JSON array of buyer truths with sources
  notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX batches_brand ON batches(brand_id, created_at);
CREATE INDEX batches_created ON batches(created_at);

CREATE TABLE ideas (
  id TEXT PRIMARY KEY,
  batch_id TEXT NOT NULL REFERENCES batches(id),
  n INTEGER NOT NULL,
  format TEXT NOT NULL CHECK (format IN ('hook', 'anatomy', 'usvsthem', 'offer')),
  insight TEXT NOT NULL,
  source_url TEXT,
  visual TEXT NOT NULL,
  headline TEXT NOT NULL,
  copy TEXT NOT NULL DEFAULT '{}', -- JSON: subline, primary text, Meta headline, description, CTA
  picked INTEGER NOT NULL DEFAULT 0, -- 1 = the critic picked this idea for the batch
  final_prompt TEXT,
  final_refs TEXT NOT NULL DEFAULT '[]', -- JSON array of extra reference URLs for the final (texture photo)
  created_at TEXT NOT NULL,
  UNIQUE (batch_id, n)
);
CREATE INDEX ideas_batch ON ideas(batch_id);

-- The critic's rank of each draft image (1 = best, pre-selected on the board).
CREATE TABLE draft_ranks (
  render_key TEXT PRIMARY KEY,
  batch_id TEXT NOT NULL REFERENCES batches(id),
  idea_id TEXT NOT NULL REFERENCES ideas(id),
  rank INTEGER NOT NULL,
  reason TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX draft_ranks_batch ON draft_ranks(batch_id);

-- The owner's final picks (the one human step, D2). One row per picked draft.
CREATE TABLE picks (
  render_key TEXT PRIMARY KEY,
  batch_id TEXT NOT NULL REFERENCES batches(id),
  idea_id TEXT NOT NULL REFERENCES ideas(id),
  note TEXT,
  final_render_id TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX picks_batch ON picks(batch_id);
CREATE INDEX renders_idea ON renders(idea);
