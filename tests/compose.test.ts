import type { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it, vi } from "vitest";
import { claimCompose, settleCompose } from "../worker/api";
import { composeFinal, finalAttach, hasJpegEnd, jpegSize } from "../worker/compose";
import type { Env } from "../worker/env";
import { TOOLS } from "../worker/mcp";
import { validate } from "../worker/schema";
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
    const asked: string[] = [];
    vi.stubGlobal("fetch", async (u: string) => {
      asked.push(String(u));
      return { ...logoResponse(String(u)), ok: false, status: 302, headers: new Headers({ location: "http://cdn.example.com/logo.png" }), body: null };
    });
    await expect(composeFinal(envWith("final", "done"), input())).rejects.toThrow("non-HTTPS");
    expect(asked).toEqual(["https://example.com/logo.png"]); // the plain-http address is never requested
  });
  it("refuses a logo on a private or internal host, before any request", async () => {
    const f = vi.fn();
    vi.stubGlobal("fetch", f);
    await expect(composeFinal(envWith("final", "done"), input("https://169.254.169.254/logo.png"))).rejects.toThrow("public host");
    await expect(composeFinal(envWith("final", "done"), input("https://localhost/logo.png"))).rejects.toThrow("public host");
    expect(f).not.toHaveBeenCalled();
  });
  it("refuses a logo that redirects to an internal host", async () => {
    vi.stubGlobal("fetch", async () => ({ ...logoResponse("x"), ok: false, status: 301, headers: new Headers({ location: "https://127.0.0.1/logo.png" }), body: null }));
    await expect(composeFinal(envWith("final", "done"), input())).rejects.toThrow("public host");
  });
  it("follows a safe https redirect by hand", async () => {
    vi.stubGlobal("fetch", async (u: string) =>
      String(u) === "https://example.com/logo.png"
        ? { ...logoResponse(String(u)), ok: false, status: 302, headers: new Headers({ location: "https://cdn.example.com/logo.png" }), body: null }
        : logoResponse(String(u)),
    );
    const out = await composeFinal(envWith("final", "done"), input());
    expect(out.key).toMatch(/-c\d+\.jpg$/);
  });
});

describe("compose_final success path", () => {
  it("trims, sizes and places the logo, adds grain, saves -c.jpg and settles the spend", async () => {
    vi.stubGlobal("fetch", async () => logoResponse("https://cdn.example.com/logo.png"));
    const env = envWith("final", "done");
    const out = await composeFinal(env, input());
    const { saved, calls } = env as unknown as { saved: Map<string, unknown>; calls: unknown[][] };
    expect(out).toMatchObject({ logoWidth: 522, top: 96, grain: "on" });
    // Date.now() (13 digits) then a random number: the shape compose_final makes.
    expect(out.key).toMatch(new RegExp(`^renders/${ID}/1-c\\d{13}\\d+\\.jpg$`));
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

describe("board compose claim", () => {
  const keyOf = (env: Env) =>
    (env.DB as unknown as { raw: DatabaseSync }).raw.prepare("SELECT composed_key AS k FROM renders WHERE id = ?").get(ID) as { k: string | null };

  it("gives one claim at a time, and lets a stale claim be taken over", async () => {
    const env = envWith("final", "done");
    const t0 = new Date("2026-11-06T10:00:00.000Z");
    const first = await claimCompose(env, ID, t0);
    expect(first).toMatch(/^pending:2026-11-06T10:00:00.000Z:/);
    expect(await claimCompose(env, ID, new Date(t0.getTime() + 60_000))).toBeNull();
    expect(await claimCompose(env, ID, new Date(t0.getTime() + 121_000))).not.toBeNull();
  });

  it("drops the late result of a superseded compose, success or failure", async () => {
    const env = envWith("final", "done");
    const t0 = new Date("2026-11-06T10:00:00.000Z");
    const old = (await claimCompose(env, ID, t0))!;
    const fresh = (await claimCompose(env, ID, new Date(t0.getTime() + 121_000)))!;
    expect(await settleCompose(env, ID, fresh, "renders/x/1-cnew.jpg")).toBe(true);
    expect(await settleCompose(env, ID, old, "renders/x/1-cold.jpg")).toBe(false);
    expect(await settleCompose(env, ID, old, "error:late failure")).toBe(false);
    expect(keyOf(env).k).toBe("renders/x/1-cnew.jpg");
    expect(await claimCompose(env, ID)).toBeNull();
  });
});

// A JPEG header with only the frame size set: enough for jpegSize.
const jpeg = (width: number, height: number) =>
  new Uint8Array([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, height >> 8, height & 255, width >> 8, width & 255, 0x03, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1, 0xff, 0xd9]);

describe("jpegSize", () => {
  it("reads the frame size", () => expect(jpegSize(jpeg(1536, 1920))).toEqual({ width: 1536, height: 1920 }));
  it("skips a segment before the frame header", () => {
    const seg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x06, 0, 0, 0, 0, ...jpeg(640, 800).slice(2)]);
    expect(jpegSize(seg)).toEqual({ width: 640, height: 800 });
  });
  it("returns null for bytes that are not a JPEG", () => {
    expect(jpegSize(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0, 0, 0, 0, 0]))).toBeNull();
    expect(jpegSize(new Uint8Array([0xff, 0xd8]))).toBeNull();
    expect(jpegSize(new Uint8Array([0xff, 0xd8, 0xff, 0xd9, 0, 0, 0, 0, 0, 0, 0, 0]))).toBeNull();
  });
});

