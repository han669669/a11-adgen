-- Rollback of 0015_engine_v3.sql, only if the owner asks for it. Run it as a new migration file (copy it to the next number).
-- It puts back the pick limit of 0004_funnel.sql: 1 idea per stage for every batch. A trigger checks only new writes, so
-- rows that exist stay as they are. The new columns and tables stay; the old code does not read them.
DROP TRIGGER ideas_pick_cap_insert;
DROP TRIGGER ideas_pick_cap_update;
DROP TRIGGER ideas_pick_old_format_insert;
DROP TRIGGER ideas_pick_old_format_update;

CREATE TRIGGER ideas_pick_limit_insert BEFORE INSERT ON ideas
WHEN NEW.picked = 1 AND (SELECT COUNT(*) FROM ideas WHERE batch_id = NEW.batch_id AND format = NEW.format AND picked = 1)
  >= 1
BEGIN
  SELECT RAISE(ABORT, 'Pick limit: 1 idea per stage per batch.');
END;

CREATE TRIGGER ideas_pick_limit_update BEFORE UPDATE OF picked, format, batch_id ON ideas
WHEN NEW.picked = 1 AND (SELECT COUNT(*) FROM ideas WHERE batch_id = NEW.batch_id AND format = NEW.format AND picked = 1 AND id != NEW.id)
  >= 1
BEGIN
  SELECT RAISE(ABORT, 'Pick limit: 1 idea per stage per batch.');
END;
