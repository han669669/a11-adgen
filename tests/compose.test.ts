import type { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { composeFinal } from "../worker/compose";
import type { Env } from "../worker/env";
import { fakeD1 } from "./helpers/d1";

const ID = "11111111-2222-3333-4444-555555555555";
const KEY = `renders/${ID}/1.jpg`;

function envWith(kind: string, status: string): Env {
  const DB = fakeD1();
  (DB as unknown as { raw: DatabaseSync }).raw
    .prepare(
      `INSERT INTO renders (id, batch, idea, kind, status, prompt, refs, width, height, quality, num_images, usd_est, created_at, updated_at)
       VALUES (?, 'b', 'i', ?, ?, 'p', '[]', 1536, 1920, 'high', 1, 0.06, 'now', 'now')`,
    )
    .run(ID, kind, status);
  return { DB, MEDIA: { get: async () => ({ body: null }) } } as unknown as Env;
}

const input = (logoUrl = "https://example.com/logo.png") =>
  ({ key: KEY, logoUrl, logoWidthPct: 34, logoTopPct: 5, grain: "on", grainPct: 18 }) as const;

describe("compose_final input checks", () => {
  it("refuses a draft", async () =>
    expect(composeFinal(envWith("draft", "done"), input())).rejects.toThrow("not a completed final"));
  it("refuses a final that is not done", async () =>
    expect(composeFinal(envWith("final", "queued"), input())).rejects.toThrow("not a completed final"));
  it("refuses a logo URL that is not HTTPS", async () =>
    expect(composeFinal(envWith("final", "done"), input("http://example.com/logo.png"))).rejects.toThrow("HTTPS"));
});
