import { describe, expect, it } from "vitest";
import { isPublicHost, isPublicHttpsUrl } from "../worker/urlsafety";

describe("isPublicHost", () => {
  it("accepts ordinary public names and addresses", () => {
    for (const h of ["example.com", "www.catandthefiddle.com", "cdn.shop.example.co.uk", "8.8.8.8", "1.1.1.1", "172.15.0.1", "172.32.0.1", "100.63.0.1", "100.128.0.1"]) expect(isPublicHost(h), h).toBe(true);
  });
  it("refuses loopback, private, link-local, metadata and carrier-grade addresses", () => {
    for (const h of ["127.0.0.1", "10.0.0.5", "172.16.0.1", "172.31.255.255", "192.168.1.1", "169.254.169.254", "100.64.0.1", "100.127.255.255", "0.0.0.0", "224.0.0.1", "255.255.255.255"]) expect(isPublicHost(h), h).toBe(false);
  });
  it("refuses internal names and single labels", () => {
    for (const h of ["localhost", "intranet", "printer.local", "db.internal", "nas.lan", "x.home", "app.corp", "a.localhost", "LOCALHOST", "localhost."]) expect(isPublicHost(h), h).toBe(false);
  });
  it("refuses IPv6 loopback, unique-local, link-local and mapped addresses; accepts a public one", () => {
    for (const h of ["[::1]", "::1", "[::]", "[fd12:3456::1]", "[fc00::1]", "[fe80::1]", "[fe90::1]", "[::ffff:127.0.0.1]", "[::127.0.0.1]", "::7f00:1", "[::a00:1]"]) expect(isPublicHost(h), h).toBe(false);
    expect(isPublicHost("[2606:4700:4700::1111]")).toBe(true);
  });
});

describe("isPublicHttpsUrl", () => {
  it("needs https and a public host", () => {
    expect(isPublicHttpsUrl("https://example.com/logo.png")).toBe(true);
    expect(isPublicHttpsUrl("http://example.com/logo.png")).toBe(false);
    expect(isPublicHttpsUrl("https://127.0.0.1/logo.png")).toBe(false);
    expect(isPublicHttpsUrl("https://localhost/logo.png")).toBe(false);
    expect(isPublicHttpsUrl("https://169.254.169.254/latest/meta-data")).toBe(false);
    expect(isPublicHttpsUrl("not a url")).toBe(false);
    expect(isPublicHttpsUrl("file:///etc/passwd")).toBe(false);
  });
});
