// Header-logo detection, ported from ai-ad-generator `tests/logohtml.test.ts`.
// Each case is a real site that once gave the wrong logo (a favicon, a press logo, a menu icon, a country flag).
import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { fileKey, headerLogos, isUiIconImg, isUiIconSvg, organizationLogo, siteName } from "../worker/logohtml";

const lb = readFileSync(new URL("./fixtures/lovebonito-header.html", import.meta.url), "utf8");

describe("headerLogos", () => {
  test("Love, Bonito: the inline SVG wordmark in the home link is found; there is no file to fetch", () => {
    expect(headerLogos(lb, "https://www.lovebonito.com/sg/", "www.lovebonito.com")).toEqual([{ kind: "svg" }]);
  });
  test("an image logo in a home link or a logo-named tag, resolved against the page", () => {
    const html = `<header><a href="/"><img alt="" srcset="/cdn/brand-wordmark.png 2x"></a><div class="site-logo"><img src="//cdn.example.com/b.webp"></div></header>`;
    expect(headerLogos(html, "https://shop.example.com/products/x", "Example")).toEqual([
      { kind: "img", url: "https://shop.example.com/cdn/brand-wordmark.png" },
      { kind: "img", url: "https://cdn.example.com/b.webp" },
    ]);
  });
  test("a link to another page or site is not a logo container; the header wins over the page body", () => {
    const links = `<header><a href="/collections/all"><svg><path d="M0 0h9v9z"/></svg></a><a href="https://press.example/"><img src="https://press.example/p.png"></a></header>`;
    expect(headerLogos(links, "https://brand.example/", "Brand")).toEqual([]);
    const both = `<header><a href="/"><img src="/head.png"></a></header><main><a href="/"><img src="/later.png"></a></main>`;
    expect(headerLogos(both, "https://brand.example/", "Brand")).toEqual([{ kind: "img", url: "https://brand.example/head.png" }]);
  });
  test("a page with a small header before the site header still finds the logo (ErgoTune)", () => {
    const html = `<header class="announcement"><p>Free shipping</p></header><div>x</div><header class="site"><h1 class="header__logo"><a href="/"><img src="https://ergotune.example/cdn/ET_LOGOMARK.png?width=850" class="header__logo-image"></a></h1></header>`;
    expect(headerLogos(html, "https://ergotune.example/", "ergotune.example")).toEqual([{ kind: "img", url: "https://ergotune.example/cdn/ET_LOGOMARK.png?width=850" }]);
  });
  test("an empty logo container, a lazy-loaded logo, a logo after an announcement header", () => {
    const url = "https://brand.example/";
    expect(headerLogos(`<header><div class="logo"></div><img src="/hero.jpg"></header>`, url, "Brand")).toEqual([]);
    expect(headerLogos(`<header><a href="/"><img src="data:image/gif;base64,R0lGOD" data-src="/logo.png"></a></header>`, url, "Brand")).toEqual([{ kind: "img", url: "https://brand.example/logo.png" }]);
    expect(headerLogos(`<header class="announcement">Free shipping</header><nav><a href="/" class="nav__home"><img src="/wordmark.png"></a></nav>`, url, "Brand")).toEqual([{ kind: "img", url: "https://brand.example/wordmark.png" }]);
  });
  test("a .ico file is not a logo", () => {
    expect(headerLogos(`<header><a href="/"><img src="/favicon.ico"></a></header>`, "https://brand.example/", "Brand")).toEqual([]);
  });
});

