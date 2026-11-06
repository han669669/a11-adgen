import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

/** A small D1 stand-in on a real SQLite engine, so the Worker's SQL runs for real in tests. */
export function fakeD1(): D1Database & { raw: DatabaseSync } {
  const db = new DatabaseSync(":memory:");
  db.exec(readFileSync(new URL("../../migrations/0001_init.sql", import.meta.url), "utf8"));
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
  return { prepare: (sql: string) => stmt(sql), raw: db } as unknown as D1Database & { raw: DatabaseSync };
}
