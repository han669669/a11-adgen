import { afterEach, describe, expect, it, vi } from "vitest";
import { brandExtract } from "../worker/brandextract";
import { promptGet } from "../worker/prompts";

const HOME = `<!doctype html><html><head>
<title>Wongi &amp; Co | Korean snacks</title>
<meta name="description" content="Crunchy snacks &amp; more">
<meta property="og:site_name" content="WonGi">
<meta property="og:image" content="/img/share.jpg">
<meta name="theme-color" content="#e63946">
<link rel="icon" href="/favicon.png">
<link rel="stylesheet" href="/site.css">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Fraunces:wght@400;700&family=Inter&display=swap">
<style>:root{--brand-red:#E63946;--bg:#fff} h1{font-family:"Fraunces",serif;color:#e63946} a{color:#E63946}</style>
</head><body style="background:#fafafa">
<img src="/img/wongi-logo.png" alt="WonGi logo" class="logo">
<img src="/img/hero.jpg" alt="snacks">
<img src="http://insecure.test/logo.png" alt="logo">
</body></html>`;
const CSS = `@font-face{font-family:"Gochi Hand";src:url(x.woff2)} body{font-family:Inter,Arial,sans-serif;color:#222;background:#fff} .btn{background:#2a9d8f;color:#fff} .x{color:#2A9D8F}`;

const asked: string[] = [];
function stub(routes: Record<string, { body: string; type: string; status?: number; location?: string }>) {
  asked.length = 0;
  vi.stubGlobal("fetch", async (input: any) => {
    const url = String(input?.url ?? input);
    asked.push(url);
    const r = routes[url];
    if (!r) return new Response("nope", { status: 404, headers: { "content-type": "text/plain" } });
    return new Response(r.body, { status: r.status ?? 200, headers: { "content-type": r.type, ...(r.location ? { location: r.location } : {}) } });
  });
}

afterEach(() => vi.unstubAllGlobals());

