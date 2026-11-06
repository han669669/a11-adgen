import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import type { Env } from "../worker/env";
import { BudgetError, reserve, settle, totals } from "../worker/spend";

/** A small D1 stand-in on a real SQLite engine, so the spend SQL (strftime, INSERT ... SELECT) runs for real. */
function fakeD1(): D1Database {
  const db = new DatabaseSync(":memory:");
  db.exec(readFileSync(new URL("../migrations/0001_init.sql", import.meta.url), "utf8"));
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
  return { prepare: (sql: string) => stmt(sql), raw: db } as unknown as D1Database;
}

const envWith = (cap: string) => ({ DB: fakeD1(), SPEND_CAP_USD: cap }) as Env;
const raw = (env: Env) => (env.DB as unknown as { raw: DatabaseSync }).raw;

describe("spend cap", () => {
  it("allows a reservation that lands exactly on the cap", async () => {
    const env = envWith("1.00");
    await reserve(env, "fal", "draft", "a", 0.6);
    await expect(reserve(env, "fal", "draft", "b", 0.4)).resolves.toBeGreaterThan(0);
  });

  it("refuses a reservation that passes the cap", async () => {
    const env = envWith("1.00");
    await reserve(env, "fal", "draft", "a", 0.6);
    await expect(reserve(env, "fal", "draft", "b", 0.41)).rejects.toBeInstanceOf(BudgetError);
  });

  it("lets only as many parallel reservations through as fit the cap", async () => {
    const env = envWith("1.00");
    const results = await Promise.allSettled([0, 1, 2].map((i) => reserve(env, "fal", "final", `p${i}`, 0.4)));
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(2);
    expect((await totals(env)).totalUsd).toBeCloseTo(0.8, 4);
  });

  it("stops counting a reservation that was never settled after 15 minutes", async () => {
    const env = envWith("1.00");
    const old = new Date(Date.now() - 16 * 60_000).toISOString();
    raw(env).prepare("INSERT INTO spend (at, service, kind, ref, usd_est) VALUES (?, 'fal', 'final', 'stale', 0.9)").run(old);
    await expect(reserve(env, "fal", "draft", "new", 0.5)).resolves.toBeGreaterThan(0);
  });

  it("keeps counting a settled spend, however old", async () => {
    const env = envWith("1.00");
    const old = new Date(Date.now() - 16 * 60_000).toISOString();
    raw(env).prepare("INSERT INTO spend (at, service, kind, ref, usd_est, status) VALUES (?, 'fal', 'final', 'old', 0.9, 'spent')").run(old);
    await expect(reserve(env, "fal", "draft", "new", 0.5)).rejects.toBeInstanceOf(BudgetError);
  });

  it("frees the money of a released reservation", async () => {
    const env = envWith("1.00");
    const id = await reserve(env, "fal", "final", "x", 0.9);
    await settle(env, id, false);
    await expect(reserve(env, "fal", "final", "y", 0.9)).resolves.toBeGreaterThan(0);
  });
});