test("a product photo whose alt text names the brand is not a logo (Our Place)", () => {
  const url = "https://fromourplace.com/";
  const html = `<header><a href="/products/rice-cooker"><picture><img alt="A blue electric rice cooker with a digital display and wooden-handled spoon, labeled Our Place, sits on a wooden kitchen counter." src="/cdn/shop/files/rice-cooker-nav-feature.jpg?width=312"></picture></a><a href="/products/knife-trio-bundle"><img alt="Our place kitchen knife set, chefs knife, serrated knife and precise pairing knife" src="//fromourplace.com/cdn/shop/files/knife_trio1.jpg?width=80"></a><a data-mtr-target="logo" href="/" class="mx-auto shrink-0"><picture><img src="//fromourplace.com/cdn/shop/t/4642/assets/logo-dark.svg?v=1" alt="Go to Home page"></picture></a></header>`;
  expect(headerLogos(html, url, "Our Place")).toEqual([{ kind: "img", url: "https://fromourplace.com/cdn/shop/t/4642/assets/logo-dark.svg?v=1" }]);
  // A short label that names the brand still marks the logo.
  expect(headerLogos(`<header><img alt="Our Place logo" src="/w.png"><img title="Our Place" src="/w2.png"></header>`, url, "Our Place")).toEqual([
    { kind: "img", url: "https://fromourplace.com/w.png" },
    { kind: "img", url: "https://fromourplace.com/w2.png" },
  ]);
  expect(headerLogos(`<header><span aria-label="Our Place"><img src="/w3.png"></span></header>`, url, "Our Place")).toEqual([{ kind: "img", url: "https://fromourplace.com/w3.png" }]);
  expect(headerLogos(`<header><span aria-label="See the Our Place rice cooker in blue"><img src="/w4.png"></span></header>`, url, "Our Place")).toEqual([]);
  // The limit: three other words pass, four fail.
  expect(headerLogos(`<header><img alt="Our Place home page now" src="/a.png"></header>`, url, "Our Place")).toEqual([{ kind: "img", url: "https://fromourplace.com/a.png" }]);
  expect(headerLogos(`<header><img alt="Our Place home page now here" src="/b.png"></header>`, url, "Our Place")).toEqual([]);
});

describe("Gryphon Tea homepage (a checkmark icon came first; the name was the host)", () => {
  const html = readFileSync(new URL("./fixtures/gryphon-home.html", import.meta.url), "utf8");
  const url = "https://gryphontea.com/";
  test("the wordmark is the first header logo; the country list's checkmark in <a href=\"#\"> is not a logo", () => {
    const logos = headerLogos(html, url, "Gryphon Singapore");
    expect(logos[0]).toEqual({ kind: "img", url: expect.stringContaining("GRYPHON_Logo-FA-RGB_Wordmark-Dark") });
    expect(logos.some((l) => l.kind === "svg")).toBe(false);
  });
  test("the brand name comes from the site (og:site_name), and the JSON-LD Organization logo is the wordmark", () => {
    expect(siteName(html)).toBe("Gryphon Singapore");
    expect(organizationLogo(html, url)).toMatch(/Wordmark-Dark_cropped2\.png/);
  });
});

test("a link to \"#\", an empty href or javascript: is not a home link", () => {
  const url = "https://brand.example/";
  for (const href of ["#", "", "#top", "javascript:void(0)"]) expect(headerLogos(`<header><a href="${href}"><img src="/x.png"></a></header>`, url, "Brand")).toEqual([]);
  expect(headerLogos(`<header><a href="/"><img src="/w.png"></a></header>`, url, "Brand")).toEqual([{ kind: "img", url: "https://brand.example/w.png" }]);
});