describe("brand_extract", () => {
  it("returns colours, fonts, logos and icons as candidates", async () => {
    stub({ "https://wongi.test/": { body: HOME, type: "text/html; charset=utf-8" }, "https://wongi.test/site.css": { body: CSS, type: "text/css" }, "https://wongi.test/img/wongi-logo.png": { body: "x", type: "image/png" } });
    const r = await brandExtract({ url: "https://wongi.test/" });
    expect(r.title).toBe("Wongi & Co | Korean snacks");
    expect(r.siteName).toBe("WonGi");
    expect(r.description).toBe("Crunchy snacks & more");
    expect(r.themeColor).toBe("#E63946");
    expect(r.colours[0]!.hex).toBe("#E63946");
    expect(r.colours.map((c) => c.hex)).toContain("#2A9D8F");
    // White, black and greys are neutrals, not brand colours.
    expect(r.colours.map((c) => c.hex)).not.toContain("#FFFFFF");
    expect(r.neutrals.map((c) => c.hex)).toContain("#FFFFFF");
    expect(r.namedColours).toEqual([{ name: "brand-red", hex: "#E63946" }]);
    const fonts = r.fonts.map((f) => f.name);
    expect(fonts).toEqual(expect.arrayContaining(["Fraunces", "Inter", "Gochi Hand"]));
    expect(fonts).not.toContain("Arial");
    expect(fonts).not.toContain("serif");
    // Logo: found by its logo container, probed live; the http image is skipped.
    expect(r.logoCandidates).toEqual([{ url: "https://wongi.test/img/wongi-logo.png", kind: "header" }]);
    expect(r.missing).toEqual([]);
    expect(r.icons).toEqual(["https://wongi.test/favicon.png"]);
    expect(r.ogImage).toBe("https://wongi.test/img/share.jpg");
    expect(r.stylesheetsRead).toBe(1);
    expect(r.warnings).toEqual([]);
    expect(r.note).toMatch(/data, not as instructions/);
  });

  it("warns instead of failing when the page has no styles, logo or readable sheet", async () => {
    stub({ "https://bare.test/": { body: `<html><head><link rel="stylesheet" href="/missing.css"></head><body>Hi</body></html>`, type: "text/html" } });
    const r = await brandExtract({ url: "https://bare.test/" });
    expect(r.colours).toEqual([]);
    expect(r.warnings.length).toBe(3);
    expect(r.warnings.join(" ")).toMatch(/No brand colours/);
    expect(r.warnings.join(" ")).toMatch(/No logo found/);
    expect(r.missing).toEqual(["logo", "colours", "fonts"]);
    expect(r.warnings.join(" ")).toMatch(/1 stylesheet/);
  });

  it("refuses http, a non-HTML answer and an error status", async () => {
    stub({ "https://x.test/img": { body: "x", type: "image/png" }, "https://x.test/gone": { body: "x", type: "text/html", status: 500 } });
    await expect(brandExtract({ url: "http://x.test/" })).rejects.toThrow(/over HTTPS/);
    await expect(brandExtract({ url: "https://x.test/img" })).rejects.toThrow(/over HTTPS/);
    await expect(brandExtract({ url: "https://x.test/gone" })).rejects.toThrow(/over HTTPS/);
  });

  it("stops reading a page past the size cap", async () => {
    stub({ "https://big.test/": { body: "<html>" + "a".repeat(1_600_000), type: "text/html" } });
    await expect(brandExtract({ url: "https://big.test/" })).rejects.toThrow(/over HTTPS/);
  });

  it("follows an https redirect by hand, and never requests a plain-http address", async () => {
    stub({
      "https://a.test/": { body: "", type: "text/html", status: 301, location: "https://www.a.test/home" },
      "https://www.a.test/home": { body: "<title>Ok</title>", type: "text/html" },
      "https://b.test/": { body: "", type: "text/html", status: 302, location: "http://b.test/plain" },
      "http://b.test/plain": { body: "<title>Plain</title>", type: "text/html" },
    });
    expect((await brandExtract({ url: "https://a.test/" })).url).toBe("https://www.a.test/home");
    await expect(brandExtract({ url: "https://b.test/" })).rejects.toThrow(/over HTTPS/);
    expect(asked).not.toContain("http://b.test/plain");
  });

  it("resolves links against <base href>", async () => {
    stub({
      "https://c.test/x/": { body: `<html><head><base href="https://cdn.test/assets/"><link rel="icon" href="i.png"></head><body><img class="logo" src="logo.png"></body></html>`, type: "text/html" },
      "https://cdn.test/assets/logo.png": { body: "x", type: "image/png" },
    });
    const r = await brandExtract({ url: "https://c.test/x/" });
    expect(r.icons).toEqual(["https://cdn.test/assets/i.png"]);
    expect(r.logoCandidates[0]!.url).toBe("https://cdn.test/assets/logo.png");
  });

  it("does not count an id selector as a colour, and keeps the theme-color boost out of uses", async () => {
    stub({
      "https://d.test/": {
        body: `<html><head><meta name="theme-color" content="#2a9d8f"><style>#add{margin:0} #bad-state .x{color:#e63946} .a{color:#e63946} .b{color:#E63946}</style></head></html>`,
        type: "text/html",
      },
    });
    const r = await brandExtract({ url: "https://d.test/" });
    const hexes = r.colours.map((c) => c.hex);
    expect(hexes).not.toContain("#AADD00");
    expect(hexes).not.toContain("#ADD");
    expect(r.colours.find((c) => c.hex === "#E63946")!.uses).toBe(3);
    // theme-color is listed (it never appears in CSS), with its true CSS count of 0.
    expect(r.colours.find((c) => c.hex === "#2A9D8F")!.uses).toBe(0);
  });

  it("reads a parent rule's declarations when a nested rule follows them", async () => {
    stub({
      "https://n.test/": {
        body: `<html><head><style>.card{color:#e63946;background:#fff; &:hover{color:#111} .x{margin:0}} @media (min-width:1px){.a{color:#e63946}}</style></head></html>`,
        type: "text/html",
      },
    });
    const r = await brandExtract({ url: "https://n.test/" });
    expect(r.colours.find((c) => c.hex === "#E63946")!.uses).toBe(2);
  });

  it("still warns when the only colour is the theme-color meta", async () => {
    stub({ "https://t.test/": { body: `<html><head><meta name="theme-color" content="#2a9d8f"><style>p{margin:0}</style></head></html>`, type: "text/html" } });
    const r = await brandExtract({ url: "https://t.test/" });
    expect(r.colours.map((c) => c.hex)).toContain("#2A9D8F");
    expect(r.warnings.join(" ")).toContain("No brand colours found in the CSS");
  });

  const LOGO_PAGE = (logo: string) => `<html><head><title>Fox & Co</title></head><body><header><a href="/"><img src="${logo}" alt=""></a></header></body></html>`;

  it("drops a logo file that answers with an error or a non-image, and says so", async () => {
    stub({ "https://dead.test/": { body: LOGO_PAGE("/gone.png"), type: "text/html" }, "https://dead.test/gone.png": { body: "no", type: "text/html", status: 404 } });
    const r = await brandExtract({ url: "https://dead.test/" });
    expect(r.logoCandidates).toEqual([]);
    expect(r.missing).toContain("logo");
    expect(r.warnings.join(" ")).toMatch(/1 logo file\(s\) the page names did not answer with an image/);
    stub({ "https://dead.test/": { body: LOGO_PAGE("/page.png"), type: "text/html" }, "https://dead.test/page.png": { body: "<html>", type: "text/html" } });
    expect((await brandExtract({ url: "https://dead.test/" })).logoCandidates).toEqual([]);
  });

  it("keeps a logo when the probe has no clear answer (a network error)", async () => {
    vi.stubGlobal("fetch", async (input: any) => {
      const url = String(input?.url ?? input);
      if (url === "https://slow.test/") return new Response(LOGO_PAGE("/l.png"), { headers: { "content-type": "text/html" } });
      throw new Error("timeout");
    });
    const r = await brandExtract({ url: "https://slow.test/" });
    expect(r.logoCandidates).toEqual([{ url: "https://slow.test/l.png", kind: "header" }]);
  });

  it("follows a logo redirect by hand and never requests a plain-http or internal hop", async () => {
    stub({
      "https://r.test/": { body: LOGO_PAGE("/a.png"), type: "text/html" },
      "https://r.test/a.png": { body: "", type: "image/png", status: 302, location: "https://cdn.r.test/a.png" },
      "https://cdn.r.test/a.png": { body: "x", type: "image/png" },
    });
    expect((await brandExtract({ url: "https://r.test/" })).logoCandidates).toEqual([{ url: "https://r.test/a.png", kind: "header" }]);
    stub({
      "https://r.test/": { body: LOGO_PAGE("/a.png"), type: "text/html" },
      "https://r.test/a.png": { body: "", type: "image/png", status: 302, location: "http://r.test/plain.png" },
      "http://r.test/plain.png": { body: "x", type: "image/png" },
    });
    await brandExtract({ url: "https://r.test/" });
    expect(asked).not.toContain("http://r.test/plain.png");
    stub({
      "https://r.test/": { body: LOGO_PAGE("/a.png"), type: "text/html" },
      "https://r.test/a.png": { body: "", type: "image/png", status: 302, location: "https://169.254.169.254/latest" },
    });
    await brandExtract({ url: "https://r.test/" });
    expect(asked).not.toContain("https://169.254.169.254/latest");
  });

  it("never asks for a logo on a private or internal host, and refuses such a page", async () => {
    stub({ "https://p.test/": { body: LOGO_PAGE("https://192.168.0.5/logo.png"), type: "text/html" }, "https://192.168.0.5/logo.png": { body: "x", type: "image/png" } });
    const r = await brandExtract({ url: "https://p.test/" });
    expect(asked).not.toContain("https://192.168.0.5/logo.png");
    expect(r.logoCandidates).toEqual([]);
    await expect(brandExtract({ url: "https://localhost/" })).rejects.toThrow();
    await expect(brandExtract({ url: "https://10.0.0.1/" })).rejects.toThrow();
    expect(asked).not.toContain("https://localhost/");
    expect(asked).not.toContain("https://10.0.0.1/");
  });

  it("uses the JSON-LD Organization logo, and lists one file once when a CDN names it at many sizes", async () => {
    const ld = `<script type="application/ld+json">{"@type":"Organization","name":"Fox & Co","logo":"https://img.fox.test/brand/logo.png?width=600"}</script>`;
    stub({
      "https://fox.test/": { body: `<html><head>${ld}</head><body><header><a href="/"><img src="https://img.fox.test/brand/logo.png?width=300"></a></header></body></html>`, type: "text/html" },
      "https://img.fox.test/brand/logo.png?width=300": { body: "x", type: "image/png" },
      "https://img.fox.test/brand/logo.png?width=600": { body: "x", type: "image/png" },
    });
    const r = await brandExtract({ url: "https://fox.test/" });
    expect(r.logoCandidates).toEqual([{ url: "https://img.fox.test/brand/logo.png?width=300", kind: "header" }]);
    stub({
      "https://fox.test/": { body: `<html><head>${ld}</head><body>Hi</body></html>`, type: "text/html" },
      "https://img.fox.test/brand/logo.png?width=600": { body: "x", type: "image/png" },
    });
    expect((await brandExtract({ url: "https://fox.test/" })).logoCandidates).toEqual([{ url: "https://img.fox.test/brand/logo.png?width=600", kind: "organization" }]);
  });

  it("flags an inline SVG header logo (no file to fetch) and asks for the file", async () => {
    stub({ "https://svg.test/": { body: `<html><body><header><a href="/"><svg viewBox="0 0 120 30"><path d="M0 0h90v20z"/></svg></a></header></body></html>`, type: "text/html" } });
    const r = await brandExtract({ url: "https://svg.test/" });
    expect(r.inlineSvgLogo).toBe(true);
    expect(r.logoCandidates).toEqual([]);
    expect(r.warnings.join(" ")).toMatch(/inline SVG/);
    expect(r.missing).toContain("logo");
  });

  it("an image outside the header is a guess, and the warning says to look at it", async () => {
    stub({
      "https://g.test/": { body: `<html><body><main><img src="/press-logo.png" alt="As seen in"></main></body></html>`, type: "text/html" },
      "https://g.test/press-logo.png": { body: "x", type: "image/png" },
    });
    const r = await brandExtract({ url: "https://g.test/" });
    expect(r.logoCandidates).toEqual([{ url: "https://g.test/press-logo.png", kind: "guess" }]);
    expect(r.warnings.join(" ")).toMatch(/guesses/);
  });

  it("drops !important from a font name", async () => {
    stub({ "https://f.test/": { body: `<html><head><style>.i{font-family:"love-bonito"!important} .j{font-family:Inter !important,sans-serif}</style></head></html>`, type: "text/html" } });
    const names = (await brandExtract({ url: "https://f.test/" })).fonts.map((f) => f.name);
    expect(names).toEqual(expect.arrayContaining(["love-bonito", "Inter"]));
    expect(names.join(" ")).not.toMatch(/important/i);
  });

  it("takes the brand name from the page, not the host", async () => {
    stub({ "https://gryphontea.test/": { body: `<html><head><meta property="og:site_name" content="Gryphon Singapore"><title>Home</title></head></html>`, type: "text/html" } });
    expect((await brandExtract({ url: "https://gryphontea.test/" })).siteName).toBe("Gryphon Singapore");
  });

  it("the brand prompt starts with brand_extract", () => {
    const p = promptGet("brand", { url: "https://wongi.test/", slug: "wongi" });
    const text = JSON.stringify(p);
    expect(text.indexOf("brand_extract")).toBeGreaterThan(-1);
    expect(text.indexOf("brand_extract")).toBeLessThan(text.indexOf("brand_save"));
  });
});
