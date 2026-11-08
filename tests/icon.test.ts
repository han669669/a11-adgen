import { describe, expect, it } from "vitest";
import { iconResponse } from "../worker/icon";

describe("icon", () => {
  it("serves the PNG at /icon.png and /favicon.ico", async () => {
    for (const path of ["/icon.png", "/favicon.ico"]) {
      const r = iconResponse(path)!;
      expect(r.headers.get("content-type")).toBe("image/png");
      const b = new Uint8Array(await r.arrayBuffer());
      expect([...b.slice(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    }
  });
  it("serves the SVG at /icon.svg", async () => {
    const r = iconResponse("/icon.svg")!;
    expect(r.headers.get("content-type")).toBe("image/svg+xml");
    expect(await r.text()).toContain("<svg");
  });
  it("sends nosniff on every icon and a script-blocking CSP on the SVG", () => {
    for (const path of ["/icon.png", "/favicon.ico", "/icon.svg"]) expect(iconResponse(path)!.headers.get("x-content-type-options")).toBe("nosniff");
    expect(iconResponse("/icon.svg")!.headers.get("content-security-policy")).toBe("default-src 'none'; sandbox");
    expect(iconResponse("/icon.png")!.headers.get("content-security-policy")).toBeNull();
  });
  it("keeps the SVG free of script, links and event handlers", async () => {
    const svg = await iconResponse("/icon.svg")!.text();
    expect(svg).not.toMatch(/<script|<foreignObject|<style|<a[\s/>]|\son\w+\s*=|\sstyle\s*=|href=|javascript:/i);
  });
  it("answers HEAD with the headers and no body", async () => {
    const { default: entry } = await import("../worker/entry");
    const r = await entry.fetch(new Request("https://x.example/icon.png", { method: "HEAD" }), { PUBLIC_BASE_URL: "https://x.example" } as any, {} as any);
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toBe("image/png");
    expect(await r.text()).toBe("");
  });
  it("ignores other paths", () => {
    expect(iconResponse("/mcp")).toBeNull();
  });
});
