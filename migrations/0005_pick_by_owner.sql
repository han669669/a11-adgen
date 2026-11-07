-- The owner picks the drafts (2026-11-07). Picks made before this file stay as they were: Claude's.
-- by_owner = 1 marks a pick the owner made; the taste log reads only those.
ALTER TABLE picks ADD COLUMN by_owner INTEGER NOT NULL DEFAULT 0;
