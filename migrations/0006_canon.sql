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
CREATE INDEX swipe_stage ON swipe(stage, created_at);

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
  created_at TEXT NOT NULL,
  UNIQUE (source, label)
);
CREATE TABLE gold_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  note TEXT NOT NULL,
  n INTEGER NOT NULL,
  agreed INTEGER NOT NULL,
  at TEXT NOT NULL
);

-- Seed: the owner's taste so far, from docs/taste-seed.md and docs/marks.md (same rules as docs/canon-seed.json; a test keeps them equal).
-- Evidence with a "quote" holds the owner's own words. Evidence with a "doc" holds the wording of taste-seed.md, which sums up his marks and is not his own words.
-- Ids are the first 8 hex digits of the SHA-256 of the rule text.
INSERT INTO canon_rules (id, stage, text, evidence, created_at, updated_at, last_evidence_at) VALUES ('18bb1bb4', 'all', 'The headline carries the ad. It must stop the scroll and send the eye to the product with curiosity. A good headline does not save a weak image either.', '[{"at": "2026-11-07T00:00:00.000Z", "source": "taste-seed §1, han 2026-10-21", "quote": "extremely crucial critical"}]', '2026-11-07T00:00:00.000Z', '2026-11-07T00:00:00.000Z', '2026-11-07T00:00:00.000Z');
INSERT INTO canon_log (rule_id, action, detail, at) VALUES ('18bb1bb4', 'add', '{"rule": "The headline carries the ad. It must stop the scroll and send the eye to the product with curiosity. A good headline does not save a weak image either.", "source": "taste-seed §1, han 2026-10-21"}', '2026-11-07T00:00:00.000Z');
INSERT INTO canon_rules (id, stage, text, evidence, created_at, updated_at, last_evidence_at) VALUES ('4d2c3cb2', 'all', 'Generic, average or pointless headlines and boring concepts are a Pass. Prefer an oddly specific true detail or a buyer''s own words, used word for word.', '[{"at": "2026-11-07T00:00:00.000Z", "source": "taste-seed §1 (B41, B43)", "quote": "boring, non-creative concepts"}]', '2026-11-07T00:00:00.000Z', '2026-11-07T00:00:00.000Z', '2026-11-07T00:00:00.000Z');
INSERT INTO canon_log (rule_id, action, detail, at) VALUES ('4d2c3cb2', 'add', '{"rule": "Generic, average or pointless headlines and boring concepts are a Pass. Prefer an oddly specific true detail or a buyer''s own words, used word for word.", "source": "taste-seed §1 (B41, B43)"}', '2026-11-07T00:00:00.000Z');
INSERT INTO canon_rules (id, stage, text, evidence, created_at, updated_at, last_evidence_at) VALUES ('78c19bcc', 'all', 'Calm ads win: one focal product, little to look at.', '[{"at": "2026-11-07T00:00:00.000Z", "source": "taste-seed §1 (B41)", "quote": "because they weren''t chaotic or busy like B39"}]', '2026-11-07T00:00:00.000Z', '2026-11-07T00:00:00.000Z', '2026-11-07T00:00:00.000Z');
INSERT INTO canon_log (rule_id, action, detail, at) VALUES ('78c19bcc', 'add', '{"rule": "Calm ads win: one focal product, little to look at.", "source": "taste-seed §1 (B41)"}', '2026-11-07T00:00:00.000Z');
INSERT INTO canon_rules (id, stage, text, evidence, created_at, updated_at, last_evidence_at) VALUES ('a38f605b', 'all', 'A clever object that IS the headline''s idea is the best kind of ad (butter on toast, a zested lemon, an empty snail shell for ''The snail had a good run.'').', '[{"at": "2026-11-07T00:00:00.000Z", "source": "taste-seed §1 (B19, B15)", "doc": "A clever object that IS the headline''s idea"}]', '2026-11-07T00:00:00.000Z', '2026-11-07T00:00:00.000Z', '2026-11-07T00:00:00.000Z');
INSERT INTO canon_log (rule_id, action, detail, at) VALUES ('a38f605b', 'add', '{"rule": "A clever object that IS the headline''s idea is the best kind of ad (butter on toast, a zested lemon, an empty snail shell for ''The snail had a good run.'').", "source": "taste-seed §1 (B19, B15)"}', '2026-11-07T00:00:00.000Z');
INSERT INTO canon_rules (id, stage, text, evidence, created_at, updated_at, last_evidence_at) VALUES ('2b1eaeeb', 'all', 'Add a short, true supporting line under the headline when the product page backs it. Without it the ad feels incomplete.', '[{"at": "2026-11-07T00:00:00.000Z", "source": "taste-seed §1 (B43, B45)", "doc": "A true supporting tagline under the headline"}]', '2026-11-07T00:00:00.000Z', '2026-11-07T00:00:00.000Z', '2026-11-07T00:00:00.000Z');
INSERT INTO canon_log (rule_id, action, detail, at) VALUES ('2b1eaeeb', 'add', '{"rule": "Add a short, true supporting line under the headline when the product page backs it. Without it the ad feels incomplete.", "source": "taste-seed §1 (B43, B45)"}', '2026-11-07T00:00:00.000Z');
INSERT INTO canon_rules (id, stage, text, evidence, created_at, updated_at, last_evidence_at) VALUES ('d35bc0e0', 'all', 'Show a real serving only when it shows what the pack hides (the tart inside the tin, the layers) or the size of a food sold by weight.', '[{"at": "2026-11-07T00:00:00.000Z", "source": "taste-seed §1", "doc": "A real serving only when it shows what the pack hides"}]', '2026-11-07T00:00:00.000Z', '2026-11-07T00:00:00.000Z', '2026-11-07T00:00:00.000Z');
INSERT INTO canon_log (rule_id, action, detail, at) VALUES ('d35bc0e0', 'add', '{"rule": "Show a real serving only when it shows what the pack hides (the tart inside the tin, the layers) or the size of a food sold by weight.", "source": "taste-seed §1"}', '2026-11-07T00:00:00.000Z');
INSERT INTO canon_rules (id, stage, text, evidence, created_at, updated_at, last_evidence_at) VALUES ('64556fa7', 'all', 'Every prop, sticker, tagline and callout must add meaning. One filler prop (a spare bowl, spoon, plate, blanket, saucer, ice tray, glass of water) turns a good ad into a reject. An upturned bowl reads unlucky.', '[{"at": "2026-11-07T00:00:00.000Z", "source": "taste-seed §1 (HFM-muse)", "doc": "Props that add no meaning"}]', '2026-11-07T00:00:00.000Z', '2026-11-07T00:00:00.000Z', '2026-11-07T00:00:00.000Z');
INSERT INTO canon_log (rule_id, action, detail, at) VALUES ('64556fa7', 'add', '{"rule": "Every prop, sticker, tagline and callout must add meaning. One filler prop (a spare bowl, spoon, plate, blanket, saucer, ice tray, glass of water) turns a good ad into a reject. An upturned bowl reads unlucky.", "source": "taste-seed §1 (HFM-muse)"}', '2026-11-07T00:00:00.000Z');
INSERT INTO canon_rules (id, stage, text, evidence, created_at, updated_at, last_evidence_at) VALUES ('c2dbc06e', 'all', 'Props match the brand''s level (a fine Chinese teacup for a heritage brand), never cheap props (tote, foil, plastic bottle).', '[{"at": "2026-11-07T00:00:00.000Z", "source": "taste-seed §1 (B43)", "doc": "Props that match the brand''s level"}]', '2026-11-07T00:00:00.000Z', '2026-11-07T00:00:00.000Z', '2026-11-07T00:00:00.000Z');
INSERT INTO canon_log (rule_id, action, detail, at) VALUES ('c2dbc06e', 'add', '{"rule": "Props match the brand''s level (a fine Chinese teacup for a heritage brand), never cheap props (tote, foil, plastic bottle).", "source": "taste-seed §1 (B43)"}', '2026-11-07T00:00:00.000Z');
INSERT INTO canon_rules (id, stage, text, evidence, created_at, updated_at, last_evidence_at) VALUES ('b0903092', 'all', 'No AI slop: no drip on a cup, no painted prepared food, no doubled or flat-printed product, no garbled letters.', '[{"at": "2026-11-07T00:00:00.000Z", "source": "taste-seed §1 (B44)", "quote": "very ai slop looking less premium"}]', '2026-11-07T00:00:00.000Z', '2026-11-07T00:00:00.000Z', '2026-11-07T00:00:00.000Z');
INSERT INTO canon_log (rule_id, action, detail, at) VALUES ('b0903092', 'add', '{"rule": "No AI slop: no drip on a cup, no painted prepared food, no doubled or flat-printed product, no garbled letters.", "source": "taste-seed §1 (B44)"}', '2026-11-07T00:00:00.000Z');
INSERT INTO canon_rules (id, stage, text, evidence, created_at, updated_at, last_evidence_at) VALUES ('d1418934', 'all', 'A wrong or garbled logo, or a logo outside the safe zone, rejects the ad by itself. Draw the real logo file in code, never paint it.', '[{"at": "2026-11-07T00:00:00.000Z", "source": "taste-seed §1 (HFB5b)", "doc": "A wrong or garbled logo, or a logo outside the safe zone: that alone rejects the ad"}]', '2026-11-07T00:00:00.000Z', '2026-11-07T00:00:00.000Z', '2026-11-07T00:00:00.000Z');
INSERT INTO canon_log (rule_id, action, detail, at) VALUES ('d1418934', 'add', '{"rule": "A wrong or garbled logo, or a logo outside the safe zone, rejects the ad by itself. Draw the real logo file in code, never paint it.", "source": "taste-seed §1 (HFB5b)"}', '2026-11-07T00:00:00.000Z');
INSERT INTO canon_rules (id, stage, text, evidence, created_at, updated_at, last_evidence_at) VALUES ('78dc3ae1', 'all', 'Food must look like the real product''s own food, from its real photo, and look appetising. Painted food, glossy round kernels and plastic-looking colour are rejected.', '[{"at": "2026-11-07T00:00:00.000Z", "source": "marks.md, W46c", "quote": "food seems ai slop not true to actual real life product"}]', '2026-11-07T00:00:00.000Z', '2026-11-07T00:00:00.000Z', '2026-11-07T00:00:00.000Z');
INSERT INTO canon_log (rule_id, action, detail, at) VALUES ('78dc3ae1', 'add', '{"rule": "Food must look like the real product''s own food, from its real photo, and look appetising. Painted food, glossy round kernels and plastic-looking colour are rejected.", "source": "marks.md, W46c"}', '2026-11-07T00:00:00.000Z');
INSERT INTO canon_rules (id, stage, text, evidence, created_at, updated_at, last_evidence_at) VALUES ('bdfcb33a', 'all', 'Do not push food colour past the real photo: a richer caramel colour looked fake and plastic.', '[{"at": "2026-11-07T00:00:00.000Z", "source": "marks.md, W46c v4", "quote": "simply fake looking plastic looking"}]', '2026-11-07T00:00:00.000Z', '2026-11-07T00:00:00.000Z', '2026-11-07T00:00:00.000Z');
INSERT INTO canon_log (rule_id, action, detail, at) VALUES ('bdfcb33a', 'add', '{"rule": "Do not push food colour past the real photo: a richer caramel colour looked fake and plastic.", "source": "marks.md, W46c v4"}', '2026-11-07T00:00:00.000Z');
INSERT INTO canon_rules (id, stage, text, evidence, created_at, updated_at, last_evidence_at) VALUES ('9787d61f', 'all', 'The product''s container keeps its real shape, height, width and camera angle. Build it from the real packshot pixels, never from a model redraw.', '[{"at": "2026-11-07T00:00:00.000Z", "source": "marks.md, W46c", "quote": "the product''s container doesn''t match real life too, the dimensions height and width"}]', '2026-11-07T00:00:00.000Z', '2026-11-07T00:00:00.000Z', '2026-11-07T00:00:00.000Z');
INSERT INTO canon_log (rule_id, action, detail, at) VALUES ('9787d61f', 'add', '{"rule": "The product''s container keeps its real shape, height, width and camera angle. Build it from the real packshot pixels, never from a model redraw.", "source": "marks.md, W46c"}', '2026-11-07T00:00:00.000Z');
INSERT INTO canon_rules (id, stage, text, evidence, created_at, updated_at, last_evidence_at) VALUES ('2fc5d7f0', 'all', 'In a row of identical packs the food must differ pack to pack. No pattern may be visible to the eye.', '[{"at": "2026-11-07T00:00:00.000Z", "source": "marks.md, W46c v5-v6", "quote": "there can be no patterns Discernible decipherable from a human eye"}]', '2026-11-07T00:00:00.000Z', '2026-11-07T00:00:00.000Z', '2026-11-07T00:00:00.000Z');
INSERT INTO canon_log (rule_id, action, detail, at) VALUES ('2fc5d7f0', 'add', '{"rule": "In a row of identical packs the food must differ pack to pack. No pattern may be visible to the eye.", "source": "marks.md, W46c v5-v6"}', '2026-11-07T00:00:00.000Z');
INSERT INTO canon_rules (id, stage, text, evidence, created_at, updated_at, last_evidence_at) VALUES ('c8668c6e', 'all', 'A pasted product must sit in the scene: the same light, shadow and blending as the room. It must not look pasted in.', '[{"at": "2026-11-07T00:00:00.000Z", "source": "marks.md, W46c v7", "quote": "it looks pasted in"}]', '2026-11-07T00:00:00.000Z', '2026-11-07T00:00:00.000Z', '2026-11-07T00:00:00.000Z');
INSERT INTO canon_log (rule_id, action, detail, at) VALUES ('c8668c6e', 'add', '{"rule": "A pasted product must sit in the scene: the same light, shadow and blending as the room. It must not look pasted in.", "source": "marks.md, W46c v7"}', '2026-11-07T00:00:00.000Z');
INSERT INTO canon_rules (id, stage, text, evidence, created_at, updated_at, last_evidence_at) VALUES ('7c58a402', 'all', 'The brand logo must be big enough to read at a glance, with breathing room above it.', '[{"at": "2026-11-07T00:00:00.000Z", "source": "marks.md, W46c v2 and v3 (the numbers for width and top are in creative-playbook §7.4 Logo room)", "quote": "the wongi logo branding needs to be big enough"}]', '2026-11-07T00:00:00.000Z', '2026-11-07T00:00:00.000Z', '2026-11-07T00:00:00.000Z');
INSERT INTO canon_log (rule_id, action, detail, at) VALUES ('7c58a402', 'add', '{"rule": "The brand logo must be big enough to read at a glance, with breathing room above it.", "source": "marks.md, W46c v2 and v3 (the numbers for width and top are in creative-playbook §7.4 Logo room)"}', '2026-11-07T00:00:00.000Z');
INSERT INTO canon_rules (id, stage, text, evidence, created_at, updated_at, last_evidence_at) VALUES ('1a4752aa', 'all', 'A moment in the copy must be true to Singapore life. Do not invent habits.', '[{"at": "2026-11-07T00:00:00.000Z", "source": "taste-seed §1", "doc": "Baking lapis this CNY? Not again."}]', '2026-11-07T00:00:00.000Z', '2026-11-07T00:00:00.000Z', '2026-11-07T00:00:00.000Z');
INSERT INTO canon_log (rule_id, action, detail, at) VALUES ('1a4752aa', 'add', '{"rule": "A moment in the copy must be true to Singapore life. Do not invent habits.", "source": "taste-seed §1"}', '2026-11-07T00:00:00.000Z');
INSERT INTO canon_rules (id, stage, text, evidence, created_at, updated_at, last_evidence_at) VALUES ('708872ea', 'all', 'Never name or hint at an ethnicity, race or religion, or a negative association. Reject on sight.', '[{"at": "2026-11-07T00:00:00.000Z", "source": "taste-seed §1 (HFX-mix2, 2026-10-25)", "quote": "really really bad headline, sounds racist"}]', '2026-11-07T00:00:00.000Z', '2026-11-07T00:00:00.000Z', '2026-11-07T00:00:00.000Z');
INSERT INTO canon_log (rule_id, action, detail, at) VALUES ('708872ea', 'add', '{"rule": "Never name or hint at an ethnicity, race or religion, or a negative association. Reject on sight.", "source": "taste-seed §1 (HFX-mix2, 2026-10-25)"}', '2026-11-07T00:00:00.000Z');
INSERT INTO canon_rules (id, stage, text, evidence, created_at, updated_at, last_evidence_at) VALUES ('6b9b36f1', 'all', 'Filler stickers and taglines are a Pass: shelf life, thin review counts, a rating line that adds nothing, a useless discount sticker. Keep taglines short and useful.', '[{"at": "2026-11-07T00:00:00.000Z", "source": "taste-seed §1", "quote": "useless 15% off tagline sticker"}]', '2026-11-07T00:00:00.000Z', '2026-11-07T00:00:00.000Z', '2026-11-07T00:00:00.000Z');
INSERT INTO canon_log (rule_id, action, detail, at) VALUES ('6b9b36f1', 'add', '{"rule": "Filler stickers and taglines are a Pass: shelf life, thin review counts, a rating line that adds nothing, a useless discount sticker. Keep taglines short and useful.", "source": "taste-seed §1"}', '2026-11-07T00:00:00.000Z');
INSERT INTO canon_rules (id, stage, text, evidence, created_at, updated_at, last_evidence_at) VALUES ('c0049d36', 'tof', 'A top-of-funnel ad carries no offer sticker.', '[{"at": "2026-11-07T00:00:00.000Z", "source": "taste-seed §1", "doc": "An offer sticker on a ToF ad"}]', '2026-11-07T00:00:00.000Z', '2026-11-07T00:00:00.000Z', '2026-11-07T00:00:00.000Z');
INSERT INTO canon_log (rule_id, action, detail, at) VALUES ('c0049d36', 'add', '{"rule": "A top-of-funnel ad carries no offer sticker.", "source": "taste-seed §1"}', '2026-11-07T00:00:00.000Z');
INSERT INTO canon_rules (id, stage, text, evidence, created_at, updated_at, last_evidence_at) VALUES ('0b78dc2d', 'bof', 'A bottom-of-funnel ad needs a real reason to buy now and a correct price.', '[{"at": "2026-11-07T00:00:00.000Z", "source": "taste-seed §1", "doc": "A BoF ad with no reason to buy now"}]', '2026-11-07T00:00:00.000Z', '2026-11-07T00:00:00.000Z', '2026-11-07T00:00:00.000Z');
INSERT INTO canon_log (rule_id, action, detail, at) VALUES ('0b78dc2d', 'add', '{"rule": "A bottom-of-funnel ad needs a real reason to buy now and a correct price.", "source": "taste-seed §1"}', '2026-11-07T00:00:00.000Z');
INSERT INTO canon_rules (id, stage, text, evidence, created_at, updated_at, last_evidence_at) VALUES ('a19f48a1', 'all', 'The flavour named in the headline is the flavour in the picture.', '[{"at": "2026-11-07T00:00:00.000Z", "source": "taste-seed §1 (HFB5b, HFB6)", "doc": "A headline flavour that is not the slice in front"}]', '2026-11-07T00:00:00.000Z', '2026-11-07T00:00:00.000Z', '2026-11-07T00:00:00.000Z');
INSERT INTO canon_log (rule_id, action, detail, at) VALUES ('a19f48a1', 'add', '{"rule": "The flavour named in the headline is the flavour in the picture.", "source": "taste-seed §1 (HFB5b, HFB6)"}', '2026-11-07T00:00:00.000Z');
INSERT INTO canon_rules (id, stage, text, evidence, created_at, updated_at, last_evidence_at) VALUES ('6a751c3c', 'all', 'No unneeded hands, no wrong scale and no busy layouts.', '[{"at": "2026-11-07T00:00:00.000Z", "source": "taste-seed §1", "doc": "Unneeded hands, wrong scale, cheap props"}]', '2026-11-07T00:00:00.000Z', '2026-11-07T00:00:00.000Z', '2026-11-07T00:00:00.000Z');
INSERT INTO canon_log (rule_id, action, detail, at) VALUES ('6a751c3c', 'add', '{"rule": "No unneeded hands, no wrong scale and no busy layouts.", "source": "taste-seed §1"}', '2026-11-07T00:00:00.000Z');
