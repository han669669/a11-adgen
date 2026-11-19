import type { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Env } from "../worker/env";
import { AcceptedError, check, submit } from "../worker/fal";
import { MAX_IMAGE_BYTES } from "../worker/images";

/** The finished-render view (the queued views have no error field). */
const done = async (p: ReturnType<typeof check>) => (await p) as { status: string; error: string | null; images: { key: string }[] };
import { fakeD1 } from "./helpers/d1";

const ID = "11111111-2222-4333-8444-555555555555";

// The URL shapes that fal returns: the queue URLs as the live renders table holds them, the image URLs as fal's model page
// and queue documentation show them. The ids are not real.
const REQUEST = "https://queue.fal.run/openai/gpt-image-2.5/requests/019a9f0e-6f0c-7d21-9a53-2d1c0f6b7e44";
const STATUS = `${REQUEST}/status`;
const IMG = (n: number) => `https://v3b.fal.media/files/b/0a8691b0/yUt7tifLSbg1WzWWgfj2o_${n}.jpg`;

function setup(urls: { status?: string; result?: string } = {}) {
  const DB = fakeD1();
  DB.raw
    .prepare(
      `INSERT INTO renders (id, batch, idea, kind, status, prompt, refs, width, height, quality, num_images,
        status_url, response_url, usd_est, created_at, updated_at)
       VALUES (?, 'b', 'i', 'draft', 'queued', 'p', '[]', 1024, 1280, 'low', 3, ?, ?, 0.04, 'now', 'now')`,
    )
    .run(ID, urls.status ?? STATUS, urls.result ?? REQUEST);
  const saved = new Map<string, ArrayBuffer | Uint8Array>();
  const MEDIA = { put: async (k: string, v: ArrayBuffer | Uint8Array) => void saved.set(k, v) };
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
  const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => queue.shift()!);
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => vi.unstubAllGlobals());