test("UI icons are not logos: an icon class or name, or an unlabelled icon-sized viewBox; a labelled wordmark stays", () => {
  expect(isUiIconSvg(`<svg class="icon icon-checkmark" viewBox="0 0 12 9"><path d="M0 0"/></svg>`)).toBe(true);
  expect(isUiIconSvg(`<svg class="lucide lucide-search" viewBox="0 0 24 24"><path d="M0 0"/></svg>`)).toBe(true);
  expect(isUiIconSvg(`<svg aria-label="Cart" viewBox="0 0 40 40"><path d="M0 0"/></svg>`)).toBe(true);
  expect(isUiIconSvg(`<svg viewBox="0 0 20 20"><path d="M0 0"/></svg>`)).toBe(true);
  // Allies of Skin draws its wordmark with class "icon icon--wordmark": the logo word wins.
  expect(isUiIconSvg(`<svg class="icon icon--wordmark h-full" viewBox="0 0 167 16"><path d="M0 0"/></svg>`)).toBe(false);
  expect(isUiIconSvg(`<svg viewBox="0 0 211 26" data-testid="header-logo"><path d="M0 0"/></svg>`)).toBe(false);
  expect(isUiIconSvg(`<svg viewBox="0 0 120 40"><path d="M0 0"/></svg>`)).toBe(false);
  expect(isUiIconSvg(`<svg viewBox="0 0 24 24"><title>Brand logo</title><path d="M0 0"/></svg>`)).toBe(false);
  expect(headerLogos(`<header><a href="/"><svg class="icon icon-cart" viewBox="0 0 30 30"><path d="M0 0h9v9z"/></svg></a></header>`, "https://b.example/", "Brand")).toEqual([]);
});

test("site name: og:site_name, else JSON-LD Organization, else the title head; a bracketed region note goes", () => {
  expect(siteName(`<meta property="og:site_name" content="ALLIES [North America]">`)).toBe("ALLIES");
  expect(siteName(`<script type="application/ld+json">{"@graph":[{"@type":"Organization","name":"Fossa Chocolate"}]}</script><title>Home</title>`)).toBe("Fossa Chocolate");
  expect(siteName(`<title>Love, Bonito | Women's Fashion</title>`)).toBe("Love, Bonito");
  expect(siteName(`<title>Eu-Yan Sang - Shop</title>`)).toBe("Eu-Yan Sang");
  expect(siteName("")).toBe("");
});

