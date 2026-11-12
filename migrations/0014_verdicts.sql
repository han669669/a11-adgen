-- One row for each thing the owner said about a draft, a final or pack copy (docs/design/owner-verdicts.md).
-- A draft pick stays in picks. Rows are only added, never changed.
CREATE TABLE verdicts (
  id TEXT PRIMARY KEY,                    -- a UUID; the backfill uses fixed ids, so a second run adds nothing
  batch_id TEXT REFERENCES batches(id),   -- NULL only for an ad that was made in no batch (the Phase 0 ads)
  idea_id TEXT,                           -- the idea, when the verdict is about one idea (it must be an idea of batch_id)
  render_key TEXT,                        -- the draft or final picture, when the verdict is about one picture
  pack_id TEXT REFERENCES packs(id),      -- the pack version, for a verdict on the copy of a published pack
  stage TEXT NOT NULL CHECK (stage IN ('draft', 'final', 'pack')),
  mark TEXT CHECK (mark IN ('pass', 'fix', 'approve', 'reject')),
  source_mark TEXT,                       -- backfill only: the Mark cell of docs/marks.md, as written
  owner_said TEXT NOT NULL CHECK (length(owner_said) BETWEEN 1 AND 2000),
  notes TEXT,                             -- evidence that is not his words: a measured ratio, a version label
  created_at TEXT NOT NULL,
  CHECK (mark IS NOT NULL OR source_mark IS NOT NULL),
  -- Each stage has its own marks: 'pass' is only for the 3 drafts of an idea, 'approve' and 'reject' are not for a draft.
  CHECK (mark IS NULL
    OR (stage = 'draft' AND mark IN ('pass', 'fix'))
    OR (stage IN ('final', 'pack') AND mark IN ('fix', 'approve', 'reject'))),
  CHECK (stage <> 'pack' OR batch_id IS NOT NULL),
  FOREIGN KEY (idea_id, batch_id) REFERENCES ideas(id, batch_id)   -- the same composite key as picks and draft_ranks
);
CREATE INDEX verdicts_recent ON verdicts (created_at);
CREATE INDEX verdicts_batch ON verdicts (batch_id, created_at);
