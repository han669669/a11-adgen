import type { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import type { Env } from "../worker/env";
import { BudgetError, reserve, settle, totals } from "../worker/spend";
import { fakeD1 } from "./helpers/d1";

const envWith = (cap: string) => ({ DB: fakeD1(), SPEND_CAP_USD: cap }) as unknown as Env;
const raw = (env: Env) => (env.DB as unknown as { raw: DatabaseSync }).raw;

/** 16 minutes ago, but never before the start of this UTC month: the cap counts one calendar month. */
const sixteenMinutesAgo = () => {
  const now = new Date();
  return new Date(Math.max(now.getTime() - 16 * 60_000, Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))).toISOString();
};

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

  it("keeps counting a reservation that was never settled: the provider may have billed it", async () => {
    const env = envWith("1.00");
    const old = sixteenMinutesAgo();
    raw(env).prepare("INSERT INTO spend (at, service, kind, ref, usd_est) VALUES (?, 'fal', 'final', 'cut off', 0.9)").run(old);
    await expect(reserve(env, "fal", "draft", "new", 0.5)).rejects.toBeInstanceOf(BudgetError);
    expect((await totals(env)).totalUsd).toBeCloseTo(0.9, 4);
  });

  it("keeps counting a settled spend, however old", async () => {
    const env = envWith("1.00");
    const old = sixteenMinutesAgo();
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
