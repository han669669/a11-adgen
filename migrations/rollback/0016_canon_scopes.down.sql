-- Rollback of 0016_canon_scopes.sql, only if the owner asks for it. Run it as a new migration file (copy it to the next number).
-- Retire every brand rule first: the old code does not read the scope, so it would show a brand's rules to every brand.
-- It puts back the limit of 0006_canon.sql: 40 active rules of every scope. The new columns stay; the old code does not read them.
DROP TRIGGER canon_scope_brand_insert;
DROP TRIGGER canon_scope_brand_update;
DROP TRIGGER canon_active_limit_insert;
DROP TRIGGER canon_active_limit_update;
DROP TRIGGER canon_brand_limit_insert;
DROP TRIGGER canon_brand_limit_update;

CREATE TRIGGER canon_active_limit_insert BEFORE INSERT ON canon_rules
WHEN NEW.status = 'active' AND (SELECT COUNT(*) FROM canon_rules WHERE status = 'active') >= 40
BEGIN SELECT RAISE(ABORT, 'canon is full: 40 active rules'); END;
CREATE TRIGGER canon_active_limit_restore BEFORE UPDATE OF status ON canon_rules
WHEN NEW.status = 'active' AND OLD.status != 'active' AND (SELECT COUNT(*) FROM canon_rules WHERE status = 'active') >= 40
BEGIN SELECT RAISE(ABORT, 'canon is full: 40 active rules'); END;
