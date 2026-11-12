import type { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Env } from "../worker/env";
import { AcceptedError, check, submit } from "../worker/fal";

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

  const statusOf = (env: Env) => (env.DB as unknown as { raw: DatabaseSync }).raw.prepare("SELECT status, error FROM renders WHERE id = ?").get(ID);
  const finish = (env: Env) =>
    (env.DB as unknown as { raw: DatabaseSync }).raw.prepare("UPDATE renders SET status = 'done', image_keys = ? WHERE id = ?").run(JSON.stringify([`renders/${ID}/1.jpg`]), ID);

  it("stays queued when an image download gets a temporary error", async () => {
    const { env } = setup();
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(Response.json({ status: "COMPLETED" }))
      .mockResolvedValueOnce(Response.json({ images: [{ url: "https://cdn/1" }] }))
      .mockResolvedValueOnce(new Response("busy", { status: 503 })));
    expect(await check(env, ID)).toMatchObject({ status: "queued", note: "image download HTTP 503; poll again." });
    expect(statusOf(env)).toMatchObject({ status: "queued" });
  });

  it("fails when an image download is gone (HTTP 404)", async () => {
    const { env } = setup();
    stubFal(["https://cdn/1"], [false]);
    expect((await done(check(env, ID))).status).toBe("failed");
    expect(statusOf(env)).toMatchObject({ status: "failed" });
  });

  it("does not overwrite a render that another poll finished during the downloads", async () => {
    const { env } = setup();
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(Response.json({ status: "COMPLETED" }))
      .mockResolvedValueOnce(Response.json({ images: [{ url: "https://cdn/1" }] }))
      .mockImplementationOnce(async () => (finish(env), new Response("gone", { status: 404 }))));
    const r = await done(check(env, ID));
    expect(r.status).toBe("done");
    expect(r.images.map((i) => i.key)).toEqual([`renders/${ID}/1.jpg`]);
    expect(statusOf(env)).toMatchObject({ status: "done", error: null });
  });

  it("does not mark a render failed that another poll finished first", async () => {
    const { env } = setup();
    vi.stubGlobal("fetch", vi.fn().mockImplementationOnce(async () => (finish(env), new Response("bad", { status: 400 }))));
    expect((await done(check(env, ID))).status).toBe("done");
    expect(statusOf(env)).toMatchObject({ status: "done", error: null });
  });
});

describe("render submit", () => {
  const input = { batch: "b", idea: "i", kind: "draft" as const, prompt: "p".repeat(40), referenceUrls: ["https://a/1.jpg"], numImages: 1 };
  const spendOf = (env: Env) => (env.DB as unknown as { raw: DatabaseSync }).raw.prepare("SELECT status FROM spend").all();

  it.each([
    ["times out", async () => Promise.reject(new DOMException("The operation timed out.", "TimeoutError"))],
    ["sends an answer that cannot be read", async () => new Response("<html>", { status: 200 })],
  ])("keeps the spend when the submit %s (fal may still bill the job)", async (_what, fetchStub) => {
    const { env } = setup();
    vi.stubGlobal("fetch", fetchStub);
    await expect(submit({ ...env, SPEND_CAP_USD: "5.00" } as Env, input)).rejects.toThrow();
    expect(spendOf(env)).toEqual([{ status: "spent" }]);
  });

  it("gives the spend back when the call was never sent (no FAL_KEY)", async () => {
    const { env } = setup();
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(submit({ ...env, SPEND_CAP_USD: "5.00", FAL_KEY: "" } as Env, input)).rejects.toThrow("FAL_KEY is not set");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(spendOf(env)).toEqual([{ status: "released" }]);
  });

  it("keeps the spend after a 5xx status: it is not sure that fal did not take the job", async () => {
    const { env } = setup();
    vi.stubGlobal("fetch", async () => new Response("bad gateway", { status: 502 }));
    await expect(submit({ ...env, SPEND_CAP_USD: "5.00" } as Env, input)).rejects.toThrow("fal submit failed: HTTP 502");
    expect(spendOf(env)).toEqual([{ status: "spent" }]);
  });

  it("keeps the spend after an unexpected 3xx status: only a 4xx is a sure refusal", async () => {
    const { env } = setup();
    vi.stubGlobal("fetch", async () => new Response("moved", { status: 307 }));
    await expect(submit({ ...env, SPEND_CAP_USD: "5.00" } as Env, input)).rejects.toThrow("fal submit failed: HTTP 307");
    expect(spendOf(env)).toEqual([{ status: "spent" }]);
  });

  it("gives the spend back for a refusal whose body cannot be read", async () => {
    const { env } = setup();
    vi.stubGlobal("fetch", async () => ({ ok: false, status: 422, text: async () => Promise.reject(new Error("stream broke")) }));
    await expect(submit({ ...env, SPEND_CAP_USD: "5.00" } as Env, input)).rejects.toThrow("fal submit failed: HTTP 422");
    expect(spendOf(env)).toEqual([{ status: "released" }]);
  });

  it("gives the spend back when fal refuses the submit with an error status", async () => {
    const { env } = setup();
    vi.stubGlobal("fetch", async () => new Response("bad prompt", { status: 422 }));
    await expect(submit({ ...env, SPEND_CAP_USD: "5.00" } as Env, input)).rejects.toThrow("fal submit failed: HTTP 422");
    expect(spendOf(env)).toEqual([{ status: "released" }]);
  });

  it("says that fal accepted the job when the render row cannot be saved, and keeps the spend", async () => {
    const { env } = setup();
    const raw = (env.DB as unknown as { raw: DatabaseSync }).raw;
    raw.exec("CREATE TRIGGER no_insert BEFORE INSERT ON renders BEGIN SELECT RAISE(ABORT, 'insert refused'); END;");
    const fetchMock = vi.fn(async () => Response.json({ request_id: "req-1", status_url: "https://q/s", response_url: "https://q/r" }));
    vi.stubGlobal("fetch", fetchMock);
    const err = await submit({ ...env, SPEND_CAP_USD: "5.00" } as Env, { batch: "b", idea: "i", kind: "final", prompt: "p".repeat(40), referenceUrls: ["https://a/1.jpg"], numImages: 1 }).catch((e) => e);
    expect(err).toBeInstanceOf(AcceptedError);
    expect(err.message).toContain("request req-1");
    expect(err.message).toContain("Do not submit again");
    expect(err.renderId).toMatch(/^[0-9a-f-]{36}$/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(raw.prepare("SELECT status FROM spend").all()).toEqual([{ status: "spent" }]);
  });
});
