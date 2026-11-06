import { afterEach, describe, expect, it, vi } from "vitest";
import type { Env } from "../worker/env";
import { check } from "../worker/fal";

/** The finished-render view (the queued views have no error field). */
const done = async (p: ReturnType<typeof check>) => (await p) as { status: string; error: string | null; images: { key: string }[] };
import { fakeD1 } from "./helpers/d1";

const ID = "11111111-2222-4333-8444-555555555555";

function setup() {
  const DB = fakeD1();
  DB.raw
    .prepare(
      `INSERT INTO renders (id, batch, idea, kind, status, prompt, refs, width, height, quality, num_images,
        status_url, response_url, usd_est, created_at, updated_at)
       VALUES (?, 'b', 'i', 'draft', 'queued', 'p', '[]', 1024, 1280, 'low', 3, 'https://fal/status', 'https://fal/result', 0.04, 'now', 'now')`,
    )
    .run(ID);
  const saved = new Map<string, ArrayBuffer>();
  const MEDIA = { put: async (k: string, v: ArrayBuffer) => void saved.set(k, v) };
  const env = { DB, MEDIA, FAL_KEY: "k", PUBLIC_BASE_URL: "https://w" } as unknown as Env;
  return { env, saved };
}

/** fal answers: status COMPLETED, then the result, then the image downloads in order. */
function stubFal(images: string[], downloads: boolean[]) {
  const queue: Response[] = [
    Response.json({ status: "COMPLETED" }),
    Response.json({ images: images.map((url) => ({ url, content_type: "image/jpeg" })) }),
    ...downloads.map((ok) => (ok ? new Response(new Uint8Array([1, 2, 3])) : new Response("gone", { status: 404 }))),
  ];
  vi.stubGlobal("fetch", vi.fn(async () => queue.shift()!));
}

afterEach(() => vi.unstubAllGlobals());

describe("render check", () => {
  it("marks done when every image is saved", async () => {
    const { env, saved } = setup();
    stubFal(["https://cdn/1", "https://cdn/2"], [true, true]);
    const r = await done(check(env, ID));
    expect(r.status).toBe("done");
    expect(r.error).toBeNull();
    expect(saved.size).toBe(2);
  });

  it("marks a short download failed and keeps the saved keys", async () => {
    const { env } = setup();
    stubFal(["https://cdn/1", "https://cdn/2", "https://cdn/3"], [true, false, true]);
    const r = await done(check(env, ID));
    expect(r.status).toBe("failed");
    expect(r.error).toBe("saved 2 of 3 images");
    expect(r.images.map((i) => i.key)).toEqual([`renders/${ID}/1.jpg`, `renders/${ID}/3.jpg`]);
  });

  it("marks an empty fal response failed", async () => {
    const { env } = setup();
    stubFal([], []);
    const r = await done(check(env, ID));
    expect(r.status).toBe("failed");
    expect(r.error).toBe("fal returned no images");
  });
});
