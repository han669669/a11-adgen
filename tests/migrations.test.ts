import { readdirSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { fakeD1 } from "./helpers/d1";

const sql = (name: string) => readFileSync(new URL(`../migrations/${name}`, import.meta.url), "utf8");

describe("0004_funnel on a database with rows", () => {
  it("keeps every idea, draft rank and pick, and keeps the foreign keys valid", () => {
    const db = new DatabaseSync(":memory:");
    db.exec("PRAGMA foreign_keys = ON");
    for (const f of ["0001_init.sql", "0002_core.sql", "0003_auth.sql"]) db.exec(sql(f));
    db.exec(`
      INSERT INTO brands (id, slug, name, created_at, updated_at) VALUES ('br', 'wongi', 'WonGi', 't', 't');
      INSERT INTO subjects (id, brand_id, kind, title, created_at) VALUES ('su', 'br', 'product', 'Pop Barley', 't');
      INSERT INTO batches (id, brand_id, subject_id, kit_version, label, status, created_at, updated_at)
        VALUES ('ba', 'br', 'su', 1, 'W46', 'board', 't', 't');
      INSERT INTO ideas (id, batch_id, n, format, insight, source_url, visual, headline, copy, picked, final_prompt, final_refs, created_at)
        VALUES ('i1', 'ba', 1, 'hook', 'in1', 'https://example.com/src', 'v1', 'No flight to Taiwan needed.', '{"subline":"s"}', 1, 'final', '["https://example.com/texture.jpg"]', 't1'),
               ('i2', 'ba', 2, 'offer', 'in2', NULL, 'v2', 'Four jars.', '{}', 0, NULL, '[]', 't2');
      INSERT INTO draft_ranks (render_key, batch_id, idea_id, rank, created_at) VALUES ('renders/r/1.jpg', 'ba', 'i1', 1, 't');
      INSERT INTO picks (render_key, batch_id, idea_id, created_at) VALUES ('renders/r/1.jpg', 'ba', 'i1', 't');
    `);
    db.exec("BEGIN");
    db.exec(sql("0004_funnel.sql"));
    db.exec("COMMIT");

    expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    expect(db.prepare("SELECT * FROM ideas ORDER BY n").all()).toEqual([
      { id: "i1", batch_id: "ba", n: 1, format: "hook", insight: "in1", source_url: "https://example.com/src", visual: "v1", headline: "No flight to Taiwan needed.",
        copy: '{"subline":"s"}', picked: 1, final_prompt: "final", final_refs: '["https://example.com/texture.jpg"]', created_at: "t1" },
      { id: "i2", batch_id: "ba", n: 2, format: "offer", insight: "in2", source_url: null, visual: "v2", headline: "Four jars.",
        copy: "{}", picked: 0, final_prompt: null, final_refs: "[]", created_at: "t2" },
    ]);
    expect(db.prepare("SELECT COUNT(*) AS n FROM draft_ranks").get()).toEqual({ n: 1 });
    expect(db.prepare("SELECT COUNT(*) AS n FROM picks").get()).toEqual({ n: 1 });
    // Old formats keep their old limit of one pick each.
    expect(() =>
      db.exec("INSERT INTO ideas (id, batch_id, n, format, insight, visual, headline, picked, created_at) VALUES ('i3', 'ba', 3, 'hook', 'x', 'x', 'x', 1, 't')"),
    ).toThrow("Pick limit");
    // The child tables still point at the rebuilt ideas table.
    expect(() =>
      db.exec("INSERT INTO picks (render_key, batch_id, idea_id, created_at) VALUES ('renders/r/2.jpg', 'ba', 'nope', 't')"),
    ).toThrow(/FOREIGN KEY/);
  });
});

describe("0014_verdicts", () => {
  // A fresh database for each test, so each test runs alone too.
  const fresh = () => {
    const db = fakeD1().raw;
    db.exec(`
    INSERT INTO brands (id, slug, name, created_at, updated_at) VALUES ('br', 'wongi', 'WonGi', 't', 't');
    INSERT INTO subjects (id, brand_id, kind, title, created_at) VALUES ('su', 'br', 'product', 'Pop Barley', 't');
    INSERT INTO batches (id, brand_id, subject_id, kit_version, label, status, created_at, updated_at)
      VALUES ('ba', 'br', 'su', 1, 'W46', 'board', 't', 't'), ('bb', 'br', 'su', 1, 'W47', 'board', 't', 't');
    INSERT INTO ideas (id, batch_id, n, format, insight, visual, headline, created_at) VALUES ('i1', 'ba', 1, 'tof', 'x', 'x', 'x', 't');
    INSERT INTO packs (id, batch_id, version, token_hash, title, content, created_at) VALUES ('p1', 'ba', 1, 'h', 't', '{}', 't');
    INSERT INTO packs (id, batch_id, version, token_hash, title, content, created_at) VALUES ('p2', 'bb', 1, 'h2', 't', '{}', 't');
  `);
    const add = (cols: string, vals: string) => db.exec(`INSERT INTO verdicts (${cols}, owner_said, created_at) VALUES (${vals}, 'his words', 't')`);
    return { db, add };
  };

  it("takes one row of each stage, and an old row with a source mark only", () => {
    const { db, add } = fresh();
    add("id, batch_id, idea_id, stage, mark", "'v1', 'ba', 'i1', 'draft', 'pass'");
    add("id, batch_id, render_key, stage, mark", "'v2', 'ba', 'renders/r/1.jpg', 'final', 'fix'");
    add("id, batch_id, pack_id, stage, mark", "'v3', 'ba', 'p1', 'pack', 'approve'");
    add("id, batch_id, stage, mark", "'v4', 'ba', 'pack', 'reject'"); // copy he refused before a pack existed
    add("id, stage, source_mark", "'v5', 'final', 'Corrected'"); // a Phase 0 ad: no batch, no clear mark
    expect(db.prepare("SELECT COUNT(*) AS n FROM verdicts").get()).toEqual({ n: 5 });
  });

  it("refuses a bad row", () => {
    const { db, add } = fresh();
    add("id, batch_id, stage, mark", "'v2', 'ba', 'final', 'fix'");
    expect(() => add("id, batch_id, stage", "'x1', 'ba', 'final'")).toThrow(/CHECK/); // no mark and no source mark
    expect(() => add("id, batch_id, stage, mark", "'x2', 'ba', 'final', 'pass'")).toThrow(/CHECK/); // 'pass' is for drafts
    expect(() => add("id, batch_id, stage, mark", "'x3', 'ba', 'draft', 'approve'")).toThrow(/CHECK/);
    expect(() => add("id, stage, mark", "'x4', 'pack', 'approve'")).toThrow(/CHECK/); // pack copy belongs to a batch
    expect(() => add("id, batch_id, stage, mark", "'x5', 'ba', 'board', 'fix'")).toThrow(/CHECK/);
    expect(() => add("id, batch_id, idea_id, stage, mark", "'x6', 'bb', 'i1', 'draft', 'pass'")).toThrow(/FOREIGN KEY/); // an idea of another batch
    expect(() => add("id, batch_id, pack_id, stage, mark", "'x7', 'ba', 'nope', 'pack', 'approve'")).toThrow(/FOREIGN KEY|not a pack of this batch/);
    expect(() => db.exec("INSERT INTO verdicts (id, batch_id, stage, mark, owner_said, created_at) VALUES ('x8', 'ba', 'final', 'fix', '', 't')")).toThrow(/CHECK/);
    expect(() => add("id, batch_id, stage, mark", "'v2', 'ba', 'final', 'fix'")).toThrow(/UNIQUE|PRIMARY/);
    expect(() => add("id, batch_id, stage, mark", "NULL, 'ba', 'final', 'fix'")).toThrow(/NOT NULL/);
    expect(() => add("id, batch_id, stage, mark", "'x9', 'ba', 'draft', 'pass'")).toThrow(/CHECK/); // a draft verdict needs its idea
    expect(() => add("id, idea_id, stage, mark", "'x10', 'i1', 'final', 'fix'")).toThrow(/CHECK/); // an idea needs its batch
    expect(() => add("id, batch_id, pack_id, stage, mark", "'x11', 'ba', 'p2', 'pack', 'approve'")).toThrow(/not a pack of this batch/);
  });
});

describe("0015_engine_v3", () => {
  const before = readdirSync(new URL("../migrations/", import.meta.url))
    .filter((n) => n.endsWith(".sql") && n < "0015")
    .sort();
  /** A database at 0014 with rows of an engine 2 batch and an old-format batch, then 0015 in one transaction. */
  const migrated = () => {
    const db = new DatabaseSync(":memory:");
    db.exec("PRAGMA foreign_keys = ON");
    for (const f of before) db.exec(sql(f));
    db.exec(`
      INSERT INTO brands (id, slug, name, created_at, updated_at) VALUES ('br', 'wongi', 'WonGi', 't', 't');
      INSERT INTO subjects (id, brand_id, kind, title, created_at) VALUES ('su', 'br', 'product', 'Pop Barley', 't');
      INSERT INTO facts (id, subject_id, label, value, quote, source_url, created_at) VALUES (1, 'su', 'price', 'S$6.90', 'S$6.90 per jar', 'https://example.com/p', 't');
      INSERT INTO batches (id, brand_id, subject_id, kit_version, label, status, created_at, updated_at)
        VALUES ('ba', 'br', 'su', 1, 'W46', 'board', 't', 't'), ('bo', 'br', 'su', 1, 'W45', 'done', 't', 't');
      INSERT INTO ideas (id, batch_id, n, format, insight, visual, headline, picked, created_at)
        VALUES ('i1', 'ba', 1, 'tof', 'x', 'x', 'x', 1, 't'), ('i2', 'ba', 2, 'tof', 'x', 'x', 'x', 0, 't'),
               ('i3', 'ba', 3, 'mof', 'x', 'x', 'x', 0, 't'), ('o1', 'bo', 1, 'hook', 'x', 'x', 'x', 1, 't'),
               ('o2', 'bo', 2, 'hook', 'x', 'x', 'x', 0, 't');
    `);
    const rows = db.prepare("SELECT * FROM ideas ORDER BY id").all();
    const tables = (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all() as { name: string }[]).map((t) => t.name);
    const snapshot = Object.fromEntries(tables.map((t) => [t, db.prepare(`SELECT * FROM "${t}" ORDER BY rowid`).all()]));
    db.exec("BEGIN");
    db.exec(sql("0015_engine_v3.sql"));
    db.exec("COMMIT");
    return { db, rows, snapshot };
  };
  const pick = (db: DatabaseSync, id: string) => db.exec(`UPDATE ideas SET picked = 1 WHERE id = '${id}'`);
  const addIdea = (db: DatabaseSync, id: string, batch: string, n: number, format: string, picked = 1) =>
    db.exec(`INSERT INTO ideas (id, batch_id, n, format, insight, visual, headline, picked, created_at) VALUES ('${id}', '${batch}', ${n}, '${format}', 'x', 'x', 'x', ${picked}, 't')`);

  it("keeps every row, marks every batch engine 2 and adds empty defaults", () => {
    const { db, rows, snapshot } = migrated();
    expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    // Every row of every table before 0015 is still there, unchanged apart from the new columns and their defaults.
    const added: Record<string, Record<string, unknown>> = { batches: { engine: 2 }, ideas: { concept: "{}" }, facts: { verified: null } };
    for (const [t, before] of Object.entries(snapshot)) {
      expect(db.prepare(`SELECT * FROM "${t}" ORDER BY rowid`).all()).toEqual(before.map((r) => ({ ...r, ...added[t] })));
    }
    expect(snapshot.batches).toHaveLength(2);
    expect(snapshot.facts).toHaveLength(1);
    expect(db.prepare("SELECT id, engine FROM batches ORDER BY id").all()).toEqual([{ id: "ba", engine: 2 }, { id: "bo", engine: 2 }]);
    expect(db.prepare("SELECT * FROM ideas ORDER BY id").all()).toEqual(rows.map((r) => ({ ...r, concept: "{}" })));
    expect(db.prepare("SELECT verified FROM facts").all()).toEqual([{ verified: null }]);
    const triggers = db.prepare("SELECT name FROM sqlite_master WHERE type = 'trigger' AND tbl_name = 'ideas' ORDER BY name").all();
    expect(triggers.map((t) => t.name)).toEqual(["ideas_pick_cap_insert", "ideas_pick_cap_update", "ideas_pick_old_format_insert", "ideas_pick_old_format_update"]);
  });

  it("keeps 1 pick per stage for an engine 2 batch (the live code has no other guard)", () => {
    const { db } = migrated();
    expect(() => pick(db, "i2")).toThrow("Pick limit");
    expect(() => addIdea(db, "i4", "ba", 4, "tof")).toThrow("Pick limit");
    pick(db, "i3");
    addIdea(db, "i5", "ba", 5, "bof");
    expect(() => db.exec("UPDATE ideas SET format = 'mof' WHERE id = 'i5'")).toThrow("Pick limit");
    // 1 tof, 1 mof and 1 bof: the 3 picks of an engine 2 batch, as before.
    expect(db.prepare("SELECT COUNT(*) AS n FROM ideas WHERE batch_id = 'ba' AND picked = 1").get()).toEqual({ n: 3 });
  });

  it("lets an engine 3 batch pick any 3, and no more", () => {
    const { db } = migrated();
    db.exec("INSERT INTO batches (id, brand_id, subject_id, kit_version, label, status, engine, created_at, updated_at) VALUES ('b3', 'br', 'su', 1, 'W47', 'ideas', 3, 't', 't')");
    addIdea(db, "e1", "b3", 1, "tof");
    addIdea(db, "e2", "b3", 2, "tof");
    addIdea(db, "e3", "b3", 3, "tof", 0);
    addIdea(db, "e4", "b3", 4, "bof", 0);
    pick(db, "e3");
    expect(() => pick(db, "e4")).toThrow("Pick limit: 3 ideas per batch");
    expect(() => addIdea(db, "e5", "b3", 5, "mof")).toThrow("Pick limit");
    // A role change of a picked idea is not a new pick.
    db.exec("UPDATE ideas SET format = 'mof' WHERE id = 'e1'");
    // Unpick one, then another can be picked.
    db.exec("UPDATE ideas SET picked = 0 WHERE id = 'e2'");
    pick(db, "e4");
    expect(() => db.exec("INSERT INTO batches (id, brand_id, subject_id, kit_version, label, status, engine, created_at, updated_at) VALUES ('b4', 'br', 'su', 1, 'W47', 'ideas', 4, 't', 't')")).toThrow(/CHECK/);
    // The engine is fixed: 3 tof picks must never become an engine 2 batch.
    expect(() => db.exec("UPDATE batches SET engine = 2 WHERE id = 'b3'")).toThrow("engine of a batch is fixed");
    expect(() => db.exec("UPDATE batches SET engine = 3 WHERE id = 'ba'")).toThrow("engine of a batch is fixed");
    db.exec("UPDATE batches SET status = 'drafts', engine = 3 WHERE id = 'b3'");
  });

  it("keeps the old limit of 1 per format for an old-format batch", () => {
    const { db } = migrated();
    expect(() => pick(db, "o2")).toThrow("Pick limit: 1 idea per stage per batch.");
    expect(() => addIdea(db, "o3", "bo", 3, "hook")).toThrow("Pick limit");
    addIdea(db, "o4", "bo", 4, "offer");
  });

  it("keeps a record on an idea of its own batch, one row per version, never changed", () => {
    const { db } = migrated();
    db.exec("INSERT INTO batches (id, brand_id, subject_id, kit_version, label, status, created_at, updated_at) VALUES ('bb', 'br', 'su', 1, 'W47', 'ideas', 't', 't')");
    const add = (id: string, batch: string, kind: string, idea: string | null, version: number, author = "main") =>
      db.exec(`INSERT INTO batch_records (id, batch_id, kind, idea_id, version, body, author, created_at)
               VALUES ('${id}', '${batch}', '${kind}', ${idea ? `'${idea}'` : "NULL"}, ${version}, '{}', '${author}', 't')`);
    add("r1", "ba", "brief", null, 1);
    add("r2", "ba", "brief", null, 2);
    add("r3", "ba", "direction", "i1", 1, "art-director");
    add("r4", "ba", "direction", "i3", 1, "art-director");
    expect(() => add("x1", "ba", "brief", null, 2)).toThrow(/UNIQUE/);
    expect(() => add("x2", "ba", "direction", "i1", 1)).toThrow(/UNIQUE/);
    expect(() => add("x3", "bb", "direction", "i1", 1)).toThrow(/FOREIGN KEY/); // an idea of another batch
    expect(() => add("x4", "ba", "notes", null, 1)).toThrow(/CHECK/);
    expect(() => add("x5", "ba", "brief", null, 3, "client")).toThrow(/CHECK/);
    expect(() => add("x6", "ba", "brief", null, 0)).toThrow(/CHECK/);
    expect(() => add("x7", "zz", "brief", null, 1)).toThrow(/FOREIGN KEY/);
    expect(() => db.exec("UPDATE batch_records SET body = '{\"x\":1}' WHERE id = 'r1'")).toThrow("never changed");
    expect(() => db.exec("DELETE FROM batch_records WHERE id = 'r1'")).toThrow("never changed");
    expect(db.prepare("SELECT COUNT(*) AS n FROM batch_records").get()).toEqual({ n: 4 });
  });

  it("keeps one research source per batch, page and way it was read", () => {
    const { db } = migrated();
    const add = (id: string, via: string) =>
      db.exec(`INSERT INTO research_sources (id, batch_id, url, retrieved_at, via) VALUES ('${id}', 'ba', 'https://example.com/a', 't', '${via}')`);
    add("s1", "search");
    add("s2", "contents");
    expect(() => add("s3", "search")).toThrow(/UNIQUE/);
    expect(() => add("s4", "scrape")).toThrow(/CHECK/);
    db.exec("INSERT INTO calibration_runs (id, kind, as_of, split, n, result, created_at) VALUES ('c1', 'triplet_replay', 't', 'holdout', 12, '{}', 't')");
    expect(() => db.exec("INSERT INTO calibration_runs (id, kind, as_of, split, n, result, created_at) VALUES ('c2', 'triplet_replay', 't', 'train', 1, '{}', 't')")).toThrow(/CHECK/);
    expect(() => db.exec("UPDATE facts SET verified = 2")).toThrow(/CHECK/);
  });

  it("rolls back to 1 pick per stage for every batch, and keeps the rows", () => {
    const { db } = migrated();
    db.exec("INSERT INTO batches (id, brand_id, subject_id, kit_version, label, status, engine, created_at, updated_at) VALUES ('b3', 'br', 'su', 1, 'W47', 'ideas', 3, 't', 't')");
    addIdea(db, "e1", "b3", 1, "tof");
    addIdea(db, "e2", "b3", 2, "tof");
    db.exec(sql("rollback/0015_engine_v3.down.sql"));
    expect(db.prepare("SELECT COUNT(*) AS n FROM ideas WHERE batch_id = 'b3' AND picked = 1").get()).toEqual({ n: 2 });
    expect(() => addIdea(db, "e3", "b3", 3, "tof")).toThrow("Pick limit: 1 idea per stage per batch.");
    expect(() => pick(db, "i2")).toThrow("Pick limit");
    const triggers = db.prepare("SELECT name FROM sqlite_master WHERE type = 'trigger' AND tbl_name = 'ideas' ORDER BY name").all();
    expect(triggers.map((t) => t.name)).toEqual(["ideas_pick_limit_insert", "ideas_pick_limit_update"]);
  });
});