describe("hasJpegEnd", () => {
  it("is true with the end marker, also with zero padding, and false without it", () => {
    expect(hasJpegEnd(jpeg(10, 10))).toBe(true);
    expect(hasJpegEnd(new Uint8Array([...jpeg(10, 10), 0, 0]))).toBe(true);
    expect(hasJpegEnd(jpeg(10, 10).slice(0, -2))).toBe(false);
  });
});

describe("final_attach", () => {
  const UP = "0a1b2c3d-0000-4000-8000-0123456789ab";
  const UPLOAD = `repairs/${UP}.jpg`;
  function attachEnv(kind = "final", status = "done", files: Record<string, Uint8Array> = { [UPLOAD]: jpeg(1536, 1920) }, composed: string | null = `renders/${ID}/1-c1.jpg`) {
    const env = envWith(kind, status) as unknown as { MEDIA: unknown; DB: { raw: DatabaseSync }; saved: Map<string, unknown> };
    env.DB.raw.prepare("UPDATE renders SET composed_key = ? WHERE id = ?").run(composed, ID);
    const saved = env.saved;
    env.MEDIA = {
      get: async (k: string) => (files[k] ? { arrayBuffer: async () => files[k]!.buffer.slice(files[k]!.byteOffset, files[k]!.byteOffset + files[k]!.byteLength) } : null),
      put: async (k: string, v: unknown) => void saved.set(k, v),
    };
    return env as unknown as Env & { saved: Map<string, unknown> };
  }
  it("saves the picture under a new compose-shaped key and leaves the original", async () => {
    const env = attachEnv();
    const out = await finalAttach(env, { key: KEY, upload: UPLOAD });
    expect(out.key).toMatch(new RegExp(`^renders/${ID}/1-c\\d+\\.jpg$`));
    expect(out).toMatchObject({ width: 1536, height: 1920 });
    expect([...env.saved.keys()]).toEqual([out.key]);
  });
  it("the tool makes the new key the render's composed picture, which pack_publish reads", async () => {
    const env = attachEnv();
    const tool = TOOLS.find((t) => t.name === "final_attach")!;
    expect(tool.inputSchema.required).toEqual(["key", "upload"]);
    const args = validate(tool.inputSchema as never, { key: KEY, upload: UPLOAD });
    const res = (await tool.run(env, args)) as { content: { text: string }[] };
    const { key } = JSON.parse(res.content[0]!.text);
    const row = (env.DB as unknown as { raw: DatabaseSync }).raw.prepare("SELECT composed_key FROM renders WHERE id = ?").get(ID);
    expect(row).toEqual({ composed_key: key });
    expect(key).toMatch(/^renders\//);
  });
  it("the tool schema refuses a malformed key, a malformed upload name and extra fields", () => {
    const tool = TOOLS.find((t) => t.name === "final_attach")!;
    const bad = [
      { key: `renders/${"a".repeat(36)}/1.jpg`, upload: UPLOAD },
      { key: KEY, upload: `repairs/${"a".repeat(36)}.jpg` },
      { key: KEY, upload: `repairs/${"-".repeat(36)}.jpg` },
      { key: KEY, upload: `refs/${UP}.jpg` },
      { key: KEY },
      { key: KEY, upload: UPLOAD, extra: 1 },
    ];
    for (const a of bad) expect(() => validate(tool.inputSchema as never, a), JSON.stringify(a)).toThrow();
  });
  it("refuses a final that was never composed", async () => {
    await expect(finalAttach(attachEnv("final", "done", undefined, null), { key: KEY, upload: UPLOAD })).rejects.toThrow("not composed yet");
  });
  it("refuses a cut-off JPEG (no end marker)", async () => {
    const cut = jpeg(1536, 1920).slice(0, -2);
    await expect(finalAttach(attachEnv("final", "done", { [UPLOAD]: cut }), { key: KEY, upload: UPLOAD })).rejects.toThrow("cut short");
  });
  it("refuses a draft, a final that is not done, a bad key and a bad upload key", async () => {
    await expect(finalAttach(attachEnv("draft", "done"), { key: KEY, upload: UPLOAD })).rejects.toThrow("not a completed final");
    await expect(finalAttach(attachEnv("final", "queued"), { key: KEY, upload: UPLOAD })).rejects.toThrow("not a completed final");
    await expect(finalAttach(attachEnv(), { key: "x.jpg", upload: UPLOAD })).rejects.toThrow("render image key");
    await expect(finalAttach(attachEnv(), { key: KEY, upload: `refs/${UP}.jpg` })).rejects.toThrow("repair key");
  });
  it("refuses a missing upload, a file that is not a JPEG and a picture of another size", async () => {
    await expect(finalAttach(attachEnv("final", "done", {}), { key: KEY, upload: UPLOAD })).rejects.toThrow("No image at");
    await expect(finalAttach(attachEnv("final", "done", { [UPLOAD]: new Uint8Array(40) }), { key: KEY, upload: UPLOAD })).rejects.toThrow("not a JPEG");
    await expect(finalAttach(attachEnv("final", "done", { [UPLOAD]: jpeg(1024, 1280) }), { key: KEY, upload: UPLOAD })).rejects.toThrow("1024x1280, but the final is 1536x1920");
  });
});