describe("header logos from rendered HTML (a fragment link may be written as an absolute URL)", () => {
  test("Bacha: the country-picker flag in an \"…/en/#\" link is not the second logo", () => {
    const html = `<header><div data-region="header-logo"><a href="https://bachacoffee.com/en"><img src="https://media-brand.bachacoffee.com/images/default-source/illustrations-icons/bacha-coffee-logo/bacha-logo-desktop.png?sfvrsn=7b46ec06_2" alt="Bacha Coffee"></a></div><div class="bch-header__nav-cart"><p><a class="bch-header__nav-cart-header-shipping-location" href="https://bachacoffee.com/en/#" data-action="open-shipping-selector"><img src="https://media-brand.bachacoffee.com/images/default-source/country-flag-images/united-states.svg?sfvrsn=941cc0f9_2" alt=" Bacha Coffee Online Boutique | Shop Legendary Coffees &amp; Accessories " width="27" height="16"></a></p></div></header>`;
    expect(headerLogos(html, "https://bachacoffee.com/en/", "Bacha Coffee")).toEqual([
      { kind: "img", url: "https://media-brand.bachacoffee.com/images/default-source/illustrations-icons/bacha-coffee-logo/bacha-logo-desktop.png?sfvrsn=7b46ec06_2" },
    ]);
  });
  test("Prefer: the cart icon image in an \"…/#\" cart link is not the second logo", () => {
    const html = `<div class="nav_menu-copy"><a href="/" aria-current="page" class="nav_brand w-nav-brand w--current"><img src="https://cdn.prod.website-files.com/68e1/68e1d4_Main%20Logo.png" loading="lazy"></a></div><div class="w-commerce-commercecartwrapper"><a class="w-commerce-commercecartopenlink button" role="button" aria-label="Open cart" href="https://prefer.coffee/#"><img src="https://cdn.prod.website-files.com/68e1/6901f5_cart.svg" loading="lazy" alt="" class="cart-img"></a></div>`;
    expect(headerLogos(html, "https://prefer.coffee/", "Prefer")).toEqual([{ kind: "img", url: "https://cdn.prod.website-files.com/68e1/68e1d4_Main%20Logo.png" }]);
  });
  test("a home link with a fragment is an in-page link, not a home link", () => {
    for (const href of ["https://brand.example/#", "/#", "/en/#menu"]) expect(headerLogos(`<header><a href="${href}"><img src="/x.png"></a></header>`, "https://brand.example/", "Brand")).toEqual([]);
  });
  test("an icon image is not a logo even inside a logo-named box; a file named logo is", () => {
    expect(isUiIconImg(`<img class="cart-img" alt="">`, "https://cdn.example/a/6901f5_cart.svg")).toBe(true);
    expect(isUiIconImg(`<img alt="">`, "https://cdn.example/images/country-flag-images/united-states.svg")).toBe(true);
    expect(isUiIconImg(`<img alt="Search">`, "https://cdn.example/a/s.svg")).toBe(true);
    expect(isUiIconImg(`<img alt="Bacha Coffee">`, "https://cdn.example/illustrations-icons/bacha-coffee-logo/bacha-logo-desktop.png")).toBe(false);
    expect(isUiIconImg(`<img alt="">`, "https://cdn.example/cdn/shop/files/ET_LOGOMARK_2025_BLACK-01.png")).toBe(false);
    expect(isUiIconImg(`<img class="header__logo-image" alt="">`, "https://cdn.example/cdn/shop/files/cart-brand.png")).toBe(false);
    expect(isUiIconImg(`<img alt="">`, "https://cdn.example/assets/icon/images/sg.svg")).toBe(true);
    expect(isUiIconImg(`<img alt="">`, "https://cdn.example/a/%E0%A4%A.svg")).toBe(false);
    expect(headerLogos(`<header><div class="logo"><img class="icon-cart" src="/c.svg"></div></header>`, "https://b.example/", "Brand")).toEqual([]);
  });
  test("IRVINS: a mascot drawn from several SVG parts is not a logo; the image logo in the home link stays", () => {
    const html = `<header><a href="https://eatirvins.sg/" class="logo"><div class="primary-logo"><img src="https://eatirvins.sg/cdn/shop/files/irvins-logo.png?v=1&amp;width=250" alt="IRVINS SG"></div><div class="secondary-logo"><div class="character-wrapper"><div id="left-eye"><div id="left-eye-color"></div></div><div class="mouth"><div class="mouth-inner"><svg id="Layer_1" viewBox="0 0 45.00174 11.99371"><path class="cls-1" d="M.0001,5.84621c-.03586,4.77605,9.26667,6.05263,21.96455,6.13823"></path></svg></div></div><div class="svg-wrapper"><svg id="Layer_1" viewBox="0 0 83.86271 72"><path d="M0 0h80v70z"></path></svg></div></div></div></a></header>`;
    expect(headerLogos(html, "https://eatirvins.sg/", "IRVINS SG")).toEqual([{ kind: "img", url: "https://eatirvins.sg/cdn/shop/files/irvins-logo.png?v=1&width=250" }]);
  });
  test("a box with several SVGs still gives its logo when the first SVG names itself a logo, and a home link is never a parts picture", () => {
    const named = `<header><div class="brand-logo"><svg aria-label="Brand logo" viewBox="0 0 120 30"><path d="M0 0h9v9z"/></svg><svg class="chevron" viewBox="0 0 120 30"><path d="M0 0h9v9z"/></svg></div></header>`;
    expect(headerLogos(named, "https://b.example/", "Brand")).toHaveLength(1);
    const link = `<header><a href="/"><svg viewBox="0 0 120 30"><path d="M0 0h9v9z"/></svg><svg viewBox="0 0 120 31"><path d="M0 0h9v9z"/></svg></a></header>`;
    expect(headerLogos(link, "https://b.example/", "Brand")).toHaveLength(1);
  });
});

test("fileKey: one key per image file, whatever the size query says", () => {
  expect(fileKey("https://cdn.example/a/Logo.png?width=500")).toBe(fileKey("https://CDN.example/a/logo.png?width=600"));
  expect(fileKey("https://cdn.example/a/logo.png")).not.toBe(fileKey("https://cdn.example/a/other.png"));
});
