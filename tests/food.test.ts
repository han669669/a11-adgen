import type { DatabaseSync } from "node:sqlite";
import { inflateSync } from "node:zlib";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Env } from "../worker/env";
import { check } from "../worker/fal";
import { foodFix } from "../worker/food";
import worker from "../worker/index";
import { pasteBack } from "../worker/paste";
import { maskPng } from "../worker/png";
import { fakeD1 } from "./helpers/d1";

afterEach(() => vi.unstubAllGlobals());

/** Reads a grey 8-bit PNG made by maskPng: returns its size and a pixel getter. */
function readPng(png: Uint8Array) {
  expect([...png.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const v = new DataView(png.buffer, png.byteOffset, png.byteLength);
  let o = 8;
  let width = 0;
  let height = 0;
  const idat: Uint8Array[] = [];
  while (o < png.length) {
    const len = v.getUint32(o);
    const type = String.fromCharCode(...png.subarray(o + 4, o + 8));
    const data = png.subarray(o + 8, o + 8 + len);
    if (type === "IHDR") {
      width = new DataView(data.buffer, data.byteOffset).getUint32(0);
      height = new DataView(data.buffer, data.byteOffset).getUint32(4);
      expect([...data.subarray(8, 13)]).toEqual([8, 0, 0, 0, 0]);
    }
    if (type === "IDAT") idat.push(data);
    o += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(idat));
  expect(raw.length).toBe((width + 1) * height);
  return { width, height, px: (x: number, y: number) => raw[y * (width + 1) + 1 + x] };
}

describe("mask PNG", () => {
  it("is white inside the boxes and black outside", async () => {
    const { width, height, px } = readPng(await maskPng(200, 100, [{ x: 10, y: 50, w: 20, h: 30 }]));
    expect([width, height]).toEqual([200, 100]);
    expect(px(20, 50)).toBe(255); // inside: x 20..59, y 50..79
    expect(px(59, 79)).toBe(255);
    expect(px(60, 60)).toBe(0);
    expect(px(30, 49)).toBe(0);
    expect(px(0, 0)).toBe(0);
  });

  it("refuses a box that leaves the picture", async () => {
    await expect(maskPng(100, 100, [{ x: 90, y: 0, w: 20, h: 10 }])).rejects.toThrow("inside the picture");
  });
});

const RID = "aaaaaaaa-0000-0000-0000-000000000001";
const KEY = `renders/${RID}/1.jpg`;

function makeEnv(opts: { food?: string; laterFood?: string; kind?: string } = {}) {
  const DB = fakeD1();
  const raw = (DB as unknown as { raw: DatabaseSync }).raw;
  const kit = (food: string | undefined, v = 1) =>
    JSON.stringify({
      logo: { key: "brands/k/logo.png", url: "https://w/m/brands/k/logo.png", sourceUrl: "x" },
      palette: [],
      fonts: [],
      voice: "v",
      neverSay: [],
      refs: [
        { key: "k1", url: `https://w/m/brands/k${v}/ref1.jpg`, sourceUrl: "x", label: "jar", role: "packshot" },
        { key: "k2", url: `https://w/m/brands/k${v}/ref2.jpg`, sourceUrl: "x", label: "close-up", role: "texture" },
      ],
      placement: { logoWidthPct: 28, logoTopPct: 3 },
      notes: "",
      ...(food === undefined ? {} : { food }),
    });
  raw.exec(`
    INSERT INTO brands (id, slug, name, created_at, updated_at) VALUES ('br', 'wongi', 'WonGi', 't', 't');
    INSERT INTO subjects (id, brand_id, kind, title, created_at) VALUES ('su', 'br', 'product', 'Pop Barley', 't');
    INSERT INTO batches (id, brand_id, subject_id, kit_version, label, status, created_at, updated_at) VALUES ('ba', 'br', 'su', 1, 'W46b', 'board', 't', 't');
  `);
  raw.prepare("INSERT INTO brand_kits (id, brand_id, version, kit, created_at) VALUES ('k1', 'br', 1, ?, 't')").run(kit(opts.food));
  if (opts.laterFood !== undefined) raw.prepare("INSERT INTO brand_kits (id, brand_id, version, kit, created_at) VALUES ('k2', 'br', 2, ?, 't')").run(kit(opts.laterFood, 2));
  raw
    .prepare(
      `INSERT INTO renders (id, batch, idea, kind, status, prompt, refs, width, height, quality, num_images, usd_est, created_at, updated_at)
       VALUES (?, 'ba', 'idea-1', ?, 'done', 'p', '[]', 1536, 1920, 'high', 1, 0.08, 'now', 'now')`,
    )
    .run(RID, opts.kind ?? "final");
  raw.prepare("UPDATE renders SET image_keys = ? WHERE id = ?").run(JSON.stringify([KEY]), RID);
  const saved = new Map<string, { bytes: Uint8Array; type: string }>();
  const MEDIA = {
    put: async (k: string, v: Uint8Array, o: { httpMetadata: { contentType: string } }) => void saved.set(k, { bytes: v, type: o.httpMetadata.contentType }),
    get: async (k: string) => (saved.has(k) ? { body: new Blob([saved.get(k)!.bytes]).stream(), size: saved.get(k)!.bytes.length, httpMetadata: { contentType: saved.get(k)!.type } } : null),
  };
  // Records the Images pipeline instead of drawing pixels. Each input gets a tag (in1, in2, ...) in call order.
  const calls: unknown[][] = [];
  const size = { width: 1536, height: 1920 };
  let inputs = 0;
  const handle = (tag: string) => {
    const self = {
      tag,
      transform: (t: unknown) => (calls.push(["transform", tag, t]), self),
      draw: (child: { tag: string }, o: unknown) => (calls.push(["draw", tag, child.tag, o]), self),
      output: async () => ({ response: () => new Response("merged") }),
    };
    return self;
  };
  const IMAGES = {
    info: async () => ({ format: "image/jpeg", fileSize: 1, ...size }),
    input: () => handle(`in${++inputs}`),
  };
  const env = { DB, MEDIA, IMAGES, FAL_KEY: "k", SPEND_CAP_USD: "5.00", PUBLIC_BASE_URL: "https://w" } as unknown as Env;
  return { env, saved, raw, calls, size };
}

function stubFal() {
  const sent: Record<string, any>[] = [];
  vi.stubGlobal("fetch", async (_u: string, init: RequestInit) => {
    sent.push(JSON.parse(String(init.body)));
    return new Response(JSON.stringify({ request_id: "r", status_url: "https://q/s", response_url: "https://q/r" }));
  });
  return sent;
}

const input = { key: KEY, boxes: [{ x: 40, y: 80, w: 35, h: 15 }], keep: "The jar stays almost empty; the note stays as it is." };

describe("food_fix", () => {
  it("re-renders only the food: mask, real photos as references, the kit's food words", async () => {
    const { env, saved, raw } = makeEnv({ food: "Irregular puffed grains with a crackled caramel net." });
    const sent = stubFal();
    const out = await foodFix(env, input);
    const maskKey = [...saved.keys()].find((k) => k.startsWith(`renders/${RID}/mask-`))!;
    expect(maskKey).toMatch(/^renders\/[0-9a-f-]{36}\/mask-\d+\.png$/);
    expect(saved.get(maskKey)!.type).toBe("image/png");
    const { width, height, px } = readPng(saved.get(maskKey)!.bytes);
    expect([width, height]).toEqual([1536, 1920]);
    expect(px(768, 1700)).toBe(255);
    expect(px(768, 300)).toBe(0); // the headline area stays black (kept)
    const body = sent[0]!;
    expect(body.mask_url).toBe(`https://w/m/${maskKey}`);
    expect(body.image_urls).toEqual([`https://w/m/${KEY}`, "https://w/m/brands/k1/ref2.jpg", "https://w/m/brands/k1/ref1.jpg"]);
    expect(body.prompt).toContain("Irregular puffed grains with a crackled caramel net.");
    expect(body.prompt).toContain("The jar stays almost empty");
    expect(body.prompt).toContain("Image 2 is a real close-up photo of this food. Image 3 is the real product as sold.");
    expect(body.quality).toBe("high");
    // The new final belongs to the same batch and idea, so the board and compose_final see it.
    expect(raw.prepare("SELECT batch, idea, kind FROM renders WHERE id = ?").get(out.id)).toEqual({ batch: "ba", idea: "idea-1", kind: "final" });
  });

  it("takes the food words from a later kit version when the pinned kit has none", async () => {
    const { env } = makeEnv({ laterFood: "Lumpy, split-open kernels." });
    const sent = stubFal();
    await foodFix(env, input);
    expect(sent[0]!.prompt).toContain("Lumpy, split-open kernels.");
    // The photos still come from the batch's pinned kit (version 1).
    expect(sent[0]!.image_urls).toEqual([`https://w/m/${KEY}`, "https://w/m/brands/k1/ref2.jpg", "https://w/m/brands/k1/ref1.jpg"]);
  });

  it("refuses without a food description, on a draft, and with a box outside the picture", async () => {
    stubFal();
    await expect(foodFix(makeEnv().env, input)).rejects.toThrow("no food description");
    await expect(foodFix(makeEnv({ food: "   " }).env, input)).rejects.toThrow("no food description");
    await expect(foodFix(makeEnv({ food: "f" }).env, { ...input, key: `renders/${RID}/2.jpg` })).rejects.toThrow("no saved image");
    await expect(foodFix(makeEnv({ food: "f", kind: "draft" }).env, input)).rejects.toThrow("not a completed final");
    await expect(foodFix(makeEnv({ food: "f" }).env, { ...input, boxes: [{ x: 90, y: 0, w: 20, h: 5 }] })).rejects.toThrow("inside the picture");
  });

  it("serves the mask at /m/ so fal can read it", async () => {
    const { env, saved } = makeEnv({ food: "f" });
    stubFal();
    await foodFix(env, input);
    const maskKey = [...saved.keys()].find((k) => k.includes("/mask-"))!;
    vi.unstubAllGlobals();
    const r = await worker.fetch(new Request(`https://w/m/${maskKey}`), env);
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toBe("image/png");
  });
});

describe("paste-back", () => {
  it("food_fix saves the paste plan before fal accepts; the result keeps the original outside the boxes", async () => {
    const { env, saved, calls } = makeEnv({ food: "f" });
    saved.set(KEY, { bytes: new TextEncoder().encode("original"), type: "image/jpeg" });
    let planAtSubmit = false;
    vi.stubGlobal("fetch", async () => {
      planAtSubmit = [...saved.keys()].some((k) => k.endsWith("/paste.json"));
      return new Response(JSON.stringify({ request_id: "r", status_url: "https://q/s", response_url: "https://q/r" }));
    });
    const out = await foodFix(env, input);
    expect(planAtSubmit).toBe(true);
    const plan = JSON.parse(String(saved.get(`renders/${out.id}/paste.json`)!.bytes));
    expect(plan).toEqual({ source: KEY, width: 1536, height: 1920, boxes: input.boxes });

    const merged = await pasteBack(env, out.id, new TextEncoder().encode("fixed").buffer as ArrayBuffer);
    expect(new TextDecoder().decode(merged!)).toBe("merged");
    // in1 = the original final (the base); in2 = the fal image, cropped to the box {x 40, y 80, w 35, h 15}
    // of 1536 x 1920 and drawn at the same place.
    expect(calls).toEqual([
      ["transform", "in2", { trim: { top: 1536, left: 614, width: 538, height: 288 } }],
      ["draw", "in1", "in2", { top: 1536, left: 614 }],
    ]);
  });

  it("returns null without a paste plan, and throws when a plan exists but the size differs", async () => {
    const { env, saved, size } = makeEnv({ food: "f" });
    saved.set(KEY, { bytes: new TextEncoder().encode("original"), type: "image/jpeg" });
    const bytes = new TextEncoder().encode("x").buffer as ArrayBuffer;
    expect(await pasteBack(env, RID, bytes)).toBeNull();
    stubFal();
    const out = await foodFix(env, input);
    size.width = 1024;
    await expect(pasteBack(env, out.id, bytes)).rejects.toThrow("1024 x 1920");
  });

  it("fails the render instead of saving the raw fal image when the paste cannot run", async () => {
    const { env, saved, size, raw } = makeEnv({ food: "f" });
    saved.set(KEY, { bytes: new TextEncoder().encode("original"), type: "image/jpeg" });
    stubFal();
    const out = await foodFix(env, input);
    size.width = 1024;
    vi.stubGlobal("fetch", async (u: string) =>
      u === "https://q/s" ? new Response(JSON.stringify({ status: "COMPLETED" }))
      : u === "https://q/r" ? new Response(JSON.stringify({ images: [{ url: "https://fal/img.jpg" }] }))
      : new Response("raw-fal-image"));
    const r = await check(env, out.id);
    expect(r.status).toBe("failed");
    expect((r as { error: string }).error).toContain("paste-back failed");
    expect(saved.has(`renders/${out.id}/1.jpg`)).toBe(false);
    expect(raw.prepare("SELECT status FROM renders WHERE id = ?").get(out.id)).toEqual({ status: "failed" });
  });
});
