import { readFileSync } from "node:fs";
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
