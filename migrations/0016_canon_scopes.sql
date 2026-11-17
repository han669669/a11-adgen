-- a11-engine v3 Phase 5 (kickoff unit 8b, audit §9.2): canon scopes, so owner taste, brand lessons, creative principles
-- and performance lessons stay apart (specification §9.7). Product truth is never a canon rule: it stays in facts and the kit.
-- Additive: no row is changed. Every rule that exists gets scope 'owner' and no brand.
-- Rollback: rollback/0016_canon_scopes.down.sql (retire the brand rules first: the old code shows every rule to every brand).

ALTER TABLE canon_rules ADD COLUMN scope TEXT NOT NULL DEFAULT 'owner' CHECK (scope IN ('owner', 'brand', 'creative', 'performance'));
-- The brand of a brand rule (brands.slug). Only a brand rule has one.
ALTER TABLE canon_rules ADD COLUMN brand_slug TEXT;
CREATE INDEX canon_scope ON canon_rules(scope, brand_slug, status);

-- A brand rule names a brand that exists; no other rule names a brand.
CREATE TRIGGER canon_scope_brand_insert BEFORE INSERT ON canon_rules
WHEN (NEW.scope = 'brand' AND (NEW.brand_slug IS NULL OR NOT EXISTS (SELECT 1 FROM brands WHERE slug = NEW.brand_slug)))
  OR (NEW.scope != 'brand' AND NEW.brand_slug IS NOT NULL)
BEGIN SELECT RAISE(ABORT, 'canon scope: a brand rule needs a brand that exists, and only a brand rule has one'); END;
CREATE TRIGGER canon_scope_brand_update BEFORE UPDATE OF scope, brand_slug ON canon_rules
WHEN (NEW.scope = 'brand' AND (NEW.brand_slug IS NULL OR NOT EXISTS (SELECT 1 FROM brands WHERE slug = NEW.brand_slug)))
  OR (NEW.scope != 'brand' AND NEW.brand_slug IS NOT NULL)
BEGIN SELECT RAISE(ABORT, 'canon scope: a brand rule needs a brand that exists, and only a brand rule has one'); END;

-- The limit of 40 active rules is for the rules that every batch reads (not brand rules), as before.
-- Each brand has its own limit of 10 active rules, so one brand's lessons cannot push out the owner's taste.
DROP TRIGGER canon_active_limit_insert;
DROP TRIGGER canon_active_limit_restore;
CREATE TRIGGER canon_active_limit_insert BEFORE INSERT ON canon_rules
WHEN NEW.status = 'active' AND NEW.scope != 'brand'
  AND (SELECT COUNT(*) FROM canon_rules WHERE status = 'active' AND scope != 'brand') >= 40
BEGIN SELECT RAISE(ABORT, 'canon is full: 40 active rules'); END;
CREATE TRIGGER canon_active_limit_update BEFORE UPDATE OF status, scope ON canon_rules
WHEN NEW.status = 'active' AND NEW.scope != 'brand'
  AND (SELECT COUNT(*) FROM canon_rules WHERE status = 'active' AND scope != 'brand' AND id != NEW.id) >= 40
BEGIN SELECT RAISE(ABORT, 'canon is full: 40 active rules'); END;
CREATE TRIGGER canon_brand_limit_insert BEFORE INSERT ON canon_rules
WHEN NEW.status = 'active' AND NEW.scope = 'brand'
  AND (SELECT COUNT(*) FROM canon_rules WHERE status = 'active' AND scope = 'brand' AND brand_slug = NEW.brand_slug) >= 10
BEGIN SELECT RAISE(ABORT, 'brand canon is full: 10 active rules for this brand'); END;
CREATE TRIGGER canon_brand_limit_update BEFORE UPDATE OF status, scope, brand_slug ON canon_rules
WHEN NEW.status = 'active' AND NEW.scope = 'brand'
  AND (SELECT COUNT(*) FROM canon_rules WHERE status = 'active' AND scope = 'brand' AND brand_slug = NEW.brand_slug AND id != NEW.id) >= 10
BEGIN SELECT RAISE(ABORT, 'brand canon is full: 10 active rules for this brand'); END;
