import { describe, expect, it } from "vitest";
import { iconResponse } from "../worker/icon";

describe("icon", () => {
  it("serves the PNG at /icon.png and /favicon.ico", async () => {
    for (const path of ["/icon.png", "/favicon.ico"]) {
      const r = iconResponse(path)!;
      expect(r.headers.get("content-type")).toBe("image/png");
      const b = new Uint8Array(await r.arrayBuffer());
      expect([...b.slice(1, 4)]).toEqual([0x50, 0x4e, 0x47]);
    }
  });
  it("serves the SVG at /icon.svg", async () => {
    const r = iconResponse("/icon.svg")!;
    expect(r.headers.get("content-type")).toBe("image/svg+xml");
    expect(await r.text()).toContain("<svg");
  });
  it("ignores other paths", () => {
    expect(iconResponse("/mcp")).toBeNull();
  });
});
