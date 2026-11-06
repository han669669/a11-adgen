import { describe, expect, it } from "vitest";
import { toBase64 } from "../worker/b64";
import { SIZES, estimate, transient } from "../worker/fal";

describe("4:5 sizes", () => {
  it("are 4:5 and multiples of 16", () => {
    for (const s of Object.values(SIZES)) {
      expect(s.width * 5).toBe(s.height * 4);
      expect(s.width % 16).toBe(0);
      expect(s.height % 16).toBe(0);
    }
  });
  it("final stays under the 3.69 MP experimental line", () => {
    expect(SIZES.final.width * SIZES.final.height).toBeLessThan(3_686_400);
  });
});

describe("estimate", () => {
  it("prices 3 low drafts with 2 references", () => {
    expect(estimate("draft", 3, 2)).toBeCloseTo(0.041, 4);
  });
  it("prices 1 high final with 3 references", () => {
    expect(estimate("final", 1, 3)).toBeCloseTo(0.093, 4);
  });
});

describe("toBase64", () => {
  it("matches Buffer for a large body", () => {
    const bytes = new Uint8Array(200_000).map((_, i) => (i * 31) % 256);
    expect(toBase64(bytes.buffer)).toBe(Buffer.from(bytes).toString("base64"));
  });
});

describe("transient", () => {
  it("retries 429 and 5xx, not 4xx", () => {
    expect(transient(429)).toBe(true);
    expect(transient(503)).toBe(true);
    expect(transient(400)).toBe(false);
    expect(transient(404)).toBe(false);
  });
});

import { placement, RENDER_KEY } from "../worker/compose";

describe("compose placement", () => {
  it("turns percentages into pixels", () => {
    expect(placement(1536, 1920, 34, 5)).toEqual({ logoWidth: 522, top: 96 });
  });
  it("accepts only a raw render key, not a composed one", () => {
    expect(RENDER_KEY.test("renders/0f7bce2f-3394-41fa-8298-0b2289f68f6c/1.jpg")).toBe(true);
    expect(RENDER_KEY.test("renders/0f7bce2f-3394-41fa-8298-0b2289f68f6c/1-c.jpg")).toBe(false);
  });
});
