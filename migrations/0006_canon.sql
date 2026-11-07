-- Phase 2: the taste canon, the swipe file and the gold set (docs/blueprint.md section 4).
-- Canon: plain-word rules, each with its evidence and its hit rate on the owner's picks. At most 40 active rules.
CREATE TABLE canon_rules (
  id TEXT PRIMARY KEY,
  stage TEXT NOT NULL DEFAULT 'all' CHECK (stage IN ('all', 'tof', 'mof', 'bof')),
  text TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'retired')),
  evidence TEXT NOT NULL DEFAULT '[]',
  hits INTEGER NOT NULL DEFAULT 0,
  misses INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_evidence_at TEXT NOT NULL,
  retired_at TEXT,
  retired_reason TEXT
);
CREATE INDEX canon_status ON canon_rules(status);

CREATE TRIGGER canon_active_limit_insert BEFORE INSERT ON canon_rules
WHEN NEW.status = 'active' AND (SELECT COUNT(*) FROM canon_rules WHERE status = 'active') >= 40
BEGIN SELECT RAISE(ABORT, 'canon is full: 40 active rules'); END;
CREATE TRIGGER canon_active_limit_restore BEFORE UPDATE OF status ON canon_rules
WHEN NEW.status = 'active' AND OLD.status != 'active' AND (SELECT COUNT(*) FROM canon_rules WHERE status = 'active') >= 40
BEGIN SELECT RAISE(ABORT, 'canon is full: 40 active rules'); END;

-- Every change to the canon, with the reason, so the owner can see and undo it.
CREATE TABLE canon_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  rule_id TEXT NOT NULL REFERENCES canon_rules(id),
  action TEXT NOT NULL,
  detail TEXT NOT NULL,
  at TEXT NOT NULL
);
CREATE INDEX canon_log_rule ON canon_log(rule_id);

-- Swipe file: real ads and why they work. The writer reads them as examples, never to copy.
CREATE TABLE swipe (
  id TEXT PRIMARY KEY,
  brand_slug TEXT,
  stage TEXT NOT NULL CHECK (stage IN ('tof', 'mof', 'bof', 'other')),
  title TEXT NOT NULL,
  why TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('owner pick', 'client winner', 'v1 used', 'research')),
  source_url TEXT,
  image_key TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX swipe_lookup ON swipe(brand_slug, stage, created_at);

-- Gold set: ads the owner marked (v1 marks and later picks). The critic re-ranks it before a canon or prompt change ships.
CREATE TABLE gold_items (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  stage TEXT CHECK (stage IN ('tof', 'mof', 'bof', 'other')),
  headline TEXT,
  image_key TEXT,
  mark TEXT NOT NULL CHECK (mark IN ('use', 'pass')),
  note TEXT,
  source TEXT NOT NULL DEFAULT 'v1',
  created_at TEXT NOT NULL
);
CREATE TABLE gold_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  note TEXT NOT NULL,
  n INTEGER NOT NULL,
  agreed INTEGER NOT NULL,
  at TEXT NOT NULL
);