describe("render check", () => {
  it("marks done when every image is saved", async () => {
    const { env, saved } = setup();
    stubFal([IMG(1), IMG(2)], [true, true]);
    const r = await done(check(env, ID));
    expect(r.status).toBe("done");
    expect(r.error).toBeNull();
    expect(saved.size).toBe(2);
  });

  it("marks a short download failed and keeps the saved keys", async () => {
    const { env } = setup();
    stubFal([IMG(1), IMG(2), IMG(3)], [true, false, true]);
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
      .mockResolvedValueOnce(Response.json({ images: [{ url: IMG(1) }] }))
      .mockResolvedValueOnce(new Response("busy", { status: 503 })));
    expect(await check(env, ID)).toMatchObject({ status: "queued", note: "image download HTTP 503; poll again." });
    expect(statusOf(env)).toMatchObject({ status: "queued" });
  });

  it("fails when an image download is gone (HTTP 404)", async () => {
    const { env } = setup();
    stubFal([IMG(1)], [false]);
    expect((await done(check(env, ID))).status).toBe("failed");
    expect(statusOf(env)).toMatchObject({ status: "failed" });
  });

  it("does not overwrite a render that another poll finished during the downloads", async () => {
    const { env } = setup();
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(Response.json({ status: "COMPLETED" }))
      .mockResolvedValueOnce(Response.json({ images: [{ url: IMG(1) }] }))
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

describe("fal answer URLs", () => {
  /** Each fetch as [URL, Authorization header]. */
  const sent = (fetchMock: ReturnType<typeof stubFal>) => fetchMock.mock.calls.map(([url, init]) => [url, new Headers(init?.headers).get("authorization")]);
  const NOT_FAL = [
    ["another host", "https://evil.example/requests/1"],
    ["plain http", REQUEST.replace("https:", "http:")],
    ["a host that only starts like fal", "https://queue.fal.run.evil.example/requests/1"],
    ["a host that only ends like fal", "https://evilqueue.fal.run/requests/1"],
    ["a fal host behind a user name", "https://queue.fal.run@evil.example/requests/1"],
    ["no URL", "not a url"],
  ];

  it("accepts the URL shapes that fal returns, and sends FAL_KEY only to the queue", async () => {
    const { env, saved } = setup();
    const images = [IMG(1), "https://v3.fal.media/files/rabbit/abc123.jpg", "https://fal.media/files/lion/abc123.jpg"];
    const fetchMock = stubFal(images, [true, true, true]);
    const r = await done(check(env, ID));
    expect(r).toMatchObject({ status: "done", error: null });
    expect(saved.size).toBe(3);
    expect(sent(fetchMock)).toEqual([[STATUS, "Key k"], [REQUEST, "Key k"], ...images.map((url) => [url, null])]);
  });

  it.each([...NOT_FAL, ["the image host", IMG(1)]])("does not send FAL_KEY to a status URL on %s", async (_name, status) => {
    const { env } = setup({ status });
    const fetchMock = stubFal([IMG(1)], [true]);
    const r = await done(check(env, ID));
    expect(sent(fetchMock)).toEqual([]);
    expect(r.status).toBe("failed");
    expect(r.error).toContain("fal status URL is not an https fal address");
  });

  it.each([...NOT_FAL, ["the image host", IMG(1)]])("does not send FAL_KEY to a result URL on %s", async (_name, result) => {
    const { env } = setup({ result });
    const fetchMock = stubFal([IMG(1)], [true]);
    const r = await done(check(env, ID));
    expect(sent(fetchMock)).toEqual([[STATUS, "Key k"]]);
    expect(r.status).toBe("failed");
    expect(r.error).toContain("fal result URL is not an https fal address");
  });

  it.each([
    ...NOT_FAL.slice(0, 2),
    ["a host that only starts like fal", "https://v3b.fal.media.evil.example/1.jpg"],
    ["a host that only ends like fal", "https://evilfal.media/1.jpg"],
    ["the queue host", REQUEST],
  ])("does not download an image from %s, and keeps the other images", async (_name, bad) => {
    const { env, saved } = setup();
    const fetchMock = stubFal([IMG(1), bad, IMG(3)], [true, true]);
    const r = await done(check(env, ID));
    expect(sent(fetchMock).map(([url]) => url)).toEqual([STATUS, REQUEST, IMG(1), IMG(3)]);
    expect(r.status).toBe("failed");
    expect(r.error).toContain("saved 2 of 3 images: fal image 2 URL is not an https fal address");
    expect([...saved.keys()]).toEqual([`renders/${ID}/1.jpg`, `renders/${ID}/3.jpg`]);
  });

  it("does not follow a redirect from fal to another host", async () => {
    const { env } = setup();
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => new Response(null, { status: 302, headers: { location: "https://evil.example/status" } }));
    vi.stubGlobal("fetch", fetchMock);
    const r = await done(check(env, ID));
    expect(sent(fetchMock)).toEqual([[STATUS, "Key k"]]);
    expect(fetchMock.mock.calls[0]?.[1]?.redirect).toBe("manual");
    expect(r.status).toBe("failed");
    expect(r.error).toContain("fal status URL is not an https fal address (evil.example)");
  });

  it("follows a redirect that stays on fal", async () => {
    const { env, saved } = setup();
    const moved = "https://v3.fal.media/files/b/0a8691b0/moved.jpg";
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(Response.json({ status: "COMPLETED" }))
      .mockResolvedValueOnce(Response.json({ images: [{ url: IMG(1) }] }))
      .mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: moved } }))
      .mockResolvedValueOnce(new Response(new Uint8Array([1, 2, 3]))));
    expect((await done(check(env, ID))).status).toBe("done");
    expect(saved.size).toBe(1);
  });

  it("does not read an image whose Content-Length is larger than the limit", async () => {
    const { env, saved } = setup();
    let pulls = 0;
    const body = new ReadableStream<Uint8Array>({ pull: (c) => (pulls++, c.enqueue(new Uint8Array(1))) }, { highWaterMark: 0 });
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(Response.json({ status: "COMPLETED" }))
      .mockResolvedValueOnce(Response.json({ images: [{ url: IMG(1) }] }))
      .mockResolvedValueOnce(new Response(body, { headers: { "content-length": String(MAX_IMAGE_BYTES + 1) } })));
    const r = await done(check(env, ID));
    expect(r.status).toBe("failed");
    expect(r.error).toBe(`saved 0 of 1 images: fal image 1 is larger than ${MAX_IMAGE_BYTES} bytes.`);
    expect(saved.size).toBe(0);
    expect(pulls).toBe(0);
  });

  it("stops reading an image that is larger than the limit, with no Content-Length, and does not save it", async () => {
    const { env, saved } = setup();
    const chunk = new Uint8Array(1_000_000);
    let pulls = 0;
    const endless = new ReadableStream<Uint8Array>({ pull: (c) => (pulls++, c.enqueue(chunk)) }, { highWaterMark: 0 });
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(Response.json({ status: "COMPLETED" }))
      .mockResolvedValueOnce(Response.json({ images: [{ url: IMG(1) }] }))
      .mockResolvedValueOnce(new Response(endless)));
    const r = await done(check(env, ID));
    expect(r.status).toBe("failed");
    expect(r.error).toBe(`saved 0 of 1 images: fal image 1 is larger than ${MAX_IMAGE_BYTES} bytes.`);
    expect(saved.size).toBe(0);
    expect(pulls).toBe(MAX_IMAGE_BYTES / chunk.length + 1);
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
