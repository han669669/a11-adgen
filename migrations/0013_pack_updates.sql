-- pack_update: put newer approved ads and their Meta text into an existing pack, in place. The link, the ad names, the comments and the uploads stay.
-- One row per change. old_content is the pack's content before the change, so nothing is lost and pack_update undo can put it back.
CREATE TABLE pack_updates (
  id TEXT PRIMARY KEY,
  pack_id TEXT NOT NULL REFERENCES packs(id),
  from_pack_id TEXT NOT NULL REFERENCES packs(id),  -- the pack whose ads and text were copied in
  old_content TEXT NOT NULL,
  created_at TEXT NOT NULL,
  undone_at TEXT                                    -- set when pack_update undo put old_content back
);
CREATE INDEX pack_updates_pack ON pack_updates (pack_id, created_at);
