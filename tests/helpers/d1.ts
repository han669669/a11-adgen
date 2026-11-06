import { readdirSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

/** A small D1 stand-in on a real SQLite engine, so the Worker's SQL runs for real in tests. */
export function fakeD1(): D1Database & { raw: DatabaseSync } {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON"); // D1 enforces foreign keys
  const dir = new URL("../../migrations/", import.meta.url);
  for (const f of readdirSync(dir).filter((n) => n.endsWith(".sql")).sort()) db.exec(readFileSync(new URL(f, dir), "utf8"));
  const stmt = (sql: string, args: unknown[] = []) => ({
    bind: (...a: unknown[]) => stmt(sql, a),
    async run() {
      const r = db.prepare(sql).run(...(args as never[]));
      return { meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } };
    },
    async first() {
      return db.prepare(sql).get(...(args as never[])) ?? null;
    },
    async all() {
      return { results: db.prepare(sql).all(...(args as never[])) };
    },
  });
  // D1 batch(): run the statements in order inside one transaction.
  const batch = async (stmts: { run(): Promise<unknown> }[]) => {
    db.exec("BEGIN");
    try {
      const out = [];
      for (const s of stmts) out.push(await s.run());
      db.exec("COMMIT");
      return out;
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
  };
  return { prepare: (sql: string) => stmt(sql), batch, raw: db } as unknown as D1Database & { raw: DatabaseSync };
}
