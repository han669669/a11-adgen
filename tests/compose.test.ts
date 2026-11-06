import type { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it, vi } from "vitest";
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
  const saved = new Map<string, unknown>();
  const calls: unknown[][] = [];
  // Records the Images pipeline instead of drawing pixels.
  const img = (src: string) => {
    const self = {
      transform: (t: unknown) => (calls.push(["transform", src, t]), self),
      draw: (child: unknown, o: unknown) => (calls.push(["draw", src, o]), self),
      output: async () => ({ response: () => new Response("jpeg") }),
    };
    return self;
  };
  const IMAGES = { input: (body: string) => img(body) };
  const MEDIA = {
    get: async (k: string) => ({ body: k === "assets/grain.png" ? "grain" : "base" }),
    put: async (k: string, v: unknown) => void saved.set(k, v),
  };
  return { DB, MEDIA, IMAGES, SPEND_CAP_USD: "1.00", PUBLIC_BASE_URL: "https://w", saved, calls } as unknown as Env;
}

const logoResponse = (url: string) => ({ url, ok: true, status: 200, headers: new Headers({ "content-type": "image/png" }), body: "logo" });
afterEach(() => vi.unstubAllGlobals());

const input = (logoUrl = "https://example.com/logo.png") =>
  ({ key: KEY, logoUrl, logoWidthPct: 34, logoTopPct: 5, grain: "on", grainPct: 18 }) as const;

describe("compose_final input checks", () => {
  it("refuses a draft", async () =>
    expect(composeFinal(envWith("draft", "done"), input())).rejects.toThrow("not a completed final"));
  it("refuses a final that is not done", async () =>
    expect(composeFinal(envWith("final", "queued"), input())).rejects.toThrow("not a completed final"));
  it("refuses a logo URL that is not HTTPS", async () =>
    expect(composeFinal(envWith("final", "done"), input("http://example.com/logo.png"))).rejects.toThrow("HTTPS"));
  it("refuses a logo that redirects to plain HTTP", async () => {
    vi.stubGlobal("fetch", async () => logoResponse("http://cdn.example.com/logo.png"));
    await expect(composeFinal(envWith("final", "done"), input())).rejects.toThrow("non-HTTPS");
  });
});

describe("compose_final success path", () => {
  it("trims, sizes and places the logo, adds grain, saves -c.jpg and settles the spend", async () => {
    vi.stubGlobal("fetch", async () => logoResponse("https://cdn.example.com/logo.png"));
    const env = envWith("final", "done");
    const out = await composeFinal(env, input());
    const { saved, calls } = env as unknown as { saved: Map<string, unknown>; calls: unknown[][] };
    expect(out).toMatchObject({ logoWidth: 522, top: 96, grain: "on" });
    expect(out.key).toMatch(new RegExp(`^renders/${ID}/1-c\\d+\\.jpg$`));
    expect([...saved.keys()]).toEqual([out.key]);
    expect(calls).toEqual([
      ["draw", "base", { repeat: true, opacity: 0.18 }],
      ["transform", "logo", { trim: "border" }],
      ["transform", "logo", { width: 522 }],
      ["draw", "base", { top: 96 }],
    ]);
    const spend = (env.DB as unknown as { raw: DatabaseSync }).raw.prepare("SELECT service, status FROM spend").all();
    expect(spend).toEqual([{ service: "images", status: "spent" }]);
  });
});
